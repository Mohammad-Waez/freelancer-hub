import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Paginated } from '../common/responses/paginated.js';
import { money } from '../common/utils/money.util.js';
import { OfferStatus, Prisma, ProjectStatus, TransactionType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStorageService } from '../storage/file-storage.service.js';
import type { CreateOfferDto } from './dto/create-offer.dto.js';
import type { ListOffersDto } from './dto/list-offers.dto.js';
import type { UpdateOfferDto } from './dto/update-offer.dto.js';
import { DAY_MS } from '../projects/project-rules.js';

const offerSelect = {
  id: true,
  projectId: true,
  price: true,
  durationDays: true,
  message: true,
  status: true,
  createdAt: true,
} satisfies Prisma.OfferSelect;

type OfferRow = Prisma.OfferGetPayload<{ select: typeof offerSelect }>;

const offerForOwnerSelect = {
  ...offerSelect,
  freelancer: {
    select: {
      id: true,
      name: true,
      profile: { select: { hourlyRate: true, photoPath: true } },
    },
  },
} satisfies Prisma.OfferSelect;

type OwnerOfferRow = Prisma.OfferGetPayload<{
  select: typeof offerForOwnerSelect;
}>;

const offerWithProjectSelect = {
  ...offerSelect,
    project: {
    select: { id: true, title: true, status: true, budget: true, dueAt: true },
  
  },
} satisfies Prisma.OfferSelect;

