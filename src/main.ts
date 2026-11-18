import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { FileStorageService } from './storage/file-storage.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // behind Nginx / a load balancer: how many proxies to trust for req.ip
  const trustProxy = config.get<number>('TRUST_PROXY') ?? 0;
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  // Swagger UI needs inline scripts, so the strict CSP is relaxed for /docs only
  const helmetDefault = helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  const helmetDocs = helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/docs') ? helmetDocs : helmetDefault)(req, res, next),
  );

  // smaller responses
  app.use(compression());

  // CORS: only the listed frontends (disabled when the list is empty)
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  // only the public folder is served: private files never are
  app.useStaticAssets(app.get(FileStorageService).publicRoot, {
    prefix: '/uploads/',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  // Swagger documentation at /docs (the OpenAPI JSON at /docs-json)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('FreelanceHub API')
    .setDescription(
      [
        'منصة عمل حر تجمع أصحاب المشاريع بالمستقلين.',
        '',
        '**الدخول:** نفّذ `POST /auth/login` ثم انسخ `accessToken` وضعه في زر **Authorize** أعلى الصفحة.',
        '',
        '**شكل الرد الموحد:** `{ success, message, data, meta? }` عند النجاح، و`{ success: false, statusCode, message, errors }` عند الفشل.',
        '',
        '**المال نصوص بخانتين** (`"100.00"`)، **وروابط الملفات نسبية** (`/uploads/...`).',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // close the database connection and the scheduled jobs cleanly on stop
  app.enableShutdownHooks();

  await app.listen(config.get<number>('PORT') ?? 3000);
}
bootstrap();