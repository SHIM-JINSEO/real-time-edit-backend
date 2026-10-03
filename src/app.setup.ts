import { INestApplication, ValidationPipe } from '@nestjs/common';

export const API_PREFIX = 'api';

/**
 * Shared HTTP configuration used by `main.ts` and the e2e tests so both run
 * the exact same pipeline (prefix, CORS, validation).
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  return app;
}
