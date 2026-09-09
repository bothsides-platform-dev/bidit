# 서포트비 (Support B)

결제대행사(PG) 견적 입찰 플랫폼. 가맹점(구매사)이 카드 수수료·정산 조건을 담은 견적 요청서(RFP)를 발행하면, 복수의 PG사가 **봉인 입찰(sealed bid)** 로 견적을 제출하고 구매사가 최적 파트너를 선정합니다.

**핵심 도메인 원칙**

- **봉인 입찰** — PG사끼리 서로의 견적·입찰 수·금액을 볼 수 없음 (`Bid.competitorCount` 필드 자체가 없음)
- **참여 = buyer-gated** — 초대(allowlist) 또는 콜드 피치 요청 후 구매사 승인으로만 입찰 가능
- **탐색 = open board** — 마감 전 RFP는 공개 게시판에 노출, 단 참여 판단에 필요한 **비경쟁 정보 화이트리스트**만 공개. 수수료·현재 거래조건·연거래액·사업자번호·메모·첨부 등 경쟁 정보는 쿼리 레이어에서 차단된다. 정확한 공개 필드 목록은 한 곳에서만 관리한다 — 타입 정의는 `OpportunityListing`(`lib/types/pg-request.ts`), 산문 설명은 `CLAUDE.md`
- **필드 단위 opt-out** — 초대된 PG에게도 '현재 카드 수수료' 노출 여부를 RFP별로 토글 가능, 서버에서 strip

---

## 시스템 아키텍처

```mermaid
graph TB
    subgraph Client["클라이언트"]
        Browser["브라우저\nReact 19 / RSC"]
    end

    subgraph Lightsail["AWS Lightsail VM"]
        Caddy["Caddy\nReverse Proxy + TLS\nsupport-b.com\npartner.support-b.com"]

            NextJS["Next.js (PM2)\nServer Components / Server Actions\nRoute Handlers — :3000"]

        Centrifugo["Centrifugo\nWebSocket 서버\n(자체호스팅)"]

        subgraph Docker["Docker"]
            PG[("PostgreSQL\n채팅·이메일·파일\n단일 스토어")]
        end

        Cron["Cron Worker\n(1분 주기)\noutbox flush"]
    end

    subgraph External["외부 서비스"]
        Resend["Resend\n이메일 발송"]
        Sentry["Sentry\n에러 트래킹"]
        Axiom["Axiom\n로그 수집"]
    end

    Browser -- "HTTPS" --> Caddy
    Browser -- "WSS" --> Caddy
    Caddy -- "reverse_proxy :3000" --> NextJS
    Caddy --> Centrifugo
    Centrifugo -- "subscribe-proxy\nACL 위임" --> NextJS
    NextJS --> PG
    Cron --> PG
    Cron --> Resend
    NextJS --> Sentry
    NextJS --> Axiom
```

채팅 메시지·이메일 아웃박스는 동일한 PostgreSQL에 저장해 메시지 브로커 없이 운영합니다. 파일 **바이트**만 Cloudflare R2에 두고(첨부파일 + 계약 보관 문서) presigned URL로 업/다운로드하며, 메타데이터·ACL 판정은 언제나 PostgreSQL과 앱이 소유합니다.

---

## 서버 레이어 아키텍처

```mermaid
graph LR
    subgraph Entry["진입점 (app/)"]
        RSC2["Server Components"]
        SA2["Server Actions"]
    end

    subgraph Actions["lib/server/actions/"]
        ACT["Actions\n① 세션 검증\n② Zod 입력 파싱\n③ 서비스 위임"]
    end

    subgraph Services["lib/server/services/"]
        SVC["Services\nRfpService · BidService\nChatService · WorkspaceService\nAuthService · NotificationService\n─────────────────────\n트랜잭션 경계\n알림 팬아웃\n이메일 아웃박스 insert"]
    end

    subgraph Repositories["lib/server/repositories/"]
        REPO["Repositories\nDrizzle ORM\nDB 접근 단일 출처"]
    end

    DB[("PostgreSQL")]

    RSC2 & SA2 --> ACT
    ACT --> SVC
    SVC --> REPO
    REPO --> DB
```

기본 의존 방향은 **Actions → Services → Repositories** 단방향입니다. 대화 읽음 상태만은 workspace identity와 projection 규칙을 한곳에 유지하기 위해 `lib/chat/read-state/`를 거치는 의도적인 tier-spanning 예외이며, 근거는 [`docs/adr/0003-conversation-read-state-vertical-module.md`](docs/adr/0003-conversation-read-state-vertical-module.md)에 기록합니다. 서비스는 `ServiceResult<T> = { ok: true } & T | { ok: false; error: string }` 형태로 결과를 반환하며 예외를 throw하지 않습니다.

