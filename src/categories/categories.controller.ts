import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Public, ResponseMessage, Roles } from '../common/decorators/index.js';

import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { Role } from '../generated/prisma/client.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';


@ApiTags('Categories: التصنيفات')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}


    @ApiDoc({
    auth: false,
    summary: 'قائمة التصنيفات (عامة)',
    description:
      'كل التصنيفات مرتبة بالاسم، **بلا تسجيل دخول**.\n\n' +
      'القائمة مخزَّنة في ذاكرة الخادم، وتُمسح فور أي تعديل، فيراه الجميع محدّثاً مباشرة.',
    ok: {
      message: 'Categories fetched',
      data: [EX.category, { id: 4, name: 'Programming' }],
    },
  })
  @Public()
  @Get()
  @ResponseMessage('Categories fetched')
  findAll() {
    return this.categories.findAll();
  }


    @ApiDoc({
    summary: 'إنشاء تصنيف (للمدير)',
    description: 'الاسم من 2 إلى 50 حرفاً (تُحذف المسافات من الطرفين)، وفريد دون اعتبار حالة الأحرف.',
    body: { name: 'Design' },
    ok: { status: 201, message: 'Category created', data: EX.category },
    errors: [400, 403, [409, 'A category with this name already exists']],
  })
  @Roles(Role.ADMIN)
  @Post()
  @ResponseMessage('Category created')
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }


    @ApiDoc({
    summary: 'إعادة تسمية تصنيف (للمدير)',
    body: { name: 'Graphic Design' },
    ok: { message: 'Category updated', data: { id: 3, name: 'Graphic Design' } },
    errors: [400, 403, 404, [409, 'A category with this name already exists']],
  })
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ResponseMessage('Category updated')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }



    @ApiDoc({
    summary: 'حذف تصنيف فارغ (للمدير)',
    description: 'إن كان في التصنيف مشاريع (بأي حالة) يُرفض الحذف حمايةً للمشاريع والأموال المحجوزة.',
    ok: { message: 'Category deleted', data: null },
    errors: [403, 404, [409, 'Category has projects and cannot be deleted']],
  })
  @Roles(Role.ADMIN)
  @Delete(':id')
  @ResponseMessage('Category deleted')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.categories.remove(id);
    return null;
  }
}