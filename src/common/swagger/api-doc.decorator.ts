import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface ApiDocOptions {
  /** one line: what the request does */
  summary: string;
  /** rules and details */
  description?: string;
  /** false for public routes (no Bearer token). Default: true */
  auth?: boolean;
  /** JSON body example */
  body?: Json;
  /** multipart/form-data: text fields and/or one file field */
  form?: {
    fields?: Record<string, string | number | boolean>;
    file?: { name: string; description: string };
  };
  query?: {
    name: string;
    description: string;
    example?: string | number;
    required?: boolean;
    enum?: string[];
  }[];
  /** the success response */
  ok?: { status?: number; message: string; data?: Json; meta?: boolean };
  /** a file download instead of JSON */
  okFile?: { description: string; contentType: string };
  /** error statuses; a [status, message] pair sets the example message */
  errors?: (number | [number, string])[];
}

const ERROR_TITLES: Record<number, string> = {
  400: 'بيانات غير صالحة',
  401: 'غير مسجّل أو token غير صالح',
  403: 'لا صلاحية لهذا الدور (أو الحساب محظور)',
  404: 'غير موجود (أو ليس لك)',
  409: 'تعارض مع حالة النظام',
  413: 'الملف أكبر من الحد المسموح',
  429: 'تجاوزت حد الطلبات',
};

const ERROR_MESSAGES: Record<number, string> = {
  400: 'Validation failed',
  401: 'Unauthorized',
  403: 'You do not have permission to perform this action',
  404: 'Not found',
  409: 'Conflict with the current state',
  413: 'File is too large',
  429: 'Too many requests, please try again later',
};

// the schema types of Swagger are very strict: examples are plain objects
const schema = (value: Record<string, unknown>) => value as never;

export function ApiDoc(o: ApiDocOptions) {
  const decorators: MethodDecorator[] = [
    ApiOperation({ summary: o.summary, description: o.description }),
  ];

  if (o.auth !== false) decorators.push(ApiBearerAuth());

  if (o.body !== undefined) {
    decorators.push(
      ApiBody({ schema: schema({ type: 'object', example: o.body }) }),
    );
  }

  if (o.form) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(o.form.fields ?? {})) {
      properties[key] = {
        type: typeof value === 'string' ? 'string' : typeof value,
        example: value,
      };
    }
    if (o.form.file) {
      properties[o.form.file.name] = {
        type: 'string',
        format: 'binary',
        description: o.form.file.description,
      };
    }
    decorators.push(
      ApiConsumes('multipart/form-data'),
      ApiBody({ schema: schema({ type: 'object', properties }) }),
    );
  }

  for (const q of o.query ?? []) {
    decorators.push(
      ApiQuery({
        name: q.name,
        description: q.description,
        required: q.required ?? false,
        example: q.example,
        enum: q.enum,
      }),
    );
  }

  if (o.ok) {
    decorators.push(
      ApiResponse({
        status: o.ok.status ?? 200,
        description: o.ok.message,
        schema: schema({
          example: {
            success: true,
            message: o.ok.message,
            data: o.ok.data ?? null,
            ...(o.ok.meta
              ? { meta: { total: 42, page: 1, limit: 10, totalPages: 5 } }
              : {}),
          },
        }),
      }),
    );
  }

  if (o.okFile) {
    decorators.push(
      ApiResponse({
        status: 200,
        description: o.okFile.description,
        content: {
          [o.okFile.contentType]: schema({
            schema: { type: 'string', format: 'binary' },
          }),
        },
      }),
    );
  }

  const errors = [...(o.errors ?? [])];
  const has401 = errors.some((e) => (Array.isArray(e) ? e[0] : e) === 401);
  if (o.auth !== false && !has401) errors.push(401);

  for (const e of errors) {
    const [status, message] = Array.isArray(e)
      ? e
      : [e, ERROR_MESSAGES[e] ?? 'Error'];
    decorators.push(
      ApiResponse({
        status,
        description: ERROR_TITLES[status] ?? 'Error',
        schema: schema({
          example: {
            success: false,
            statusCode: status,
            message,
            errors: status === 400 ? ['password must be longer than or equal to 8 characters'] : [],
          },
        }),
      }),
    );
  }

  return applyDecorators(...decorators);
}