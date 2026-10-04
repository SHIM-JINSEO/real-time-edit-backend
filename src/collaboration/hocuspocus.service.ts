import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus, type WebSocketLike } from '@hocuspocus/server';
import crossws from 'crossws/adapters/node';
import type { Server as HttpServer } from 'node:http';
import type * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { readDocumentText } from '../yjs/document-doc.js';

// WebSocket path on the NestJS HTTP server where Hocuspocus listens.
export const COLLABORATION_PATH = '/collaboration';

export interface CollaborationStats {
  documents: number;
  connections: number;
}

/**
 * Hosts a Hocuspocus instance on the same HTTP server (and port) as NestJS.
 *
 * - `onAuthenticate` checks the share token the client sends for a document.
 * - The `Database` extension loads/saves the binary Yjs state in PostgreSQL
 *   and refreshes the plain-text `title`/`content` snapshot columns.
 * - `withDocument` lets the REST API edit the live Y.Doc so connected
 *   clients receive REST edits as ordinary CRDT updates.
 */
@Injectable()
export class HocuspocusService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(HocuspocusService.name);
  readonly hocuspocus: Hocuspocus;
  private readonly ws: ReturnType<typeof crossws>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterHost: HttpAdapterHost,
  ) {
    this.hocuspocus = new Hocuspocus({
      name: 'real-time-edit',
      quiet: true,
      debounce: 1000, // when stop typing
      maxDebounce: 5000, // when keep typing

      // check the share token the client sends for a document. If it doesn't match the DB, the connection is rejected.
      onAuthenticate: async ({ documentName, token }) => {
        const doc = await this.prisma.document.findUnique({
          where: { id: documentName },
          select: { shareToken: true },
        });
        if (!doc) throw new Error('Document not found');
        if (!token || token !== doc.shareToken) {
          throw new Error('Invalid share token');
        }
      },
      // extend database to load/save the binary Yjs state in PostgreSQL and refresh the plain-text title/content snapshot columns
      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            const doc = await this.prisma.document.findUnique({
              where: { id: documentName },
              select: { yjsState: true },
            });
            return doc?.yjsState ?? null;
          },
          store: async ({ documentName, document, state }) => {
            const text = readDocumentText(document);
            await this.prisma.document.updateMany({
              where: { id: documentName },
              data: { yjsState: new Uint8Array(state), ...text },
            });
          },
        }),
      ],
    });

    // crossws adapter deliver WebSocket connections to Hocuspocus 
    this.ws = crossws({
      hooks: {
        // open websocket connection and attach it to Hocuspocus
        open: (peer) => {
          const connection = this.hocuspocus.handleConnection(
            peer.websocket as unknown as WebSocketLike,
            peer.request as Request,
          );
          (peer as any)._hocuspocus = connection;
        },
        // handle incoming WebSocket messages
        message: (peer, message) => {
          (peer as any)._hocuspocus?.handleMessage(message.uint8Array());
        },
        // close websocket connection and detach it from Hocuspocus
        close: (peer, event) => {
          (peer as any)._hocuspocus?.handleClose({
            code: event.code,
            reason: event.reason,
          });
        },
        error: (peer, error) => {
          this.logger.error(`WebSocket error for peer ${peer.id}: ${error}`);
        },
      },
    });
  }

  // Mount the Hocuspocus WebSocket server on the NestJS HTTP server. 
  // The Hocuspocus instance will handle WebSocket upgrade requests at the specified path.
  onModuleInit(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as HttpServer;
    // Get the underlying HTTP server from the NestJS application and listen for WebSocket upgrade requests.
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname.replace(/\/+$/, '') !== COLLABORATION_PATH) {
        socket.destroy();
        return;
      }
      // Delegate the WebSocket upgrade to the crossws adapter, which will handle the connection and pass it to Hocuspocus.
      this.ws.handleUpgrade(request, socket, head).catch((error) => {
        this.logger.error(`WebSocket upgrade failed: ${error}`);
        socket.destroy();
      });
    });
    this.logger.log(`Hocuspocus mounted at ws://<host>${COLLABORATION_PATH}`);
  }

  // exectue when the application is shutting down. 
  // It closes all active client connections to Hocuspocus, flushes any pending database writes, and triggers the onDestroy hook for cleanup.
  async onApplicationShutdown(): Promise<void> {
    this.hocuspocus.closeConnections(); 
    this.hocuspocus.flushPendingStores(); 
    await this.hocuspocus.hooks('onDestroy', { instance: this.hocuspocus });
  }

  /** Most important methods in this service **/

  async withDocument(
    documentId: string,
    mutate: (doc: Y.Doc) => void,
  ): Promise<void> {
    // connect to the document and perform a transaction on it, applying the provided mutation function. After the transaction, disconnect from the document.
    const connection = await this.hocuspocus.openDirectConnection(documentId);
    try {
      await connection.transact((doc) => mutate(doc));
    } finally {
      await connection.disconnect();
    }
  }

  /** Kick every client off a document (used before deleting it). */
  closeDocument(documentId: string): void {
    this.hocuspocus.closeConnections(documentId);
  }

  stats(): CollaborationStats {
    return {
      documents: this.hocuspocus.getDocumentsCount(),
      connections: this.hocuspocus.getConnectionsCount(),
    };
  }
}
