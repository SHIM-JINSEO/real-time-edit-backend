import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { createInitialState } from '../yjs/document-doc.js';
import type { Document } from '../generated/prisma/client.js';
import type { DocumentSummary } from './document.response.js';

export const DEFAULT_TITLE = 'Untitled';

/**
 * Database-level operations for documents: CRUD plus share-token checks.
 * Anything that touches a *live* Y.Doc goes through HocuspocusService.
 */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { title?: string; content?: string }): Promise<Document> {
    const title = input.title?.trim() || DEFAULT_TITLE;
    const content = input.content ?? '';
    return this.prisma.document.create({
      data: {
        title,
        content,
        // Seed the CRDT state so the first collaborator sees the same text
        // the REST API reported.
        yjsState: new Uint8Array(createInitialState({ title, content })),
      },
    });
  }

  findAll(): Promise<DocumentSummary[]> {
    return this.prisma.document.findMany({
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  async findByShareToken(shareToken: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({
      where: { shareToken },
    });
    if (!doc) throw new NotFoundException('No document for this share token');
    return doc;
  }

  /** Resolve a document and verify the caller knows its share token. */
  async assertShareToken(
    id: string,
    token: string | undefined,
  ): Promise<Document> {
    const doc = await this.findById(id);
    if (!token || token !== doc.shareToken) {
      throw new ForbiddenException('Invalid share token');
    }
    return doc;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.document.delete({ where: { id } });
  }
}