**레이어 경계 강제**: `@typescript-eslint/no-restricted-imports` 규칙으로 `lib/server/repositories/` 외부에서 Drizzle 클라이언트·스키마를 직접 import하면 lint error. 드리프트 가드 테스트(`lib/server/__tests__/repo-boundary.test.ts`)가 CI에서 이중 검증합니다.

---

## 라우팅 구조

```
app/
├─ (public)/          # 비인증: /login, /signup, /invite/{rfp,workspace}/[token], /pending-approval
└─ (app)/             # 인증 + AppShell (Sidebar + Header)
   ├─ home/
   ├─ rfp/            # 구매사 — RFP 목록·상세 (/rfp-create — 실제 작성 라우트)
   ├─ rfp-create/     # 구매사 — RFP 작성 플로우 (/rfp/new → /rfp-create 리다이렉트)
   ├─ inbox/          # PG사 — 견적 수신함
   ├─ opportunities/  # PG사 — 오픈 RFP 게시판
   ├─ messages/       # 공통 — 실시간 채팅 (Centrifugo)
   ├─ notifications/  # 공통 — 인앱 알림 목록
   ├─ contracts/      # 공통 — 계약 보관함 (전자서명 완료본 자동 사본 + 외부 계약서 PDF 업로드)
   ├─ tutorial/       # 공통 — 온보딩 튜토리얼 (buyer/pg 각각 실제 여정)
   ├─ workspace/new/  # 공통 — 워크스페이스 생성
   ├─ quote-templates/    # PG사 — 견적 템플릿 관리
   ├─ contract-templates/ # PG사 — 계약서 템플릿 (PDF 서명칸 배치 / 조항형 작성)
   └─ settings/       # profile / members / notifications / audit-log
```

**멀티 호스트 라우팅**: 단일 Next.js 앱이 두 도메인을 서빙합니다. `(app)/layout.tsx`가 요청 호스트를 읽어 세션 워크스페이스 타입(buyer/pg)과 일치하지 않으면 올바른 호스트로 리다이렉트합니다. 세션 쿠키는 `.support-b.com`으로 스코프해 크로스 서브도메인 SSO를 지원합니다.

---

## 핵심 기술 결정

### 이메일 발송 — Transactional Outbox Pattern

이메일 발송 실패가 비즈니스 로직을 롤백하지 않도록 outbox 테이블을 사용합니다.

```mermaid
sequenceDiagram
    participant SVC as Service (tx)
    participant DB as PostgreSQL
    participant Cron as Outbox Worker
    participant Resend

    SVC->>DB: INSERT 비즈니스 레코드<br/>+ INSERT outbox_entries (동일 트랜잭션)
    Note over DB: 원자적 보장
    Cron->>DB: SELECT pending (1분 주기)
    Cron->>Resend: batch.send() — 최대 100건/회
    Resend-->>Cron: 결과 (부분 실패 포함)
    Cron->>DB: UPDATE outbox (sent / retry / permanent_fail)
```

Resend의 초당 2요청 한도는 `batch.send()`로 N건을 단일 호출로 묶고, 지수 백오프(최대 3회 재시도)와 idempotency key로 중복 발송을 방지합니다.

### 실시간 채팅 — Centrifugo + Subscribe-Proxy

Centrifugo를 자체호스팅 WebSocket 서버로 운영합니다. 채널 구독 승인을 **subscribe-proxy**로 Next.js API 라우트에 위임해, 봉인 입찰 보안 경계와 채팅 ACL이 동일한 코드베이스 안에서 유지됩니다. 메시지 영속은 자사 PostgreSQL에만 저장하며 Centrifugo는 전달 레이어 역할만 합니다.

### 봉인 입찰 보안

PG사가 견적 브리프를 열 때 RSC 데이터 로더(`lib/server/rfp-detail-loader.ts`)가 서버에서 민감 필드를 제거합니다. 클라이언트 렌더 게이트만으로는 RSC payload에 원본 데이터가 포함되기 때문에 데이터 레이어에서 차단하는 것이 필수입니다.

### Repository Boundary — 아키텍처를 린트로 강제

```
lib/server/repositories/  ← DB 접근 허용
lib/server/services/       ← repository 주입만 허용
lib/server/actions/        ← service 호출만 허용
app/                       ← action / server component만 허용
```

