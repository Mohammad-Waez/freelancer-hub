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

// every route in this controller is for admins only
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @ResponseMessage('Users fetched')
  listUsers(@Query() query: ListUsersDto) {
    return this.admin.listUsers(query);
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  @ResponseMessage('User banned')
  ban(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId: number,
  ) {
    return this.admin.ban(id, adminId);
  }

  @Post('users/:id/unban')
  @HttpCode(200)
  @ResponseMessage('User unbanned')
  unban(@Param('id', ParseIntPipe) id: number) {
    return this.admin.unban(id);
  }

  @Get('projects/blocked')
  @ResponseMessage('Blocked projects fetched')
  listBlocked(@Query() query: PaginationQueryDto) {
    return this.admin.listBlockedProjects(query);
  }

  @Post('projects/:id/cancel')
  @HttpCode(200)
  @ResponseMessage('Project cancelled and the held amount refunded')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.admin.cancelBlockedProject(id);
  }
}
