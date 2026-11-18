import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeliveriesService } from '../deliveries/deliveries.service.js';
import { DeliveryStatus, ProjectStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// a delivery the client never answers is approved after this many days
const AUTO_APPROVE_AFTER_DAYS = 3;
// max deliveries handled per run (the rest wait for the next hour)
const AUTO_APPROVE_BATCH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private autoApproving = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
  ) {}

  /** Every hour: approve (and pay) deliveries nobody answered for 7 days. */
  @Cron(CronExpression.EVERY_HOUR)
  async autoApproveDeliveries() {
    // never let two runs overlap
    if (this.autoApproving) return;
    this.autoApproving = true;

    try {
      const cutoff = new Date(Date.now() - AUTO_APPROVE_AFTER_DAYS * DAY_MS);

      const due = await this.prisma.delivery.findMany({
        where: {
          status: DeliveryStatus.PENDING,
          createdAt: { lte: cutoff },
          project: { status: ProjectStatus.IN_PROGRESS },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: AUTO_APPROVE_BATCH,
        select: { id: true },
      });

      for (const { id } of due) {
        try {
          // same payment function as the manual approval (owner = system)
          await this.deliveries.approve(id, null);
          this.logger.log(`Delivery ${id} approved automatically`);
        } catch (error) {
          // one failure must not stop the others
          this.logger.warn(
            `Automatic approval of delivery ${id} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Automatic approval run failed: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
    } finally {
      this.autoApproving = false;
    }
  }

  /** Every day at 3 AM: delete refresh tokens expired for more than a day. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanRefreshTokens() {
    try {
      const cutoff = new Date(Date.now() - DAY_MS);
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      this.logger.log(`Deleted ${count} expired refresh tokens`);
    } catch (error) {
      this.logger.error(
        `Refresh token cleanup failed: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
    }
  }
}