`no-restricted-imports` ESLint 규칙 + 독립 드리프트 가드 테스트로 레이어 경계를 코드 리뷰 없이도 자동 차단합니다. 서비스의 트랜잭션 핸들도 예외가 아닙니다 — DB 클라이언트를 직접 열지 않고 리포지토리와 **같은 주입점**인 `repositories/factory`의 `getDb()`로 받습니다. 드리프트 가드(`lib/server/__tests__/repo-boundary.test.ts`)는 ESLint가 보지 못하는 동적 `import('@/lib/db/*')`와 `lib/server/services/**` 밖의 `getDb()` 호출까지 잡습니다 — `getDb()`는 드리즐 핸들을 그대로 내주는 접근자라 액션·로더가 부르면 경계가 조용히 다시 열리기 때문입니다. 의도적 예외는 하나뿐이며 `lib/server/db-boundary-allowlist.mjs`에 명문화합니다: 크로스 aggregate 캐스케이드(`actions/auth/_purgeUnverifiedSignup.ts`). 액션은 DB 핸들을 만지지 않습니다 — 옛 `actionDb()` 테스트-오버라이드 레지스트리는 마지막 호출처 3개(loginAction 의 죽은 인자 제거, 나머지 둘은 `RfpService.setBoardVisible` / `WorkspaceService.replaceBizProfile` 로 이관)와 함께 사라졌고, 서버 테스트 하네스는 `lib/server/__tests__/_harness.ts`의 `setupServerTestEnv()` 하나입니다. 서비스는 이 레지스트리를 쓰지 않습니다.

---

## 테스트 전략

| 레벨 | 도구 | 전략 |
|------|------|------|
| 단위 | Vitest + **PGlite** | 실제 PostgreSQL DDL을 인메모리로 구동. Mock DB 없이 스키마·쿼리·트랜잭션을 직접 검증 |
| 컴포넌트 | Vitest + jsdom + Testing Library | 클라이언트 컴포넌트 상호작용 테스트 |
| E2E | Playwright | 구매사·PG 두 워크스페이스 전체 시나리오 검증 |

**TDD 원칙**: 구현 코드 작성 전 반드시 실패하는 테스트를 먼저 작성합니다. PGlite 싱글턴 + TRUNCATE로 테스트 간 격리를 유지하며 전체 단위 테스트 3,500+ 케이스가 약 200초 내에 완료됩니다. 액션·서비스 테스트는 `__useDrizzleWithDbForTest(db)` 한 번으로 리포지토리와 서비스를 함께 PGlite에 올립니다 — 서비스가 리포 번들의 `getDb()`에서 트랜잭션 핸들을 받기 때문에 서비스를 손으로 다시 조립하는 하네스는 없습니다. `__resetForTest()`가 번들과 함께 그 위에 만들어진 서비스 싱글턴(`lib/server/_singleton.ts`의 `'service'` 그룹)도 비우므로, 다음 테스트가 이전 테스트의 번들 위에 만들어진 서비스를 재사용하지 않습니다.

---

## 기술 스택

| 레이어 | 기술 | 선택 이유 |
|--------|------|-----------|
| Framework | Next.js 16 App Router | RSC로 서버 fetch 레이어 단순화, Server Actions으로 form 처리 |
| Runtime | React 19 | RSC + Server Actions 풀 지원 |
| ORM | Drizzle ORM | 트랜잭션 핸들을 직접 전달 가능 → Service 레이어 tx 경계 설계 |
| Auth | Auth.js v5 | Custom credentials provider. 미들웨어 프록시는 edge-safe config, 서버 컴포넌트·액션은 Node 런타임 auth() |
| Realtime | Centrifugo | 자체호스팅 WebSocket, subscribe-proxy로 ACL을 앱에 보존 |
| 이메일 | Resend + Outbox | 발송 실패와 비즈니스 로직을 트랜잭션으로 분리 |
| 파일 스토리지 | Cloudflare R2 (S3 호환) | 첨부파일·계약 보관 문서. 업/다운로드 모두 presigned라 앱 서버가 바이트를 중계하지 않음 |
| 테스트 DB | PGlite | 실제 PostgreSQL DDL을 인메모리로 → CI 속도 + 현실적 검증 |
| Styling | Tailwind v4 + CSS Variables | 디자인 시스템 토큰 기반 일관성 유지 |
| 상태 관리 | Zustand | UI 토글·시그업 초안·헤더 액션 슬롯 등 경량 전역 상태 |
| 모니터링 | Sentry + Axiom (Pino) | 에러 트래킹 + 구조화 로그 |
| 배포 | AWS Lightsail + Caddy + PM2 | 단일 VM 자체호스팅, Caddy가 TLS·리버스프록시·WSS 통합 처리 |
