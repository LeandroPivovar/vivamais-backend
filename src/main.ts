import 'dotenv/config';
import { mkdirSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { UPLOADS_DIR, UPLOADS_PUBLIC_PREFIX } from './common/uploads.constant';

/**
 * Domínios oficiais do portal — sempre liberados no CORS, independente do
 * CORS_ORIGIN do .env. Servimos o app nos dois (.net é o ativo; o .com fica
 * para quando o DNS voltar), e um .env desatualizado aqui derruba o checkout
 * inteiro no browser com "Failed to fetch".
 */
const DEFAULT_ORIGINS = [
  'https://conta.vivamaisclub.net',
  'https://conta.vivamaisclub.com',
];

function corsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás do nginx, sem isto o @Ip() devolve o IP do proxy — e a Veenca exige o IPv4
  // real do cliente na cobrança em cartão.
  app.set('trust proxy', 1);

  // Anexos (prints de ticket) são gravados em disco e servidos estaticamente.
  mkdirSync(UPLOADS_DIR, { recursive: true });
  app.useStaticAssets(UPLOADS_DIR, { prefix: UPLOADS_PUBLIC_PREFIX });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  const port = process.env.PORT ?? 3011;
  await app.listen(port);
  console.log(`🚀 Backend rodando em http://localhost:${port}/api`);
}
bootstrap();
