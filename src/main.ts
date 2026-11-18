import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { FileStorageService } from './storage/file-storage.service.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );


  // Swagger UI needs inline scripts, so the strict CSP is relaxed for /docs only
  const helmetDefault = helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  const helmetDocs = helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  });
  app.use((req, res, next) =>
    (req.path.startsWith('/docs') ? helmetDocs : helmetDefault)(req, res, next),
  );

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

  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  // only the public folder is served: private files never are
  app.useStaticAssets(app.get(FileStorageService).publicRoot, {
    prefix: '/uploads/',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  const port = app.get(ConfigService).get<number>('PORT') ?? 3000;
  await app.listen(port);
}
bootstrap();