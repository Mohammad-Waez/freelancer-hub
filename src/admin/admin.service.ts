import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import {
  DeliveryStatus,
  OfferStatus,
  ProjectStatus,
  Role,
  TransactionType,
} from '../generated/prisma/client.js';
import { Paginated } from '../common/responses/paginated.js';
import { money } from '../common/utils/money.util.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import { refundHeldAmount } from '../projects/refund-project.js';

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isBanned: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------
  // users
  // ---------------------------------------------------------------

  async listUsers(query: ListUsersDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isBanned !== undefined ? { isBanned: query.isBanned } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: userSelect,
      }),
      this.prisma.user.count({ where }),
    ]);

    return Paginated.of(items, total, query.page, query.limit);
  }

  async ban(targetId: number, adminId: number) {
    if (targetId === adminId) {
      throw new ForbiddenException('You cannot ban yourself');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.ADMIN) {
      throw new ForbiddenException('Admin accounts cannot be banned');
    }

    // one transaction: the ban and the end of all his sessions
    // (banning an already banned user is harmless)
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: { isBanned: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { id: targetId, isBanned: true };
  }

  async unban(targetId: number) {
    const result = await this.prisma.user.updateMany({
      where: { id: targetId },
      data: { isBanned: false },
    });
    if (result.count === 0) throw new NotFoundException('User not found');

    return { id: targetId, isBanned: false };
  }

  // ---------------------------------------------------------------
  // projects
  // ---------------------------------------------------------------

  /** In-progress projects whose accepted freelancer is banned. */
  async listBlockedProjects(query: PaginationQueryDto) {
    const where: Prisma.ProjectWhereInput = {
      status: ProjectStatus.IN_PROGRESS,
      offers: {
        some: {
          status: OfferStatus.ACCEPTED,
          freelancer: { isBanned: true },
        },
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          title: true,
          createdAt: true,
          owner: { select: { id: true, name: true } },
          offers: {
            where: { status: OfferStatus.ACCEPTED },
            take: 1,
            select: {
              price: true,
              freelancer: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    return Paginated.of(
      items.map(({ offers, ...project }) => ({
        ...project,
        heldAmount: money(offers[0].price),
        freelancer: offers[0].freelancer,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Cancels an in-progress project whose freelancer is banned and gives the
   * held money back to the client. One transaction: all steps or none.
   */
    async cancelBlockedProject(projectId: number) {
    return this.prisma.$transaction(async (tx) => {
      // same lock as approval: a payment and a cancellation cannot overlap
      const projects = await tx.$queryRaw<
        { ownerId: number; status: string }[]
      >`
        SELECT "ownerId", "status"::text AS "status"
        FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      const project = projects[0];

      if (!project) throw new NotFoundException('Project not found');
      if (project.status !== ProjectStatus.IN_PROGRESS) {
        throw new ConflictException(
          'Only projects in progress can be cancelled',
        );
      }

      const accepted = await tx.offer.findFirst({
        where: { projectId, status: OfferStatus.ACCEPTED },
        select: { freelancer: { select: { isBanned: true } } },
      });
      if (!accepted) {
        throw new Error(`No accepted offer for project ${projectId}`);
      }
      if (!accepted.freelancer.isBanned) {
        throw new ConflictException(
          'The freelancer of this project is not banned',
        );
      }

      const refunded = await refundHeldAmount(tx, {
        projectId,
        ownerId: project.ownerId,
        note: 'Project cancelled by admin',
      });

      return {
        project: { id: projectId, status: ProjectStatus.CANCELLED },
        refunded: money(refunded),
      };
    });
  }
}