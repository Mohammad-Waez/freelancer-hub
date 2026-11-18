import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  LoginRateLimit,
  Public,
  ResponseMessage,
} from '../common/decorators/index.js';
import { ApiDoc } from '../common/swagger/api-doc.decorator.js';
import { EX } from '../common/swagger/examples.js';
import type { AuthUser } from '../common/interfaces/auth-user.interface.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('Auth: الحسابات')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ResponseMessage('Registered successfully')
  @ApiDoc({
    auth: false,
    summary: 'تسجيل حساب جديد',
    description:
      'ينشئ حساباً **ومحفظة له** (وملف مستقل فارغاً إن كان مستقلاً) في عملية واحدة ويُرجع الـ tokens مباشرة.\n\n' +
      '- `name`: 2 إلى 100 حرف.\n- `email`: بريد صالح (يُحوَّل إلى أحرف صغيرة).\n' +
      '- `password`: 8 إلى 128 حرفاً وفيها حرف ورقم.\n- `role`: `CLIENT` أو `FREELANCER` فقط (لا مدير من هنا).',
    body: {
      name: 'Sara',
      email: 'sara@test.com',
      password: 'Pass1234',
      role: 'CLIENT',
    },
    ok: {
      status: 201,
      message: 'Registered successfully',
      data: { user: EX.user, ...EX.tokens },
    },
    errors: [400, [409, 'Email is already registered']],
  })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @LoginRateLimit()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Logged in successfully')
  @ApiDoc({
    auth: false,
    summary: 'تسجيل الدخول',
    description:
      'يُرجع access token (يعيش 15 دقيقة) وrefresh token (7 أيام).\n\n' +
      '- رسالة الخطأ واحدة سواء كان البريد أو كلمة السر خاطئة.\n' +
      '- المحظور يُرفض (403) بعد التأكد من كلمة السر.\n' +
      '- **الحد: 5 محاولات في الدقيقة لكل (IP + بريد).**',
    body: { email: 'sara@test.com', password: 'Pass1234' },
    ok: {
      message: 'Logged in successfully',
      data: { user: EX.user, ...EX.tokens },
    },
    errors: [
      400,
      [401, 'Invalid email or password'],
      [403, 'Your account has been banned'],
      429,
    ],
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ResponseMessage('Token refreshed')
  @ApiDoc({
    auth: false,
    summary: 'تجديد الجلسة (refresh)',
    description:
      'يُبدل refresh token صالحاً بزوج جديد. **التدوير:** القديم يُلغى فوراً.\n\n' +
      'استعمال token ألغي سابقاً يعني غالباً أنه سُرق، فتُلغى **كل** جلسات صاحبه.',
    body: { refreshToken: EX.tokens.refreshToken },
    ok: { message: 'Token refreshed', data: EX.tokens },
    errors: [400, [401, 'Invalid refresh token'], 403],
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ResponseMessage('Logged out successfully')
  @ApiDoc({
    auth: false,
    summary: 'تسجيل الخروج',
    description:
      'يُلغي الـ refresh token المرسل. آمن للتكرار (200 دائماً).\n\n' +
      'الـ access token الصادر قبله يبقى صالحاً حتى تنتهي مدته (15 دقيقة).',
    body: { refreshToken: EX.tokens.refreshToken },
    ok: { message: 'Logged out successfully', data: null },
    errors: [400],
  })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
    return null;
  }

  @Get('me')
  @ResponseMessage('Current user')
  @ApiDoc({
    summary: 'المستخدم الحالي',
    description: 'يُرجع بيانات صاحب الـ token.',
    ok: { message: 'Current user', data: EX.user },
    errors: [[403, 'Your account has been banned']],
  })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}