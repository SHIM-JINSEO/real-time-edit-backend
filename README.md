# real-time-edit-backend

CRDT 기반 실시간 공동 텍스트 편집 백엔드. 발표·시연용 프로젝트.

- **NestJS 12** (REST) + **Hocuspocus 4** (WebSocket, 같은 포트의 `/collaboration`)
- **Yjs** CRDT로 제목·본문 동시 편집
- **Prisma 7 + PostgreSQL 17**에 Yjs 바이너리 상태와 평문 스냅샷 저장
- 로그인 없음. 문서별 **공유 토큰**으로 접근 제어

전체 설명(원리, 구현, 프론트엔드/배포 가이드)은 **[docs/COLLABORATIVE-EDITING.md](docs/COLLABORATIVE-EDITING.md)** 를 보세요.

## Quick start

```bash
bun install
cp .env.example .env     # 이미 .env 가 있으면 생략
bun run db:up            # PostgreSQL (docker compose)
bun run db:migrate       # 스키마 적용
bun run start:dev        # http://localhost:3000/api
```

```bash
# 문서 생성
curl -s -X POST localhost:3000/api/documents -H 'content-type: application/json' -d '{"title":"Hello"}'
# 응답의 id / shareToken 으로 WebSocket 접속:
#   url: ws://localhost:3000/collaboration, name: <id>, token: <shareToken>
```

## API

브라우저에서 **http://localhost:3000/api-docs** (Swagger UI)를 열면 모든 REST API를 보고 바로 호출해 볼 수 있습니다. 원본 OpenAPI JSON은 `/api-docs-json`. (`NODE_ENV=production`이면 비활성화)

| Method | Path | Auth |
|---|---|---|
| POST | `/api/documents` | – |
| GET | `/api/documents` | – |
| GET | `/api/documents/shared/:shareToken` | 경로 토큰 |
| GET / PATCH / DELETE | `/api/documents/:id` | `x-share-token` 헤더 또는 `?token=` |
| GET | `/api/collaboration/stats` | – |
| GET | `/api/health` | – |

## Tests

```bash
bun run test       # 단위 (Yjs 헬퍼, 서비스)
bun run test:e2e   # E2E: REST CRUD + 두 WebSocket 클라이언트 동시 편집 수렴 (DB 필요)
```

## Scripts

| Script | 설명 |
|---|---|
| `start:dev` | watch 모드 실행 |
| `build` / `start:prod` | `prisma generate && nest build` / `node dist/main` |
| `db:up` / `db:migrate` / `db:deploy` / `db:studio` | Postgres 기동 / 개발 마이그레이션 / 운영 마이그레이션 / Prisma Studio |
| `lint` / `format` | oxlint / prettier |
