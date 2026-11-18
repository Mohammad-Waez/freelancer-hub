import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../common/decorators/index.js';
import { Role } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/interfaces/auth-user.interface.js';
import {
  UPLOAD_RULES,
  type UploadedFileData,
} from '../storage/file-storage.service.js';
import { DeliveriesService } from './deliveries.service.js';
import { RejectDeliveryDto } from './dto/reject-delivery.dto.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';


@ApiTags('Deliveries: التسليم والدفع')
// no prefix: serves /projects/:id/deliveries and /deliveries/...
@Controller()
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Post('projects/:projectId/deliveries')
  @Roles(Role.FREELANCER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_RULES.delivery.maxBytes, files: 1 },
    }),
  )
  @ResponseMessage('Delivery submitted')
    @ApiDoc({
    summary: 'رفع ملف التسليم (للمستقل صاحب العرض المقبول)',
    description:
      'ملف واحد في الحقل `file`: **PDF أو ZIP حتى 20MB**.\n\n' +
      '- المشروع يجب أن يكون `IN_PROGRESS`.\n' +
      '- الملف يُحفظ في مجلد **خاص** لا يُقدَّم للعامة أبداً.\n' +
      '- لا يُقبل تسليم جديد وفي المشروع تسليم `PENDING` آخر.\n' +
      '- بعد رفض تسليم يستطيع رفع تسليم جديد.',
    form: { file: { name: 'file', description: 'ملف التسليم (PDF أو ZIP حتى 20MB)' } },
    ok: { status: 201, message: 'Delivery submitted', data: EX.delivery },
    errors: [
      400,
      403,
      [404, 'Project not found'],
      [409, 'You already have a pending delivery'],
      413,
    ],
  })
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') userId: number,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.deliveries.create(projectId, userId, file);
  }

  @Get('projects/:projectId/deliveries')
  @ResponseMessage('Deliveries fetched')
    @ApiDoc({
    summary: 'قائمة التسليمات (أطراف المشروع)',
    description:
      'يراها صاحب المشروع والمستقل المقبول والمدير، وغيرهم 404.\n\n' +
      'الحالات: `PENDING` ينتظر قرار العميل، `APPROVED` تم الدفع، `REJECTED` مرفوض (ومعه `clientNote`).',
    ok: { message: 'Deliveries fetched', data: [EX.delivery] },
    errors: [[404, 'Project not found']],
  })
  listForProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.deliveries.listForProject(projectId, user);
  }

  @Get('deliveries/:id/file')
    @ApiDoc({
    summary: 'تنزيل ملف التسليم (أطراف المشروع)',
    description:
      'يُرسل **الملف نفسه** (PDF أو ZIP) وليس JSON، مع ترويسة `Content-Disposition: attachment`.\n\n' +
      'الملف الخاص لا يُفتح إلا من هنا بعد التحقق من الصلاحية. وغير أطراف المشروع: 404.',
    okFile: { description: 'محتوى الملف', contentType: 'application/pdf' },
    errors: [[404, 'Delivery not found']],
  })
  download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.deliveries.download(id, user);
  }

  @Post('deliveries/:id/approve')
  @Roles(Role.CLIENT)
  @HttpCode(200)
  @ResponseMessage('Delivery approved and payment released')
    @ApiDoc({
    summary: 'الموافقة على التسليم والدفع (للعميل صاحب المشروع)',
    description:
      'يوافق العميل فيُدفع المبلغ المحجوز. **معاملة واحدة، فإما تنجح كلها أو لا يتغير شيء:**\n\n' +
      '- عمولة المنصة = 10% من سعر العرض (تُقرَّب إلى خانتين).\n' +
      '- المستقل يأخذ الباقي (السعر − العمولة). مثال: عرض 200 ← المستقل 180 والمنصة 20.\n' +
      '- حركتا `RELEASE` للمستقل و`COMMISSION` لمحفظة المنصة.\n' +
      '- التسليم `APPROVED` والمشروع `COMPLETED`.\n\n' +
      'ولا يُدفع شيء مرتين. **الموافقة التلقائية:** إن لم يردّ العميل خلال **3 أيام** من رفع التسليم تتم الموافقة والدفع تلقائياً بالطريقة نفسها.',
    ok: {
      message: 'Delivery approved and payment released',
      data: {
        delivery: { id: 4, status: 'APPROVED' },
        project: { id: 12, status: 'COMPLETED' },
        payout: '180.00',
        commission: '20.00',
      },
    },
    errors: [403, [404, 'Delivery not found'], [409, 'This delivery is no longer pending']],
  })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.deliveries.approve(id, userId);
  }

  @Post('deliveries/:id/reject')
  @Roles(Role.CLIENT)
  @HttpCode(200)
  @ResponseMessage('Delivery rejected')
    @ApiDoc({
    summary: 'رفض التسليم وطلب تعديل (للعميل صاحب المشروع)',
    description:
      'يرفض العميل التسليم مع سبب، فيرفع المستقل تسليماً جديداً. المال يبقى محجوزاً.\n\n' +
      '- `note`: سبب الرفض، من 3 إلى 1000 حرف (إلزامي).\n' +
      '- `extraDays`: الأيام الإضافية التي يمنحها العميل للمستقل، من 1 إلى 30 (إلزامي).\n\n' +
      'الموعد الجديد للمشروع = **الأبعد بين الموعد الحالي والآن** + `extraDays`، فلا يضيع على المستقل الوقت المتبقي.',
    body: { note: 'Please fix the colors', extraDays: 2 },
    ok: {
      message: 'Delivery rejected',
      data: {
        ...EX.delivery,
        status: 'REJECTED',
        clientNote: 'Please fix the colors',
        dueAt: '2026-11-25T11:00:00.000Z',
      },
    },
    errors: [400, 403, [404, 'Delivery not found'], [409, 'This delivery is no longer pending']],
  })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Body() dto: RejectDeliveryDto,
  ) {
    return this.deliveries.reject(id, userId, dto);
  }
}