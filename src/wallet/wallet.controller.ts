import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../common/decorators/index.js';

import { DepositDto } from './dto/deposit.dto.js';
import { ListTransactionsDto } from './dto/list-transactions.dto.js';
import { WalletService } from './wallet.service.js';
import { Role } from '../generated/prisma/browser.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';

@ApiTags('Wallet: المحفظة')
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}


    @ApiDoc({
    summary: 'رصيد المحفظة',
    description:
      'يُرجع الرصيد **المتاح** فقط. المبلغ المحجوز لمشروع قيد التنفيذ لا يظهر هنا بل في الحركات.\n\n' +
      'لكل مستخدم محفظة، ورصيد المدير هو رصيد المنصة (العمولات).',
    ok: { message: 'Wallet balance', data: { balance: '100.00' } },
  })
  @Get()
  @ResponseMessage('Wallet balance')
  getBalance(@CurrentUser('id') userId: number) {
    return this.wallet.getBalance(userId);
  }

    @ApiDoc({
    summary: 'الحركات المالية',
    description:
      'حركات المحفظة، الأحدث أولاً.\n\n' +
      '- `DEPOSIT` شحن، و`HOLD` حجز عند قبول عرض (مبلغ **سالب**).\n' +
      '- `RELEASE` دفع للمستقل، و`COMMISSION` عمولة المنصة، و`REFUND` استرداد بعد إلغاء مشروع.\n' +
      '- المبالغ نصوص بخانتين، والحركة المرتبطة بمشروع فيها `projectId`.',
    query: [
      { name: 'page', description: 'رقم الصفحة (الافتراضي 1)', example: 1 },
      { name: 'limit', description: 'عدد العناصر (الافتراضي 10، الأقصى 50)', example: 10 },
      {
        name: 'type',
        description: 'تصفية بنوع الحركة',
        enum: ['DEPOSIT', 'HOLD', 'RELEASE', 'COMMISSION', 'REFUND'],
      },
    ],
    ok: { message: 'Transactions fetched', data: [EX.transaction], meta: true },
    errors: [400],
  })
  @Get('transactions')
  @ResponseMessage('Transactions fetched')
  listTransactions(
    @CurrentUser('id') userId: number,
    @Query() query: ListTransactionsDto,
  ) {
    return this.wallet.listTransactions(userId, query);
  }
  @ApiDoc({
    summary: 'شحن الرصيد (للعميل فقط)',
    description:
      'يزيد رصيد العميل ويسجّل حركة `DEPOSIT` في عملية واحدة. (لا توجد بوابة دفع حقيقية.)\n\n' +
      '- `amount`: من 0.01 إلى 1,000,000 وبخانتين عشريتين كحد أقصى.',
    body: { amount: 300 },
    ok: { status: 201, message: 'Deposit successful', data: { balance: '300.00' } },
    errors: [400, 403],
  })
  @Post('deposit')
  @Roles(Role.CLIENT)
  @ResponseMessage('Deposit successful')
  deposit(@CurrentUser('id') userId: number, @Body() dto: DepositDto) {
    return this.wallet.deposit(userId, dto.amount);
  }
}