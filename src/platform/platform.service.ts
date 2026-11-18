import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service.js';
import { Role } from '../generated/prisma/client.js';

@Injectable()
export class PlatformService implements OnModuleInit {
  private walletId?: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // runs once at startup: the app refuses to start without a platform account
  async onModuleInit() {
    const email = this.config
      .getOrThrow<string>('PLATFORM_ADMIN_EMAIL')
      .trim()
      .toLowerCase();

    const admin = await this.prisma.user.findUnique({
      where: { email },
      select: { role: true, wallet: { select: { id: true } } },
    });

    if (!admin || admin.role !== Role.ADMIN || !admin.wallet) {
      throw new Error(
        `Platform account "${email}" was not found (or has no wallet). Run: npx prisma db seed`,
      );
    }
    this.walletId = admin.wallet.id;
  }

  /** The wallet that receives the 10% commission. */
  get platformWalletId(): number {
    if (this.walletId === undefined) {
      throw new Error('PlatformService is not initialized');
    }
    return this.walletId;
  }
}