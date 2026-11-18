import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  DeliveryStatus,
  OfferStatus,
  ProjectStatus,
  Role,
  TransactionType,
} from '../generated/prisma/client.js';
import type { AuthUser } from '../common/interfaces/auth-user.interface.js';
import { money } from '../common/utils/money.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PlatformService } from '../platform/platform.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FileStorageService,
  type UploadedFileData,
} from '../storage/file-storage.service.js';
import type { RejectDeliveryDto } from './dto/reject-delivery.dto.js';
import { DAY_MS } from '../projects/project-rules.js';

const COMMISSION_RATE = '0.1';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

const deliverySelect = {
  id: true,
  projectId: true,
  status: true,
  clientNote: true,
  createdAt: true,
} satisfies Prisma.DeliverySelect;

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly platform: PlatformService,
  ) {}

  // ---------------------------------------------------------------
  // freelancer: submit a delivery
  // ---------------------------------------------------------------

  async create(
    projectId: number,
    freelancerId: number,
    file?: UploadedFileData,
  ) {
    if (!file) throw new BadRequestException('A delivery file is required');

    // early checks (no locks) so we do not store useless files
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        status: true,
        offers: {
          where: { status: OfferStatus.ACCEPTED },
          select: { freelancerId: true },
          take: 1,
        },
      },
    });
    if (!project || project.offers[0]?.freelancerId !== freelancerId) {
      throw new NotFoundException('Project not found');
    }
    if (project.status !== ProjectStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Deliveries can only be submitted on projects in progress',
      );
    }

    const filePath = await this.storage.save('delivery', file);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // lock the project: two uploads at once cannot both pass
        const locked = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS "status"
          FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
        if (locked[0]?.status !== ProjectStatus.IN_PROGRESS) {
          throw new ConflictException(
            'Deliveries can only be submitted on projects in progress',
          );
        }

        const pending = await tx.delivery.count({
          where: { projectId, status: DeliveryStatus.PENDING },
        });
        if (pending > 0) {
          throw new ConflictException('You already have a pending delivery');
        }

        return tx.delivery.create({
          data: { projectId, filePath },
          select: deliverySelect,
        });
      });
    } catch (error) {
      // do not leave an orphan file if the record was not saved
      await this.storage.remove(filePath);
      throw error;
    }
  }

  // ---------------------------------------------------------------
  // owner / accepted freelancer / admin: list and download
  // ---------------------------------------------------------------

  async listForProject(projectId: number, user: AuthUser) {
    await this.assertParticipant(projectId, user, 'Project not found');

    return this.prisma.delivery.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: deliverySelect,
    });
  }

  async download(deliveryId: number, user: AuthUser) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, projectId: true, filePath: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    await this.assertParticipant(
      delivery.projectId,
      user,
      'Delivery not found',
    );

    const fullPath = this.storage.getAbsolutePath(delivery.filePath);
    let size: number;
    try {
      size = (await stat(fullPath)).size;
    } catch {
      throw new NotFoundException('File not found');
    }

    const ext = extname(delivery.filePath).toLowerCase();
    return new StreamableFile(createReadStream(fullPath), {
      type: MIME_BY_EXT[ext] ?? 'application/octet-stream',
      disposition: `attachment; filename="delivery-${delivery.id}${ext}"`,
      length: size,
    });
  }

  // ---------------------------------------------------------------
  // owner: approve (pays) or reject
  // ---------------------------------------------------------------

  /**
   * Approves a delivery and pays: 90% to the freelancer, 10% to the platform.
   * One transaction: all steps or none.
   * ownerId = null means the system (automatic approval after 7 days).
   */
  async approve(deliveryId: number, ownerId: number | null) {
    return this.prisma.$transaction(async (tx) => {
      const { projectId } = await this.lockForReview(tx, deliveryId, ownerId);

      const offer = await tx.offer.findFirst({
        where: { projectId, status: OfferStatus.ACCEPTED },
        select: { freelancerId: true, price: true },
      });
      const hold = await tx.transaction.findFirst({
        where: { projectId, type: TransactionType.HOLD },
        select: { amount: true },
      });

      // safety net: money must leave exactly what was held
      if (!offer || !hold || !hold.amount.neg().eq(offer.price)) {
        throw new Error(
          `Held amount does not match the accepted offer (project ${projectId})`,
        );
      }

      const price = offer.price;
      const commission = price
        .mul(COMMISSION_RATE)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const payout = price.sub(commission);

      const freelancerWallet = await tx.wallet.update({
        where: { userId: offer.freelancerId },
        data: { balance: { increment: payout } },
        select: { id: true },
      });

      const movements: Prisma.TransactionCreateManyInput[] = [
        {
          walletId: freelancerWallet.id,
          projectId,
          type: TransactionType.RELEASE,
          amount: payout,
        },
      ];

      if (commission.gt(0)) {
        const platformWalletId = this.platform.platformWalletId;
        await tx.wallet.update({
          where: { id: platformWalletId },
          data: { balance: { increment: commission } },
        });
        movements.push({
          walletId: platformWalletId,
          projectId,
          type: TransactionType.COMMISSION,
          amount: commission,
        });
      }
      await tx.transaction.createMany({ data: movements });

      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.APPROVED },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.COMPLETED },
      });

      return {
        delivery: { id: deliveryId, status: DeliveryStatus.APPROVED },
        project: { id: projectId, status: ProjectStatus.COMPLETED },
        payout: money(payout),
        commission: money(commission),
      };
    });
  }

  async reject(deliveryId: number, ownerId: number, dto: RejectDeliveryDto) {
    return this.prisma.$transaction(async (tx) => {
      const { projectId, dueAt } = await this.lockForReview(
        tx,
        deliveryId,
        ownerId,
      );

      // the new deadline counts from the later of "now" and the old
      // deadline, so the revision never eats the time that is left
      const now = new Date();
      const base = dueAt && dueAt > now ? dueAt : now;
      const newDueAt = new Date(base.getTime() + dto.extraDays * DAY_MS);

      await tx.project.update({
        where: { id: projectId },
        data: { dueAt: newDueAt },
      });

      const delivery = await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.REJECTED, clientNote: dto.note },
        select: deliverySelect,
      });
      return { ...delivery, dueAt: newDueAt };
    });
  }

  // ---------------------------------------------------------------

  /**
   * Locks the project, then the delivery (always in this order), and checks
   * that the delivery can still be reviewed. A second approval at the same
   * moment waits here and then fails: nobody is paid twice.
   */
   private async lockForReview(
    tx: Prisma.TransactionClient,
    deliveryId: number,
    ownerId: number | null,
  ) {
    const ref = await tx.delivery.findUnique({
      where: { id: deliveryId },
      select: { projectId: true },
    });
    if (!ref) throw new NotFoundException('Delivery not found');

    const projects = await tx.$queryRaw<
      { ownerId: number; status: string; dueAt: Date | null }[]
    >`
      SELECT "ownerId", "status"::text AS "status", "dueAt"
      FROM "Project" WHERE "id" = ${ref.projectId} FOR UPDATE`;
    const project = projects[0];

    // 404 (not 403) so nobody can probe which ids exist
    if (!project || (ownerId !== null && project.ownerId !== ownerId)) {
      throw new NotFoundException('Delivery not found');
    }
    if (project.status !== ProjectStatus.IN_PROGRESS) {
      throw new ConflictException('This project is not in progress');
    }

    const deliveries = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status"::text AS "status"
      FROM "Delivery" WHERE "id" = ${deliveryId} FOR UPDATE`;
    if (deliveries[0]?.status !== DeliveryStatus.PENDING) {
      throw new ConflictException('This delivery is no longer pending');
    }

    return {
      projectId: ref.projectId,
      dueAt: project.dueAt ? new Date(project.dueAt) : null,
    };
  }

  /** The owner, the accepted freelancer, or an admin. Others get 404. */
  private async assertParticipant(
    projectId: number,
    user: AuthUser,
    notFoundMessage: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerId: true,
        offers: {
          where: { status: OfferStatus.ACCEPTED },
          select: { freelancerId: true },
          take: 1,
        },
      },
    });

    const allowed =
      project &&
      (user.role === Role.ADMIN ||
        project.ownerId === user.id ||
        project.offers[0]?.freelancerId === user.id);

    if (!allowed) throw new NotFoundException(notFoundMessage);
  }
}