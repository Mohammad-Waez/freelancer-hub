import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { money } from '../common/utils/money.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FileStorageService,
  type UploadedFileData,
} from '../storage/file-storage.service.js';
import type { UpdateFreelancerProfileDto } from './dto/update-freelancer-profile.dto.js';

const profileSelect = {
  bio: true,
  hourlyRate: true,
  photoPath: true,
  user: { select: { id: true, name: true, isBanned: true } },
} satisfies Prisma.FreelancerProfileSelect;

type ProfileRow = Prisma.FreelancerProfileGetPayload<{
  select: typeof profileSelect;
}>;

@Injectable()
export class FreelancersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
  ) {}

  /** Public page: anyone can open it, except for banned users. */
  async findPublic(userId: number) {
    const profile = await this.prisma.freelancerProfile.findUnique({
      where: { userId },
      select: profileSelect,
    });
    if (!profile || profile.user.isBanned) {
      throw new NotFoundException('Freelancer not found');
    }
    return this.toView(profile);
  }

  async findMine(userId: number) {
    const profile = await this.prisma.freelancerProfile.findUnique({
      where: { userId },
      select: profileSelect,
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return this.toView(profile);
  }

  async updateMine(
    userId: number,
    dto: UpdateFreelancerProfileDto,
    file?: UploadedFileData,
  ) {
    const current = await this.prisma.freelancerProfile.findUnique({
      where: { userId },
      select: { photoPath: true },
    });
    if (!current) throw new NotFoundException('Profile not found');

    const newPhoto = file
      ? await this.storage.save('profile-photo', file)
      : undefined;

    const data: Prisma.FreelancerProfileUncheckedUpdateInput = {
      ...(dto.bio !== undefined && { bio: dto.bio }),
      ...(dto.hourlyRate !== undefined && {
        hourlyRate: new Prisma.Decimal(dto.hourlyRate),
      }),
      ...(newPhoto
        ? { photoPath: newPhoto }
        : dto.removePhoto
          ? { photoPath: null }
          : {}),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    let updated: ProfileRow;
    try {
      updated = await this.prisma.freelancerProfile.update({
        where: { userId },
        data,
        select: profileSelect,
      });
    } catch (error) {
      // do not leave an orphan file if the record was not saved
      if (newPhoto) await this.storage.remove(newPhoto);
      throw error;
    }

    // the old photo is deleted only after the update succeeded
    if (current.photoPath && (newPhoto || dto.removePhoto)) {
      await this.storage.remove(current.photoPath);
    }
    return this.toView(updated);
  }

  private toView(profile: ProfileRow) {
    return {
      id: profile.user.id,
      name: profile.user.name,
      bio: profile.bio,
      hourlyRate:
        profile.hourlyRate === null ? null : money(profile.hourlyRate),
      photoUrl: this.storage.publicUrl(profile.photoPath),
    };
  }
}