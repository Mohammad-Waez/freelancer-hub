import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

// 30s, 15m, 12h, 7d
const DURATION = /^\d+[smhd]$/;

// an empty value in .env (for example "CORS_ORIGINS=") means "not set"
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

class EnvironmentVariables {
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a PostgreSQL connection string',
  })
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  @Matches(DURATION, {
    message: 'JWT_ACCESS_EXPIRES_IN must look like 15m, 12h or 7d',
  })
  JWT_ACCESS_EXPIRES_IN!: string;

  @Matches(DURATION, {
    message: 'JWT_REFRESH_EXPIRES_IN must look like 15m, 12h or 7d',
  })
  JWT_REFRESH_EXPIRES_IN!: string;

  @IsEmail()
  PLATFORM_ADMIN_EMAIL!: string;

  @IsString()
  @IsNotEmpty()
  PLATFORM_ADMIN_NAME!: string;

  @IsString()
  @MinLength(8)
  PLATFORM_ADMIN_PASSWORD!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  UPLOADS_DIR?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^https?:\/\/[^\s,/]+(\s*,\s*https?:\/\/[^\s,/]+)*$/, {
    message:
      'CORS_ORIGINS must be comma-separated origins without a trailing slash, e.g. http://localhost:5173',
  })
  CORS_ORIGINS?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY?: number;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  RATE_LIMIT_PER_MINUTE?: number;
}

/** Runs once at startup (ConfigModule). Throws one error listing every problem. */
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validated);

  if (errors.length > 0) {
    const lines = errors.map(
      (e) =>
        `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    );
    throw new Error(`Invalid environment variables:\n${lines.join('\n')}`);
  }
  return validated;
}