import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../common/utils/crypto.util.js';
import { parseDurationMs } from '../common/utils/duration.util.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from './interfaces/jwt-payload.interface.js';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Issues a short-lived access token and a stored (hashed) refresh token. */
  async issue(
    userId: number,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const payload: JwtPayload = { sub: userId };

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.getOrThrow<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const ttlMs = parseDurationMs(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );

    await client.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return { accessToken, refreshToken };
  }

  /** Exchanges a valid refresh token for a new pair (rotation). */
  async rotate(rawToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    // a revoked token used again was most likely stolen:
    // kill every session of this user
    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { isBanned: true },
    });
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    if (user.isBanned) {
      await this.revokeAllForUser(stored.userId);
      throw new ForbiddenException('Your account has been banned');
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      // atomic claim: only one concurrent request can revoke this token
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      return this.issue(stored.userId, tx);
    });

    // lost the race: the token was used by someone else a moment ago
    if (!tokens) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    return tokens;
  }

  /** Revokes one refresh token. Silent if it does not exist. */
  async revoke(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes all active refresh tokens of a user (reuse, ban...). */
  async revokeAllForUser(userId: number) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}