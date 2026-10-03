import type { Document } from '../generated/prisma/client.js';

/** Public representation of a document (binary Yjs state is never exposed). */
export interface DocumentResponse {
  id: string;
  title: string;
  content: string;
  shareToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
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
