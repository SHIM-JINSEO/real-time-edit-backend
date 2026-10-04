import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { COLLABORATION_PATH } from './collaboration/hocuspocus.service.js';
import {
  SHARE_TOKEN_HEADER,
  SHARE_TOKEN_SECURITY,
} from './documents/share-token.guard.js';

export const SWAGGER_PATH = 'api-docs';

/**
 * Serves Swagger UI at `/api-docs` and the raw OpenAPI JSON at
 * `/api-docs-json`. The global `/api` prefix is applied to the documented
 * paths automatically; the docs route itself is not prefixed.
 */
export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Real-time Edit API')
    .setDescription(
      [
        'REST API for the real-time collaborative editing demo (Yjs + Hocuspocus).',
        '',
        `- Protected document routes take the share token via the \`${SHARE_TOKEN_HEADER}\` header (or \`?token=\`).`,
        '  Paste the `shareToken` from the create response into **Authorize** (top right) to send it automatically.',
        `- Real-time editing happens over the WebSocket \`ws://<host>${COLLABORATION_PATH}\` (Hocuspocus),`,
        '  which OpenAPI cannot describe, so it is not listed here.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: SHARE_TOKEN_HEADER,
        description: 'shareToken from the create-document response',
      },
      SHARE_TOKEN_SECURITY,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    // Keep the entered share token across page reloads during a demo.
    swaggerOptions: { persistAuthorization: true },
  });
}
