# 실시간 공동 편집 백엔드 — 원리, 구현, 그리고 다음 단계

> 대상 독자: 이 프로젝트로 CRDT를 발표·시연하려는 개발자.
> 스택: NestJS 12 · Prisma 7 · PostgreSQL 17 · Yjs 13 · Hocuspocus 4

---

## 목차

1. [프로젝트 한눈에 보기](#1-프로젝트-한눈에-보기)
2. [왜 CRDT인가 — 공동 편집의 근본 문제](#2-왜-crdt인가--공동-편집의-근본-문제)
3. [Yjs는 어떻게 동작하는가](#3-yjs는-어떻게-동작하는가)
4. [Hocuspocus의 역할](#4-hocuspocus의-역할)
5. [이 프로젝트의 구현](#5-이-프로젝트의-구현)
6. [발표·시연 시나리오 제안](#6-발표시연-시나리오-제안)
7. [프론트엔드 구현 가이드](#7-프론트엔드-구현-가이드)
8. [배포 가이드](#8-배포-가이드)
9. [한계와 확장 아이디어](#9-한계와-확장-아이디어)
10. [부록: 명령어 모음 / API 레퍼런스](#10-부록)

---

## 1. 프로젝트 한눈에 보기

```
┌──────────────┐  REST  /api/documents        ┌──────────────────────────────┐
│  브라우저 A  │ ───────────────────────────▶ │  NestJS (Express)            │
│              │  WS    /collaboration        │   ├─ DocumentsModule (CRUD)  │
│  브라우저 B  │ ───────────────────────────▶ │   ├─ CollaborationModule     │        ┌────────────┐
│              │        Yjs sync / awareness  │   │    └─ Hocuspocus         │ Prisma │ PostgreSQL │
│  브라우저 C  │ ◀──────────────────────────  │   │        ├ onAuthenticate  │ ─────▶ │  Document  │
└──────────────┘        CRDT update 브로드캐스트│   │        └ Database ext.   │        │  (yjsState)│
                                              │   └─ PrismaModule            │        └────────────┘
                                              └──────────────────────────────┘
                                                  하나의 HTTP 서버, 하나의 포트
```

- **문서 CRUD**: 누구나 REST로 문서를 만들고, 목록을 보고, 수정·삭제할 수 있다.
- **로그인 없음**: 문서마다 `shareToken`이 하나 있다. 토큰을 아는 사람만 그 문서를 읽고 쓸 수 있다.
- **문서 = 제목 + 본문** (둘 다 평문). 둘 다 CRDT(`Y.Text`)로 관리된다.
- **동시 편집**: 클라이언트는 Hocuspocus WebSocket에 접속해 Yjs 업데이트를 주고받는다. 서버는 중계·검증·저장만 한다.

핵심 소스 파일:

| 역할 | 파일 |
|---|---|
| Y.Doc 구조와 순수 헬퍼 | [src/yjs/document-doc.ts](../src/yjs/document-doc.ts) |
| Hocuspocus 마운트·인증·저장 | [src/collaboration/hocuspocus.service.ts](../src/collaboration/hocuspocus.service.ts) |
| REST 컨트롤러 | [src/documents/documents.controller.ts](../src/documents/documents.controller.ts) |
| DB CRUD + 토큰 검증 | [src/documents/documents.service.ts](../src/documents/documents.service.ts) |
| 토큰 가드 | [src/documents/share-token.guard.ts](../src/documents/share-token.guard.ts) |
| 데이터 모델 | [prisma/schema.prisma](../prisma/schema.prisma) |
| E2E 시나리오(두 클라이언트 수렴 검증) | [test/collaboration.e2e-spec.ts](../test/collaboration.e2e-spec.ts) |

---

## 2. 왜 CRDT인가 — 공동 편집의 근본 문제

### 2.1 문제

두 사람이 같은 문자열 `"abc"`를 동시에 편집한다고 하자.

- A는 맨 앞에 `X`를 넣는다 → A의 화면: `Xabc`
- B는 인덱스 1의 `b`를 지운다 → B의 화면: `ac`

서로의 연산을 **그대로** 교환하면:

- A가 B의 "인덱스 1 삭제"를 받으면 `Xabc`에서 인덱스 1인 `a`를 지워 `Xbc`가 된다 (의도와 다름).
- B가 A의 "인덱스 0에 X 삽입"을 받으면 `Xac`가 된다.

결과가 다르다(`Xbc` ≠ `Xac`). 인덱스 기반 연산은 **적용 순서와 상대방의 중간 상태**에 의존하기 때문이다.

### 2.2 두 가지 해법

| | OT (Operational Transformation) | CRDT (Conflict-free Replicated Data Type) |
|---|---|---|
| 아이디어 | 연산을 받을 때 상대 연산을 고려해 **변환(transform)** 한다 | 데이터 구조 자체를 **어떤 순서로 합쳐도 같은 결과**가 나오도록 설계한다 |
| 중앙 서버 | 보통 필수 (연산 순서를 정하는 권위자) | 불필요. 서버는 단순 중계자여도 된다 |
| 오프라인 편집 | 어렵다 | 자연스럽다 (나중에 합치면 된다) |
| 복잡도 | 변환 함수의 정확성 증명이 어렵다 | 메타데이터(ID, tombstone) 오버헤드 |
| 대표 구현 | Google Docs, ShareDB | Yjs, Automerge, Figma 내부 구조 |

CRDT는 수학적으로 **교환법칙·결합법칙·멱등성**을 만족하는 병합(merge) 연산을 가진 복제 데이터 타입이다. 모든 복제본이 같은 연산 집합을 받기만 하면(순서 무관, 중복 무관) 반드시 같은 상태로 **수렴(converge)** 한다. 이 "강한 최종 일관성(Strong Eventual Consistency)"이 공동 편집에서 원하는 성질이다.

이 프로젝트의 단위 테스트 [document-doc.spec.ts](../src/yjs/document-doc.spec.ts)의 `converges regardless of the order updates are applied`가 바로 이 성질을 코드로 보여준다. 세 피어의 업데이트를 서로 다른 순서로 적용해도 결과가 같다.

---

## 3. Yjs는 어떻게 동작하는가

Yjs는 **YATA**(Yet Another Transformation Approach) 알고리즘 기반의 시퀀스 CRDT 구현체다. 텍스트를 "문자 배열"이 아니라 **고유 ID를 가진 아이템들의 이중 연결 리스트**로 본다.

### 3.1 모든 글자에 전역 고유 ID

- 각 클라이언트는 무작위 `clientID`를 가진다.
- 클라이언트가 만드는 아이템마다 `clock`이 1씩 증가한다.
- 따라서 아이템의 ID는 `(clientID, clock)` 쌍이고, 전 세계에서 유일하다.

```
"Hi" 를 client 7이 입력:
  Item{ id:(7,0), content:'H', left:null,  right:(7,1) }
  Item{ id:(7,1), content:'i', left:(7,0), right:null  }
```

### 3.2 삽입은 "인덱스"가 아니라 "이웃 ID"로 표현된다

`"Hi"`의 사이에 `e`를 넣는 연산은 "인덱스 1에 삽입"이 아니라 **"`(7,0)`과 `(7,1)` 사이에 삽입"** 으로 기록된다. 상대방이 그 사이에 무엇을 넣었든, 왼쪽 이웃·오른쪽 이웃은 변하지 않으므로 의도가 보존된다.

두 사람이 **같은 자리**에 동시에 삽입하면? YATA는 결정론적 규칙(원래 이웃 정보 + clientID 비교)으로 순서를 정한다. 모든 복제본이 같은 규칙을 쓰므로 같은 결과가 나온다. 이 때문에 2.1의 예시가 Yjs에서는 양쪽 모두 `Xac`로 수렴한다.

### 3.3 삭제는 지우지 않고 표시한다 (tombstone)

아이템을 삭제하면 리스트에서 빼는 대신 `deleted` 플래그를 세운다. 그래야 "삭제된 아이템 옆에 삽입" 같은 연산이 나중에 도착해도 위치를 찾을 수 있다. Yjs는 모든 피어가 확인한 뒤 가비지 컬렉션으로 내용(content)만 비우고 자리는 유지한다.

### 3.4 상태 벡터와 업데이트

- **State Vector**: `{ clientID → 지금까지 받은 clock 수 }` 맵. "나는 어디까지 알고 있다"의 요약이다.
- **Update**: 아이템들과 삭제 집합을 바이너리로 인코딩한 것. `Y.encodeStateAsUpdate(doc)`는 문서 전체를, `Y.encodeStateAsUpdate(doc, stateVector)`는 상대가 모르는 부분만 만든다.
- **적용은 멱등**: 같은 업데이트를 두 번 적용해도 아무 일도 일어나지 않는다. 이 성질 덕분에 네트워크 재전송·재접속이 단순해진다.

이 프로젝트는 문서의 전체 상태를 `Y.encodeStateAsUpdate(doc)` 결과(바이트열)로 PostgreSQL의 `Document.yjsState`에 저장한다. 다시 읽을 때는 빈 `Y.Doc`에 `Y.applyUpdate`하면 된다.

### 3.5 동기화 프로토콜 (y-protocols/sync)

클라이언트와 서버가 연결되면:

1. **SyncStep1**: 내 state vector를 보낸다. ("나는 여기까지 알아")
2. **SyncStep2**: 상대는 그 state vector 기준으로 **모자란 부분만** 업데이트로 보낸다.
3. 양방향으로 1·2를 수행하면 두 복제본이 동일해진다.
4. 이후 로컬 변경이 생길 때마다 **증분 업데이트(Update 메시지)** 를 보내고, 서버는 같은 문서에 붙은 다른 클라이언트에게 브로드캐스트한다.

### 3.6 Awareness (존재감)

커서 위치·이름·색상 같은 **휘발성 정보**는 문서 CRDT에 넣지 않는다. 별도의 awareness 프로토콜로 주기적으로 전파되고, 연결이 끊기면 사라진다. 이 프로젝트는 서버 측에서 별도 설정 없이 Hocuspocus 기본 awareness를 그대로 중계한다. 프론트엔드에서 커서 공유를 구현할 때 사용한다(7장 참고).

### 3.7 이 프로젝트의 Y.Doc 모양

```ts
doc.getText('title')    // 제목
doc.getText('content')  // 본문
```

[src/yjs/document-doc.ts](../src/yjs/document-doc.ts)에 이 구조를 다루는 순수 함수가 모여 있다.

- `createInitialState({title, content})` — 새 문서를 만들 때 REST가 받은 텍스트로 Y.Doc을 만들고 바이너리로 인코딩한다. 첫 접속자가 REST에서 본 것과 같은 텍스트를 받게 하기 위함이다.
- `readDocumentText(doc)` — 저장 시 평문 스냅샷을 뽑는다.
- `replaceText(ytext, next)` — REST `PATCH`에서 쓴다. **전체를 지우고 다시 넣지 않고** 공통 접두사·접미사를 제외한 가운데 부분만 삭제/삽입한다. 그래야 동시에 다른 위치를 편집하던 사람의 변경이 살아남는다. 단위 테스트 `keeps concurrent edits from another peer when replacing text`가 이를 검증한다.

---

## 4. Hocuspocus의 역할

Yjs 자체는 네트워크를 모른다. **프로바이더(provider)** 가 업데이트를 실어 나른다. Hocuspocus는 Yjs용 **WebSocket 서버 + 클라이언트 프로바이더** 세트다.

서버가 하는 일:

| 기능 | 설명 | 이 프로젝트에서 |
|---|---|---|
| 문서 룸 관리 | `documentName`별로 서버 메모리에 `Y.Doc`을 하나 띄우고, 같은 이름으로 접속한 소켓끼리 업데이트를 브로드캐스트 | `documentName` = 문서 UUID |
| 동기화 프로토콜 처리 | SyncStep1/2, Update, Awareness 메시지 파싱·응답 | 기본값 그대로 |
| 훅(hook) | `onAuthenticate`, `onLoadDocument`, `onStoreDocument`, `onChange`, `onDisconnect` … | `onAuthenticate`로 토큰 검증 |
| 확장(extension) | 훅을 묶은 플러그인 | `@hocuspocus/extension-database`로 Prisma 저장 |
| 디바운스 저장 | 변경이 있을 때 `debounce` ms 뒤에, 늦어도 `maxDebounce` ms 안에 `onStoreDocument` 호출. 마지막 접속자가 나가면 즉시 저장 후 메모리에서 내림 | 1초 / 5초 |
| Direct Connection | 서버 코드가 WebSocket 없이 메모리의 Y.Doc을 직접 편집 | REST `PATCH`가 사용 |

Hocuspocus 4의 중요한 특징 하나: **문서 이름과 토큰은 URL이 아니라 프로토콜 메시지 안에서 전달된다.** 한 WebSocket으로 여러 문서를 멀티플렉싱할 수 있고, 서버는 각 문서마다 `onAuthenticate`를 따로 호출한다. 그래서 클라이언트 URL은 `ws://host/collaboration` 하나면 된다.

---

## 5. 이 프로젝트의 구현

### 5.1 모듈 구조

```
AppModule
 ├─ ConfigModule (.env 로드, 전역)
 ├─ PrismaModule (전역) ─ PrismaService: Prisma 7 + @prisma/adapter-pg
 ├─ CollaborationModule
 │    ├─ HocuspocusService   : Hocuspocus 인스턴스, /collaboration 업그레이드 핸들러, 저장 어댑터
 │    └─ CollaborationController : GET /api/collaboration/stats
 └─ DocumentsModule (imports CollaborationModule)
      ├─ DocumentsService    : DB CRUD, 토큰 검증
      ├─ ShareTokenGuard     : x-share-token 헤더 / ?token= 쿼리 확인
      └─ DocumentsController : /api/documents/*
```

의존 방향은 `Documents → Collaboration → Prisma` 한 방향이다. `HocuspocusService`가 `DocumentsService`에 의존하지 않고 Prisma를 직접 쓰는 이유는 순환 참조를 피하기 위해서다. Hocuspocus 쪽 DB 접근은 "토큰 조회·상태 읽기·상태 쓰기" 세 가지뿐이라 어댑터 안에 두는 것이 자연스럽다.

### 5.2 데이터 모델

```prisma
model Document {
  id         String   @id @default(uuid())      // WebSocket documentName
  title      String   @default("Untitled")      // 평문 스냅샷
  content    String   @default("")              // 평문 스냅샷
  yjsState   Bytes?                             // CRDT 원본 (source of truth)
  shareToken String   @unique @default(cuid())  // 공유 토큰
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

**`yjsState`가 진실이고, `title`/`content`는 파생 캐시**다. 저장할 때마다 Y.Doc에서 평문을 뽑아 함께 갱신하므로 목록 조회·단건 조회 같은 REST 읽기는 Yjs를 전혀 디코딩하지 않는다. 발표 때 DB를 직접 보여 주기에도 좋다(`bun run db:studio`).

### 5.3 Hocuspocus를 NestJS 서버에 붙이기

[hocuspocus.service.ts](../src/collaboration/hocuspocus.service.ts)의 `onModuleInit`:

1. `HttpAdapterHost`로 NestJS가 쓰는 Node `http.Server`를 얻는다.
2. 그 서버의 `upgrade` 이벤트를 가로채 경로가 `/collaboration`이면 `crossws`(Hocuspocus가 내부적으로 쓰는 WebSocket 어댑터)에 넘긴다. 다른 경로는 소켓을 닫는다.
3. `crossws` 훅 `open/message/close`에서 `hocuspocus.handleConnection / handleMessage / handleClose`를 호출한다. 이 세 줄은 Hocuspocus의 자체 `Server` 클래스가 하는 일과 동일하다.

이렇게 하면 **REST와 WebSocket이 같은 포트**를 쓴다. 배포 플랫폼이 포트 하나만 열어 줄 때(대부분의 PaaS) 중요하다.

### 5.4 인증: 공유 토큰

```ts
onAuthenticate: async ({ documentName, token }) => {
  const doc = await prisma.document.findUnique({ where: { id: documentName }, select: { shareToken: true } });
  if (!doc) throw new Error('Document not found');
  if (!token || token !== doc.shareToken) throw new Error('Invalid share token');
}
```

- 클라이언트는 `new HocuspocusProvider({ name: <id>, token: <shareToken> })`로 접속한다.
- 훅이 throw하면 Hocuspocus가 `permission-denied` 메시지를 보내고 그 문서 연결을 거부한다. 프로바이더는 `onAuthenticationFailed` 콜백을 받는다.
- 토큰이 맞으면 문서가 메모리에 없을 때 `Database.fetch`가 호출돼 `yjsState`를 로드한다.

REST도 같은 토큰 규칙을 쓴다(`ShareTokenGuard`). 단, **공유 링크 부트스트랩** 용도로 `GET /api/documents/shared/:shareToken`은 토큰만으로 문서를 찾아 `id`를 알려 준다. 프론트엔드 라우트 `/share/:token`이 이 엔드포인트를 호출한 뒤 WebSocket에 붙는 흐름이다.

### 5.5 저장: Database 확장

```ts
new Database({
  fetch: ({ documentName }) => prisma.document.findUnique(...).yjsState ?? null,
  store: ({ documentName, document, state }) =>
    prisma.document.updateMany({
      where: { id: documentName },
      data: { yjsState: state, ...readDocumentText(document) },
    }),
})
```

- `fetch`가 `null`을 돌려주면 빈 문서로 시작한다. 하지만 이 프로젝트는 문서 생성 시 `yjsState`를 미리 채우므로 보통 `null`이 아니다.
- `store`에 `updateMany`를 쓴 이유: 사람들이 붙어 있는 동안 문서가 REST로 삭제되면, 마지막 플러시가 "행이 없음" 오류를 내지 않게 하기 위해서다(`updateMany`는 0행이어도 조용히 끝난다).
- 저장 주기 `debounce: 1000, maxDebounce: 5000`. 시연 중 "타이핑 후 1초면 DB에 들어간다"를 보여 주기 좋다.

### 5.6 REST `PATCH`는 "서버에서 접속한 또 하나의 피어"

```ts
await hocuspocus.withDocument(id, (doc) => applyDocumentText(doc, dto));
```

`openDirectConnection(id)`로 메모리의 Y.Doc(없으면 로드)을 얻어 트랜잭션 안에서 `Y.Text`를 수정한다. 그러면

1. 접속 중인 모든 클라이언트가 **일반 CRDT 업데이트**로 변경을 받고,
2. `disconnect()` 시점에 Hocuspocus가 저장 훅을 즉시 실행해 DB가 갱신된 뒤 응답한다.

"REST로 제목을 바꿨더니 다른 브라우저에 바로 반영된다"는 시연이 가능하고, REST와 WebSocket 사이에 데이터 불일치가 생기지 않는다. E2E 테스트 `a REST PATCH shows up live in a connected client`가 이를 검증한다.

### 5.7 삭제 흐름

1. `hocuspocus.closeConnections(id)` — 그 문서의 모든 소켓을 닫는다 (클라이언트는 재접속을 시도하지만 `onAuthenticate`에서 "Document not found"로 거부된다).
2. DB에서 행을 지운다.

### 5.8 테스트

| 종류 | 파일 | 확인하는 것 |
|---|---|---|
| 단위 | `src/yjs/document-doc.spec.ts` | 상태 직렬화 왕복, 최소 diff 교체, 동시 편집 병합, 적용 순서 무관 수렴 |
| 단위 | `src/documents/documents.service.spec.ts` | 초기 Yjs 상태 시드, 기본 제목, 404/403 |
| E2E | `test/documents.e2e-spec.ts` | 생성→목록→토큰 없이 401→틀린 토큰 403→조회→공유 링크→PATCH→검증 400→삭제→404 |
| E2E | `test/collaboration.e2e-spec.ts` | 틀린 토큰 거부, 없는 문서 거부, 초기 동기화, **두 클라이언트 동시 편집 수렴 + DB 저장**, REST PATCH 실시간 반영 |

E2E는 `docker compose up -d`로 띄운 실제 PostgreSQL에 붙고, 앱을 임의 포트로 실제 `listen`한 뒤 `@hocuspocus/provider`로 접속한다. Node 22+의 내장 `WebSocket`을 쓰므로 별도 폴리필이 없다.

```bash
bun run test        # 단위
bun run test:e2e    # E2E (DB 필요)
```

---

## 6. 발표·시연 시나리오 제안

1. **문서 만들기**: `POST /api/documents` → 응답의 `shareToken`으로 공유 링크를 만든다.
2. **브라우저 두 개**(또는 노트북 + 폰)로 같은 링크를 연다. 양쪽에서 타이핑 → 즉시 반영.
3. **동시 편집 충돌 데모**: 한쪽은 문장 앞에, 다른 쪽은 문장 뒤에 동시에 입력. 둘 다 같은 결과로 수렴함을 보여 준다.
4. **오프라인 데모**: 브라우저 DevTools → Network → Offline. 양쪽에서 각각 편집한 뒤 Online으로 돌리면 병합된다. (프로바이더가 자동 재접속 + SyncStep1/2로 차이만 교환)
5. **서버는 중계자일 뿐**: `GET /api/collaboration/stats`로 열린 문서 수·연결 수를 보여 주고, Prisma Studio(`bun run db:studio`)에서 `yjsState`가 바이너리로, `content`가 평문으로 1초 내 갱신되는 것을 보여 준다.
6. **REST도 하나의 피어**: `curl -X PATCH …`로 제목을 바꾸면 열려 있는 브라우저에서 제목이 바뀐다.
7. **토큰 없이는 못 들어감**: 토큰을 틀리게 바꾼 링크로 접속 → 거부.

슬라이드용 핵심 메시지: *"서버는 순서를 정하지 않는다. 데이터 구조가 순서를 필요 없게 만든다."*

---

## 7. 프론트엔드 구현 가이드

### 7.1 추천 스택

- **Vite + React + TypeScript** (가장 빠르게 시작). Next.js도 가능하지만 WebSocket 프로바이더는 클라이언트 컴포넌트에서만 만들어야 한다.
- 패키지:
  ```bash
  npm i yjs @hocuspocus/provider
  # 에디터 바인딩 중 하나를 선택 (7.4 참고)
  ```

### 7.2 라우트 설계

| 경로 | 역할 |
|---|---|
| `/` | 문서 목록(`GET /api/documents`) + 새 문서 만들기(`POST`) |
| `/share/:token` | 공유 링크 진입점. `GET /api/documents/shared/:token`으로 `id`를 얻은 뒤 에디터로 이동/렌더 |
| `/d/:id?token=…` | (선택) id 기반 에디터 라우트 |

문서 생성 직후 `shareToken`은 **응답에서만** 받을 수 있다(목록에는 없다). 생성한 브라우저가 링크를 복사해 공유하는 UX가 자연스럽다. 발표용으로는 `localStorage`에 "내가 만든 문서의 토큰"을 저장해 두면 편하다.

### 7.3 프로바이더 연결 (핵심 코드)

```ts
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const API = import.meta.env.VITE_API_URL;      // http://localhost:3000
const WS  = import.meta.env.VITE_WS_URL;       // ws://localhost:3000/collaboration

export function createCollab(documentId: string, shareToken: string) {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: WS,
    name: documentId,          // 서버의 documentName
    token: shareToken,         // onAuthenticate 로 전달
    document: ydoc,
    onStatus: ({ status }) => console.log('ws', status),           // connecting | connected | disconnected
    onSynced: () => console.log('initial sync done'),
    onAuthenticationFailed: ({ reason }) => alert(`접근 거부: ${reason}`),
  });
  return {
    ydoc,
    provider,
    title: ydoc.getText('title'),
    content: ydoc.getText('content'),
    destroy: () => provider.destroy(),
  };
}
```

React에서는 `useEffect`로 만들고 cleanup에서 `destroy()`한다. StrictMode의 이중 마운트가 신경 쓰이면 `@hocuspocus/provider-react`를 쓰면 된다.

### 7.4 텍스트 입력과 Y.Text 바인딩

평문 편집기이므로 세 가지 선택지가 있다.

**(A) CodeMirror 6 + `y-codemirror.next`** — 평문에 가장 적합. 커서·선택 영역 공유(awareness)까지 기본 제공.
```bash
npm i @codemirror/state @codemirror/view y-codemirror.next
```
```ts
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';

provider.awareness!.setLocalStateField('user', { name: '지서', color: '#30bced' });
new EditorView({
  state: EditorState.create({
    doc: content.toString(),
    extensions: [yCollab(content, provider.awareness)],
  }),
  parent: document.getElementById('editor')!,
});
```

**(B) Tiptap + Collaboration 확장** — Hocuspocus와 같은 팀이 만든 리치 텍스트 에디터. 평문만 쓰더라도 `StarterKit` 없이 `Document/Paragraph/Text` 노드만 넣으면 평문처럼 동작한다. 단, 이 경우 Y.Doc의 키는 `Y.Text`가 아닌 `Y.XmlFragment`가 되므로 **서버 쪽 `readDocumentText`를 바꿔야 한다**. 현재 서버는 `Y.Text` 기준이다.

**(C) 직접 `<textarea>` 바인딩** — 가장 원리가 잘 드러나지만 커서 점프 처리 등 손이 간다. 발표에서 "CRDT 연산이 무엇인지" 보여 주고 싶다면 좋다.
```ts
// Y.Text → textarea
content.observe(() => { if (document.activeElement !== ta) ta.value = content.toString(); });
// textarea → Y.Text (최소 diff로 변환; 서버의 replaceText 와 같은 로직)
ta.addEventListener('input', () => replaceText(content, ta.value));
```
`replaceText`는 서버의 [document-doc.ts](../src/yjs/document-doc.ts)에 있는 함수를 그대로 복사해 쓰면 된다.

제목은 한 줄 `<input>`에 (C) 방식으로 묶는 것이 간단하다.

### 7.5 접속자 표시 (awareness)

```ts
provider.awareness!.setLocalStateField('user', { name, color });
provider.awareness!.on('change', () => {
  const users = Array.from(provider.awareness!.getStates().values()).map(s => s.user);
  render(users);
});
```

### 7.6 REST 호출 시 토큰

보호된 엔드포인트(`GET/PATCH/DELETE /api/documents/:id`)에는 `x-share-token` 헤더 또는 `?token=` 쿼리로 토큰을 보낸다.

```ts
fetch(`${API}/api/documents/${id}`, { headers: { 'x-share-token': token } });
```

### 7.7 개발 환경 CORS

백엔드 `.env`의 `CORS_ORIGIN`에 프론트 주소(`http://localhost:5173`)를 적는다. 비워 두면 모든 origin을 허용한다(데모 기본값). WebSocket은 CORS 대상이 아니지만, 운영에서는 `onAuthenticate`의 토큰 검사가 보호 수단이다.

---

## 8. 배포 가이드

### 8.1 체크리스트

- [ ] **WebSocket 업그레이드를 지원하는 호스팅**인지 확인 (아래 8.3). 서버리스 함수(Vercel Functions, AWS Lambda 기본)는 장시간 연결을 유지하지 못해 **부적합**하다.
- [ ] PostgreSQL 준비 후 `DATABASE_URL` 설정.
- [ ] 배포 시 `prisma migrate deploy` 실행(스키마 적용). `migrate dev`는 로컬 전용.
- [ ] `PORT`는 플랫폼이 주입하는 값을 그대로 쓴다(코드는 `process.env.PORT`를 읽는다).
- [ ] `CORS_ORIGIN`에 프론트 도메인.
- [ ] HTTPS 뒤에 두면 프론트는 `wss://` 로 접속.
- [ ] `@nestjs/observe` 모듈은 스캐폴드의 플레이스홀더 키(`YOUR_APP_KEY`)로 설정돼 있어 시작 로그에 워커 오류가 반복된다. 사용하지 않을 거면 `src/app.module.ts`와 `src/main.ts`에서 제거하고 패키지도 지우는 것을 권한다.

### 8.2 Docker 이미지 (권장)

프로젝트 루트에 `Dockerfile`:

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build            # prisma generate + nest build → dist/

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
```

`.dockerignore`에 `node_modules`, `dist`, `.env`, `.git`을 넣는다.
(런타임을 `node`로 둔 이유: Prisma 7 + `@prisma/adapter-pg` 조합이 Node에서 가장 검증돼 있다. Bun 런타임으로도 동작하지만 문제 시 Node로 돌아올 수 있게 분리했다.)

### 8.3 플랫폼별 메모

| 플랫폼 | WebSocket | 메모 |
|---|---|---|
| **Railway** | O | Dockerfile 자동 인식. Postgres 플러그인 제공. 가장 간단. |
| **Render** (Web Service) | O | Docker 또는 Node 빌드. 무료 플랜은 유휴 시 슬립 → 첫 접속 지연. |
| **Fly.io** | O | `fly launch`가 Dockerfile 사용. 리전 선택 가능(서울 `nrt` 근처). |
| **AWS EC2 / Lightsail + nginx** | O | 아래 8.4 리버스 프록시 설정 필요. |
| **AWS ECS/Fargate + ALB** | O | ALB는 WebSocket 지원. idle timeout(기본 60s)을 늘리거나 Hocuspocus의 ping(기본 동작)으로 유지. |
| Vercel / Netlify Functions | **X** | 프론트엔드만 올리고 백엔드는 다른 곳에. |

프론트엔드는 Vercel/Netlify/Cloudflare Pages 어디든 좋다. 환경 변수 `VITE_API_URL=https://api.example.com`, `VITE_WS_URL=wss://api.example.com/collaboration`.

### 8.4 nginx 리버스 프록시 (직접 서버를 운영할 때)

```nginx
server {
  listen 443 ssl;
  server_name api.example.com;

  location /collaboration {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;     # 장시간 연결 유지
  }
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
  }
}
```

### 8.5 수평 확장이 필요해지면

지금 구조는 **인스턴스 1개** 기준이다. 문서의 Y.Doc이 서버 메모리에 있으므로 인스턴스를 2개 이상 띄우면 같은 문서에 붙은 사용자가 다른 인스턴스로 분산돼 서로 못 본다. 해결책은 `@hocuspocus/extension-redis`로 인스턴스 간 업데이트를 pub/sub 하는 것이다. 발표 프로젝트 범위에서는 불필요하다.

### 8.6 운영 시 알아 둘 것

- **백업**: `Document.yjsState`만 있으면 문서는 완전 복원된다. 일반 PostgreSQL 백업으로 충분.
- **문서 크기**: Yjs 상태는 편집 이력(tombstone)을 포함하므로 평문보다 크다. 평문 수십 KB 수준의 데모에서는 문제없다.
- **종료 처리**: `app.enableShutdownHooks()`가 켜져 있어 SIGTERM 시 Hocuspocus가 대기 중인 저장을 플러시한다. 컨테이너 종료 유예(grace period)를 10초 이상 주면 안전하다.
- **헬스 체크**: `GET /api/health`.

---

## 9. 한계와 확장 아이디어

| 한계 | 이유 | 확장 방향 |
|---|---|---|
| 토큰 하나 = 읽기·쓰기 모두 | 데모 단순화 | `readToken`/`editToken` 둘로 나누고 `onAuthenticate`에서 `connectionConfig.readOnly = true` 설정 |
| 문서 목록이 공개 | 사용자 개념 없음 | 로그인 도입 시 `ownerId` 추가 |
| 편집 이력/되돌리기 없음 | — | Yjs `UndoManager`(클라이언트) 또는 주기적 스냅샷 테이블 |
| 단일 인스턴스 | 메모리 내 Y.Doc | Redis 확장 (8.5) |
| 평문만 지원 | 요구사항 | Tiptap + `Y.XmlFragment`로 교체하고 서버의 텍스트 추출만 수정 |

---

## 10. 부록

### 10.1 로컬 실행

```bash
bun install
bun run db:up            # PostgreSQL 17 (docker compose)
bun run db:migrate       # prisma migrate dev
bun run start:dev        # http://localhost:3000/api , ws://localhost:3000/collaboration
```

### 10.2 REST API 레퍼런스

Base URL: `/api`

| Method | Path | 인증 | Body | 응답 |
|---|---|---|---|---|
| GET | `/health` | – | – | `{ status: "ok", service, time }` |
| POST | `/documents` | – | `{ title?: string(≤200), content?: string }` | **201** 문서(+`shareToken`) |
| GET | `/documents` | – | – | `[{ id, title, createdAt, updatedAt }]` |
| GET | `/documents/shared/:shareToken` | 경로의 토큰 | – | 문서 |
| GET | `/documents/:id` | `x-share-token` 헤더 또는 `?token=` | – | 문서 |
| PATCH | `/documents/:id` | 동일 | `{ title?, content? }` | 문서 (라이브 Y.Doc 경유) |
| DELETE | `/documents/:id` | 동일 | – | **204** |
| GET | `/collaboration/stats` | – | – | `{ documents, connections, path }` |

문서 응답: `{ id, title, content, shareToken, createdAt, updatedAt }`
오류: `400` 검증 실패 · `401` 토큰 없음 · `403` 토큰 불일치 · `404` 없음

### 10.3 curl 예시

```bash
# 생성
curl -s -X POST localhost:3000/api/documents -H 'content-type: application/json' \
  -d '{"title":"CRDT 발표","content":"안녕"}'
# → {"id":"<ID>","shareToken":"<TOKEN>",...}

# 조회
curl -s localhost:3000/api/documents/<ID> -H 'x-share-token: <TOKEN>'

# 제목 변경 (접속 중인 브라우저에 즉시 반영)
curl -s -X PATCH localhost:3000/api/documents/<ID> -H 'x-share-token: <TOKEN>' \
  -H 'content-type: application/json' -d '{"title":"바뀐 제목"}'

# 실시간 통계
curl -s localhost:3000/api/collaboration/stats
```

### 10.4 WebSocket 접속 요약

```
URL   : ws://<host>:<port>/collaboration
name  : 문서 id
token : 문서 shareToken
Y.Doc : getText('title'), getText('content')
```

### 10.5 더 읽을거리

- Yjs 내부 구조: https://github.com/yjs/yjs/blob/main/INTERNALS.md
- YATA 논문: Nicolas et al., *Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types* (2016)
- Hocuspocus 문서: https://tiptap.dev/docs/hocuspocus
- CRDT 개론: https://crdt.tech
