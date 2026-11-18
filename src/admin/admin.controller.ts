import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, ResponseMessage, Roles } from '../common/decorators/index.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Role } from '../generated/prisma/client.js';
import { AdminService } from './admin.service.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
// every route in this controller is for admins only


@ApiTags('Admin: المدير')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @ResponseMessage('Users fetched')
    @ApiDoc({
    summary: 'قائمة المستخدمين (للمدير)',
    description: 'يبحث المدير عن المستخدمين ليعرف من سيُحظر. **لا يُرجع كلمة السر أبداً.**',
    query: [
      { name: 'page', description: 'رقم الصفحة', example: 1 },
      { name: 'limit', description: 'عدد العناصر', example: 10 },
      { name: 'role', description: 'تصفية بالدور', enum: ['CLIENT', 'FREELANCER', 'ADMIN'] },
      { name: 'isBanned', description: 'المحظورون أو غير المحظورين', enum: ['true', 'false'] },
      { name: 'q', description: 'كلمة في الاسم أو البريد', example: 'ahmad' },
    ],
    ok: {
      message: 'Users fetched',
      data: [
        {
          id: 5,
          name: 'Ahmad',
          email: 'ahmad@test.com',
          role: 'FREELANCER',
          isBanned: false,
          createdAt: '2026-11-10T08:00:00.000Z',
        },
      ],
      meta: true,
    },
    errors: [400, 403],
  })
  listUsers(@Query() query: ListUsersDto) {
    return this.admin.listUsers(query);
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  @ResponseMessage('User banned')
    @ApiDoc({
    summary: 'حظر مستخدم (للمدير)',
    description:
      'يحظر المستخدم **وتُلغى كل جلساته** في عملية واحدة، ويتوقف فوراً عن استخدام المنصة.\n\n' +
      '- لا يُحظر مدير، ولا يحظر المدير نفسه (403).\n' +
      '- حظر المحظور مرة أخرى آمن (200).\n' +
      '- أثره الفوري: توقف الـ token (403)، وفشل الدخول (403)، وإخفاء ملفه وعروضه.\n' +
      '- **لا يحدث شيء تلقائياً لمشاريعه الجارية:** العميل المحظور تُدفع تسليماته بالموافقة التلقائية بعد 3 أيام، ' +
      'والمستقل المحظور يعالجه المدير بإلغاء المشروع (`POST /admin/projects/{id}/cancel`).',
    ok: { message: 'User banned', data: { id: 5, isBanned: true } },
    errors: [[403, 'Admin accounts cannot be banned'], [404, 'User not found']],
  })
  ban(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId: number,
  ) {
    return this.admin.ban(id, adminId);
  }

  @Post('users/:id/unban')
  @HttpCode(200)
  @ResponseMessage('User unbanned')
    @ApiDoc({
    summary: 'رفع الحظر (للمدير)',
    description: 'جلساته القديمة لا تعود، فعلى المستخدم تسجيل الدخول من جديد.',
    ok: { message: 'User unbanned', data: { id: 5, isBanned: false } },
    errors: [403, [404, 'User not found']],
  })
  unban(@Param('id', ParseIntPipe) id: number) {
    return this.admin.unban(id);
  }

  @Get('projects/blocked')
  @ResponseMessage('Blocked projects fetched')
    @ApiDoc({
    summary: 'المشاريع العالقة (للمدير)',
    description:
      'المشاريع **قيد التنفيذ** التي حُظر مستقلها، أي التي تحتاج تدخل المدير (والمال محجوز فيها)، الأقدم أولاً.',
    query: [
      { name: 'page', description: 'رقم الصفحة', example: 1 },
      { name: 'limit', description: 'عدد العناصر', example: 10 },
    ],
    ok: {
      message: 'Blocked projects fetched',
      data: [
        {
          id: 12,
          title: 'Logo design for my shop',
          createdAt: '2026-11-16T09:30:00.000Z',
          owner: { id: 1, name: 'Sara' },
          heldAmount: '200.00',
          freelancer: { id: 5, name: 'Ahmad' },
        },
      ],
      meta: true,
    },
    errors: [400, 403],
  })
  listBlocked(@Query() query: PaginationQueryDto) {
    return this.admin.listBlockedProjects(query);
  }

  @Post('projects/:id/cancel')
  @HttpCode(200)
  @ResponseMessage('Project cancelled and the held amount refunded')
    @ApiDoc({
    summary: 'إلغاء مشروع مستقله محظور واسترداد المال (للمدير)',
    description:
      'يُلغي مشروعاً قيد التنفيذ حُظر مستقله ويعيد المحجوز للعميل. **معاملة واحدة:**\n\n' +
      '- حركة `REFUND` موجبة بقيمة المحجوز إلى محفظة العميل.\n' +
      '- المشروع `CANCELLED`.\n' +
      '- أي تسليم معلّق يصبح `REJECTED` بملاحظة "Project cancelled by admin".\n\n' +
      'للمشاريع `IN_PROGRESS` فقط، ولا يُلغى إلا إن كان مستقلها محظوراً فعلاً. ولا يُسترد المبلغ مرتين.',
    ok: {
      message: 'Project cancelled and the held amount refunded',
      data: { project: { id: 12, status: 'CANCELLED' }, refunded: '200.00' },
    },
    errors: [403, 404, [409, 'The freelancer of this project is not banned']],
  })
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.admin.cancelBlockedProject(id);
  }
}
