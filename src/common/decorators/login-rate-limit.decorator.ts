import { SetMetadata } from '@nestjs/common';

export const LOGIN_RATE_LIMIT_KEY = 'loginRateLimit';

/** Marks a route whose attempts are counted per IP + email. */
export const LoginRateLimit = () => SetMetadata(LOGIN_RATE_LIMIT_KEY, true);