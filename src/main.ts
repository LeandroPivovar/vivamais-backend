import 'dotenv/config';
import { mkdirSync } from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { UPLOADS_DIR, UPLOADS_PUBLIC_PREFIX } from './common/uploads.constant';
import { corsAllowedOrigins } from './common/public-url';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás do nginx, sem isto o @Ip() devolve o IP do proxy — e a Veenca exige o IPv4
  // real do cliente na cobrança em cartão.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    ['/api/auth/login', '/api/auth/login-kids', '/api/auth/forgot-password', '/api/auth/reset-password'],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
    }),
  );
  app.use(
    ['/api/billing/checkout', '/api/billing/referral-click'],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 80,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' },
    }),
  );

  // Anexos (prints de ticket) são gravados em disco e servidos estaticamente.
  mkdirSync(UPLOADS_DIR, { recursive: true });
  app.useStaticAssets(UPLOADS_DIR, { prefix: UPLOADS_PUBLIC_PREFIX });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: corsAllowedOrigins(),
    credentials: true,
  });
  const port = process.env.PORT ?? 3011;
  await app.listen(port);
  console.log(`🚀 Backend rodando em http://localhost:${port}/api`);
}
bootstrap();
