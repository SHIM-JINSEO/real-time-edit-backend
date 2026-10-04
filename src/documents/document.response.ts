import { ApiProperty } from '@nestjs/swagger';
import type { Document } from '../generated/prisma/client.js';

// These are classes (not interfaces) so @nestjs/swagger can read their
// metadata at runtime and render the response schemas in /api-docs.

/** Public listing entry: titles only, no content or share token. */
export class DocumentSummary {
  @ApiProperty({ example: '6f1c2a3e-8b7d-4c1e-9f0a-1234567890ab' })
  id: string;

  @ApiProperty({ example: 'CRDT talk' })
  title: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** Public representation of a document (binary Yjs state is never exposed). */
export class DocumentResponse extends DocumentSummary {
  @ApiProperty({ example: 'Hello, world' })
  content: string;

  @ApiProperty({
    description:
      'Share token for this document. Send it as the `x-share-token` header, the `?token=` query, or the WebSocket token.',
    example: 'cm1x8k2p40000abcd1234efgh',
  })
  shareToken: string;
}

export function toDocumentResponse(doc: Document): DocumentResponse {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    shareToken: doc.shareToken,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
