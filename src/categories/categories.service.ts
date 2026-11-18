import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';

const categoryView = { id: true, name: true } satisfies Prisma.CategorySelect;

type CategoryView = { id: number; name: string };

@Injectable()
export class CategoriesService {
  // in-memory cache of the full list: no expiry, cleared on every change
  private cache: CategoryView[] | null = null;
  // protects against a slow read refilling the cache with stale data
  private version = 0;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<CategoryView[]> {
    if (this.cache) return this.cache;

    const version = this.version;
    const categories = await this.prisma.category.findMany({
      select: categoryView,
      orderBy: { name: 'asc' },
    });
    if (version === this.version) this.cache = categories;
    return categories;
  }

  async create(dto: CreateCategoryDto) {
    await this.assertNameAvailable(dto.name);
    try {
      const category = await this.prisma.category.create({
        data: { name: dto.name },
        select: categoryView,
      });
      this.invalidate();
      return category;
    } catch (error) {
      this.mapError(error);
    }
  }

  async update(id: number, dto: UpdateCategoryDto) {
    await this.assertNameAvailable(dto.name, id);
    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: { name: dto.name },
        select: categoryView,
      });
      this.invalidate();
      return category;
    } catch (error) {
      this.mapError(error);
    }
  }

  async remove(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { _count: { select: { projects: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    if (category._count.projects > 0) {
      throw new ConflictException(
        'Category has projects and cannot be deleted',
      );
    }

    try {
      await this.prisma.category.delete({ where: { id } });
      this.invalidate();
    } catch (error) {
      this.mapError(error);
    }
  }

  private invalidate() {
    this.version++;
    this.cache = null;
  }

  // the database unique index is case-sensitive, so we check ignoring case
  private async assertNameAvailable(name: string, exceptId?: number) {
    const duplicate = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('A category with this name already exists');
    }
  }

  private mapError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A category with this name already exists');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      if (error.code === 'P2003') {
        throw new ConflictException(
          'Category has projects and cannot be deleted',
        );
      }
    }
    throw error;
  }
}