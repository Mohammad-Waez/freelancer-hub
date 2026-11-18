import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fileTypeFromBuffer } from 'file-type';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export type UploadKind = 'profile-photo' | 'project-attachment' | 'delivery';

/** The minimal shape we need from a multer file. */
export interface UploadedFileData {
  buffer: Buffer;
  size: number;
}

const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

export const UPLOAD_RULES: Record<
  UploadKind,
  { visibility: 'public' | 'private'; maxBytes: number; mimes: string[] }
> = {
  'profile-photo': { visibility: 'public', maxBytes: 2 * MB, mimes: IMAGES },
  'project-attachment': {
    visibility: 'public',
    maxBytes: 5 * MB,
    mimes: [...IMAGES, 'application/pdf'],
  },
  delivery: {
    visibility: 'private',
    maxBytes: 20 * MB,
    mimes: ['application/pdf', 'application/zip'],
  },
};

@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(
      process.cwd(),
      config.get<string>('UPLOADS_DIR') ?? './uploads',
    );
  }

  async onModuleInit() {
    await mkdir(join(this.root, 'public'), { recursive: true });
    await mkdir(join(this.root, 'private'), { recursive: true });
  }

  /** Folder served publicly at /uploads. Never expose the root itself. */
  get publicRoot(): string {
    return join(this.root, 'public');
  }

  /**
   * Validates the real file type (from its content, not its name),
   * saves it, and returns the relative path to store in the database.
   */
  async save(kind: UploadKind, file: UploadedFileData): Promise<string> {
    const rule = UPLOAD_RULES[kind];

    if (file.size > rule.maxBytes) {
      throw new PayloadTooLargeException(
        `File is too large (max ${rule.maxBytes / MB}MB)`,
      );
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !rule.mimes.includes(detected.mime)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${rule.mimes.join(', ')}`,
      );
    }

    const name = `${this.timestamp()}-${randomBytes(4).toString('hex')}.${detected.ext}`;
    const relativePath = `${rule.visibility}/${name}`;

    // flag "wx": never overwrite an existing file
    await writeFile(this.resolveSafe(relativePath), file.buffer, {
      flag: 'wx',
    });
    return relativePath;
  }

  /** Deletes a stored file. Never throws: a missing file is not an error. */
  async remove(relativePath: string): Promise<void> {
    try {
      await rm(this.resolveSafe(relativePath), { force: true });
    } catch (error) {
      this.logger.warn(`Could not delete ${relativePath}: ${String(error)}`);
    }
  }

  /** Public URL of a stored file, or null if it is missing or private. */
  publicUrl(relativePath: string | null): string | null {
    if (!relativePath || !relativePath.startsWith('public/')) return null;
    return `/uploads/${relativePath.slice('public/'.length)}`;
  }


    /** Absolute path of a stored file (used to stream private files). */
  getAbsolutePath(relativePath: string): string {
    return this.resolveSafe(relativePath);
  }

  // 20261111-083512 (UTC)
  private timestamp(): string {
    const iso = new Date().toISOString();
    const date = iso.slice(0, 10).replaceAll('-', '');
    const time = iso.slice(11, 19).replaceAll(':', '');
    return `${date}-${time}`;
  }

  // refuses any path that escapes the uploads folder
  private resolveSafe(relativePath: string): string {
    const full = resolve(this.root, relativePath);
    const rel = relative(this.root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Invalid file path');
    }
    return full;
  }
}