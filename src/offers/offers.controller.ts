import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../common/decorators/index.js';

import { CreateOfferDto } from './dto/create-offer.dto.js';
import { ListOffersDto } from './dto/list-offers.dto.js';
import { UpdateOfferDto } from './dto/update-offer.dto.js';
import { OffersService } from './offers.service.js';
import { Role } from '../generated/prisma/client.js';
import { AcceptOfferDto } from './dto/accept-offer.dto.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';


@ApiTags('Offers: العروض')
// no prefix: this controller serves both /projects/:id/offers and /offers/...
@Controller()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post('projects/:projectId/offers')
  @Roles(Role.FREELANCER)
  @ResponseMessage('Offer submitted')
    @ApiDoc({
    summary: 'تقديم عرض على مشروع (للمستقل)',
    description:
      '- `price`: من 0.01 إلى 1,000,000 **ولا يتجاوز ميزانية المشروع** (يجوز أن يكون أقل).\n' +
      '- `durationDays`: عدد صحيح من 1 إلى 365. وهو **مدة التسليم** التي يبدأ حسابها عند قبول العرض.\n' +
      '- `message`: من 5 إلى 1000 حرف.\n\n' +
      'قواعد: على مشروع **مفتوح** فقط، و**عرض واحد** لكل مستقل على المشروع الواحد. يبدأ العرض `PENDING`.',
    body: { price: 200, durationDays: 7, message: 'I can do this work well.' },
    ok: { status: 201, message: 'Offer submitted', data: EX.offer },
    errors: [
      400,
      403,
      404,
      [409, 'You have already submitted an offer on this project'],
    ],
  })
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: CreateOfferDto,
  ) {
    return this.offers.create(projectId, userId, dto);
  }

  @Get('projects/:projectId/offers')
  @Roles(Role.CLIENT)
  @ResponseMessage('Offers fetched')
    @ApiDoc({
    summary: 'عروض مشروعي (للعميل صاحب المشروع)',
    description:
      'العروض على مشروعه مع بطاقة المستقل (الرقم والاسم وسعره بالساعة وصورته).\n\n' +
      'عروض المستقلين **المحظورين** مخفية. وغير صاحب المشروع: 404.',
    query: [
      { name: 'page', description: 'رقم الصفحة', example: 1 },
      { name: 'limit', description: 'عدد العناصر', example: 10 },
      {
        name: 'status',
        description: 'تصفية بحالة العرض',
        enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
      },
    ],
    ok: {
      message: 'Offers fetched',
      data: [
        {
          ...EX.offer,
          freelancer: {
            id: 5,
            name: 'Ahmad',
            hourlyRate: '25.50',
            photoUrl: '/uploads/20261110-083512-a1b2c3d4.png',
          },
        },
      ],
      meta: true,
    },
    errors: [400, 403, [404, 'Project not found']],
  })
  listForProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') userId: number,
    @Query() query: ListOffersDto,
  ) {
    return this.offers.listForProject(projectId, userId, query);
  }

  @Get('offers/mine')
  @Roles(Role.FREELANCER)
  @ResponseMessage('Your offers fetched')
    @ApiDoc({
    summary: 'عروضي (للمستقل)',
    description: 'عروض المستقل نفسه مع **حالة كل عرض** وملخص مشروعه (ومنه الموعد `dueAt` و`isOverdue`).',
    query: [
      { name: 'page', description: 'رقم الصفحة', example: 1 },
      { name: 'limit', description: 'عدد العناصر', example: 10 },
      {
        name: 'status',
        description: 'تصفية بحالة العرض',
        enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
      },
    ],
    ok: {
      message: 'Your offers fetched',
      data: [
        {
          ...EX.offer,
          status: 'ACCEPTED',
          project: {
            id: 12,
            title: 'Logo design for my shop',
            status: 'IN_PROGRESS',
            budget: '250.00',
            dueAt: '2026-11-23T11:00:00.000Z',
            isOverdue: false,
          },
        },
      ],
      meta: true,
    },
    errors: [400, 403],
  })
  listMine(@CurrentUser('id') userId: number, @Query() query: ListOffersDto) {
    return this.offers.listMine(userId, query);
  }

  @Patch('offers/:id')
  @Roles(Role.FREELANCER)
  @ResponseMessage('Offer updated')
    @ApiDoc({
    summary: 'تعديل عرضي (للمستقل صاحب العرض)',
    description:
      'يعدّل ما ترسله فقط (`price` و`durationDays` و`message`) بنفس قواعد التقديم.\n\n' +
      '**ما دام العرض `PENDING` والمشروع `OPEN` فقط.** والسعر لا يتجاوز ميزانية المشروع.',
    body: { price: 180 },
    ok: { message: 'Offer updated', data: { ...EX.offer, price: '180.00' } },
    errors: [
      400,
      403,
      404,
      [409, 'Only pending offers on open projects can be modified'],
    ],
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(id, userId, dto);
  }



  @Post('offers/:id/accept')
  @Roles(Role.CLIENT)
  @HttpCode(200)
  @ResponseMessage('Offer accepted')
    @ApiDoc({
    summary: 'قبول عرض وحجز ثمنه (للعميل صاحب المشروع)',
    description:
      'أهم عملية في المشروع. **كل الخطوات في معاملة واحدة، فإما تنجح كلها أو لا يتغير شيء:**\n\n' +
      '1. التحقق أن المشروع مفتوح وملك العميل، وأن العرض معلّق ومستقله غير محظور.\n' +
      '2. التحقق أن السعر يساوي `expectedPrice` (السعر الذي رآه العميل).\n' +
      '3. خصم ثمن العرض من رصيد العميل **بشرط أن الرصيد يكفي**.\n' +
      '4. حركة `HOLD` بمبلغ سالب مرتبطة بالمشروع.\n' +
      '5. العرض `ACCEPTED` وبقية العروض `REJECTED`.\n' +
      '6. المشروع `IN_PROGRESS`، ويُحسب موعد التسليم `dueAt` = وقت القبول + مدة العرض.\n\n' +
      '**أسباب 409:** المشروع لم يعد مفتوحاً، أو العرض لم يعد معلّقاً، أو المستقل محظور، ' +
      'أو `Offer has changed` (غيّر المستقل سعره)، أو `Insufficient balance`.',
    body: { expectedPrice: 200 },
    ok: {
      message: 'Offer accepted',
      data: {
        offer: { id: 7, status: 'ACCEPTED', price: '200.00' },
        project: {
          id: 12,
          status: 'IN_PROGRESS',
          dueAt: '2026-11-23T11:00:00.000Z',
        },
        balance: '100.00',
      },
    },
    errors: [400, 403, 404, [409, 'Insufficient balance']],
  })
  accept(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Body() dto: AcceptOfferDto,
  ) {
    return this.offers.accept(id, userId, dto.expectedPrice);
  }


}