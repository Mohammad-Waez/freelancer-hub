import {
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';

import { sha256 } from '../common/utils/crypto.util.js';
import { Prisma, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { TokenService } from './token.service.js';

const BCRYPT_ROUNDS = 12;

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService implements OnModuleInit {
  // used to keep login timing equal when the email does not exist
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await this.hashPassword('dummy-password-for-timing');
  }

  async register(dto: RegisterDto) {
    const passwordHash = await this.hashPassword(dto.password);

    try {
      // nested writes run in one atomic transaction:
      // user + wallet (+ empty profile for freelancers)
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: dto.role,
          wallet: { create: {} },
          ...(dto.role === Role.FREELANCER
            ? { profile: { create: {} } }
            : {}),
        },
        select: publicUser,
      });

      const tokens = await this.tokens.issue(user.id);
      return { user, ...tokens };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const found = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    const isValid = await bcrypt.compare(
      this.prehash(dto.password),
      found?.passwordHash ?? this.dummyHash,
    );

    if (!found || !isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (found.isBanned) {
      throw new ForbiddenException('Your account has been banned');
    }

    const tokens = await this.tokens.issue(found.id);
    return {
      user: {
        id: found.id,
        name: found.name,
        email: found.email,
        role: found.role,
      },
      ...tokens,
    };
  }


  me(userId: number) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: publicUser,
    });
  }

    refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string) {
    return this.tokens.revoke(refreshToken);
  }

  // SHA-256 first, so bcrypt's 72-byte limit never truncates long
  // or non-ASCII (e.g. Arabic) passwords
  private prehash(password: string) {
    return sha256(password, 'base64');
  }

  private hashPassword(password: string) {
    return bcrypt.hash(this.prehash(password), BCRYPT_ROUNDS);
  }
}