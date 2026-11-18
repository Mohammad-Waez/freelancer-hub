import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/interfaces/auth-user.interface.js';
import { Paginated } from '../common/responses/paginated.js';
import { money } from '../common/utils/money.util.js';
import {
  OfferStatus,
  Prisma,
  ProjectStatus,
  Role,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FileStorageService,
  type UploadedFileData,
} from '../storage/file-storage.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';
import type { ListMyProjectsDto } from './dto/list-my-projects.dto.js';
import type { ListProjectsDto, ProjectSort } from './dto/list-projects.dto.js';
import type { UpdateProjectDto } from './dto/update-project.dto.js';
import { CANCEL_GRACE_DAYS, DAY_MS } from './project-rules.js';
import { refundHeldAmount } from './refund-project.js';

const projectSelect = {
  id: true,
  title: true,
  description: true,
  budget: true,
  status: true,
  attachmentPath: true,
  createdAt: true,
  dueAt: true,
  category: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
  ) {}

  async create(
    ownerId: number,
    dto: CreateProjectDto,
    file?: UploadedFileData,
  ) {
    await this.assertCategoryExists(dto.categoryId);

    const attachmentPath = file
      ? await this.storage.save('project-attachment', file)
      : null;

    try {
      const project = await this.prisma.project.create({
        data: {
          ownerId,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description,
          budget: new Prisma.Decimal(dto.budget),
          attachmentPath,
        },
        select: projectSelect,
      });
      return this.toView(project);
    } catch (error) {
      // do not leave an orphan file if the record was not saved
      if (attachmentPath) await this.storage.remove(attachmentPath);
      throw error;
    }
  }

  /** The browsing page for freelancers: open projects only. */
  async findOpen(query: ListProjectsDto) {
    const where: Prisma.ProjectWhereInput = {
      status: ProjectStatus.OPEN,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: this.orderBy(query.sort),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: projectSelect,
      }),
      this.prisma.project.count({ where }),
    ]);

    return Paginated.of(
      items.map((p) => this.toView(p)),
      total,
      query.page,
      query.limit,
    );
  }

  /** The owner's own projects, in every status. */
  async findMine(ownerId: number, query: ListMyProjectsDto) {
    const where: Prisma.ProjectWhereInput = {
      ownerId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: projectSelect,
      }),
      this.prisma.project.count({ where }),
    ]);

    return Paginated.of(
      items.map((p) => this.toView(p)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: number, user: AuthUser) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: projectSelect,
    });

    // 404 (not 403) so nobody can probe which ids exist
    if (!project || !(await this.canView(project, user))) {
      throw new NotFoundException('Project not found');
    }
    return this.toView(project);
  }

  async update(
    id: number,
    ownerId: number,
    dto: UpdateProjectDto,
    file?: UploadedFileData,
  ) {
    const current = await this.assertOwnedAndOpen(id, ownerId);
    if (dto.categoryId !== undefined) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const newAttachment = file
      ? await this.storage.save('project-attachment', file)
      : undefined;

    const data: Prisma.ProjectUncheckedUpdateManyInput = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
      ...(dto.budget !== undefined && {
        budget: new Prisma.Decimal(dto.budget),
      }),
      ...(newAttachment
        ? { attachmentPath: newAttachment }
        : dto.removeAttachment
          ? { attachmentPath: null }
          : {}),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    try {
      // the status condition is repeated here: if an offer was accepted
      // a moment ago, nothing is updated
      const result = await this.prisma.project.updateMany({
        where: { id, ownerId, status: ProjectStatus.OPEN },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException('Only open projects can be modified');
      }
    } catch (error) {
      if (newAttachment) await this.storage.remove(newAttachment);
      throw error;
    }

    // the old file is deleted only after the update succeeded
    if (current.attachmentPath && (newAttachment || dto.removeAttachment)) {
      await this.storage.remove(current.attachmentPath);
    }

    const updated = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      select: projectSelect,
    });
    return this.toView(updated);
  }

  async remove(id: number, ownerId: number) {
    const current = await this.assertOwnedAndOpen(id, ownerId);

    // offers of an open project are deleted with it (cascade)
    const result = await this.prisma.project.deleteMany({
      where: { id, ownerId, status: ProjectStatus.OPEN },
    });
    if (result.count === 0) {
      throw new ConflictException('Only open projects can be deleted');
    }

    if (current.attachmentPath) {
      await this.storage.remove(current.attachmentPath);
    }
  }


  /**
   * The client cancels a LATE project and gets the held money back.
   * Allowed only after the deadline + the grace period, and only when
   * there is no pending delivery. One transaction: all steps or none.
   */
  async cancelByOwner(projectId: number, ownerId: number) {
    return this.prisma.$transaction(async (tx) => {
      // same lock as accept / approve / admin cancel
      const rows = await tx.$queryRaw<
        { ownerId: number; status: string; dueAt: Date | null }[]
      >`
        SELECT "ownerId", "status"::text AS "status", "dueAt"
        FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      const project = rows[0];

      // 404 (not 403) so nobody can probe which ids exist
      if (!project || project.ownerId !== ownerId) {
        throw new NotFoundException('Project not found');
      }
      if (project.status !== ProjectStatus.IN_PROGRESS) {
        throw new ConflictException(
          'Only projects in progress can be cancelled',
        );
      }
      if (!project.dueAt) {
        throw new ConflictException('This project has no deadline');
      }

      const cancellableAt = new Date(
        new Date(project.dueAt).getTime() + CANCEL_GRACE_DAYS * DAY_MS,
      );
      if (cancellableAt > new Date()) {
        throw new ConflictException(
          `You can cancel only after ${cancellableAt.toISOString()}`,
        );
      }

      const pending = await tx.delivery.count({
        where: { projectId, status: 'PENDING' },
      });
      if (pending > 0) {
        throw new ConflictException(
          'There is a pending delivery: approve or reject it first',
        );
      }

      const refunded = await refundHeldAmount(tx, {
        projectId,
        ownerId,
        note: 'Project cancelled by the client after the deadline',
      });

      return {
        project: { id: projectId, status: ProjectStatus.CANCELLED },
        refunded: money(refunded),
      };
    });
  }



  // ---------------------------------------------------------------

  private toView(project: ProjectRow) {
    const { attachmentPath, ...rest } = project;
    const inProgress = rest.status === ProjectStatus.IN_PROGRESS;

    return {
      ...rest,
      budget: money(rest.budget),
      attachmentUrl: this.storage.publicUrl(attachmentPath),
      // late: the deadline has passed and the project is still in progress
      isOverdue: inProgress && rest.dueAt !== null && rest.dueAt < new Date(),
      // the first moment the client may cancel and get his money back
      cancellableAt:
        inProgress && rest.dueAt
          ? new Date(rest.dueAt.getTime() + CANCEL_GRACE_DAYS * DAY_MS)
          : null,
    };
  }

  private async canView(project: ProjectRow, user: AuthUser) {
    if (user.role === Role.ADMIN) return true;
    if (project.owner.id === user.id) return true;
    if (user.role !== Role.FREELANCER) return false;
    if (project.status === ProjectStatus.OPEN) return true;

    // not open: only the freelancer whose offer was accepted
    const accepted = await this.prisma.offer.count({
      where: {
        projectId: project.id,
        freelancerId: user.id,
        status: OfferStatus.ACCEPTED,
      },
    });
    return accepted > 0;
  }

  private async assertOwnedAndOpen(id: number, ownerId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { ownerId: true, status: true, attachmentPath: true },
    });
    if (!project || project.ownerId !== ownerId) {
      throw new NotFoundException('Project not found');
    }
    if (project.status !== ProjectStatus.OPEN) {
      throw new ConflictException('Only open projects can be modified');
    }
    return { attachmentPath: project.attachmentPath };
  }

  private async assertCategoryExists(categoryId: number) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Category does not exist');
  }

  private orderBy(sort: ProjectSort): Prisma.ProjectOrderByWithRelationInput[] {
    switch (sort) {
      case 'budget_asc':
        return [{ budget: 'asc' }, { id: 'desc' }];
      case 'budget_desc':
        return [{ budget: 'desc' }, { id: 'desc' }];
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }
}
