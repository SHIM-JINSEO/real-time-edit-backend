import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

export interface TestApp {
  app: INestApplication;
  /** e.g. http://127.0.0.1:54321 */
  httpUrl: string;
  /** e.g. ws://127.0.0.1:54321/collaboration */
  wsUrl: string;
}

/**
 * Boot the real application (real Postgres from docker-compose) on a random
 * port so both REST and WebSocket paths can be exercised end to end.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.listen(0, '127.0.0.1');

  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/collaboration`,
  };
}
