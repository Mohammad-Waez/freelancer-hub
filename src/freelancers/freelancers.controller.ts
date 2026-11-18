import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentUser,
  Public,
  ResponseMessage,
  Roles,
} from '../common/decorators/index.js';

import {
  UPLOAD_RULES,
  type UploadedFileData,
} from '../storage/file-storage.service.js';
import { UpdateFreelancerProfileDto } from './dto/update-freelancer-profile.dto.js';
import { FreelancersService } from './freelancers.service.js';
import { Role } from '../generated/prisma/client.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';

@ApiTags('Freelancers: ملف المستقل')
@Controller('freelancers')
export class FreelancersController {
  constructor(private readonly freelancers: FreelancersService) {}

  // "me" routes are declared before ':id' so "me" is not read as an id
  @Get('me')
  @Roles(Role.FREELANCER)
  @ResponseMessage('Your profile fetched')
    @ApiDoc({
    summary: 'ملفي الشخصي (للمستقل)',
    description: 'القيم فارغة (`null`) حتى يعدّلها المستقل.',
    ok: { message: 'Your profile fetched', data: EX.profile },
    errors: [403],
  })
  findMine(@CurrentUser('id') userId: number) {
    return this.freelancers.findMine(userId);
  }

  @Patch('me')
  @Roles(Role.FREELANCER)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: {
        fileSize: UPLOAD_RULES['profile-photo'].maxBytes,
        files: 1,
      },
    }),
  )
  @ResponseMessage('Profile updated')
    @ApiDoc({
    summary: 'تعديل ملفي الشخصي (للمستقل)',
    description:
      'يعدّل ما ترسله فقط (`multipart/form-data` إن كانت فيه صورة).\n\n' +
      '- `bio`: حتى 2000 حرف.\n- `hourlyRate`: من 0.01 إلى 10,000 وبخانتين.\n' +
      '- `photo`: صورة JPG أو PNG أو WEBP حتى 2MB، **صور فقط**.\n' +
      '- `removePhoto=true`: لإزالة الصورة. والصورة القديمة تُحذف من القرص.',
    form: {
      fields: { bio: 'Graphic designer with 5 years of experience', hourlyRate: 25.5 },
      file: { name: 'photo', description: 'صورة شخصية اختيارية (حتى 2MB)' },
    },
    ok: { message: 'Profile updated', data: EX.profile },
    errors: [400, 403, 413],
  })
  updateMine(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateFreelancerProfileDto,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.freelancers.updateMine(userId, dto, file);
  }

  @Public()
  @Get(':id')
  @ResponseMessage('Freelancer fetched')
    @ApiDoc({
    auth: false,
    summary: 'ملف مستقل (عام)',
    description:
      'يفتحه أي شخص **بلا تسجيل دخول**. المعرّف هو معرّف **المستخدم**.\n\n' +
      'لا يُظهر البريد ولا أي بيانات خاصة، والمستقل المحظور ملفه مخفي (404).',
    ok: { message: 'Freelancer fetched', data: EX.profile },
    errors: [[404, 'Freelancer not found']],
  })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.freelancers.findPublic(id);
  }
}