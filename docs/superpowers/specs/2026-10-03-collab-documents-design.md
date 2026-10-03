# Real-time collaborative documents — design spec

Date: 2026-10-03
Status: approved by default (autonomous run); assumptions are listed so they can be overridden.

## Goal

A demo backend (NestJS + Prisma + PostgreSQL) that shows CRDT-based collaborative
editing with Yjs and Hocuspocus. It is a teaching/presentation project, not a product.

## Requirements (from the user)

1. Anyone on the web can do basic document CRUD.
2. No login. Whoever knows a document's share token can open the share link and edit.
3. A document is just a title and plain text.
4. Many people editing at once must converge, via Hocuspocus (WebSocket) + Yjs (CRDT).
5. Afterwards: a document explaining the principles, the implementation, and what is
   needed next for the frontend and deployment.

## Assumptions made (no user available mid-task)

- Title is also collaborative (a `Y.Text` named `title`), not just the body. This makes
  the demo richer and keeps one source of truth: the Y.Doc.
- A document is identified by a UUID; its share token is a separate random string.
  Share link shape (frontend-owned): `<frontend>/share/<shareToken>`.
- Listing documents is open (titles only, no tokens), because there is no user concept.
  Reading, updating, or deleting a specific document requires its share token.
- Hocuspocus runs on the **same HTTP server and port** as NestJS, under the path
  `/collaboration`. One port is easier to deploy than two.
- Scaffold models `User`/`Post` are removed (they were never used).
- The `@nestjs/observe` module from the scaffold is left untouched.

## Architecture

```
Browser A ──REST /api/documents──▶ NestJS (Express) ──▶ Prisma ──▶ PostgreSQL
Browser B ──WS   /collaboration──▶ Hocuspocus (same Node http server)
                                      │  onAuthenticate: token == document.shareToken
                                      │  Database ext: fetch/store Y.Doc binary
                                      └──▶ Prisma ──▶ PostgreSQL (Document.yjsState)
```

### Modules

- `PrismaModule` / `PrismaService` — Prisma 7 client with the `pg` driver adapter.
- `DocumentsModule`
  - `DocumentsService` — CRUD on the `Document` table, token verification,
    Y.Doc <-> columns helpers.
  - `DocumentsController` — REST under `/api/documents`.
  - `ShareTokenGuard` — reads `x-share-token` header or `?token=` query and checks it
    against the document in `:id`.
- `CollaborationModule`
  - `HocuspocusService` — builds a `Hocuspocus` instance, attaches it to Nest's HTTP
    server `upgrade` event for `/collaboration` via the `crossws` node adapter,
    wires the `Database` extension to `DocumentsService`, and exposes
    `withDocument(id, fn)` (direct connection) so REST edits flow to live clients.
  - `CollaborationController` — `GET /api/collaboration/stats` for the demo
    (open documents / connections).
- `yjs/document-doc.ts` — pure helpers: `encodeInitialState(title, content)`,
  `readTitle(doc)`, `readContent(doc)`. Shared by REST and WS paths.

### Data model

```prisma
model Document {
  id         String   @id @default(uuid())
  title      String   @default("Untitled")   // snapshot of Y.Text "title"
  content    String   @default("")           // snapshot of Y.Text "content"
  yjsState   Bytes?                          // Y.encodeStateAsUpdate(doc)
  shareToken String   @unique @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

`yjsState` is the source of truth for collaboration. `title`/`content` are derived
snapshots written on every `onStoreDocument`, so plain REST reads and listings never
need to decode Yjs.

### Y.Doc shape

- `doc.getText('title')`
- `doc.getText('content')`

### REST API (`/api`)

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/documents` | none | `{ title?, content? }` | 201 document incl. `shareToken` |
| GET | `/documents` | none | | `[{ id, title, createdAt, updatedAt }]` |
| GET | `/documents/shared/:shareToken` | token in path | | full document (bootstrap for share link) |
| GET | `/documents/:id` | share token | | full document |
| PATCH | `/documents/:id` | share token | `{ title?, content? }` | updated document |
| DELETE | `/documents/:id` | share token | | 204 |
| GET | `/collaboration/stats` | none | | `{ documents, connections }` |

Full document = `{ id, title, content, shareToken, createdAt, updatedAt }`.
Errors: 404 unknown id/token, 403 wrong token, 400 validation.

PATCH applies the change inside the live Y.Doc through Hocuspocus (direct connection),
replacing the text of the relevant `Y.Text`. Connected clients receive it as a normal
CRDT update; the Database extension persists it.

### WebSocket (`/collaboration`)

Client: `new HocuspocusProvider({ url: 'ws://host/collaboration', name: <documentId>, token: <shareToken>, document: ydoc })`.

Server hooks:
- `onAuthenticate` — look up document by `documentName`; throw if missing or token mismatch.
- `Database.fetch` — return `yjsState` bytes (or null → empty doc).
- `Database.store` — save `yjsState` plus `title`/`content` snapshots.
- `debounce: 1000`, `maxDebounce: 5000` so persistence is visibly quick in demos.

Delete closes all connections for that document name before removing the row.

### Error handling

- Prisma "not found" → `NotFoundException`.
- Token mismatch → `ForbiddenException` (REST) / rejected auth (WS).
- Hocuspocus hook failures are logged with Nest's `Logger`; never crash the process.

### Testing

- Unit (vitest): Y.Doc helpers; `DocumentsService` with a mocked Prisma; guard.
- E2E (vitest + supertest + real Postgres from docker-compose): REST CRUD and
  token rules; two `HocuspocusProvider` clients editing the same document converge
  and the result is persisted to the DB; wrong token is rejected.

## Deliverable docs

- `docs/COLLABORATIVE-EDITING.md` (Korean): CRDT/Yjs principles, how this code works,
  frontend guide, deployment guide.
- README updated with run instructions.
