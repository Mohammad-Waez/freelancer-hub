import { Injectable, NotFoundException } from '@nestjs/common';

import { Paginated } from '../common/responses/paginated.js';
import { money } from '../common/utils/money.util.js';
import { Prisma, TransactionType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListTransactionsDto } from './dto/list-transactions.dto.js';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: number) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return { balance: money(wallet.balance) };
  }

  async deposit(userId: number, amount: number) {
    const value = new Prisma.Decimal(amount);

    const wallet = await this.prisma.$transaction(async (tx) => {
      // atomic SQL increment: safe even with concurrent deposits
      const updated = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: value } },
        select: { id: true, balance: true },
      });

      await tx.transaction.create({
        data: {
          walletId: updated.id,
          type: TransactionType.DEPOSIT,
          amount: value,
        },
      });
      return updated;
    });

    return { balance: money(wallet.balance) };
  }

  async listTransactions(userId: number, query: ListTransactionsDto) {
    const where: Prisma.TransactionWhereInput = {
      wallet: { userId },
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          type: true,
          amount: true,
          projectId: true,
          createdAt: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return Paginated.of(
      items.map((t) => ({ ...t, amount: money(t.amount) })),
      total,
      query.page,
      query.limit,
    );
  }
}