type MyOfferRow = Prisma.OfferGetPayload<{
  select: typeof offerWithProjectSelect;
}>;

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
  ) {}

  async create(projectId: number, freelancerId: number, dto: CreateOfferDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, budget: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    // the rule exists in the spec; roles already make it impossible
    if (project.ownerId === freelancerId) {
      throw new ForbiddenException(
        'You cannot make an offer on your own project',
      );
    }

    const price = new Prisma.Decimal(dto.price);
    if (price.gt(project.budget)) {
      throw new BadRequestException(
        'Offer price cannot exceed the project budget',
      );
    }

    try {
      const offer = await this.prisma.$transaction(async (tx) => {
        // FOR SHARE: while we insert, the project cannot be switched to
        // "in progress" by a concurrent acceptance (and the reverse)
        const open = await tx.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "Project"
          WHERE "id" = ${projectId} AND "status" = 'OPEN'
          FOR SHARE`;
        if (open.length === 0) {
          throw new ConflictException(
            'Offers can only be submitted on open projects',
          );
        }

        return tx.offer.create({
          data: {
            projectId,
            freelancerId,
            price,
            durationDays: dto.durationDays,
            message: dto.message,
          },
          select: offerSelect,
        });
      });
      return this.toView(offer);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You have already submitted an offer on this project',
        );
      }
      throw error;
    }
  }

  /** The owner of a project sees all offers on it (never someone else's). */
  async listForProject(
    projectId: number,
    ownerId: number,
    query: ListOffersDto,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    // 404 (not 403) so nobody can probe which ids exist
    if (!project || project.ownerId !== ownerId) {
      throw new NotFoundException('Project not found');
    }

    // offers of banned freelancers are hidden
    const where: Prisma.OfferWhereInput = {
      projectId,
      freelancer: { isBanned: false },
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.offer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: offerForOwnerSelect,
      }),
      this.prisma.offer.count({ where }),
    ]);

    return Paginated.of(
      items.map((o) => this.toOwnerView(o)),
      total,
      query.page,
      query.limit,
    );
  }

  /** A freelancer's own offers, with the status of each one. */
  async listMine(freelancerId: number, query: ListOffersDto) {
    const where: Prisma.OfferWhereInput = {
      freelancerId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.offer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: offerWithProjectSelect,
      }),
      this.prisma.offer.count({ where }),
    ]);

    return Paginated.of(
      items.map((o) => this.toMineView(o)),
      total,
      query.page,
      query.limit,
    );
  }

  async update(id: number, freelancerId: number, dto: UpdateOfferDto) {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      select: {
        freelancerId: true,
        status: true,
        project: { select: { status: true, budget: true } },
      },
    });
    if (!offer || offer.freelancerId !== freelancerId) {
      throw new NotFoundException('Offer not found');
    }
    if (
      offer.status !== OfferStatus.PENDING ||
      offer.project.status !== ProjectStatus.OPEN
    ) {
      throw new ConflictException(
        'Only pending offers on open projects can be modified',
      );
    }
    if (
      dto.price !== undefined &&
      new Prisma.Decimal(dto.price).gt(offer.project.budget)
    ) {
      throw new BadRequestException(
        'Offer price cannot exceed the project budget',
      );
    }

    const data: Prisma.OfferUncheckedUpdateManyInput = {
      ...(dto.price !== undefined && { price: new Prisma.Decimal(dto.price) }),
      ...(dto.durationDays !== undefined && {
        durationDays: dto.durationDays,
      }),
      ...(dto.message !== undefined && { message: dto.message }),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    // conditions are repeated: if the offer was accepted or rejected a
    // moment ago, nothing is updated
    const result = await this.prisma.offer.updateMany({
      where: {
        id,
        freelancerId,
        status: OfferStatus.PENDING,
        project: { status: ProjectStatus.OPEN },
      },
      data,
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Only pending offers on open projects can be modified',
      );
    }

    const updated = await this.prisma.offer.findUniqueOrThrow({
      where: { id },
      select: offerSelect,
    });
    return this.toView(updated);
  }



    /**
   * Accepts an offer: holds its price from the client's wallet.
   * Everything happens in ONE transaction: all steps or none.
   */
  async accept(offerId: number, ownerId: number, expectedPrice: number) {
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.offer.findUnique({
        where: { id: offerId },
        select: { projectId: true },
      });
      if (!ref) throw new NotFoundException('Offer not found');

      // 1. lock the project: concurrent acceptances / new offers wait here
      const projects = await tx.$queryRaw<
        { ownerId: number; status: string }[]
      >`
        SELECT "ownerId", "status"::text AS "status"
        FROM "Project" WHERE "id" = ${ref.projectId} FOR UPDATE`;
      const project = projects[0];

      // 404 (not 403) so nobody can probe which ids exist
      if (!project || project.ownerId !== ownerId) {
        throw new NotFoundException('Offer not found');
      }
      if (project.status !== ProjectStatus.OPEN) {
        throw new ConflictException('This project is no longer open');
      }

      // 2. lock the offer: the freelancer cannot edit it while we decide
           const offers = await tx.$queryRaw<
        {
          freelancerId: number;
          price: string;
          status: string;
          durationDays: number;
        }[]
      >`
        SELECT "freelancerId", "price"::text AS "price",
               "status"::text AS "status", "durationDays"
        FROM "Offer" WHERE "id" = ${offerId} FOR UPDATE`;
      const offer = offers[0];
      if (!offer) throw new NotFoundException('Offer not found');

      if (offer.status !== OfferStatus.PENDING) {
        throw new ConflictException('This offer is no longer pending');
      }

      const freelancer = await tx.user.findUnique({
        where: { id: offer.freelancerId },
        select: { isBanned: true },
      });
      if (!freelancer || freelancer.isBanned) {
        throw new ConflictException('This freelancer is no longer available');
      }

      const price = new Prisma.Decimal(offer.price);
      if (!price.eq(new Prisma.Decimal(expectedPrice))) {
        throw new ConflictException('Offer has changed');
      }

      // 3. one conditional statement: debit only if the balance is enough
      const debited = await tx.wallet.updateMany({
        where: { userId: ownerId, balance: { gte: price } },
        data: { balance: { decrement: price } },
      });
      if (debited.count !== 1) {
        throw new ConflictException('Insufficient balance');
      }

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: ownerId },
        select: { id: true, balance: true },
      });

      // 4. the held money is recorded as a negative HOLD movement
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          projectId: ref.projectId,
          type: TransactionType.HOLD,
          amount: price.neg(),
        },
      });

      // 5. this offer accepted, every other offer rejected, project started
      await tx.offer.update({
        where: { id: offerId },
        data: { status: OfferStatus.ACCEPTED },
      });
      await tx.offer.updateMany({
        where: {
          projectId: ref.projectId,
          id: { not: offerId },
          status: OfferStatus.PENDING,
        },
        data: { status: OfferStatus.REJECTED },
      });
            // the deadline starts now and lasts as long as the offer duration
      const dueAt = new Date(Date.now() + offer.durationDays * DAY_MS);

      await tx.project.update({
        where: { id: ref.projectId },
        data: { status: ProjectStatus.IN_PROGRESS, dueAt },
      });

      return {
        offer: {
          id: offerId,
          status: OfferStatus.ACCEPTED,
          price: money(price),
        },
        project: {
          id: ref.projectId,
          status: ProjectStatus.IN_PROGRESS,
          dueAt,
        },
        balance: money(wallet.balance),
      };
    });
  }

  // ---------------------------------------------------------------

  private toView(offer: OfferRow) {
    return { ...offer, price: money(offer.price) };
  }

  private toOwnerView(offer: OwnerOfferRow) {
    const { freelancer, ...rest } = offer;
    return {
      ...this.toView(rest),
      freelancer: {
        id: freelancer.id,
        name: freelancer.name,
        hourlyRate: freelancer.profile?.hourlyRate
          ? money(freelancer.profile.hourlyRate)
          : null,
        photoUrl: this.storage.publicUrl(freelancer.profile?.photoPath ?? null),
      },
    };
  }

   private toMineView(offer: MyOfferRow) {
    const { project, ...rest } = offer;
    return {
      ...this.toView(rest),
      project: {
        ...project,
        budget: money(project.budget),
        isOverdue:
          project.status === ProjectStatus.IN_PROGRESS &&
          project.dueAt !== null &&
          project.dueAt < new Date(),
      },
    };
  }
}