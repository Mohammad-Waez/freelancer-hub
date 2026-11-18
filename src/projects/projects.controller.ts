import {
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../common/decorators/index.js';

import type { AuthUser } from '../common/interfaces/auth-user.interface.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ListMyProjectsDto } from './dto/list-my-projects.dto.js';
import { ListProjectsDto } from './dto/list-projects.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ProjectsService } from './projects.service.js';
import { Role } from '../generated/prisma/client.js';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  UPLOAD_RULES,
  type UploadedFileData,
} from '../storage/file-storage.service.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';

@ApiTags('Projects: المشاريع')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @ApiDoc({
    summary: 'نشر مشروع (للعميل)',
    description:
      'ينشر مشروعاً بحالة `OPEN`. يقبل JSON عادياً أو `multipart/form-data` إن كان فيه مرفق.\n\n' +
      '- `title`: 3 إلى 150 حرفاً. `description`: 10 إلى 5000.\n' +
      '- `categoryId`: تصنيف موجود. `budget`: من 0.01 إلى 1,000,000 وبخانتين.\n' +
      '- `attachment` (اختياري): صورة JPG أو PNG أو WEBP أو PDF حتى 5MB. يُتحقق من **محتوى** الملف لا امتداده.',
    form: {
      fields: {
        title: 'Logo design for my shop',
        description: 'A detailed description of the work that is needed.',
        categoryId: 3,
        budget: 250,
      },
      file: {
        name: 'attachment',
        description: 'مرفق اختياري (صورة أو PDF حتى 5MB)',
      },
    },
    ok: { status: 201, message: 'Project created', data: EX.project },
    errors: [400, 403, 413],
  })
  @Post()
  @Roles(Role.CLIENT)
  @UseInterceptors(
    FileInterceptor('attachment', {
      limits: {
        fileSize: UPLOAD_RULES['project-attachment'].maxBytes,
        files: 1,
      },
    }),
  )
  @ResponseMessage('Project created')
  create(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateProjectDto,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.projects.create(userId, dto, file);
  }

  @Get()
  @Roles(Role.FREELANCER)
  @ResponseMessage('Projects fetched')
  @ApiDoc({
    summary: 'تصفح المشاريع المفتوحة (للمستقل)',
    description:
      'المشاريع **المفتوحة فقط**، بترقيم صفحات. المشروع الذي قُبل عرضه يخرج من هذه القائمة.',
    query: [
      { name: 'page', description: 'رقم الصفحة (الافتراضي 1)', example: 1 },
      {
        name: 'limit',
        description: 'عدد العناصر (الافتراضي 10، الأقصى 50)',
        example: 10,
      },
      { name: 'categoryId', description: 'تصفية بالتصنيف', example: 3 },
      {
        name: 'q',
        description: 'كلمة في العنوان (لا تهم حالة الأحرف)',
        example: 'logo',
      },
      {
        name: 'sort',
        description: 'الترتيب (الافتراضي newest)',
        enum: ['newest', 'budget_asc', 'budget_desc'],
      },
    ],
    ok: { message: 'Projects fetched', data: [EX.project], meta: true },
    errors: [400, 403],
  })
  findOpen(@Query() query: ListProjectsDto) {
    return this.projects.findOpen(query);
  }

  // declared before ':id' so "mine" is not read as an id
  @Get('mine')
  @Roles(Role.CLIENT)
  @ResponseMessage('Your projects fetched')
  @ApiDoc({
    summary: 'مشاريعي (للعميل)',
    description: 'مشاريع العميل نفسه بكل حالاتها، الأحدث أولاً.',
    query: [
      { name: 'page', description: 'رقم الصفحة', example: 1 },
      { name: 'limit', description: 'عدد العناصر', example: 10 },
      {
        name: 'status',
        description: 'تصفية بالحالة',
        enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      },
    ],
    ok: { message: 'Your projects fetched', data: [EX.project], meta: true },
    errors: [400, 403],
  })
  findMine(
    @CurrentUser('id') userId: number,
    @Query() query: ListMyProjectsDto,
  ) {
    return this.projects.findMine(userId, query);
  }

  @Get(':id')
  @ResponseMessage('Project fetched')
  @ApiDoc({
    summary: 'تفاصيل مشروع',
    description:
      '**من يراه:** المدير وصاحب المشروع دائماً، والمستقل إن كان المشروع مفتوحاً أو كان صاحب العرض المقبول. غير ذلك: **404** (لا 403) كي لا يُكشف وجود المعرّفات.\n\n' +
      'الحقول الإضافية في كل رد مشروع:\n' +
      '- `dueAt`: موعد التسليم (فارغ قبل قبول عرض).\n' +
      '- `isOverdue`: فات الموعد والمشروع ما زال قيد التنفيذ.\n' +
      '- `cancellableAt`: أول لحظة يستطيع فيها العميل الإلغاء (الموعد + يومان).',
    ok: {
      message: 'Project fetched',
      data: {
        ...EX.project,
        status: 'IN_PROGRESS',
        dueAt: '2026-11-23T11:00:00.000Z',
        cancellableAt: '2026-11-25T11:00:00.000Z',
      },
    },
    errors: [[404, 'Project not found']],
  })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.findOne(id, user);
  }
  @Patch(':id')
  @Roles(Role.CLIENT)
  @UseInterceptors(
    FileInterceptor('attachment', {
      limits: {
        fileSize: UPLOAD_RULES['project-attachment'].maxBytes,
        files: 1,
      },
    }),
  )
  @ResponseMessage('Project updated')
  @ApiDoc({
    summary: 'تعديل مشروع (للعميل صاحبه)',
    description:
      'يعدّل ما ترسله فقط. **ما دام المشروع `OPEN` فقط.**\n\n' +
      '- `attachment`: ملف جديد يستبدل القديم (والقديم يُحذف بعد نجاح التعديل).\n' +
      '- `removeAttachment=true`: لإزالة المرفق.\n' +
      '- خفض الميزانية بعد وصول عروض أعلى مسموح ولا يمس العروض.\n\n' +
      '*في Swagger: احذف الحقول التي لا تريد تعديلها.*',
    form: {
      fields: { title: 'Logo design for my coffee shop', budget: 300 },
      file: { name: 'attachment', description: 'مرفق جديد (اختياري)' },
    },
    ok: {
      message: 'Project updated',
      data: { ...EX.project, budget: '300.00' },
    },
    errors: [400, 403, 404, [409, 'Only open projects can be modified'], 413],
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateProjectDto,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.projects.update(id, userId, dto, file);
  }

  @Delete(':id')
  @Roles(Role.CLIENT)
  @ResponseMessage('Project deleted')
  @ApiDoc({
    summary: 'حذف مشروع (للعميل صاحبه)',
    description: 'يحذف المشروع **وعروضه ومرفقه**، ما دام `OPEN` فقط.',
    ok: { message: 'Project deleted', data: null },
    errors: [403, 404, [409, 'Only open projects can be deleted']],
  })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
  ) {
    await this.projects.remove(id, userId);
    return null;
  }

  @Post(':id/cancel')
  @Roles(Role.CLIENT)
  @HttpCode(200)
  @ResponseMessage('Project cancelled and the held amount refunded')
  @ApiDoc({
    summary: 'إلغاء مشروع متأخر واسترداد المال (للعميل)',
    description:
      'يُلغي العميل مشروعاً **قيد التنفيذ تأخر فيه المستقل** ويسترد المبلغ المحجوز كاملاً (`REFUND`)، في معاملة واحدة.\n\n' +
      '- لا يُسمح إلا بعد موعد التسليم `dueAt` **بيومين** (انظر `cancellableAt`).\n' +
      '- لا يُسمح إن كان هناك **تسليم معلّق**: على العميل أن يوافق أو يرفض أولاً.\n' +
      '- لا يُسترد المبلغ مرتين.',
    ok: {
      message: 'Project cancelled and the held amount refunded',
      data: { project: { id: 12, status: 'CANCELLED' }, refunded: '200.00' },
    },
    errors: [
      403,
      404,
      [409, 'You can cancel only after 2026-11-25T11:00:00.000Z'],
    ],
  })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.projects.cancelByOwner(id, userId);
  }
}
