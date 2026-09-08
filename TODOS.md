# TODOS

## Test infra

### 스크립트의 import 시점 `dotenv/config` 가 개발자 `.env` 를 테스트 환경에 흘린다 (P3)
`scripts/{seed,perf-seed,test-db-reset,backfill-kanban-columns,prune-drafting-columns,remove-*-kanban-columns,seed-pg-companies}.ts` 는 모듈 최상단에서 `import 'dotenv/config'` 를 한다. `scripts/**/*.test.ts` 가 `unit-node` include 에 있고 `scripts/__tests__/seed.test.ts` 가 `../seed` 를 import 하므로, **테스트 실행이 개발자의 실제 `.env` 를 `process.env` 에 싣는다**. vitest 워커가 `process.env` 를 공유하므로 그 값은 자기 파일 밖으로도 보인다 — CI 에는 `.env` 가 없어 CI 는 초록이고 **로컬에서만** 깨지는 계열의 결함이 된다.

v0.4.57.1 컷에서 `logger.test.ts` 4건이 이 모양으로 떴다(주변에 `AXIOM_*` 이 있으면 `logger.ts` 가 transport 분기를 타서 pino 인자 개수와 transport 호출 누적이 둘 다 어긋난다). **증상은 그 파일에서 고쳤지만**(가정을 stub 으로 명시) 메커니즘은 남아 있어 `process.env` 를 읽는 다른 테스트에도 같은 방식으로 번질 수 있다. 한 줄 재현: `AXIOM_TOKEN=x AXIOM_DATASET=y pnpm exec vitest run lib/observability/__tests__/logger.test.ts`.

닫는 법 후보: ① 스크립트에서 import 시점 부수효과를 없애고 `main()` 안에서 명시적으로 dotenv 를 부른다(진짜 수정, 스크립트 실행 경로 확인 필요), ② 테스트가 스크립트 모듈을 import 하지 않도록 순수 로직을 분리, ③ vitest `env` 로 테스트에서 `.env` 를 무력화. ①이 원인에 가장 가깝다. **주의: 어느 쪽도 `.env` 를 읽는 스크립트의 실사용 동작을 깨뜨리면 안 된다.** (발견: v0.4.57.1 컷 감사)

### 킬 스위치 off-branch 분기 테스트 — 재비활성화 시 복원할 것 (P4, 현재 잠복)
원 항목은 "4개 SURFACE 중 `loading.tsx` 만 off-branch 분기 테스트가 없다"였다. **v0.4.56.0 재활성화가 전제를 바꿨다**: off-branch 회귀 테스트 3파일(`*.contract-templates.test.*`)은 플래그 on 에서 RED 라 삭제됐고(복원 절차는 `lib/features/contract-templates.ts` 주석), 이제 off 분기는 **네 SURFACE 모두** 잠복 코드다. 다시 끌 일이 생기면 그 PR 이 3파일을 git 이력에서 복원하면서 `loading.tsx` off 렌더(헤더 전용 스트립 ≠ `ContractTemplatesPageSkeleton`) 테스트를 함께 추가할 것 — 그때까지는 도달 불가 분기라 실피해 없음. (발견: v0.4.49.0 컷 감사, 재프레임: v0.4.56.0)

### ~~`lastReadByCounterparty` — 후임 바로 옆에 남은 미호출 쌍둥이 (P4)~~ — 해결 (v0.5.7.0)
`repositories/types.ts:1466`. 프로덕션 호출자가 0인 선존재 죽은 코드인데, 이 diff 가 올바르게 스코프된 후임 `maxLastReadAt` 을 **바로 위에** 추가하고 `conversationLoaders.ts` 주석이 둘을 구분하라고 적었다. 대체된 메서드를 대체한 메서드 옆에 남겨 두는 건 나중에 잘못 집어가기 딱 좋은 모양이다. `ChatReadRepo`·`DrizzleChatReadRepository`·`chat-conversation.test.ts` 에서 함께 삭제. (발견: v0.4.49.0 컷 감사)

### `types.ts` 스테일 주석 2건 (P4)
① `:89` — 새 `findByIds` 선언이 `findByBuyerWs` 의 docstring 과 `findByBuyerWs` **사이에** 끼어들어, 한 줄 주석이 이제 엉뚱한 메서드를 설명하고 `findByBuyerWs` 는 모든 메서드가 문서를 가진 인터페이스에서 혼자 무문서가 됐다. ② `:1099` — `deleteStalePending` 이 `limit` 파라미터를 받게 됐는데 docstring 은 아직 "전부 삭제"라고 약속하고 `limit` 을 언급하지 않는다. 상한이 그 변경의 요점(무제한 배치가 타임아웃 때 R2 객체를 고아로 만든다)이라, 계약 문구가 변경이 없앤 바로 그 동작을 서술하고 있다. (발견: v0.4.49.0 컷 감사)

### `packageManager` 핀이 없어 pnpm 버전 드리프트가 조용히 깨진다 (P4)
PATH 의 pnpm 8.6.2 가 lockfile `9.0` 을 못 읽어 `pnpm audit` 이 `undefined is not a function` 으로 크래시한다(9.12.3 으로 우회 실행하면 정상). `package.json` 에 `packageManager` 필드가 없어 corepack 핀도 없다 — 다른 머신·CI 에서 감사·설치가 조용히 어긋날 수 있다. 닫는 법: `"packageManager": "pnpm@9.x"` 추가(corepack 강제이므로 로컬 개발 흐름 영향을 확인하고 적용). (발견: 릴리스 컷 보안 감사 2026-08-05, v0.4.42.0)

### ~~dev 의 e2e 시나리오 6개가 깨져 있다 (P1, 선존재)~~ — 해결 (2026-08-26)

여섯이 **한 원인이 아니라 다섯 원인**이었고, 전부 스펙 드리프트였다(제품 회귀 0건). 마지막 초록은 2026-06-30, 첫 빨강은 07-01이다.

- **환영 모달이 클릭을 삼켰다** (`rfp-detail-navigation` 2건) — 시드가 `users.onboarding` 을 `'{}'` 로 두어 `/home` 이 항상 환영 모달을 열었고, base-ui Dialog 의 전면 backdrop 이 링크 클릭을 가로챘다. `/home` 요소를 클릭하는 스펙이 이 둘뿐이라 나머지는 우연히 비켜갔다(`loginAs` 직후 `page.goto` 로 이탈). **고친 곳은 스펙이 아니라 시드다** — `scripts/seed.ts` 가 두 온보딩 키에 `completedAt` 을 찍는다(시드 유저 = 이미 온보딩을 마친 픽스처).
- **신규 계약이 숨긴 필드를 채우려 했다** (`scenario-a`) — v0.2.68.0 의 신규 계약 면제로 전년도 PG 거래액 입력이 렌더되지 않는다. 채우기를 **숨김 단언으로 바꿔** 회귀 가드로 전환했다.
- **PG 칩 3개를 눌러 전부 해제했다** (`scenario-a`, 위와 별개 결함) — 위저드가 첫 마운트에서 전체를 자동 선택하는데(`RfpCreateWizard:74-80`, 2026-06-30 도입) 스펙의 순회 클릭이 토글로 작동해 0개가 됐다. 07-01 CI 의 `input[type="date"]` 타임아웃이 이것이었다.
- **1단계 필수값 정산한도를 안 채웠다** (`scenario-b`·`scenario-e`) — `handleSubmit` 이 확인창을 열지 않고 힌트 토스트 + 1단계 복귀로 끝난다(`BidWizard:280-295`). 다이얼로그·라벨·role 은 멀쩡했다. 이제 **막힌 제출 왕복까지 단언**한다(그 회귀를 잡았을 유일한 단언).
- **대기 두 줄이 공허해 SELECT 가 커밋을 앞질렀다** (`scenario-d`) — `getByText(PG명)` 은 피커 칩 자신을, `text=/대기중/` 은 **정적 안내 문단**(`RfpInviteManager:187-190`)을 잡아 즉시 통과했다. ⚠️ 옛 기록의 "화면에는 초대 행이 그려지는데 DB 에는 없다"는 **오독이었다** — 화면은 초대 행을 그린 적이 없다. 서버 파생 신호(초대 보내기 버튼의 draft 카운트)로 바꾸고, 조용한 `ok:false` 를 에러 토스트로 갈라내게 했다.

**재발 방지가 본체다**: e2e 잡이 `main` push 전용이라 PR 에서는 required 인데도 **보고되지 않은 채** 통과했고, 그래서 두 달간 아무도 몰랐다. `ci.yml` 을 `pull_request: [main, dev]` + e2e 잡 `if` 제거로 바꿔 **dev 대상 PR 에서도 돈다**(기능 브랜치→dev PR 에 CI 가 없던 기존 설계를 여기서 뒤집는다). 곁들여 고친 것: `scenario-a` 의 아웃박스 기대값이 상수 3 이었는데 팬아웃은 **승인 멤버당 1건**이라(시드 toss 는 멤버 둘) 같은 규칙에서 파생하도록 바꿨고, 두 PG 스펙의 `select` 첫 요소 셀렉터를 옵션 기반으로(`select:has(option[value="D"])`) 좁혔다.

> **갱신 (2026-09-04, v0.5.6.1)**: 위 "dev 대상 PR 에서도 돈다"는 그 뒤 뒤집혔다 — `ci.yml` 의 e2e 잡이 다시 `if: github.event_name != 'pull_request' || github.base_ref == 'main'` 로 게이트돼 **dev 대상 PR 에서는 스킵된다**(사용자 결정, 커밋 `ca4326e7`). lint+tsc·unit 은 dev 대상 PR 에서도 그대로 돈다. 즉 e2e 게이트는 이제 **dev→main 컷 PR 한 곳뿐**이므로 그 PR 의 e2e 결과를 반드시 읽어야 한다. 기록은 결정 이력 보존을 위해 남긴다.

<details><summary>원문 (해결 전 기록)</summary>

`pnpm e2e` 전체 실행 시 6개가 실패한다 — `rfp-detail-navigation`(구매사·PG 각 1), `scenario-a-buyer-rfp`, `scenario-b-pg-bid`, `scenario-d-buyer-add-pg`, `scenario-e-requote`. 나머지 27개는 통과.

**선존재임을 실측 확인했다**: `origin/dev`(79049397)를 별도 워크트리에 체크아웃해 같은 스펙들을 돌렸더니 **동일한 6개가 동일한 지점에서** 실패한다(scenario-b 는 같은 143줄). 즉 v0.4.34.0 브랜치가 만든 회귀가 아니다.

**GitHub Actions 에서도 같은 6개가 실패한다 — 로컬 환경 문제가 아니다.** `ci` 워크플로는 `main` push 에서만 e2e 를 돌리는데(`pull_request` 는 lint+unit 만), 최근 두 릴리스 머지가 모두 그 job 에서 실패했다: run 30451288804 (#454 머지) 와 30427610561 (#450 머지) 모두 `lint + tsc` ✓ · `unit (vitest)` ✓ · **`e2e (playwright)` ✗**. 실패 목록은 위 6개와 정확히 일치한다(ubuntu-latest + 서비스 컨테이너 Postgres 환경).

**즉 `main` 은 최소 두 릴리스 전부터 CI 가 빨간 상태로 머지돼 왔다.** e2e 가 릴리스 게이트로 배치돼 있는데(`main` push 전용) 상시 실패라 실효가 없다 — 이게 이 항목이 P1 인 이유다. 또한 **기능 브랜치 → `dev` PR 에는 CI 가 아예 걸리지 않는다**(`pull_request: branches: [main]`), 그래서 dev 로 들어오는 변경은 로컬 검증에만 의존한다.

증상은 대부분 `locator.click: Test timeout of 90000ms exceeded` 계열의 타임아웃이라 원인이 하나인지 여럿인지 아직 모른다. 후보: 시드 상태 전제가 어긋났거나(스펙들이 공유 시드 RFP `P-2604-0001` 에 의존), 화면 구조 변경 후 셀렉터가 스테일하거나, dev 서버 cold-compile 타임아웃. **먼저 할 일은 원인 분류다** — 6개가 한 원인인지 확인하고, 그 다음 고칠지/스펙을 현행화할지 정한다.

**분류 1건 완료 — scenario-d 는 타임아웃이 아니다 (2026-08-12 실측, v0.4.53.0).** 13초 만에 **어서션**에서 죽는다: 로그인 → 딜룸 `PG 관리` 탭 → PG 칩 클릭 → `대기중` 칩 렌더까지 전부 통과한 뒤 `SELECT status FROM rfp_invitations WHERE rfp_id=? AND pg_ws_id=?` 가 **0행**을 돌려준다(`expect(draftArr).toHaveLength(1)`). 화면에는 초대 행이 그려지는데 DB 에는 없다 — 후보는 ① 액션이 조용히 실패하는데 UI 가 낙관적으로 그린다 ② 스펙이 조회하는 `rfpUuid`/`pg_ws_id` 가 실제 기록과 다르다 ③ 트랜잭션이 롤백된다. `origin/dev`(642b060e)를 별도 워크트리에 체크아웃해 같은 스펙을 돌려도 **같은 줄에서 같은 0행**이라 선존재가 재확인됐다. 즉 최소 이 한 건은 "셀렉터 스테일"도 "cold-compile 타임아웃"도 아니며, 나머지 5개도 각각 같은 방식(베이스라인 대조 + 실패 지점 확인)으로 갈라야 한다. (v0.4.53.0 이 이 스펙의 워크스페이스 시드를 `status:'active'` 로 고친 것은 별개 수정이며, 그 덕에 칩 클릭 단계는 통과한다.)

이게 열려 있는 동안 e2e 는 회귀 게이트로 못 쓴다(항상 빨간 상태라 새 실패가 묻힌다). (발견: /ship 최종 검증 2026-07-29, v0.4.34.0 — 베이스라인 대조로 선존재 확정)

</details>

### 랜딩 타이포 e2e 가 데스크톱 폭에서만 돈다 — `md:` 스코프 회귀를 못 잡는다 (P3)
`playwright.config.ts` 의 프로젝트는 `devices['Desktop Chrome']`(1280×720) 하나뿐이라 `landing-text-token-cascade.spec.ts` 는 언제나 `md:` 브레이크포인트 **위**에서만 잰다. 그래서 랜딩 nav 링크·CTA 의 클래스를 `md:text-sm md:leading-[inherit]` 처럼 **데스크톱 스코프로만** 바꾸면 이 스펙은 초록인데 모바일에서 보이는 링크는 본문을 그대로 상속해 **16px/24px(비율 1.5)** 로 조용히 회귀한다 — 그 폭에는 `text-sm` 자체가 없으므로 Tailwind 의 20px 행간이 아니라 본문 행간이 걸린다. 소스 드리프트 가드도 못 잡는다 — `text-size-token-drift.test.ts` 의 leading 검사는 **variant 무관**으로 설계돼 있고(그 파일 주석이 "a variant-scoped size with an unscoped leading is close enough for a lint-grade rule" 이라고 명시), 같은 줄에 `leading-` 만 있으면 통과한다.

닫는 법: `playwright.config.ts` 에 모바일 뷰포트 프로젝트를 추가하고 이 스펙을 양쪽에서 돌린다. **범위가 이 스펙 하나가 아니라서 미뤘다** — 프로젝트를 추가하면 스펙 35개가 전부 두 번 돌아 CI 시간이 늘고, 모바일에서 숨는 요소(`hidden md:inline-flex` CTA)를 쓰는 스펙들은 뷰포트별로 기대값을 갈라야 한다. 모바일 전용 프로젝트에 스펙을 선별 지정하는 쪽이 현실적이다. (발견: /ship Codex 적대 리뷰 2026-09-04, v0.5.6.1)

### e2e 가 dev 서버를 상대로 돈다 — 인터셉트 라우트 첫 생성이 500 을 낸다 (P2)
`playwright.config.ts` 의 webServer 가 `pnpm dev` 라 각 라우트의 **첫 방문이 곧 Turbopack 컴파일**이고, 그 경합이 실제 실패를 만든다. 2026-08-26 CI trace 로 확정된 증상: 목록 행 클릭 → `GET /rfp/<code>?_rsc=…` 이 **500**, dev 서버 로그에 `Invalid interception route: /rfp/(.)(.)(.)(.)<code>`(마커가 4번 중첩된 경로 — 라우트 매니페스트가 만들어지는 중에 요청이 도착할 때만 난다), Next 가 하드 네비로 폴백해 **정식 페이지**를 그린다. 그러면 URL 은 맞는데 모달이 영영 없어서 **대기 시간을 늘려도 소용없다**(60s 로 올려도 같은 실패). `/inbox` 쪽도 같은 모양이다.

두 번째 시도부터는 컴파일돼 있어 정상 인터셉트되므로 스펙을 `expect(...).toPass()` 재시도로 감쌌다 — 임시방편이고, **이 축은 프로덕션 배포에는 없다**(라우트가 미리 빌드돼 있다). 곁들여 드러난 사실: 그동안 이 두 스펙이 초록이던 것은 **앞선 두 스펙이 3분씩 타임아웃하며 라우트를 우연히 데워 준 덕분**이었다. 즉 이 하네스에서는 "초록"이 실행 순서에 의존한다.

닫는 법: CI e2e 를 `next build && next start` 로 돌린다(`process.env.CI` 로 갈라 로컬은 `pnpm dev` 유지). 빌드 2-4분이 붙지만 전 스펙의 콜드 컴파일이 사라져 총시간은 비슷하고, 스펙 곳곳의 45s·60s·120s 패딩과 위 재시도를 **실제 회귀 임계로 되돌릴 수 있다**. (발견: e2e 수리 2026-08-26, CI trace + 서버 로그 실측)

### ~~PG 칩에 선택 상태가 노출되지 않는다 — 스크린리더도 테스트도 못 읽는다 (P3)~~ — 해결 (v0.8.1.0)
칩에 `aria-pressed` 와 `data-state` 가 붙었고 체크 상자·헤더 카운터(`data-testid="pg-select-count"`)가 생겼다. e2e 는 더 이상 `N개 선택됨` 문구에 의존하지 않는다(`scenario-a-buyer-rfp.spec.ts` 가 카운터 testid + 칩 `aria-pressed` 를 관측한다). 원 항목이 곁들여 남긴 제품 결정은 아래로 분리했다.

### 첫 진입에서 PG 를 전부 자동 선택하는 것이 봉인 입찰의 기본으로 맞나 (P3)
`RfpCreateWizard:72-80` 이 최초 진입에서 사용 가능한 PG 를 **전부** 자동 선택한다 — 기본값이 "전원 발송"이라는 뜻이다. 봉인 입찰 제품에서 의도된 기본인지 확인이 필요하다. 확인 경로가 하나 늘었다: v0.8.1.0 의 헤더 카운터가 이제 `3/3 선택` 처럼 기본 상태를 화면에 드러내므로, 구매사가 "전원에게 간다"는 사실을 최소한 볼 수는 있다. 결정이 "전원 발송이 맞다"로 나면 이 항목은 그대로 닫고, 아니면 기본값을 바꾸는 쪽이 카운터와 함께 자연스럽다. (발견: e2e 수리 2026-08-26 / 분리: v0.8.1.0)

### `addPgWorkspaces` 가 중복 추가를 조용히 삼킨다 (P3)
이미 `rfp_allowed_pg` 에 있는 워크스페이스를 추가하면 `ok:true, addedCount:0` 으로 끝난다(`lib/server/services/rfp.ts:596-602`) — 초대 행도 안 생기고 **토스트도 없다**. `RfpInviteManager.handleSelect`(`:78-86`)는 `!r.ok` 일 때만 문구를 띄우므로, 구매사 화면에서는 **칩을 눌렀는데 아무 일도 일어나지 않는다**. 초대 목록에 이미 있으면 칩이 피커에서 빠지므로(`availablePgs`) 일상 경로에서는 도달하기 어렵지만, allowlist 와 초대 행이 어긋난 상태(초대 삭제·라운드 재설정)에서는 도달한다. 닫는 법: `addedCount === 0` 이면 "이미 추가된 PG예요" 안내를 띄운다. (발견: e2e 수리 2026-08-26 — 이 경로가 로컬 재실행에서 "0행" 증상을 만들어 스펙 실패로 오인될 수 있었다)

### 재요청 위저드가 제출 불가능한 값을 프리필한다 (P3)
`bidToDraft`(`components/inbox/bid-wizard/BidWizard.tsx:97`)가 `String(b.settleLimit ?? 0)` 로 직전 라운드 값을 채우는데, 레거시 `settle_limit = 0` 행이면 화면에는 `0` 이 **채워진 것처럼** 보이고 `isSettleLimitValid` 는 거부한다(0 초과 필수). `advance`(`:251`)에 단계 가드가 없어 사용자는 4단계까지 걸어간 뒤 발송 버튼에서야 "정산한도를 입력해주세요"로 1단계로 튕긴다. 닫는 법: 프리필 시 유효하지 않은 값은 빈 문자열로 떨어뜨리거나(EMPTY_BID_DRAFT 의 근거 주석이 이미 그 논리다), `advance` 에 RFP 위저드와 같은 단계 가드를 건다. (발견: e2e 수리 2026-08-26)

## Biz Profile / NTS (사업자번호 조회)

### 미검증 사업자번호 백필 cron 미구현 (P1)
국세청 장애로 미검증 통과한 가입건(`biz_profiles.tax_type IS NULL` + `biz_no` non-null)은 **장애가 끝나도, 관리자 승인 뒤에도 영원히 미검증으로 남는다** — 지금은 수동 확인 외에 채울 경로가 없다. `app/api/cron/backfill-biz-profiles/` 를 기존 3개 cron 의 인증 패턴(상수시간·헤더 전용)으로 추가해 배치 재조회하고, 폐업/휴업 판명 시 `risk_flags` severity 를 `critical` 로 승격할 것. 배치 크기·주기는 leaky-bucket 10 req/s(쓰기 예약분 3 포함) 안에 들도록 보수적으로. 저하 모드 계획의 Phase 5 로 의도적으로 연기한 항목. (발견: 저하 모드 계획 2026-07-29, v0.4.29.0)

### ~~설정 사업자번호 변경에 admin 권한 체크 없음 (P2)~~ — 해결
`updateWorkspaceBizProfileAction` 에 `getMembership` + `isApprovedAdmin` 게이트를 붙였다(당시 `renameWorkspaceAction` 과 동일 문법 — 해당 즉시 변경 액션은 v0.6.1.0 에서 제거되고 심사 요청 액션으로 대체됐다). JWT role 은 stale 가능 + 미승인 admin 포함 가능이라 DB 라이브 리드로 재확인하며, 두 축 모두 테스트가 커버한다. 에러 코드는 `FORBIDDEN_NOT_ADMIN`.

UI 도 짝을 맞췄다: ① `WorkspaceBizNoForm` 의 수정 버튼을 `canEdit` prop 으로 가린다(`WorkspaceNameForm` 선례), ② **미등록(`currentBizNo===null`) + 일반 멤버**는 입력 UI 대신 관리자 안내를 보여준다 — 그 상태는 `editing` 을 기본 `true` 로 켜서 버튼 게이트를 우회했고, 일반 멤버가 다 입력하고 저장에서만 거부당하는 막다른 길이었다. ③ 실패 토스트가 에러 코드 원문을 그대로 노출하던 것(`저장하지 못했어요 — FORBIDDEN_NOT_ADMIN`)을 `ERROR_LABELS` 매핑으로 대체했다. 기존 테스트 하나가 그 누출을 단언하고 있어(`stringContaining('WORKSPACE_NOT_FOUND')`) 함께 갱신했다.

### ~~워크스페이스 로고 교체·삭제에 권한 체크가 없다 (P2, 선존재)~~ — 해결 (v0.4.35.0)
`app/api/workspace/[id]/avatar/route.ts` 의 POST·DELETE 가 공통 `guardWrite` 를 지나도록 했다 — 세션 폐기·이메일 인증·워크스페이스 일치 검사에 더해 `getMembership` + `isApprovedAdmin`(DB 라이브 리드)을 요구하고, 멤버십 row 가 없는 마스터/운영자는 `isMasterEmail` 로 면제한다. 거부 코드는 `updateWorkspaceBizProfileAction` 과 같은 `FORBIDDEN_NOT_ADMIN` 이다 (`requestWorkspaceNameChangeAction` 은 `FORBIDDEN` — 아래 P4 항목).

같은 PR 에서 당시 `renameWorkspaceAction` 에 빠져 있던 마스터 면제도 넣었다. 그 즉시 변경 액션은 v0.6.1.0 에서 제거됐고, 대체된 `requestWorkspaceNameChangeAction` 도 같은 면제와 DB 라이브 멤버십 판정을 유지한다.

UI 도 짝을 맞췄다: `WorkspaceLogoForm` 에 필수 `canEdit` prop 을 더해 변경·삭제 컨트롤을 가린다(아바타 읽기는 그대로). 설정 페이지는 이미 계산해 둔 `canEditWorkspace` 를 세 컨트롤 모두에 내려 준다 — 로고·이름·사업자번호가 이제 한 술어를 공유한다.

기존 라우트 테스트 7개가 `seedMembership` 기본값(`member`)으로 쓰기 성공을 기대하고 있어 `admin` 으로 갱신했다. 신규 게이트 4건은 변이 검증으로 비공허성을 확인했다.

<details><summary>원문</summary>
설정 페이지의 워크스페이스 패널에는 컨트롤이 셋인데(로고·이름·사업자번호), v0.4.34.0 이 뒤의 둘에 admin 게이트를 붙이는 동안 **`WorkspaceLogoForm` 은 무조건 렌더된다**. 엔드포인트(`app/api/workspace/[id]/avatar/route.ts`)도 요청 워크스페이스가 세션 워크스페이스와 같은지만 보고 role 을 확인하지 않으며, 판정을 DB 라이브 리드가 아니라 JWT 로 한다 — 같은 PR 의 다른 두 게이트가 "JWT 는 stale 할 수 있다"는 이유로 DB 재확인을 택한 것과 어긋난다. 결과적으로 **일반 멤버(그리고 제거됐지만 토큰이 살아 있는 전 멤버)가 워크스페이스 로고를 바꾸거나 지울 수 있다.**

닫는 법: 라우트에 `getMembership`+`isApprovedAdmin`(+마스터 면제)을 붙이고 `WorkspaceLogoForm` 에도 같은 `canEdit` 를 내린다. 패널 세 컨트롤이 같은 게이트를 공유하게 되므로 페이지에서 한 번만 계산하면 된다(이미 `canEditWorkspace` 가 있다). (발견: /ship red-team 리뷰 2026-07-29, v0.4.34.0)

</details>

### `duplicateQuoteTemplateAction` 이 새 정산한도 불변식을 강제하지 않는다 (P4)
v0.4.34.0 이 `saveQuoteTemplateAction` 에 `settleLimit > 0` 을 걸었지만 복제 경로는 기존 행을 그대로 베낀다 — 운영 DB 에 남아 있는 레거시 0 템플릿을 복제하면 새 0 템플릿이 생긴다. 실피해는 낮다(표시 문제이고 제출 시 서버가 다시 거부한다). 레거시 행 정리 방침(비교 화면 0원 표기 폴리시)과 함께 판단하는 게 자연스럽다. (발견: /ship red-team 리뷰 2026-07-29, v0.4.34.0)

### `createRfpAction` 의 사업자번호 오버라이드가 무검증·무게이트 (P2, 선존재)
`updateWorkspaceBizProfileAction` 은 v0.4.34.0 에서 admin 게이트 + NTS 재조회를 둘 다 갖췄지만, **형제 경로인 `RfpService.createRfp` 의 `bizProfileMode:'override'` 는 여전히 클라이언트가 보낸 `bizNo` 를 그대로 저장한다** — `lib/server/services/rfp.ts` 의 `bizNo: bizNoOverride ?? undefined` 에 NTS 재조회도, role 확인도 없다. 즉 일반 멤버가 임의(타사) 사업자번호를 RFP 스냅샷에 찍을 수 있고, 초대된 PG 는 그것을 실제 발주사 정보로 읽는다. 설정 경로에서 닫은 것과 **같은 사칭 부류**다.

닫는 법: `bizProfileMode:'override'` 를 `resolveBizProfileForWrite` 로 태우고(설정 경로와 동일), 건별 오버라이드에도 admin 게이트가 필요한지 제품 판단. 의도적으로 열어 두기로 한다면 THREAT_MODEL.md 에 수용 리스크로 명문화해야 한다 — 지금은 두 경로의 비대칭이 어디에도 기록돼 있지 않다. (발견: /ship security 전문가 리뷰 2026-07-29, v0.4.34.0)

### 마스터 면제가 게이트마다 다르고 어디에도 정책이 적혀 있지 않다 (P3)
`isApprovedAdmin` 은 10곳 넘게 불리는데 **마스터가 그것을 우회하는지가 곳마다 다르다.** 면제 있음: 로고 라우트(`guardWrite`)·`updateWorkspaceBizProfileAction`·`requestWorkspaceNameChangeAction`·설정 페이지의 `canEditWorkspace`. 면제 없음: `listAuditLogsAction`·`settings/audit-log/page.tsx`·`lib/server/services/workspace.ts` 의 초대·제거·역할변경 등 다섯 게이트.

결과적으로 **마스터는 로고·사업자번호를 바꾸고 워크스페이스 이름 변경을 요청할 수 있지만, 멤버를 초대·제거하거나 역할을 바꾸거나 감사 로그를 볼 수 없다.** 그게 의도인지 사고인지 코드 어디에도 적혀 있지 않다 — 지금은 각 호출부의 유무로만 표현된다.

닫는 법: `lib/auth/pg-membership-gate.ts` 선례(하나의 술어 + 두 호출부로도 독립 모듈을 만들고 모듈 헤더에 마스터 면제 근거를 적었다)를 따라 `requireApprovedWorkspaceAdmin(userId, workspaceId, email)` 를 `lib/auth/` 에 뽑고, **같은 변경에서 현재 면제 없는 일곱 게이트의 마스터 정책을 결정한다**(가드 테스트로 고정). 이건 authz 행동 변경이라 P2 로고 픽스 안에 넣을 수 없어 분리했다. 이 항목은 아래 P4(에러 코드 이름)를 포함한다 — 한 헬퍼로 모으면 코드 이름도 자연히 하나가 된다. (발견: /ship maintainability 리뷰 2026-07-30, v0.4.35.0)

### 워크스페이스 정체성 쓰기 경로가 워크스페이스 status 를 보지 않는다 (P3, 선존재)
로고 라우트·`updateWorkspaceBizProfileAction` 두 경로는 **멤버 승인 상태만** 보고 워크스페이스 자체의 `status`(pending/suspended)는 보지 않는다. 이름 변경 요청은 v0.6.1.0 에서 트랜잭션 안의 active 조회를 거치도록 고쳐 이 항목에서 빠졌다. 남은 두 경로 때문에 **정지된 워크스페이스의 승인 admin 도 로고를 올리고 지울 수 있다.** 로고 GET 은 비인증 공개 + `Cache-Control: public, max-age=31536000, immutable` 이라, 앱 origin 의 안정적 URL 로 임의 PNG/JPEG 를 계속 서빙할 수 있다(sniff 검증이 SVG/XSS 는 막는다). 셸 가드(`resolveShellAccess`)는 RSC 렌더만 막고 이 라우트는 지나지 않는다.

v0.4.35.0 이 구멍을 '아무 멤버'→'승인 admin' 으로 좁혔을 뿐 넓히지는 않았다. 닫는 법: 위 P3 의 공용 술어에 워크스페이스 status 확인을 함께 넣는다(`getMembership` 이 이미 `workspaces` 를 innerJoin 하므로 `status` 를 projection 에 추가). 수용 리스크로 판단하면 `docs/THREAT_MODEL.md` 에 AR 항목으로 명문화한다 — **로고 GET 이 비인증 공개라는 사실 자체도 현재 어디에도 문서화돼 있지 않다.** (발견: /ship security 리뷰 2026-07-30, v0.4.35.0)

### RFP 참여 허용목록 쓰기 경로가 워크스페이스 status 를 보지 않는다 (P3, 선존재)
v0.4.53.0 이 **읽기** 쪽(`WorkspaceRepo.search` — 구매사 PG 피커)에 `status='active'` 를 넣어 심사 대기 PG 가 목록에 뜨던 것을 막았지만, **쓰기** 쪽은 그대로다. `RfpService.createRfp` 는 `input.allowedPgWorkspaceIds` 를 아무 검증 없이 `rfpAllowedPgRepo.add` 로 넘기고(액션의 zod 는 `uuid()` 형식만 본다), 발송 후 경로인 `addPgWorkspaces` 가 쓰는 `filterPgIds`(`lib/server/repositories/drizzle/workspace.ts`)는 `type='pg'` 만 확인한다. 즉 **직접 호출로는 pending/suspended PG 워크스페이스를 지금도 허용목록에 넣을 수 있고**, 그 PG 는 승인되는 순간 봉인된 견적 브리프를 읽는다.

지금 UI 로는 도달할 수 없다(피커가 그 id 를 더 이상 내주지 않는다) — 그래서 P3 이지 P2 가 아니다. 닫는 법: `filterPgIds` 에 `eq(workspaces.status,'active')` 를 더하고 `createRfp` 가 같은 필터를 통과한 id 만 저장하도록 한다. 읽기와 쓰기가 같은 술어를 쓰게 되는 셈이라, 그때 조건을 repo 안 한 곳으로 모으는 게 낫다. (발견: 테스트 PG 숨김 작업 중, v0.4.53.0)

### 워크스페이스 gate 에러 코드 이름이 게이트마다 다름 (P4)
같은 술어가 이제 **세 곳**에 있고 이름이 갈린다: `FORBIDDEN_NOT_ADMIN` 2곳(`updateWorkspaceBizProfileAction`, 로고 라우트 `guardWrite`)과 `FORBIDDEN` 1곳(`requestWorkspaceNameChangeAction`). 하나는 액션이 아니라 **API 라우트**라, 고칠 때 액션 계층만 손대면 안 된다.

v0.4.35.0 부터 이 차이가 **사용자에게 보인다**: `WorkspaceLogoForm` 은 `FORBIDDEN_NOT_ADMIN` 을 '권한이 없어요. 워크스페이스 관리자에게 변경을 요청해 주세요.' 로, `WorkspaceNameForm` 은 `FORBIDDEN` 을 맨 '권한이 없어요.' 로 매핑한다 — 같은 패널, 같은 상황, 다른 문구. `ActionResult` 의 `error` 가 맨 `string` 이라 타입도 묶어 주지 못한다.

한 이름으로 통일하면 `components/settings` 의 `ERROR_LABELS` 맵 세 개도 합칠 수 있다(`WorkspaceBizNoForm`·`WorkspaceLogoForm` 은 이미 바이트 동일한 리터럴을 각자 들고 있다). 위 P3(마스터 면제 공용 술어)와 같은 변경에서 처리하는 게 자연스럽다. (발견: /ship maintainability 리뷰 2026-07-29, 범위 확대 2026-07-30)

### 드리프트 가드 4개가 같은 per-line 스캔 루프를 각자 복제 (P4)
`_source-scan.ts` 가 traversal 과 `Violation` 타입은 소유하지만 per-line 절반은 네 곳이 각자 적는다(`mono-label-drift` 2곳·`outline-text-drift` 2곳·`text-size-token-drift` 1곳) — 매번 `readFileSync().split('\n').forEach()` + 1-based 줄번호 + `.trim()` 을 재유도한다. `scanLines(file, matcher)` 를 `_source-scan.ts` 에 올리면 각 가드는 실제로 고유한 부분(정규식)만 남는다. (발견: /ship maintainability 리뷰 2026-07-29, v0.4.34.0)

### 랜딩 타이포 위계가 한 단으로 눌렸다 (P3)
색 클로버 수정(v0.4.34.0)이 5개 의도 티어(`--text-2xs`/`-xs`/`-sm`/`-base`/`-md`)를 전부 `text-sm` 하나로 접었다. **렌더 회귀는 아니다** — 36곳 모두 원래 body 14px 를 상속하고 있었고(조상 중 font-size 를 정하는 곳이 없음), Tailwind 기본 `--text-sm` 이 정확히 body 크기라 크기 델타는 0이다. 문제는 **의도가 코드에서 사라졌다**는 것: 같은 파일 안에서 눈에 띄는 쌍이 `OfferComparisonTable` 의 `headCls`(구 `2xs`) vs `numCls`(구 `base`), `CostComparisonChart:22`(구 `2xs`) vs `:73`(구 `base`), `SavingsCalculator:191`(구 `xs`) vs `:192`(구 `base`) 셋이다. 위계를 다시 세우려면 실제 크기로 새로 설계하고 `/design-review` 시각 승인을 받아야 한다(구 스케일 복원은 별건으로 이미 분리돼 있다). (발견: /ship design 리뷰 2026-07-29, v0.4.34.0)

### 저하 코드 목록이 클라·서버 두 곳에 따로 있음 (P3)
"어떤 NTS 실패를 저하로 볼 것인가" 가 두 모양으로 중복된다: `components/rfp/nts-lookup.ts` 의 `DEGRADED_CODES` 는 닫힌 allowlist 이고, `_resolveBizProfile.ts` 는 `NTS_LOCAL_THROTTLED` 만 빼고 전부 저하시키는 blanket catch 다. 새 `NtsErrorCode` 를 추가하면 클라는 막고 서버는 통과시키는 방향으로 **기본값이 어긋난다**. `isDegradableNtsCode(code)` 를 `lib/integrations/nts.ts` 에 단일 출처로 두고 양쪽이 소비 + 모든 코드가 명시 분류됐는지 드리프트 가드 테스트. (발견: /ship maintainability 전문가 리뷰 2026-07-29, v0.4.29.0)

### 사업자번호 조회 결과 단기 캐시 없음 (P4)
화면에서 조회 → 제출 시 서버가 같은 번호를 다시 조회하므로, 완주 1건당 국세청 호출이 2회다(가입 buyer/PG·`/workspace/new`·설정 4경로 공통). 재조회는 신뢰 경계라 **없애면 안 되고**, 30~60초 TTL 인메모리 캐시(정규화 bizNo 키, 크기 상한)를 `getNtsClient().lookup` 앞에 두면 경계를 유지한 채 상위 호출과 제출 지연을 반으로 줄인다. (발견: /ship performance 전문가 리뷰 2026-07-29, v0.4.29.0)

### `createWorkspaceAction` 이 사업자번호 오류를 INVALID_INPUT 으로 뭉갬 (P4)
가입 경로는 `BIZ_NOT_FOUND`/`BIZ_STATUS_NOT_ACTIVE`/`BIZ_UNSUPPORTED_TYPE`/`BIZ_LOOKUP_RATE_LIMITED` 를 구분해 돌려주는데, `/workspace/new` 는 넷 다 `INVALID_INPUT` 으로 접어서 "이름이 잘못됐다" 와 구분되지 않는다. `CreateWorkspaceResult` 의 error 유니온을 넓히고 리졸버 배선을 공용 헬퍼로 뽑을 것(가입 액션과 8줄 중복). (발견: /ship maintainability 전문가 리뷰 2026-07-29, v0.4.29.0)

### 가입 화면에 신규 사업자번호 오류코드 문구 매핑 없음 (P4)
`signupCompleteAction` 이 돌려주는 `BIZ_*` 4종이 `app/(public)/signup/buyer/profile/page.tsx` 의 라벨 맵에 없어 전부 "가입을 완료하지 못했어요"로 낙하한다(회귀는 아님 — 예전엔 전부 `INVALID_INPUT` 이라 같은 문구였다). 새로 도달 가능해진 막다른 길: 워크스페이스 단계에서 장애로 저하 통과 → 장애 복구 → 마지막 단계 서버 재조회에서 미등록/폐업 판정 → 두 단계 앞의 사업자번호를 고칠 방법 없이 generic 오류. (발견: /ship 계획 완료 감사 2026-07-29, v0.4.29.0)

## Notifications

### `assertUsableDedupeKey` 가 CLAUDE.md 가 지목한 위험을 못 잡는다 (P3)
`notifications/notify.ts:65` 의 가드는 `[object Object]` 만 검사한다 — 즉 시그니처가 `(email) => …` 에서 `(recipient) => …` 로 넓어졌을 때 안 고친 호출부(마이그레이션 사고)는 잡지만, CLAUDE.md 가 **위험으로 명시한** 쪽인 "다수 수신자에게 진짜 상수 키"(예: `dedupeKey: () => \`rfp:${id}:invite\`` + 수신자 8명)는 그대로 통과시켜 outbox 부분 UNIQUE 에서 1행으로 접히고 7명이 조용히 메일을 못 받는다. 타입으로는 못 막는다(무인자 화살표도 할당 가능).

현 호출부는 전부 안전함이 확인됐다 — 다수 수신자 호출은 전부 수신자별로 파생하고(`services/rfp.ts:174,537,714,848,1038`·`services/bid.ts:245`), 남은 상수 키 2곳은 의도적 단일 수신자 다이제스트(`services/chat.ts:241`·`services/team-chat.ts:230`)다. 그래서 라이브 버그가 아니라 **누락된 가드**다. `enqueueMany` 매핑에서 `recipients.length > 1` 일 때 키를 Set 에 모아 `size < length` 면 throw 하면 의도적 단일 수신자 다이제스트는 건드리지 않고 막힌다. (발견: v0.4.49.0 컷 감사)

### `notify.ts` 모듈 docstring 이 재작성 이전 동작을 서술한다 (P4)
파일 최상단(2행)은 아직 "수신자마다 in-app row insert(`dispatchNotification`)"라고 적혀 있는데, 실제로는 행을 전부 만든 뒤 `dispatchNotifications` 1회 + `outbox.enqueueMany` 1회다. 30행 아래 인라인 주석은 맞게 적혀 있어 같은 파일 안에서 모순된다 — 채널당 한 문장이 이 PR 의 핵심 불변식이라 특히 헷갈린다. (발견: v0.4.49.0 컷 감사)

### 알림 환경설정 미구현 — 이메일 수신 거부 불가 (P2)
`/settings/notifications` 는 "들어갈 예정입니다" 스텁이고, 발송 경로(`notify()`)에 사용자 선호도 체크가 전혀 없다 — 모든 이메일이 무조건 발송되며 수신 거부 수단이 없다. 타입/채널별 수신 토글 스키마 + `notify()` enforcement + 설정 UI 가 필요. (발견: 알림 시스템 전수 조사 2026-07-07, v0.2.75.1)

### 승인/거절 알림 미배선 (P3)
`workspace.approved/rejected`, `rfp.sent`, `membership.approved/rejected` 템플릿·outbox enum은 존재하지만 어디서도 발송하지 않는다. 승인 액션 자체는 admin 별도 레포(`admin-supporter-b`) 소관이라 발송 지점을 어느 레포에 둘지 경계 결정 필요. 관련: master/ops 멤버십 row를 admin 레포가 직접 insert하면서 `approval_status`를 명시적으로 non-approved로 쓰는 곳이 없는지 1줄 확인 필요(있다면 v0.2.75.1의 approved 필터로 master가 조용히 수신 중단됨). (발견: 알림 시스템 전수 조사 + /ship 적대 리뷰 2026-07-07)

### `notifications` 가 운영에서 실제로 파티션돼 있는지 미확인 (P3)
`lib/db/schema/notifications.ts` 상단 주석은 "RANGE-partitioned by created_at (0000 migration: 월별 자식 + DEFAULT)" 라고 적어 두었지만, **그 마이그레이션 폴더는 더 이상 없다** — 프로젝트가 push-only 로 옮기면서 DDL 은 `lib/db/schema-ddl.ts` 가 Drizzle 스키마에서 생성하고, `generateMigration` 은 `PARTITION BY RANGE` 를 못 뱉는다. 그래서 **단위·e2e 는 확실히 평범한 테이블**이고, 운영은 옛 0000 이 만든 파티션 테이블이 그대로 남아 있을 가능성이 높지만 확인되지 않았다.

두 가지가 여기에 걸려 있다: ① `markChatThreadRead` 의 `MARK_READ_LOOKBACK_DAYS` (90일) 하한은 **파티션이 있다는 전제**로 넣은 것이다 — 없으면 불필요한 제약이고, 90일 지난 안 읽은 알림이 안 걷히는 대가만 남는다. ② 파티션이 있다면 **어떤 테스트도 프루닝 회귀를 잡을 수 없다**(테스트 DB 가 파티션돼 있지 않으므로).

닫는 법: 운영에서 `SELECT relkind FROM pg_class WHERE relname='notifications';` 한 줄(`p`=파티션, `r`=평범). `r` 이면 하한을 지우고 스키마 주석을 고친다. `p` 면 주석에 "DDL 은 schema-ddl.ts 가 아니라 운영 DB 에만 있다"를 명시하고, 하한 없는 형제 쿼리(`markAllRead`)도 같은 눈으로 본다. (발견: /ship 성능 리뷰 2026-09-08, v0.9.3.0 — 사용자가 확인 없이 하한 추가를 선택)

### 알림 소소한 정합성 묶음 (P4)
① 알림 페이지 RSC는 100건, 훅 스토어(`useNotifications`)는 API 50건 하이드레이트 — 51~100번째 항목에서 배지/읽음 처리 불일치 가능. ② 인앱 알림 row는 `pending→read`만 전이하는데 렌더러(`NotificationActivityList`)와 `unreadCount`에 도달 불가능한 `sent`/`failed` 분기가 남아 있음. ~~빨간색 미읽음 렌더~~ — 색·라벨은 해결 (v0.5.5.1: 도달 가능한 `pending` 칩이 `warning`/`대기` → `primary`/`안 읽음`, `sent` 도 같은 값). 분기 자체의 도달 불가능성은 미해결이며, **`sent` 를 쓰는 테스트는 화면을 보장하지 않는다**는 점에 주의(그래서 `pending` 픽스처 테스트를 따로 뒀다). ⑤ `WorkspaceSwitcher` 드롭다운 미읽음 점에 접근 가능한 이름이 없음 — `ConversationList` 처럼 `sr-only` 라벨 필요(발견: /ship 리뷰 2026-09-04). ③ 알림 `type`이 free-form text로 SSOT enum이 없고 렌더러에 타입별 라벨/아이콘 매핑도 없음. ④ `retryEmail`은 서비스·액션·훅·테스트 완비 + requeue/화이트리스트 결함도 해소(v0.4.20.x)됐지만 여전히 UI 호출 지점 0인 데드코드 — 배선 여부는 별도 결정(2026-07-07 보류). (발견: 알림 시스템 전수 조사 2026-07-07)

## Deal Room / Award

### 선정 후 구매사 담당자(createdBy) 탈퇴 시 승자 PG가 빈 딜룸 (P3)
선정 연락처 교환(`CounterpartyContactCard`)은 `findContactById`가 fail-closed라, 구매사 담당자(RFP `createdBy`)가 탈퇴/시스템계정이면 `buyerContact=null`이 된다. 승자 PG 분기는 `awardedToMe && buyerContact`로 카드를, `awarded && !awardedToMe`로 미선정 안내를 그리므로 — 승자인데 buyerContact만 null이면 카드도 안내도 안 떠 빈 화면이 된다(드묾·누출 아님·정상 fail-closed). 후속: 연락처 없음 안내 폴백 또는 워크스페이스 대표 담당자 폴백 검토. (발견: /ship 적대 리뷰 2026-06-27)

### `WorkspaceAvatar.workspaceId` 는 아직 optional — 로고 누락의 남은 한 축 (P4)
v0.9.x 에서 `logoUpdatedAt` 을 필수로 올려 "배선을 잊음"과 "로고 없음"을 구분되게 만들었지만
(`Counterparty`·`WorkspaceAvatar`), 같은 컴포넌트의 `workspaceId` 는 여전히 optional 이다.
img 분기는 **둘 다** 있어야 켜지므로, 로고 버전만 넘기고 id 를 빠뜨리면 똑같이 조용히
이니셜로 떨어진다. 현재 실피해는 없다 — 호출부 전수(7/7)가 id 를 넘긴다. 닫지 않은 이유는
`workspaceId` 없는 "이니셜 전용 아바타"가 의도된 용법이고(`WorkspaceAvatar.test.tsx` 가
그 분기를 명시적으로 검증한다) 그것까지 없애려면 props 를 `WorkspaceDisplay` 하나 또는
`{name}` 유니온으로 바꿔야 해서, 이번 변경의 범위를 넘는다. 닫는 법 후보: prop 을
`identity: WorkspaceDisplay | { name: string }` 판별 유니온으로. (발견: 로고 누락 구조 수정 작업)

## Settings / Account

### 설정 페이지 `canEditWorkspace` 의 미승인-admin 축이 무테스트다 (P2)
v0.4.34.0 이 `app/(app)/settings/profile/page.tsx` 의 `canEditWorkspace` 를 role-only 검사에서 `isMasterEmail(...) || isApprovedAdmin(await getMembership(...))` 로 올렸다. 그런데 이 배선을 검증하는 유일한 테스트인 `e2e/settings-biz-admin-gate.spec.ts` 는 **`role` 컬럼만 토글하고 `approval_status` 는 건드리지 않는다.** 즉 술어를 `memberMeta?.role === 'admin'` 으로 되돌려도 전 스위트가 초록으로 남으면서, **미승인 admin(canonical-PG 합류자)에게 수정 어포던스가 다시 열린다** — 술어를 바꾼 바로 그 이유가 무테스트인 셈이다. 페이지에는 단위 테스트도 없다.

세 축이 함께 비어 있다: ① `role='admin'` + `approval_status='pending_approval'` → 수정·사진 변경 버튼 0개 + 관리자 안내 노출, ② 마스터 계정의 페이지 레벨 분기, ③ `biz_required` 넛지 억제.

액션 레벨 게이트는 세 곳 모두 양쪽 축이 커버돼 있으므로(실제 권한 상승은 서버에서 막힌다) 이건 **어포던스 회귀** 위험이다 — 미승인 admin 이 버튼을 보고 눌렀다가 거부당하는 막다른 길. 닫는 법: 저 스펙에 `approval_status` 토글을 추가한다. (발견: /ship testing·coverage 리뷰 2026-07-30, v0.4.35.0 — Playwright 검증에 시드된 :5433 DB + 서버가 필요해 이번 컷에서는 미작성)

### admin-or-master 게이트가 네 곳에 손으로 복제됐다 (P3)
`isMasterEmail` 면제 + `getMembership`→`isApprovedAdmin` 조합이 네 곳에 같은 모양으로 적혀 있다: `app/api/workspace/[id]/avatar/route.ts` 의 `guardWrite`, `updateWorkspaceBizProfileAction`, `requestWorkspaceNameChangeAction`, 그리고 `settings/profile/page.tsx` 의 `canEditWorkspace`. 넷이 갈리면 권한 판정이 표면별로 달라진다 — 실제로 v0.4.34.0 이 옛 `renameWorkspaceAction` 의 마스터 면제를 빼먹어 v0.4.35.0 에서 따라잡았고, 그게 이 중복이 만드는 결함 모양이다.

닫는 법: `lib/auth/active-workspace.ts` 에 `isApprovedAdminOrMaster(userId, workspaceId, email)` 를 두고 네 호출처가 그것만 부른다. 권한 경계 네 곳을 동시에 건드리는 리팩터라 릴리스 컷에 섞지 않았다. (발견: /ship maintainability 리뷰 2026-07-30, v0.4.35.0)

### 설정 패널의 `ERROR_LABELS` 맵이 폼마다 따로 있다 (P4)
`WorkspaceLogoForm`·`WorkspaceBizNoForm`·`WorkspaceNameForm` 이 각자 `ERROR_LABELS` 를 들고 있고, `FORBIDDEN_NOT_ADMIN` 문구는 앞의 두 파일에 바이트 단위로 같은 문자열이 복제돼 있다. 조회 **판정**은 v0.4.35.0 에서 `lib/utils/error-label.ts` 단일 출처로 모았지만 **문구 맵** 자체는 아직 셋이다. `lib/quote/error-messages.ts` 가 이미 쓰는 모양(코드→한국어 단일 맵)을 설정 패널에도 적용하면 된다. (발견: /ship maintainability 리뷰 2026-07-30, v0.4.35.0)

### 에러코드 로스터 테스트가 신규 코드를 못 잡는다 (P4)
`WorkspaceLogoForm.test.tsx`·`WorkspaceBizNoForm.test.tsx` 의 "모든 서버 코드에 라벨이 있다" 테스트는 코드 목록과 라벨 맵을 **둘 다 손으로** 유지한다 — 라우트에 `fail(..., 'NEW_CODE')` 를 새로 추가해도 아무 테스트가 깨지지 않는다(기존 라벨을 **지울** 때만 잡힌다). 주석은 "새 코드가 생기면 아래 테스트가 깨진다"고 적혀 있어 보장을 과장한다. 닫는 법: 목록을 소스에서 파생시킨다(라우트를 읽어 `fail(status, CODE)` 리터럴을 모아 맵과 대조 — `lib/design/__tests__/_source-scan.ts` 가 이미 그 모양이다). GET 전용 `NOT_FOUND` 는 제외. (발견: /ship testing 리뷰 2026-07-30, v0.4.35.0)

### `text-size-token-drift` 가드가 줄 단위라 줄바꿈에 오탐한다 (P4)
`text-sm` + 명시 `leading-` 규칙이 **줄 단위**로 매칭돼서, prettier 가 감싼 `className` 이 `text-sm` 과 `leading-[inherit]` 을 다른 줄에 놓으면 정상 요소인데도 위반으로 잡는다. 오탐이 나면 가드가 삭제된다는 걸 이 파일 주석이 스스로 경고하고 있으므로 값이 있다. 닫는 법: 판정 창을 className 리터럴/JSX 요소 단위로 넓히거나, 최소한 실패 메시지에 "같은 줄" 제약을 적어 다음 사람이 규칙을 지우는 대신 줄을 정리하게 한다. (발견: /ship testing 리뷰 2026-07-30, v0.4.35.0 — confidence 5, 실오탐은 아직 없음)

### 랜딩 e2e 첫 테스트가 cold-compile 타임아웃에 노출됐다 (P3)
`e2e/landing-text-token-cascade.spec.ts:21` 의 `page.goto('/')` 가 이 스위트 전체에서 `/` 를 처음 방문하는 지점인데(랜딩은 demo-app + motion + scroll-pin 으로 가장 무겁다) 기본 30s 타임아웃으로 돈다. 같은 파일 뒤쪽 테스트는 저자가 **같은 이유로** 90s 로 올려 뒀다(`test.setTimeout(90_000)`, 주석: "dev 서버 cold-compile 이 기본 30s 를 넘길 수 있다"). CI 는 `reuseExistingServer: !process.env.CI` 라 항상 새 서버를 띄우므로 잠재 플레이크다. 닫는 법: `setTimeout` 을 describe 레벨로 올린다. (발견: /ship testing 리뷰 2026-07-30, v0.4.35.0)

### 잔여 소소한 커버리지 구멍 3건 (P4)
① `requirePgActor` 가 `email` 을 실어 보내는지 단언하는 테스트가 없다(`requireBuyerActor` 는 마스터 면제 테스트가 실경로로 덮는다). PG 표면에 마스터 면제 게이트가 생기면 이 축이 조용히 빈다. ② `SETTLE_LIMIT_MIN` 3소비처(위저드 게이트·`submitBidAction`·`saveQuoteTemplateAction`) 드리프트 가드가 없다 — 공유 import 라 눈에 보이긴 한다. ③ 랜딩 히어로 다크씬 `inverse-on-surface` 수정에 대비(contrast) 단언이 없다(시각 확인만). (발견: /ship coverage 감사 2026-07-30, v0.4.35.0)

### 운영 `workspace_logo_blobs` 에 레거시 비-PNG/JPEG 행이 있는지 확인 (P3)
v0.4.35.0 릴리스 컷에서 로고 GET 이 저장된 mime 을 그대로 `Content-Type` 으로 되울리던 것을 쓰기 허용목록(`ALLOWED_MIMES`)으로 좁혔다 — 허용목록 밖이면 `application/octet-stream` 으로 서빙한다. 앱 코드 쪽 축은 닫혔지만 **운영 DB 에 실제로 SVG 행이 남아 있는지는 git 만으로 확인할 수 없다.** 삭제된 `backfill-pg-logos.ts`(스크립트는 d067e858, package.json 엔트리는 v0.4.35.0 에서 제거)가 canonical PG 로고를 SVG 로 심었으므로, 그 백필이 운영에서 한 번이라도 돌았다면 행이 있다.

확인: `SELECT workspace_id, mime, octet_length(bytes) FROM workspace_logo_blobs WHERE mime NOT IN ('image/png','image/jpeg');` — 행이 나오면 해당 워크스페이스 로고는 지금 다운로드로 떨어진다(깨진 이미지). 그 경우 PNG 로 재인코딩해 다시 심거나 행을 지우고 워크스페이스에 재업로드를 안내한다. 행이 0 이면 이 항목을 닫는다. (발견: /ship security 전문가 리뷰 2026-07-30, v0.4.35.0 — 앱 축은 같은 PR 에서 해결)

### ~~설정 폼 에러 문구 조회가 프로토타입 체인 키를 흡수하지 않았다 (P4)~~ — 해결 (v0.4.35.0)
세 설정 폼(로고·이름·사업자번호)이 `ERROR_LABELS[code] ?? fallback` 으로 서버 코드를 문구로 바꿨는데, 객체 리터럴 조회라 `constructor`·`toString` 같은 프로토타입 체인 키가 오면 **함수**가 잡히고 `??` 가 발동하지 않았다 — "내부 enum 은 절대 노출하지 않는다"는 이 맵들의 존재 이유가 그 축에서 깨진다. 실도달 경로는 없었다(키는 항상 우리 `fail()`·`ActionResult` 의 닫힌 집합). `lib/utils/error-label.ts` 의 `errorLabel()` 단일 출처로 바꿨다 — `hasOwnProperty` 판정 + 비문자열 코드 가드. 세 폼이 같은 판정을 공유하므로 갈릴 수 없다. 변이 검증으로 비공허성 확인(평범 조회로 되돌리면 프로토타입 키 5축 + 반환타입 축이 전부 RED). (발견: /ship security 전문가 리뷰 2026-07-30, v0.4.35.0)

### ~~계정 탈퇴 Enter 제출 경로 무커버리지 (P3)~~ — 해결 (v0.4.23.0)
`DeleteAccountSection.tsx` 의 Enter 제출 경로에 테스트를 추가했다: 정상 Enter 제출, 빈 비밀번호 Enter 무제출, submitting 중 Enter 재진입 무중복. 커버리지를 붙이면서 빈 비밀번호 Enter 가 버튼 disabled 를 우회해 제출되던 실제 결함도 드러나 `handleSubmit` 초입에 `!password` 가드를 추가했다(버튼은 이미 막혀 있었지만 Enter 는 버튼을 안 거친다). (발견: /ship 적대 리뷰 2026-07-22, v0.4.9.1 · 해결 v0.4.23.0)

## Signing (선정 후 전자서명 / SnowSign)

### 딜룸 계약 카드의 조사 자동선택 미적용 — `'…계약서'(으)로` (P4)
`components/deal-room/signing/signing-view-model.ts:308` 이 `연결된 템플릿 '{이름}'(으)로 바로 보내거나…` 로 **`(으)로` 폴백을 하드코딩**한다. 이 레포의 한글 조사 단일 출처는 `es-hangul` 의 `josa()` 이고(CLAUDE.md 스택 표), 받침 없는 이름(`…계약서`)이면 `로` 가 맞다. 따옴표로 감싼 고유명사 뒤라 `(으)로` 를 의도적으로 두는 제품도 있어 **문구 판단이 필요**하다 — 자동 수정하지 않고 남긴다. 서식 이름은 PG 자유 입력이라 받침 유무가 갈린다. (발견: 계약서 기능 QA, 2026-08-25)

### ~~조항형 계약에는 서명 마감이 없다 — 아무도 취소하지 않으면 영영 열려 있다 (P2, 공급자 제약)~~ — 보상 통제 완료 (v0.4.57.0)

**공급자 제약 자체는 그대로다**(`deadline_days` 가 `POST /v1/contracts` 에서 201 로 수락된 뒤 조용히 무시된다 — S6 실측). 마감을 심을 수단이 없으므로 **흉내내지 않고**(거짓 약속 금지) 관측으로 덮었다: ① 딜룸 진행 카드가 마감 줄과 **같은 자리**에서 `보낸 지 N일째` 를 띄운다(둘은 상호배타 — 마감 있으면 템플릿 경로) ② 폴러가 30일(`STALE_SENT_AFTER_DAYS`, 템플릿 경로 마감과 **같은 상수에서 파생**) 넘게 열린 계약을 운영자 슬랙으로 알린다(재알림 7일). **자동 취소는 하지 않는다**(사용자 결정 2026-08-19 — 되돌릴 수 없고 상대가 막 서명하려는 순간과 경합한다). 스로틀 마커는 새 컬럼 `stale_notified_at` 이다 — `lastPolledAt` 은 폴러가 틱마다 전진시켜 못 쓰고, `lastRemindedAt` 은 겸용하면 운영자 알림이 사용자 리마인더 쿨다운을 잡아먹는다.

### ~~발송된 조항형 계약의 문서 스냅샷이 없다 (P2, 설계 의도와 코드가 어긋난다)~~ — 해결 (v0.5.3.0)

`signing_contracts.sent_document jsonb` 를 넣고 `markSentIfAwaiting` 이 `provider_ref`·출처와 **한 UPDATE 로** 쓴다(발송 성공과 스냅샷이 갈라지면 안 된다). 담는 것은 처방된 "해석된 문서"가 아니라 **`LayoutInput` 통째**(`SentContractSnapshot` = `{_v:1, doc, feeRows, parties}`)다 — 문서만으로는 재현이 안 되기 때문이다: `parties.company` 는 워크스페이스 이름이라 **나중에 바뀌고**, `feeRows` 는 재파생이 같은 코드 경로를 요구한다. 렌더 입력과 스냅샷은 **같은 객체**를 쓴다(따로 조립하면 "보낸 것과 다른 것이 보존되는" 조용한 실패가 생긴다). 처방대로 `SigningContract` 도메인 타입에는 얹지 않았고 읽기는 좁은 리더 `findSentDocument` 뿐이다. 덤으로 `markSentIfAwaiting` 의 compose 팔이 스냅샷을 **필수**로 받아 "발송했는데 무엇을 보냈는지 모르는" 행이 컴파일 타임에 표현 불가능해졌다(출처·판본을 한 UPDATE 로 묶은 규율과 같은 모양). ⚠️ 잔여: 이 컬럼을 **읽는 화면이 아직 없다**(인앱 열람은 아래 P3 그대로) — 지금 값은 증거 보존이다. 배포는 DDL 선행(`ALTER TABLE signing_contracts ADD COLUMN sent_document jsonb`).

<details><summary>원문 (해결 전 기록)</summary>

### 발송된 조항형 계약의 문서 스냅샷이 없다 (P2, 설계 의도와 코드가 어긋난다)
Stage 2 설계는 발송 시점에 **해석 완료된 문서 JSON 스냅샷**(`signing_contracts.sent_document`)을 남기기로 했고, "서식 버전 관리를 범위 밖으로 두는" 근거가 바로 그것이었다("나간 계약이 나중 편집에 흔들리지 않을 것 = 스냅샷이 이미 해결한다"). **그런데 그 컬럼은 구현되지 않았다**(`grep sent_document` 0건). 그래서 지금은: 서식을 수정하면 **이미 나간 계약이 무엇이었는지 확인할 길이 없다** — 공급자 다운로드는 `completed` 에서만 열리므로 진행 중·거절·(조항형은 도달 못 하지만)만료 상태에서는 원본이 어디에도 없다. 문서가 우리 DB 에 있다는 이 경로의 장점이 정작 **발송 시점 고정**에는 쓰이지 않는 셈이다. 닫는 법: `sent_document jsonb` 추가 + `commitSentContract` 이 해석된 문서를 같은 트랜잭션에 쓴다(발송 성공과 스냅샷이 갈라지면 안 된다). ⚠️ **`SigningContract` 도메인 타입에는 얹지 않는다** — 문서 전체가 딜룸 로드마다 페이로드를 타면 안 되고, 이 레포 규율은 좁은 전용 리더다(`findSigningTemplateId` 선례). (발견: 잔여 부채 정리 중 설계 대조, 2026-08-19)

</details>

### 조항형 계약의 공급자 수용 — **수용은 실측으로 확인, 조판 검증과 자동화가 남았다** (P3, 2026-08-25 부분 해결)
**수용은 닫혔다.** 2026-08-25 QA 에서 실 키로 조항형 계약 1건을 딜룸에서 끝까지 **발송**했다(`연결된 템플릿으로 보내기` → 렌더 → 업로드 → `POST /v1/contracts` → `sendContract`). 공급자가 우리가 만든 PDF 를 받았고 계약이 `pending` 에 도달했으며 참여자 둘 다 `identity_verification` 으로 기록됐다(본인인증 강제가 공급자 측에서 실제로 성립). 정리는 `취소` 로 했고 공급자도 `cancelled` 로 반영했다. 즉 **"공급자가 우리 PDF 를 거부한다"는 위험은 사라졌다.**

남은 것 셋: ① `/v1/uploads/{id}/diagnostics` 의 `page_count`·`warnings` 미확인 ② **서명칸이 좌표대로 앉았는지 육안 미확인**(서명 화면을 열지 않았다 — 레이아웃 엔진 좌표가 공급자 렌더와 맞는지는 여전히 미검증이고, 이게 남은 것 중 제일 중요하다) ③ 비대화형 스모크 미작성(위 절차를 손으로 했다). 닫는 법은 원안대로 `scripts/signing/snowsign-smoke.ts --compose` + `docs/SNOWSIGN_SANDBOX.md` C 계열 등재. (부분 해결: 2026-08-25 QA)

### 프로세스 `TZ` 가 어디에도 고정돼 있지 않다 (P3, 지금은 우연히 맞다)
`asIsoDate` 가 공급자의 오프셋 없는 타임스탬프를 UTC 로 확정하도록 고쳤지만(커밋 `fc3a2233`), 그건 **이 경계 하나**다. `ecosystem.config.cjs` 에도 `docker-compose.prod.yml` 에도 `TZ` 가 없어 정확성이 호스트 기본값(Lightsail = UTC)에 얹혀 있다. 다른 naive 날짜 문자열을 파싱하는 코드가 새로 생기면 같은 함정이 조용히 되살아난다. 닫는 법: PM2 `env` 에 `TZ: 'UTC'` 를 명시한다(운영이 이미 UTC 라 **동작 변화 0**이고, 의도를 코드에 적는 것이 목적이다).

⚠️ **소급 보정은 하지 않는다.** 고친 것은 새 쓰기뿐이고, 이미 저장된 행은 그대로다. 운영이 계속 UTC 였다면 오염된 행은 **없다**(파싱이 우연히 맞았다). 로컬/비UTC 환경에서 만들어진 행만 9시간 밀려 있고 그건 개발 데이터다. reconcile 은 상태가 바뀔 때만 쓰므로 재조회로 저절로 낫지도 않는다 — 운영에서 이상한 `보낸 지 N일째` 가 보이면 그때 해당 행만 공급자 값으로 다시 맞춘다. (발견: 2026-08-25 QA 에서 실 발송 후 "보낸 지 1일째" 로 드러남)

### 계약 보관함 — 착륙 리뷰 잔여 (P3/P4, v0.5.3.0)

9기 리뷰(전문 7 + 커버리지·계획 감사)에서 나온 것 중 **이번 컷에서 고치지 않은 것**. 고친 것은 커밋 이력에 있다.

**P3**
- **`status='failed'` 는 종결인데 재시도 경로가 없다.** `findPendingSigningGroups` 는 `pending` 만 고르고, `findCompletedContractsMissingArchive` 는 **보관함 행이 있으면**(failed 여도) 제외하므로 백필도 되살리지 못한다. `MAX_HYDRATE_ATTEMPTS=10` + 2분 폴러라 **~20분 공급자 장애가 그 창의 계약을 영구히 좌초**시키고, 30MB 초과 문서는 첫 시도에 결정적으로 좌초한다. 바이트는 공급자에 남아 있으니 손실은 아니지만 앱이 다시 가져오지 않는다. 닫는 법: cron 스텝이 N시간 지난 `failed` 를 `attempts=0` 으로 되돌리거나(상한 필요), 최소한 복구 UPDATE 를 런북에 적고 `archive.hydrate_failed_final` 에 알림을 건다.
- **목록에 상한이 없다.** `ARCHIVE_UPLOAD_CAP_PER_WORKSPACE`(200)는 `source='upload'` 만 센다 — 서명 출처 행은 완료 계약당 2행씩 **무제한**이고 `listByWorkspace` 에 `.limit()` 이 없다. 사업 속도로만 자라므로 급하지 않지만, 상한을 두거나(+ '최근 N건' 안내) 검색 해시택을 미리 계산·디바운스해야 하는 시점이 온다. (`search.ts` 의 근거 문구는 이번에 정정했다.)
- **R2 PUT 에 요청 타임아웃이 없다.** `getStorage()` 의 `S3Client` 에 `requestHandler` 타임아웃 설정이 없어 매달린 업로드를 끊을 수단이 없다. 이번 컷은 crontab 에 `--max-time 90` 을 넣어 **락이 영구히 물리는 증상**만 막았다(그게 실제 피해였다). 클라이언트 자체 타임아웃은 첨부 업로드까지 영향 범위가 넓고 실 R2 없이 값을 고를 수 없어 미룬다.
- **업로드 다이얼로그 폼이 박스형 프리미티브를 안 쓴다.** 손으로 만든 `<input>` 셋이 `outline-none` 으로 레포 기본 포커스 링을 없애고 `aria-invalid` 오류 스타일도 잃는다(DESIGN.md §7.1 은 다이얼로그 폼을 `components/ui/input.tsx` 박스형으로 지정). 필수 표시도 `aria-hidden` `*` 뿐이라 AT 에 안 들리고 `Field`/`RequiredMark` 프리미티브를 안 쓴다.
- **제출 버튼이 눌리는 순간 자기를 disabled 한다** — 포커스가 body 로 떨어져 같은 요소에 붙인 `aria-busy` 와 '올리는 중…' 이 스크린리더에 안 들린다. `ContractTemplateList.tsx:469` 가 같은 함정을 주석으로 기록해 두고 ref 가드로 푼 선례가 있다.

**P4**
- ~~`lib/contract-archive/upload-client.ts` 테스트 0 — 형제인 `lib/attachments/__tests__/upload-client.test.ts` 는 있다. presign 오류코드 전파(사용자 문구가 여기 의존)·PUT 실패·비-JSON 폴백이 미검증.~~ — 해결 (v0.7.0.0): 도메인 메타데이터 보존과 presign/PUT/complete 순서, 오류코드 전파, 비-JSON 폴백, PUT 실패 시 complete 미호출을 공통 runner와 archive adapter 테스트로 고정했다.
- C3(폐기 세션)·C4(이메일 미인증) 게이트 부인 테스트가 신규 3라우트 모두에 없다(mock 은 이미 깔려 있어 값싸다).
- `contractArchiveErrorMessage` 직접 테스트·드리프트 가드 없음 — 라우트의 `fail()` 코드 집합과 키가 갈려도 조용히 폴백 문구로 떨어진다.
- presign 의 `PRESIGN_FAILED` 고아 행 롤백·`INVALID_JSON` 미검증. 롤백이 회귀하면 실패한 presign 이 200 슬롯을 영구 소모한다.
- `hydratePending` 의 루프 안 `!providerRef` 경합 팔과 `fetchCapped` 의 `!res.ok` 팔 미검증. `HYDRATE_BUDGET_PER_RUN`·`BACKFILL_BUDGET_PER_RUN` 기본값도 미고정.
- `ContractArchiveList` 의 빈 상태·검색 0건·`failed` 칩·액션 throw 팔 미렌더. `getBreadcrumbSegments('/contracts')` 미검증.
- `ContractArchiveEntry.documentName`·`createdAt` 은 매핑되지만 소비자가 없다(YAGNI).
- ~~`uploadKey` 가 서비스에서 export 돼 presign 라우트가 서비스 모듈 전체를 끌어온다 — `lib/contract-archive/keys.ts` 로 옮기면 형제 `signingKeys` 와 한집이 된다.~~ — 해결 (v0.7.0.0): `archiveUploadKey`를 `lib/contract-archive/storage-key.ts`로 분리해 업로드 adapter와 테스트가 서비스 모듈 없이 공유한다.
- 대기 알림 이메일 블록이 두 호출부에 거의 동일하게 있다(제목·딜룸 URL 이 갈릴 수 있다).
- 7일 재넛지 테스트가 벽시계 의존(ms 충돌 시 dedupe UNIQUE 로 2건에서 멈춤). 실사용은 7일 스로틀이라 안전하지만 CI 에서 재현 불가한 빨강이 될 수 있다.

### 카카오 알림톡 채널이 미배선이다 — 이메일 반송의 유일한 대안 (P3, 실 API 키 필요)
공급자는 참여자별 `mobile_alimtalk_enabled` 를 받는데(`docs/SNOWSIGN_API.md:360`·`:528`) 우리는 보내지 않는다. 그래서 **서명 요청 이메일이 반송(`email_delivery='bounced'`)되면 대안이 없다** — 딜룸이 error 칩과 지속 경고를 띄우지만 그건 관측이지 전달이 아니다. 모두싸인은 같은 구간을 알림톡 + 앱 미설치 시 LMS 자동 fallback 으로 덮는다. 전제는 이미 있다: 템플릿·조항형 경로는 `resolveSecurityMethod`(010 만)로 **양측 phone 을 이미 검증**한다. **임베드 경로는 불가** — PG 가 iframe 안에서 수신자를 직접 타이핑하므로 우리가 참여자 페이로드를 못 만든다(강제 범위가 갈리는 것과 같은 경계다).

닫기 전에 실측이 필요하고, **그 실측이 이 항목의 진짜 비용이다**: ① `snowsign-smoke.ts` 에 알림톡 프로브가 없다(현재 `--template`/`--contract` 뿐) — 새로 써야 한다. ② 조직 카카오 채널 설정을 요구하는지 공급자 문서에 없다. ③ **201 이 성공의 증거가 아니다** — 이 레포엔 이미 선례가 둘 있다: `deadline_days` 는 201 로 수락된 뒤 조용히 무시됐고(S6), `signers[].security_method` 는 미문서인데 동작했다. 수락만 확인하면 "알림톡이 켜졌다"고 믿으면서 실제로는 아무것도 안 가는 상태가 되고, 그건 반송 대안이 있다는 **거짓 안심**이라 지금보다 나쁘다. 실제 전달을 가리려면 실 휴대폰으로 서명 요청을 보내야 한다(계약 1건 소모).

**보류 결정 (사용자, 2026-08-24)**: 사각지대의 앞 구간은 `signing.awaiting_template` 이메일이 이미 닫았고(v0.5.3.0), 알림톡은 반송 대안이라 생살여탈이 아니다. 실 발송 검증을 감수할 이유가 생길 때 다시 연다.

### ~~`sendComposedContract` 와 `sendFromTemplate` 의 커밋 절반이 중복이다 (P3)~~ — 해결 (v0.4.57.0)

`buildSentParticipants` + `commitSentContract` 로 뽑았다(참여자 행·발송 트랜잭션·커밋 후 emit/알림). `draft` 와 `auditMetadata` 만 파라미터로 갈린다. **catch/lost-race 블록과 초안 프로브 절은 합치지 않았다** — 동작이 실제로 다르다(템플릿은 리스를 반납하지 않고 조항형은 반납하며, 재사용 vs 프로브-후-폐기는 v0.4.52.0 출처·판본 게이트의 의도다). 리팩터 전에 compose 쪽 lost-race 안전망 3건을 먼저 깔았고(그 분기는 테스트가 0이었다), **테스트 파일을 한 줄도 고치지 않고** 217건이 통과하는 것으로 무변경을 증명했다. 곁들여 조항형의 일반 오류 로그가 `signing.` 접두어·`rfpCode`·`logger.error` 없이 새던 드리프트도 정렬했다.

<details><summary>원문 (해결 전 기록)</summary>

참여자 배열 구성, 발송 트랜잭션(`markSentIfAwaiting` + `insertParticipants` + 감사 + `notify` + `notifySigningOperator`), lost-race 보상 블록이 두 메서드에 거의 같은 모양으로 두 벌 있다 — 새 메서드의 ~345줄 중 ~110줄. **이미 한 번 갈라졌다**: 조항형 쪽 lost-race 분기에 `logger.error`·`captureSigningError` 가 빠져 있었고(v0.4.57.0 에서 메움), 그건 "로그가 없으면 계통적 CAS 패배가 조용한 토스트로만 퇴화한다"고 옆 주석이 경고한 바로 그 실패다. 닫는 법: `commitSentContract({active, rfp, actor, now, providerRef, sentAt, draft, source, auditMeta})` 하나로 뽑는다. ⚠️ **초안 프로브 절은 합치지 않는다** — 템플릿은 재사용하고 compose 는 프로브-후-폐기하며, 그 차이가 v0.4.52.0 출처·판본 게이트의 의도다. `createSendEmbedSession` 이 아직 v0.4.55.0 이전 리스 모양을 들고 있는 것(아래 P3)이 안 뽑은 형제 경로의 비용을 보여주는 이 레포의 선례다. (발견: 착륙 전 리뷰, v0.4.57.0)

</details>

### ~~조항형 문서 텍스트 순회가 세 곳에 흩어져 있다 (P3)~~ — 해결 (v0.4.57.0)

`lib/contract-doc/doc-text.ts` 하나로 모았다. **모양이 둘**이라는 것이 핵심이었고 타입으로 갈랐다: `contractDocTokenSources`(스캔 — 제목 포함 + `substituted` 플래그)와 `mapContractDocText`(치환 — 제목 제외). 세 번째 `collectDrawableText({doc, feeRows?, parties?})` 가 **PDF 에 그려지는 모든 텍스트**를 돌려주며, 경계를 `layoutContract` 의 입력과 같게 잡아 "그릴 것"과 "검사할 것"이 어긋날 수 없게 했다. 곁들여 **미리보기 라우트에 없던 글리프 검사**를 붙이고(저장은 막는데 미리보기는 빈칸으로 렌더하고 있었다), 테스트가 없던 `bizNo` 회귀도 채웠다.

<details><summary>원문 (해결 전 기록)</summary>

`ContractDoc` 의 텍스트 필드를 훑는 코드가 셋이다 — `variables.ts` 의 `tokenSources`(토큰 검사), `signing-template.ts` 의 저장 시 글리프 검사, `contract-signing.ts` 의 발송 시 글리프 검사(+ 수수료 표·사업자번호). 뒤 둘은 `flatMap` 표현이 축자 중복이다. v2 에서 텍스트 필드를 하나 더하면 세 파일을 고쳐야 하고, 하나를 빠뜨리면 **글리프 게이트나 토큰 게이트가 조용히 그 필드를 안 본다** — v0.4.57.0 이 고친 두 결함이 정확히 그 모양이었다(제목의 토큰 미검사, 수수료 표 라벨 미검사). 닫는 법: `lib/contract-doc` 에서 순회 하나를 export 하고 세 호출자가 파생하게 한다. (발견: 착륙 전 리뷰, v0.4.57.0)

</details>

### ~~조항형 에디터 미리보기에 요청 순서 가드가 없다 (P3)~~ — 해결 (v0.4.57.0)

`CommandPalette` 의 디바운스 effect 관례(effect 스코프 `cancelled` 플래그, cleanup 이 타이머와 플래그를 함께 처리)로 바꿨다 — 레포에 클라이언트 `AbortController` 사용처가 하나도 없어 abort 가 아니라 **stale-drop** 이 관례다. 취소된 늦은 응답은 자기가 만든 object URL 을 그 자리에서 회수한다(언마운트 누수도 같은 가드가 덮는다). **이 컴포넌트의 첫 테스트 파일**을 함께 만들었고, 픽스 전에는 늦게 도착한 요청이 최신 미리보기를 덮는 것을 RED 로 확인했다.

<details><summary>원문 (해결 전 기록)</summary>

`ClauseTemplateEditor` 의 `refreshPreview` 는 `AbortController` 도 단조 요청 id 도 없다. 느린 앞 요청이 뒤 요청보다 늦게 도착하면 **낡은 문서로 `previewUrl` 을 덮고 새 blob URL 을 revoke** 한다 — 사용자가 방금 친 것과 다른 미리보기를 본다. 이 기능이 내세우는 "본 대로 서명된다"를 정확히 깨는 축이고, 렌더가 수 MB PDF 라 지연 편차가 크다. 컴포넌트에 테스트 파일이 아직 없다(순수 리듀서만 있다) — 저장 실패 문구·400 본문 통과·언마운트 revoke 도 미검증. (발견: 착륙 전 리뷰, v0.4.57.0)
</details>

### remind 에 상태 게이트가 없고 실패 반납이 쿨다운을 되돌린다 — 공유 예산 증폭 (P2)
`remind` 는 ACL 통과 후 `providerRef` 존재만 보고 **계약 상태를 보지 않는다** — `cancel`/`resend` 는 `transitionIfActive` CAS 로 종결 계약에서 no-op 인데 `remind` 만 이 게이트가 없다. 종결 계약(completed/canceled/expired)에 remind → provider 400 `INVALID_CONTRACT_STATUS` → `REMIND_NOT_EXECUTED_CODES` 에 있어 `releaseRemindClaim` → 쿨다운 즉시 초기화 → 무한 반복. 인증 당사자 1인이 RTT 당 1회 ≈ 600 req/분으로 조직 공유 SnowSign 예산(100/분)을 상시 포화시켜 **전 워크스페이스**의 폴링·attach(`getContract`)·완료본 다운로드가 멈춘다(발송된 계약의 고아 확정 포함). `SNOWSIGN_RATE_LIMIT`(429)도 반납 집합에 있어 **예산이 포화된 바로 그 순간 쿨다운이 스스로 풀린다** — 백프레셔가 가장 필요할 때 꺼지는 설계. 선존재 완화: main 은 쿨다운 자체가 없어 동일 스팸이 오늘도 가능하고 v0.4.42.0 이 성공 경로를 1/24h 로 좁혔다 — 잔여는 실패 경로다. 닫는 법: ① `REMINDABLE = {sent, in_progress}` 게이트(cancel/resend 와 정렬, 미충족 시 공급자 호출 없이 반환) ② 429 를 반납 집합에서 제거. RED 먼저: completed 계약에 remind → `snowsign.remind` 미호출 + 에러 반환. (발견: 릴리스 컷 보안 감사 2026-08-05, v0.4.42.0)

### 리마인더 쿨다운이 자기잠김한다 — 연결 전 실패도 클레임 유지 + 해제 경로 전무 (P2)
`mapNetworkError`(`snowsign-client.ts`)가 연결 거부·DNS·TLS(요청이 **실행되지 않았음이 보장**되는 실패)와 timeout(진짜 모호)을 전부 `SNOWSIGN_NETWORK` 하나로 뭉개고, 이 코드는 `REMIND_NOT_EXECUTED_CODES` 에 없어 클레임이 유지된다 — 리마인더가 0통 나갔는데 화면은 "이미 전송됐을 수 있다"며 24h 잠긴다. `releaseRemindClaim` 호출자는 `remind` 내부 한 곳뿐 — admin·cron·UI 어디에도 해제 경로가 없다. 화면 축도 같은 뿌리: `last_reminded_at` 이 `rowToContract` 에 매핑되지 않아 클라가 쿨다운을 모른다 — 버튼이 늘 활성이고 눌러서 에러 토스트로 배운다. 닫는 법: fetch 가 응답을 받기 전에 reject 한 경우 전용 코드(`SNOWSIGN_UNREACHABLE`)로 갈라 반납 집합에 추가(timeout 은 `SNOWSIGN_NETWORK` 유지), 도메인 타입에 쿨다운을 노출해 버튼 비활성 + 남은 시간 표기. 위 P2(상태 게이트)와 반대 방향의 조정이지만 양립한다 — 연결 전 실패는 공급자 예산을 소모하지 않는다. (발견: 릴리스 컷 적대 리뷰 2026-08-05, v0.4.42.0)

### 수신자 불일치 지속 경고가 서명 진행 증거를 무시한다 (P3)
`signing-view-model.ts` 의 mismatch 술어가 `role === 'buyer'` 부재만 본다. `role` 은 바인딩 시 이메일 **정확일치**로 1회 결정되고 이후 불변(`SigningParticipantPatch` 에 `role` 없음)이라, 구매사 담당자가 별칭 주소(`y.buyer@` vs `buyer@`)로 수신해 이미 열람·서명한 계약에도 "확인하고 필요하면 취소해 주세요" 배너가 양측에 영구히 뜬다 — 반쯤 서명된 계약의 취소(=새 라운드 강제: PDF 재업로드 + 서명칸 재배치)를 종용한다. 템플릿 경로는 면역(`role:'buyer'` 하드코딩) — 임베드 경로 전용이고, 컷 전에는 1회성 토스트였다가 지속화되며 새 표면이 됐다. 닫는 법: 형제 술어 `isUndelivered` 처럼 참여자 하나라도 viewed/signed/rejected 에 도달하면 억제(메일이 사람에게 닿았다는 증거). (발견: 릴리스 컷 적대 리뷰 2026-08-05, v0.4.42.0)

### EditorChunkBoundary 가 모든 오류를 네트워크 탓으로 삼키고 Sentry 에 안 보낸다 (P3)
`ContractTemplateList.tsx` 의 바운더리가 `getDerivedStateFromError` 만 구현 — `componentDidCatch`/`captureException` 없음(이 바운더리가 대체한 `global-error.tsx`·`(app)/error.tsx` 는 둘 다 캡처한다). 에디터 내부 런타임 오류(null 역참조·pdf.js 렌더 throw)도 "네트워크를 확인한 뒤 새로고침" 문구 + 새로고침(배치한 서명칸 소실)이고 **Sentry 에는 아무것도 안 남아** 운영 에러율이 깨끗해 보인다 — PR#470 이 브라우저 QA 전무 산출물이라는 점에서 무게가 다르다. 닫는 법: `componentDidCatch` 에서 `Sentry.captureException` + `ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module` 패턴일 때만 네트워크 문구, 그 외는 일반 오류 문구. (발견: 릴리스 컷 적대 리뷰 2026-08-05, v0.4.42.0)

### in_progress 전이만 CAS 가드가 없다 — 종결을 역행 부활시킬 수 있다 (P3, 선존재)
종결 전이(declined/expired 등)는 전부 `transitionIfActive` CAS 인데 `in_progress` 만 무가드 `patchContract` 다. 웹훅 reconcile R1 이 행을 `sent` 로 읽고 provider 가 `in_progress` 회신, 동시에 폴링 R2 가 `completed` 로 종결 → R1 tx 가 늦게 커밋하면 `completed → in_progress` 역행, 폴링이 재개되고 다음 폴에서 완료 알림이 한 번 더 무장된다. v0.4.42.0 의 `expiresAt` 미러가 같은 무가드 patch 를 탄다(악화는 아님 — 새 리미터가 웹훅 재조회를 오히려 줄인다). 닫는 법: `WHERE status IN (active)` 로 같은 CAS 형태를 씌운다. (발견: 릴리스 컷 적대 리뷰 2026-08-05, v0.4.42.0)

### 시스템 발견 종결 전이가 특정 개인의 행위로 감사 기록된다 (P3)
`signing.declined`/`signing.expired`/`signing.canceled_by_provider` 는 폴링·웹훅이 **발견**한 사건인데 `actorUserId: rfp.createdBy`(구매사 담당자)로 기록된다 — `AuditLogPanel` 이 `actorName` 을 굵게 앞세워 "홍길동 · 전자서명이 거절됐어요"로 읽히고, 분쟁 시 구매사 담당자가 거절한 것처럼 오귀속된다(PG 서명자가 제3자로서 트리거 가능). 원인은 `audit_logs.actor_user_id` notNull 로 앵커가 강제되는 것. 같은 자리의 결손: 이 이벤트들이 buyer ws 에만 남아 **PG 활동 기록에는 자기 계약의 거절·만료가 없다**. 닫는 법(DDL 없이): metadata `actorKind:'system'` + 패널에서 그 경우 이름 대신 '시스템' 렌더(`metadata` 는 이미 projection 에 포함돼 클라 도달 확인됨), PG ws 병기 기록. (발견: 릴리스 컷 보안·적대 감사 2026-08-05, v0.4.42.0)

### ~~🚨 초안 재사용 경로가 본인인증을 우회한다 — `CONTRACT_TEMPLATES_ENABLED` 를 켜기 전 반드시 고칠 것 (P1)~~ — 해결 (v0.4.50.0)

재사용 판정을 `providerRef` **존재**에서 **양성 증명**으로 뒤집었다. `sendFromTemplate` 의 스테일-ref 블록이 이미 조회하던 `stale` 상세를 그대로 써서(추가 왕복 0회) 초안 자신의 참여자 정책을 확인한다 — `isDraftAuthEnforced`(fail-closed: 참여자가 둘 미만이거나 하나라도 `identity_verification` 이 아니면 미강제). 미강제 초안은 종결 ref 와 같은 방식으로 `providerRef` 를 지우고 새로 만든다(발송 전이라 메일도 쿼터도 안 썼고, 비용은 공급자 측 고아 초안 하나 — `:242` 가 이미 수용한 축이다).

원 항목이 다루지 않은 갈래를 하나 더 닫았다: **프로브 자체가 실패하면 보내지 않는다.** 이전에는 "판정 불가 → 기존 재사용 경로로 진행"이라 공급자 블립 한 번에 미강제 초안이 그대로 나갈 수 있었다 — 템플릿 정책 게이트의 `catch` 와 같은 fail-closed 로 맞췄다. 리스는 반납하고(안 하면 본인이 5분 self-lock) **`providerRef` 는 보존한다** — 일시 실패였는데 그 ref 가 실제로는 dispatched 였다면 지우는 순간 취소 핸들을 잃고 이미 나간 계약이 영구 고아가 되기 때문이다.

어휘가 이 수정의 최대 함정이었다: 계약 **참여자**는 `identity_verification`, 템플릿 **서명자**는 `easy_cert` 다(SANDBOX S4). `easy_cert` 로 비교하면 모든 재시도가 폐기·재생성으로 떨어져 초안 중복 방지 설계가 조용히 죽는다 — 리터럴을 `lib/signing/security-method.ts` 의 `PROVIDER_ENFORCED_SECURITY_METHOD` 로 SSOT 화하고, 재사용 **보존** 테스트를 가드로 뒀다(변이 검증으로 확인: `easy_cert` 로 바꾸면 그 테스트가 RED).

<details><summary>원 항목</summary>

**이것은 fail-open 이다.** `services/contract-signing.ts:858-884` 에서 phone/`easy_cert` 페이로드는 **`if (!providerRef)` 안에서만** 실린다. `active.providerRef` 가 이미 있으면 `createContractFromTemplate` 을 통째로 건너뛰고 곧장 `sendContract(providerRef)` 로 간다 — **phone 없이 만들어진(=공급자 기본 email 정책) 초안이 그대로 발송된다.** 그리고 `:895`/`:906` 이 무조건 `securityMethod: buyerSec.method`(= `'easy_cert'`)를 적는다. 결과: 계약은 이메일 링크로 서명 가능한데 딜룸·타임라인·참여자 행은 전부 본인인증을 했다고 주장한다. 정확히 `:826-829` 주석이 막겠다고 선언한 그 거짓말이다.

**새 게이트가 못 잡는 이유**: `:835-847` 는 **템플릿**의 `signers[].security_method` 를 본다. 이미 만들어진 **초안**의 참여자 정책은 생성 시점에 고정되고 이 검사에 보이지 않는다.

**스테일 정리가 못 잡는 이유**: `:785` 가 `draft` 를 **의도적으로 보존**한다(`else if (… !== 'draft')`) — 초안이 여러 개 쌓이는 것을 막는 원래 설계다.

**도달 경로는 평범한 재시도다.** `:881` 이 `sendContract` **전에** `providerRef` 를 기록하고 상태는 `markSentIfAwaiting` 에서야 뒤집힌다. 그래서 v0.4.46.0 **이전에** 그 두 줄 사이에서 죽은 발송(429·전송 오류·리스 CAS `ContractNoLongerAwaitingError`)은 정확히 재사용 가능한 상태를 남긴다 — `awaiting_pg_template` + phone 없는 `draft` `providerRef`.

**제품이 처방하는 복구가 곧 뇌관이다.** 그런 딜은 먼저 `TEMPLATE_AUTH_NOT_ENFORCED` 를 받고, 그 사용자 문구(`lib/signing/error-messages.ts`)는 *"계약서 템플릿에서 열어 다시 저장하면 보낼 수 있어요."* 다. 다시 저장하면 **템플릿**이 `easy_cert` 로 바뀌어 게이트를 통과하고, 그 다음 시도가 **옛 email 초안을 재사용해 발송**한다. reconcile 이 나중에 `securityMethod` 를 고쳐도 나간 계약을 되돌리지 못한다.

**오늘의 blast radius: 0** — 유일한 호출자인 딜룸 지름길이 `CONTRACT_TEMPLATES_ENABLED=false` 로 숨겨져 있다. 그래서 운영 장애가 아니라 **플래그를 켜는 순간 무장되는 구멍**이다. 킬 스위치 해제의 선행 조건으로 취급할 것.

**닫는 법**: 재사용 후보를 `providerRef` 존재만으로 판단하지 말고 **초안 자신의 참여자 정책**으로 판단한다 — 재조회한 `stale` 상세에 참여자 `phone`/`security_method` 가 없으면 `providerRef` 를 지우고 새로 만든다. `stale` 은 `:771-796` 에서 이미 조회하므로 추가 비용이 없다. (발견: v0.4.49.0 컷 적대 감사 2차 패스)

</details>

### `clearDraftRefIf` 에 리스 토큰 팔이 없다 — 심층방어 여지 (P4)
`markSentIfAwaiting` 은 `opts.claimedAt` 정확일치 CAS 를 선택적으로 받는데, 같은 diff 가 만든 `clearDraftRefIf` 는 id+ref+awaiting 만 본다. 프로브 왕복 중 리스를 강제 이어받긴 흐름이 새 소유자가 방금 재사용 검증한 초안 ref 를 지울 수 있다 — 다만 이중 발송은 `markSentIfAwaiting` 의 claimedAt CAS + 보상 취소가 백스톱하고, 문서화된 이어받기 수용 창 안이라 **취약점이 아니라 심층방어**다. 닫는 법: `clearDraftRefIf` 에 선택적 claimedAt 정확일치 조건을 미러링하고 네 호출부(리스 토큰을 `resolveStaleEmbedRef` 까지 배관)에서 전달. (발견: v0.4.55.0 컷 보안 스페셜리스트)

### 404 인 `provider_ref` 는 자가치유되지 않는다 — 딜이 영구 차단된다 (P4, 선존재)
`sendFromTemplate` 의 프로브가 `SNOWSIGN_NOT_FOUND`(404, `snowsign-client.ts:91`)를 받으면 "판정 불가"로 묶여 발송이 막히고 `provider_ref` 는 보존된다. 그런데 404 는 판정 불가가 아니라 **그 계약이 없다는 양성 증거**다 — 재시도마다 같은 404 라 딜이 영원히 갇힌다.

**선존재이며 v0.4.50.0 이 바꾸지 않았다**: 그 전에도 프로브 실패는 재사용 경로로 흘러 `sendContract(죽은ref)` 가 같은 404 를 받고 같은 코드로 실패했다. 결과·에러코드가 동일하다.

고치지 않은 이유: 404 에 ref 를 지우면 자가치유되지만, **읽기-쓰기 지연으로 인한 일시적 404** 가 실제로는 발송된 계약에 떨어졌을 때 취소 핸들을 영구히 잃는다(보존 규칙이 막으려는 바로 그 손해). 쓰레기 ref 가 실제로 생긴 사례는 관측된 적이 없고, 틀렸을 때의 비용은 서명된 실계약을 손댈 수 없게 되는 것이라 추측으로 바꾸지 않는다. 닫으려면 "발송된 적 없음"을 404 와 독립적으로 알 수 있어야 한다(초안 생성 시각·로컬 sent 기록 등). (발견: v0.4.50.0 컷 적대 리뷰)

### ~~재사용된 초안은 옛 템플릿 판본의 PDF 를 나른다 (P3)~~ — 해결 (v0.4.52.0, 등재 정리는 v0.4.55.0)

초안 출처·판본 게이트(아래 P2 ① 해결분)가 정확히 이 축을 닫았다 — `bindDraftRef` 가 초안 생성 시 판본을 기록하고, 재사용은 `origin === 'template' AND 기록된 판본 == 지금 연결된 템플릿` 을 요구한다. 아래 원문의 "판정 근거가 없다(`snowsign_template_id` 가 신규 발송 경로에서 안 채워진다)"는 그 릴리스 이후 사실이 아니다. 취소선 처리가 누락돼 있던 것을 v0.4.55.0 컷에서 정리.

<details><summary>원 항목</summary>
템플릿 **수정**은 새 `POST /v1/templates` 로 재생성한 뒤 링크 행의 `snowsignTemplateId` 를 in-place 교체한다 — "수정하면 그 템플릿을 골라 둔 기존 견적의 발송에도 새 판이 쓰인다"가 그 설계의 목적이다. 그런데 `sendFromTemplate` 이 **이미 만들어진 초안**을 재사용하면(재시도 경로) 그 초안은 **생성 시점 템플릿 판본**의 PDF·서명칸을 그대로 들고 있다. 즉 "수정 후 발송"이 조용히 옛 판본을 보낸다.

v0.4.50.0 의 본인인증 게이트는 이 축을 닫지 않는다 — 옛 판본도 `identity_verification` 이면 강제는 성립하므로 통과한다(정책은 맞고 **문서가 틀린** 상태). 판정 근거가 없는 것이 문제다: `signing_contracts.snowsign_template_id` 는 템플릿 시절의 이력 컬럼이라 신규 발송 경로에서 채워지지 않아 대조할 값 자체가 없다.

닫는 법: 초안을 만들 때 그 `snowsignTemplateId` 를 행에 기록하고, 재사용 전에 현재 `template.snowsignTemplateId` 와 다르면 본인인증 게이트와 같은 방식으로 `providerRef` 를 버리고 새로 만든다. 실 위험은 발송 전 초안에 한정되고(빈도 낮음) 방향도 "옛 계약서를 보냄"이라 fail-open 은 아니지만, 수정 기능의 약속을 어기는 침묵이다. (발견: v0.4.50.0 P1 수정 중)

</details>

### 다른 담당자가 재시도하면 초안을 재사용해도 참여자 행이 실제 수신자와 갈린다 (P3, 선존재)
`sendFromTemplate` 은 초안을 재사용하든 새로 만들든 참여자 행을 **항상 지금의 연락처**로 적는다 — `:853` 이 `findContactById(actor.userId)` 로 PG 담당자를 뽑고 `:955` 가 그 이메일을 `insertParticipants` 에 싣는데, `:912` 의 `if (!providerRef)` 는 create 만 건너뛰지 이 기록은 건너뛰지 않는다. 공급자 쪽 참여자는 **초안을 만든 시점**에 고정돼 있으므로, 동료 A 가 만든 초안을 동료 B 가 재시도로 재사용하면 **서명 요청 메일은 A 에게 가고 우리 행에는 B 가 적힌다.**

조용한 이유는 reconcile 이 **이메일로 매칭**하기 때문이다(`:1875` `lp.email.toLowerCase() === pp.email.toLowerCase()`). A 의 참여자에 대응하는 로컬 행이 없어 매칭이 실패하고, A 가 실제로 서명해도 그 서명이 어떤 행에도 반영되지 않는다 — 딜룸 타임라인은 PG 를 영원히 `pending` 으로 보여준다. 계약 **수준** 상태는 정상 반영되므로(`ensureFinalized`) 완료 자체가 막히지는 않고, 같은 담당자가 재시도하면 이메일이 같아 증상이 없다.

**선존재이며 v0.4.50.0 이 만들지 않았다** — 재사용 경로는 처음부터 로컬 연락처를 적었다. 오히려 이번 게이트가 미강제 초안을 폐기·재생성시키므로 노출은 줄었다.

닫는 법: 재사용 분기에서는 로컬 연락처 대신 프로브로 이미 받아 둔 `stale.participants` 를 미러링한다(`bindDispatchedContract` 이 쓰는 바로 그 매핑 — 두 번째 매퍼를 만들 필요가 없다). 또는 초안 참여자 이메일이 현재 담당자와 다르면 본인인증 게이트와 같은 방식으로 버리고 새로 만든다. (발견: v0.4.50.0 dev→main 컷 감사)

### 정책 게이트의 유일한 키가 한글 문자열 정확일치다 — 불일치 시 재저장으로도 못 푸는 데드락 (P3)
`contract-signing.ts:839` 의 `SIGNING_ROLE_LABELS.every((role) => enforcedRoles.has(role))` 는 공급자가 돌려준 `role_name` 과 `['구매사','PG사']`(`template-fields.ts:32`)를 한글 `Set.has` 로 정확 비교한다. 공급자가 쓰기·읽기 어디서든 정규화(NFC↔NFD, 공백 트림)를 하면 **모든 템플릿이 불일치**하고, 재저장은 같은 리터럴을 같은 정규화로 다시 쓰므로 처방된 복구(`다시 저장하면 보낼 수 있어요`)가 **영원히 안 풀린다**. fail-closed 라 보안 구멍은 아니지만 잘못된 안내가 붙은 영구 차단이다. 양쪽 NFC 정규화 비교면 이 부류가 사라진다. (발견: v0.4.49.0 컷 적대 감사 2차 패스)

### ~~`getTemplate` 이 미검증 공급자 필드를 하드 요구한다 — 킬 스위치 재활성화 시점의 시한폭탄 (P2)~~ — 해결 (v0.4.55.0)

`signers[].role_name` 을 관대 파싱으로 전환 — 없거나 빈 signer 는 **스킵**한다. 스킵은 역할 집합을 줄이는 방향뿐이라 발송 전 정책 게이트(`SIGNING_ROLE_LABELS.every`)가 자동으로 미강제(`TEMPLATE_AUTH_NOT_ENFORCED`)로 읽어 fail-closed 가 유지된다. `signature_fields` 의 `role_name` 하드 파싱은 유지 — 에디터 매핑의 load-bearing 데이터라 조용히 스킵하면 수정 저장이 그 필드를 소실시킨다. **읽기측 `role_name` 실존은 v0.4.56.0 재활성화 QA 에서 실측 확정** — 원시 `GET /v1/templates/{id}` 가 `signers[].role_name` 을 우리 라벨 그대로 회신한다(`docs/SNOWSIGN_SANDBOX.md` "읽기측 signers[].role_name 실측" 절). 관대 파싱은 살아있는 우회가 아니라 심층방어로 남는다.

<details><summary>원 항목</summary>

`snowsign-client.ts:768` 이 `signers[].role_name` 을 `reqString` 으로 파싱해 없거나 빈 값이면 `SNOWSIGN_MALFORMED` 를 던진다. #492 이전에는 `getTemplate` 이 `signers` 를 아예 건드리지 않았으므로, 관대했던 읽기 경로에 **새로운 하드 실패 모드**가 생겼다.

읽기 측 `role_name` 존재 근거가 약하다 — `docs/SNOWSIGN_SANDBOX.md` S5 는 `security_method` 되읽기만 기록하고, 그 줄을 만든 스모크 스크립트는 `${s.role_name ?? '?'}` 로 찍는다(`snowsign-smoke.ts:1156`). **키가 없었어도 `?` 를 찍고 통과했을 출력**이라 존재가 그럴듯할 뿐 입증되지 않았다. 게다가 이 코드베이스는 쓰기 `role` ↔ 읽기 `role_name` 비대칭을 이미 문서화하고 있어 정확히 이 함정의 사정권이다.

키가 없거나 이름이 `role` 이면: `getDetail` → `translateProviderError` 로 템플릿 **수정**이 죽고(`services/signing-template.ts:184`), `sendFromTemplate` 의 정책 확인이 catch 로 떨어져 **발송도 전부 막힌다**. 지금은 `CONTRACT_TEMPLATES_ENABLED=false` 라 두 표면이 다 숨겨져 있어 **운영 장애가 아니라 재활성화 시점의 시한폭탄**이고, 방향은 fail-closed 라 안전하다. 관대하게 파싱하거나(호출부 `contract-signing.ts:836` 이 이미 정확일치로 fail-closed 하므로 클라이언트가 엄격할 필요가 없다) 플래그를 켜기 전에 샌드박스로 재실측할 것. (발견: v0.4.49.0 컷 적대 감사)

</details>

### `easy_cert` 리터럴이 4곳에 흩어져 있다 — SSOT 위반 (P3)
**부분 해결 (v0.4.50.0)**: 짝이 되는 **계약 참여자** 어휘(`identity_verification`)는 `security-method.ts` 의 `PROVIDER_ENFORCED_SECURITY_METHOD` 로 SSOT 화했다(그쪽이 더 위험했다 — 두 어휘를 혼동하면 판정이 통째로 뒤집힌다). 아래 `easy_cert` 축은 그대로 남아 있다.

`security-method.ts:29`·`:45`, `snowsign-client.ts:671`(모든 템플릿 역할에 심는 자리), `contract-signing.ts:837`(발송 전 정책 검사), `snowsign-smoke.ts:1133`. 클라이언트 주석은 "여기가 강제를 심는 유일한 자리"라고 적었는데 **같은 diff 안에서 이미 사실이 아니다**. 이 레포는 도메인 어휘를 배열/상수 하나에 두는 규약이므로 `SIGNING_SECURITY_METHOD` 를 `lib/signing/security-method.ts` 에서 export 해 네 곳이 역참조해야 한다. (발견: v0.4.49.0 컷 감사)

### `EXTERNAL_SYSTEM` 을 만든 diff 가 같은 값의 생 리터럴을 새로 추가했다 (P4)
`snowsign-client.ts` 의 `EXTERNAL_SYSTEM` docstring 이 "두 리터럴로 두면 공급자측 로그에서 같은 시스템이 둘로 보인다"고 적어 놓고, 같은 diff 가 `snowsign-smoke.ts:1018` 에 생 `'supporter-b'` 를 새로 넣었다(선존재 리터럴이 `:171` 에도 있다). 스모크 스크립트는 이미 `lib/signing/template-fields` 를 임포트하므로 상수 도달 가능. (발견: v0.4.49.0 컷 감사)

### ~~`providerSecurity` 는 태어나자마자 죽은 코드다 (P4)~~ — 전제 무효 (v0.4.51.0)

**지우면 안 된다.** 이 항목은 "`snowsign-client.ts` 는 create-contract 에 보안 블록을 보내지 않는다"를 근거로 삼았는데, v0.4.51.0 의 `createContract` 가 정확히 그 블록을 보낸다(`security: { method: PROVIDER_ENFORCED_SECURITY_METHOD }`, 참여자별). 리터럴 상수는 이제 그 seam 이 역참조하는 SSOT 다.

남은 사실은 좁아졌다: **`resolveSecurityMethod` 의 `providerSecurity` 객체 필드**는 **프로덕션** 소비자가 0이다(`createContract` 가 리터럴 상수를 직접 심고, 정책을 호출자 옵션으로 받지 않기 때문이다 — `createTemplate` 과 같은 규율). 단 상수와 `security` 블록 전송은 **살아 있는 코드**이므로 함께 지우지 말 것. (전제 무효화: v0.4.51.0 적대 리뷰)

⚠️ **"아무도 안 읽는다"는 틀렸다** — `snowsign-smoke.ts:1046` 이 `d.providerSecurity` 를 읽어 실측 페이로드를 만든다(하네스가 손으로 만든 payload 를 재지 않고 프로덕션 판정 함수를 쓰는 것이 그 파일의 규율이라 의도적이다). 지우려면 스모크 하네스를 같이 고쳐야 하고, 고치면 하네스가 프로덕션과 다른 payload 를 재게 된다 — 정리의 값이 그만큼 낮다. tsc 가 잡아 주므로 조용히 깨지지는 않는다. (정정: v0.4.51.0 컷 감사)

### ~~자체 발송 경로는 강등, 템플릿 경로는 차단 — 두 정책이 한 딜룸에 공존한다 (P2, Stage 2 착륙 전 결론 필요)~~ — 해결 (v0.4.57.0)

**결론: 공존시키지 않는다 — compose 도 차단한다** (사용자 결정 2026-08-17, 2026-08-08 의 "강등" 결정을 뒤집음). `sendComposedContract` 가 템플릿 경로와 **같은 정책**으로 양측 `resolveSecurityMethod` 를 검증하고 `PG_PHONE_REQUIRED`/`BUYER_PHONE_REQUIRED` 로 막는다. 뒤집은 근거 셋: ① 강등 팔에는 저장할 method 값이 없어 서비스가 `signing_participants` 행 값을 **지어내야** 한다 — v0.4.46.0·v0.4.50.0 을 깨뜨린 fail-open 이 정확히 그 모양이었다. ② 한 딜룸에 보안 수준이 다른 발송 버튼 둘이 공존하면 게이트가 **선택지**가 된다(막힌 PG 가 서식 종류만 바꿔 우회). ③ "차단은 데드엔드"라는 원래 근거가 약해졌다 — 현행 문구가 임베드 경로를 탈출구로 안내하고, 설정 > 프로필에 번호 입력 화면도 생겼다. 아래 ③(같은 딜룸 두 버튼의 정책 차이)은 정책이 하나가 되어 소멸했고, ②(강등 초안 고아)도 강등이 없어 소멸했다. `security-method.ts` 의 반대 서술을 이 결론으로 교체했다 — 그 파일이 자칭 단일 출처라 거짓 서술의 손해가 가장 큰 자리였다.

<details><summary>원문 (해결 전 기록)</summary>

v0.4.51.0 의 `createContract` 타입 주석은 "010 번호가 있으면 본인인증, 없으면 이메일로 **강등**"을 선언한다(사용자 결정, 2026-08-08). 그런데 레포의 다른 모든 기록은 반대다 — `security-method.ts` 의 "강등하지 않고 발송을 차단한다", 위 Signing 절, CLAUDE.md. C6 이 측정한 것은 **공급자가 혼합 목록을 받는다**는 것이고, 그건 제품 결정이 아니다.

지금은 소비자가 0이라 무해하지만 Stage 2 가 배선하는 순간 세 가지가 걸린다: ① `isDraftAuthEnforced`(`contract-signing.ts:223`)는 참여자 **전원** `identity_verification` 을 요구하므로 **의도적으로 강등된 compose 초안이 본인인증 도입 전 레거시 초안과 구별되지 않는다** — "게이트가 정상 초안을 계속 버린다"고 판단한 사람이 게이트를 느슨하게 만들 수 있다(v0.4.50.0 이 막은 바로 그 fail-open). ② create 와 send 사이 크래시가 강등 초안을 남기면 재사용 프로브가 버리고 새로 만들어 공급자 측 고아가 하나씩 쌓인다(삭제 API 없음). ③ 같은 딜룸에서 템플릿 버튼은 `BUYER_PHONE_REQUIRED` 로 막고 compose 버튼은 조용히 강등한다 — 사용자에게 구분이 없다.

닫는 법: Stage 2 에서 compose 전용 초안 판정을 `isDraftAuthEnforced` 와 분리하고(강등이 정상인 경로임을 술어가 알아야 한다), 화면이 참여자별 인증수단을 발송 **전에** 보여주고, CLAUDE.md·THREAT_MODEL 에 두 정책의 공존을 명문화한다. (발견: v0.4.51.0 적대 리뷰)

**~~①~~ 해결 (v0.4.52.0) — 술어를 분리하는 대신 compose 초안이 그 술어에 *도달하지 않게* 했다.** 재사용이 이제 `origin === 'template' AND 판본 일치` 를 요구하므로 compose 초안은 출처에서 걸러지고 `isDraftAuthEnforced` 는 의미가 그대로다(느슨하게 만들 압력 자체가 사라진다). 같은 게이트가 **P2 원문에 없던 축**도 닫았다: 템플릿 수정이 판을 in-place 로 갈아치우므로 compose 없이도 옛 판 초안이 발송될 수 있었다. 근거·변이 검증은 THREAT_MODEL §3.2 "초안 출처·판본 게이트".
</details>

**~~③~~ 부분 해결 (v0.4.52.0)** — 발송 전 참여자별 인증수단 표시는 **데이터가 없어** Stage 2 로 간다: `persistAwaiting`(`contract-signing.ts`)이 참여자 **0명**으로 계약을 만들고 참여자 행은 발송 트랜잭션에서야 생긴다. 뷰모델에 넘길 입력이 없다. Stage 2 가 서버에서 참여자를 만들 때 손에 쥐는 `SigningSecurityDecision[]` 이 유일한 안정적 앵커다. **UX 결정은 확정**: 강등이 하나라도 있을 때만 확인 다이얼로그, 문구는 누가 무엇을 해야 하는지로 끝낸다(`설정 > 프로필에서 등록할 수 있어요`).

**②는 그대로 남는다** — create/send 사이 크래시가 남긴 강등 초안은 여전히 프로브가 버린다(고아 누적). Stage 2 가 결론낼 것.

### `createSendEmbedSession` 이 리스 **이전** 스냅샷으로 판정한다 (P3)
`sendFromTemplate` 과 같은 모양이었고 그쪽만 고쳤다(행을 읽고 → 리스를 잡고 → 읽은 값으로 판정). 임베드 진입도 `active` 를 리스 전에 읽어, 그 사이 다른 경로가 ref 를 쥐면 낡은 값으로 `resolveStaleEmbedRef` 판정이 돈다. 같은 처방(리스 획득 후 재조회)을 적용할 것. 이 PR 에서 함께 고치지 않은 것은 리뷰 크기를 지키기 위함이다. (발견: 초안 출처 게이트 적대 설계 리뷰)

**v0.4.55.0 적대 리뷰 보강 — 파괴 축은 닫혔고 스킵 축이 남았다.** clear CAS 도입으로 "낡은 판정이 발송된 계약의 ref 를 지우는" 축은 CONTRACT_BUSY 로 물러나게 됐지만, 스냅샷의 `providerRef === undefined` 가 DB 의 실제 ref 를 가리면 `resolveStaleEmbedRef` 자체를 **건너뛴다** — 이어지는 attach 의 `markSentIfAwaiting` 은 WHERE 에 `provider_ref IS NULL` 가드가 없어 기존 초안 ref 를 조용히 덮어쓴다(공급자 측 고아 초안, 극단적으로는 dispatched-인데-awaiting 인 H3 케이스에서 유일한 취소 핸들 소실). 창은 SQL 한 문장 폭. 처방은 동일(리스 획득 후 재조회)이고 이 비대칭(sendFromTemplate 은 리스 후 재조회, 임베드는 아님)이 다음 구멍이다.

### ~~`sendFromTemplate` 이 템플릿 판본만 리스 **이전** 스냅샷으로 게이트한다 (P3)~~ — 해결 (v0.4.56.0)

재사용 게이트 직전에 템플릿을 재조회하고 이후(정책 게이트·create·draft 기록)가 전부 그 재조회본을 쓰도록 갈아끼웠다 — 함수 진입 스냅샷으로 비교하던 창(리스 획득 + 프로브 왕복)이 닫혔다. **잔여(선존재 부류)**: 재조회와 create 사이(정책 게이트의 provider 왕복 동안)에 커밋된 수정은 여전히 직전 판으로 create 한다 — 다만 `bindDraftRef` 가 그 판본을 정직하게 기록하므로 다음 재시도의 판본 게이트가 잡고, 그 창에 발송까지 완주한 1회는 나갈 수 있다(공급자에 판본 CAS 가 없어 0 으로 만들 수 없는 축). 적대 리뷰 권고대로 킬 스위치 재활성화와 같은 PR 로 착륙.

<details><summary>원 항목</summary>
계약 행(`active`)은 리스 뒤 `findById` 로 재조회하는데, 게이트가 비교하는 `template.snowsignTemplateId`(`templateRepo.findById`, `contract-signing.ts:740-742`)는 리스보다 먼저 함수 진입 시 한 번만 읽고 재조회하지 않는다. 원래 닫은 축(발송 실패 → 템플릿 수정 → **재시도**)은 재시도마다 함수를 새로 호출해 판본을 다시 읽으므로 그대로 닫혀 있다 — 이 항목이 **좁히는 것이지 재여는 것은 아니다**. 다만 **같은 호출 안에서** 템플릿 수정이 끼어드는 창(리스 획득 + 계약 재조회 + 공급자 프로브 왕복 동안)은 남는다 — 그 창에 걸리면 게이트가 낡은 판본과 비교해 옛 PDF·서명칸 초안을 통과시킬 수 있다. 닫는 법: 템플릿 조회를 리스 획득 뒤 계약 재조회(:779) 아래로 옮겨 계약 행과 같은 취급을 준다. THREAT_MODEL.md §3.2 의 "판정은 리스 획득 뒤 재조회한 상태로 한다" 문장은 계약 행에 한정해 정정했다. (발견: dev→main 컷 감사 — pre-landing checklist) **v0.4.55.0 적대 리뷰 권고: 킬 스위치 재활성화(PR B)와 같이 또는 그보다 먼저 착륙할 것** — 이 창이 열어 주는 결과(옛 판 PDF 발송)가 정확히 이 하드닝 브랜치가 막으려는 부류라, 플래그가 켜져 실사용이 시작되는 순간부터 살아 있는 창이 된다.

</details>

### ~~`bindDraftRef` 의 compose 분기가 옛 `snowsignTemplateId` 를 지우지 않는다 (P4, 오늘 폭발반경 0)~~ — 해결 (v0.4.57.0)

처방대로 `snowsignTemplateId: draft.origin === 'template' ? draft.snowsignTemplateId : null` 로 **없음을 명시적으로 쓴다** — compose 를 배선하기 전에 고쳤다.

템플릿 출처로 바인딩됐던 행(`snowsignTemplateId` 채워짐)이 이후 compose 초안으로 재바인딩되면(:388-390) SET 절에 `snowsignTemplateId` 가 아예 없어 옛 값이 DB 에 그대로 남는다. 게이트는 무해하다 — `findDraftRef` 가 `origin === 'compose'` 면 `snowsignTemplateId` 를 애초에 응답에 담지 않는다(:417) — 그리고 오늘은 compose 호출자가 0이라 이 상태에 도달할 경로가 없다. 다만 `bindDraftRef` 옆 주석("반쪽이 표현 불가능해야 한다")은 **타입 레벨**에서만 참이고 DB 로우는 그 불변식을 실제로 강제하지 않는다 — Stage 2 가 compose 를 배선하기 전에 `snowsignTemplateId: draft.origin === 'template' ? draft.snowsignTemplateId : null` 로 명시적으로 지우도록 고칠 것. (발견: dev→main 컷 감사 — pre-landing checklist)

### ~~`sendFromTemplate`/`resolveStaleEmbedRef` 의 ref-clear 가 CAS 없이 블라인드 쓰기다 — **서명 완료된 계약을 영구 조정불가로 만들 수 있다** (P2, 컷 감사 다중 적발 + 재확인 후 상향)~~ — 해결 (v0.4.55.0)

네 clear 지점(터미널·출처판본 불일치·인증 미강제·`resolveStaleEmbedRef`) 전부를 리포 신설 `clearDraftRefIf` 로 전환했다 — `WHERE id AND provider_ref = 기대값 AND status='awaiting_pg_template'` CAS 로, 여기 제안됐던 중간 완화(status 조건만)를 넘어 **기대 ref 정확일치**까지 요구한다(`bindDraftRef` 의 역연산 — 쓰기와 지우기가 같은 규율). clear 는 출처·판본을 **같은 UPDATE** 로 지우고, 실패는 `CONTRACT_BUSY` 로 물러난다. `SigningContractPatch` 의 `providerRef` 팔은 삭제 — clear 가 컴파일 타임에 단일 경로다. 킬샷 시나리오(프로브 왕복 중 attach 가 바인딩한 발송 계약의 ref 를 지워 "sent + provider_ref NULL" 행 생성)는 sendFromTemplate·createSendEmbedSession 양쪽 회귀 테스트로 고정했고, 변이 검증(WHERE ref 제거 / WHERE status 제거)이 각각 다른 테스트를 RED 로 만든다. 아래 배포 전 카운트 쿼리는 정직성 체크로 유지 — 이제 레거시 행이 걸려도 파괴가 아니라 `CONTRACT_BUSY` 다.

<details><summary>원 항목</summary>

`contract-signing.ts`의 세 clear 분기(터미널 ref :847, 출처·판본 불일치 :875 — 이 릴리스 신규, 인증 미강제 :889)와 `resolveStaleEmbedRef`(:1234, 선존재)가 전부 `patchContract(active.id, { providerRef: null })` 를 **id 만으로** 건다 — `patchContract`(리포지토리)의 WHERE 는 `id` 뿐, `provider_ref` 현재값도 `status` 도 안 본다.

**재확인 후 상향(adversarial) — 침입자·이어받기 없이, 평범한 경합만으로 성립하고, 결과는 "고아"보다 나쁘다.** `attachProviderContract`(임베드 postMessage 완료 경로)는 **리스를 아예 요구하지 않는다**(`claimForSend` 호출 없음) — `markSentIfAwaiting` 호출에 `claimedAt` 을 안 넘겨 리스 CAS 도 안 걸린다. 그리고 이 바인딩은 `provider_draft_origin` 을 전혀 찍지 않는다. 시나리오: A(`sendFromTemplate`)가 `getContract` 프로브를 기다리는 동안(계약 행은 아직 `awaiting_pg_template`), B(평범한 임베드 완료 — postMessage, 별도 행위자·별도 탭 불필요)가 `attachProviderContract` 로 **같은 행**에 실제 발송된 provider 계약 Y 를 바인딩한다: `provider_ref=Y`, `status='sent'`, `origin=NULL`(안 찍힘). A 가 재개해 게이트(`findDraftRef`)를 읽으면 `origin=NULL` → `undefined` → fail-closed → **불일치 분기로 떨어진다** → `patchContract({providerRef:null})` 가 상태를 안 보고 그대로 Y 를 지운다. 결과: `status='sent'`, `provider_ref=NULL` 인 행 — `reconcileStatus`(:1944)는 `!contract.providerRef` 에서 즉시 반환하므로 **재조정이 영구히 멈춘다**(양측이 실제로 서명을 마쳐도 로컬은 영원히 `sent` 에 머무른다). `findPollable` 은 계속 이 행을 골라 매번 no-op, 취소는 핸들이 없고, 복구 다이얼로그는 `awaiting` 상태 전용 화면이라 이 행에 도달조차 못 한다 — 수동 DB 개입 외에 되돌릴 길이 없다. **PR 델타 관점**: 이 릴리스 이전엔 이 분기 자체가 없었다(`isDraftAuthEnforced` 하나만 보고 통과·재사용했다) — 새 게이트가 DB 를 다시 읽는다는 사실 자체가, attach 가 origin 을 안 찍는 것과 만나 **매번** 불일치로 떨어지게 만든다. 즉 새 게이트는 이 취약 프리미티브를 그대로 물려받은 정도가 아니라 **그 분기를 타는 빈도를 실질적으로 높인다.**

**오늘의 폭발반경 — 875(신규)는 플래그가, 1234(선존재, `resolveStaleEmbedRef`)는 다른 불변식이 막는다.** `sendFromTemplate` 의 유일한 UI 진입점(`SigningTab`/`signing-view-model.ts` 의 `linked`)은 `PgDealRoomBody.tsx` 의 `CONTRACT_TEMPLATES_ENABLED && awardedToMe` 로 게이트돼 있고, 플래그가 `false` 라 오늘은 그 버튼이 렌더되지 않는다(직접 확인, 서비스 레이어 어디에도 `CONTRACT_TEMPLATES_ENABLED` 참조 없음). 서버 액션 자체엔 독립 플래그 검사가 없어 정확히 0은 아니지만(플래그가 꺼지기 **전** 템플릿이 이미 연결된 낡은 견적을 직접 스크립트로 호출), UI 경로로는 오늘 도달 불가.

**하지만 `resolveStaleEmbedRef`(:1234)는 `createSendEmbedSession`(:601+) — 딜룸 "계약서 올리기" 임베드, 플래그와 완전히 무관한 항상 켜진 기본 경로 — 소속이라 킬 스위치의 보호를 전혀 받지 않는다(직접 확인).** 이게 오늘 무해한 이유는 플래그가 아니라 **런타임 불변식**이다: `resolveStaleEmbedRef` 는 `if (!active.providerRef) return null` 로 시작하고(:1178), `awaiting_pg_template` 행에 발송 **전** `provider_ref` 를 쓰는 유일한 경로는 `bindDraftRef` 인데(전체 서비스에서 단 한 곳, `sendFromTemplate` 안 :989) 그게 위에서 말한 플래그 뒤에 있다 — 그래서 "대기 중인 행에 provider_ref 가 있다"는 전제 자체가 오늘 성립하지 않는다. 이 불변식은 **가정이 아니라 직접 재는 게 가능하다**(런북에 이미 있는 쿼리): `SELECT count(*) FROM signing_contracts WHERE status='awaiting_pg_template' AND provider_ref IS NOT NULL;` — 0이 아니면 v0.4.49.0 이전(플래그가 살아있던 시절)에 만들어진 레거시 행이 있다는 뜻이고, 그 행은 **오늘도, 플래그와 무관하게** 임베드 패널을 여는 것만으로 이 결함에 걸린다. 플래그보다 깨지기 쉬운 전제다 — 사람이 아니라 데이터 상태에 달려 있다.

교차 확인: 적대 리뷰가 최초 발견, 보안 리뷰가 독립 경로로 재발견(같은 취약 프리미티브), 적대 리뷰가 재추적 과정에서 "고아"를 "영구 조정불가"로 상향 정정하고 이어서 완화 범위에 1234 누락을 지적.

**닫는 법(제안된 저비용 중간 완화 — adversarial, 범위 수정):** 완전한 수정(기대 ref CAS, `clearDraftRefIf`)은 동시성 테스트가 필요해 이 컷에서 서두르지 않는다. 다만 **네** clear 지점(847/875/889/**1234** — 앞서 세 곳만 언급한 것은 실수, `resolveStaleEmbedRef` 도 반드시 포함)에 `status='awaiting_pg_template'` 조건만 추가해도(전체 CAS보다 훨씬 작은 변경) **최악 결과(발송된 계약의 ref 를 지우는 것)는 원천 차단**된다 — awaiting-대-awaiting 겹쳐쓰기라는 더 좁은 잔여만 남는다. 이 중간 조치를 넣기 **전에** 위 count 쿼리로 "대기 중 행에 ref 있음" 전제가 실제로 0인지 먼저 확인할 것 — 배포 전 체크리스트에 추가. 847/889/1234 는 선존재(이 릴리스가 만든 게 아니다) — 875 만 신규지만 같은 취약 프리미티브를 재사용했고, 새 게이트가 그 분기를 타는 빈도를 실질적으로 높였다. (발견: dev→main 컷 감사 — adversarial + security 교차 확인, adversarial 재추적으로 두 차례 상향)

</details>

### ~~`sendFromTemplate` 의 재사용 게이트가 검증한 ref 와 실제로 보내는 ref 가 다를 수 있다 (P2, 재확인·심화)~~ — 해결 (v0.4.55.0)

처방 ①②를 함께 배송했다. ① `isReusableTemplateDraft` → `findReusableTemplateDraftRef`: 게이트가 검증한 그 ref 를 반환하고, 호출부가 리스 직후 스냅샷(`active.providerRef`)과 다르면 리스를 반납하고 `CONTRACT_BUSY` 로 물러난다 — 검증된 쪽으로 갈아타지 않는다(그 ref 는 상태 프로브·인증 판정이 보지 않은 값이다). ② `provider_ref` 의 세 쓰기·지우기 경로가 전부 출처·판본을 같은 UPDATE 로 관리한다: `bindDraftRef`(쓰기, 기존), `clearDraftRefIf`(지우기 — NULL 셋), `markSentIfAwaiting`(재바인딩 — 필수 `draft` 판별 필드: 템플릿 발송은 유지, 임베드 attach·복구·자가치유는 NULL). "clear 후 임베드 재바인딩이 옛 template 출처를 입는" 축은 attach 회귀 테스트로 고정했고, 변이 검증(동일성 분기 무력화 / markSent 출처 정리 제거)이 각각 다른 테스트를 RED 로 만든다.

<details><summary>원 항목</summary>

`isReusableTemplateDraft`(:1150)는 `findDraftRef` 로 그 순간 DB 를 다시 읽어 출처·판본을 검증하지만, **검증에 쓴 그 read 의 `providerRef` 를 버리고** 반환한다. 호출부(:958)가 실제로 보내는 값은 더 이전의 `active.providerRef`(:779 재조회 스냅샷)다 — 둘이 같은 객체라는 assert 가 없다. 위 P2(블라인드 clear)와 같은 경합 창(다른 경로가 발송 리스 밖에서 ref 를 갈아치우는 동안의 provider 프로브 왕복)에서, 게이트가 **DB 의 현재 ref(새 것)**를 검증해 통과시키고 코드는 **오래된 스냅샷(옛 것)**을 보내는 불일치가 가능하다 — 직접 추적 확인: `sendContract(providerRef)`(:1011)가 실제로 옛 문서를 발송(=서명 요청 메일 발신, 되돌릴 수 없음)한 **뒤에야** `markSentIfAwaiting` 의 `claimedAt` CAS(:1050)가 진다. CAS 실패 시 catch 블록(:1086)이 best-effort 로 그 ref 를 `snowsign.cancel` 하지만(:1111), 이는 **추가 서명을 막을 뿐 이미 나간 메일을 되돌리지 못한다** — "화면은 연결된 템플릿을 보냈다고 말하는데 실제로는 다른 문서가 서명 요청으로 나간다"는, 이 PR 전체가 막으려던 바로 그 결과다. (참고: 최초 리뷰는 이 CAS 가 "발송 전에" 막아 무해하다고 평가했으나, `sendContract` 호출이 CAS 보다 먼저라 그 평가는 틀렸다 — 직접 코드 추적으로 정정.) 이 결함은 **이 PR 이전부터 존재**했다(`active.providerRef` 를 갱신 없이 그대로 보내는 것 자체가 선행 코드 구조) — 새 게이트는 검증을 하나 더 추가했을 뿐 대상을 못 고쳤다. **재확인 후 심화(security) — 두 번째 concurrent `sendFromTemplate` 없이도 성립한다.** `markSentIfAwaiting`(`signing-contract.ts:430-465`)이 `provider_ref` 의 **두 번째 쓰기 경로**인데, SET 절이 `{ providerRef, snowsignTemplateId?, sentAt, status }` 뿐 — `provider_draft_origin` 은 아예 손대지 않고, `bindDispatchedContract`(임베드 attach·자가치유가 공유하는 경로, `:1614`)의 호출도 `snowsignTemplateId` 를 넘기지 않는다. 그래서 한 행이 ① 템플릿 경로로 바인딩됐다가(`origin='template'`, 판본=V) ② (터미널·불일치·미강제 등 어느 clear 분기로든) `provider_ref` 만 NULL 로 지워지고 ③ 나중에 **같은 행**에 임베드로 다른 계약(X)이 `markSentIfAwaiting` 으로 바인딩되면 — `origin`·판본은 지워지지 않은 채 그대로 남아 X 가 "template, 판본 V" 라는 거짓 출처를 입는다. 이 상태에서 진행 중이던(또는 재시도한) `sendFromTemplate` 호출이 `findDraftRef` 로 이 행을 읽으면 `isReusableTemplateDraft` 가 참을 반환한다 — **두 번째 사람이 개입할 필요 없이, 실패→(임베드로 전환)→재시도 한 사람의 손 안에서도** 위 문단의 오문서 발송 조건이 갖춰진다. (전에 이 컬럼들이 "오늘 무해하다"고 별도 P4 로 등재했던 것은 이 재사용 경로를 놓친 평가였다 — 여기 흡수.)

닫는 법(두 부분, 같은 커밋에서 함께): ① `isReusableTemplateDraft` 가 검증한 `draft.providerRef` 를 반환하게 하고, 호출부가 `active.providerRef` 대신 그 값으로 send 하거나 최소한 `draft.providerRef === active.providerRef` 를 요구해 불일치 시 `CONTRACT_BUSY` 로 물러날 것. ② `provider_ref` 를 쓰는 **모든** 경로(위 clear-CAS 항목의 `clearDraftRefIf` 및 `markSentIfAwaiting`)가 같은 UPDATE 로 `provider_draft_origin`·`snowsign_template_id` 도 함께 정리(clear 는 NULL 로, 재바인딩은 그 바인딩에 맞는 값으로)하게 할 것 — `bindDraftRef` 하나만 원자적으로 관리하고 다른 두 쓰기 경로는 방치하면 반쪽 규율이다. (발견: dev→main 컷 감사 — adversarial 최초 발견, security 가 재확인 과정에서 markSentIfAwaiting 경유 축을 추가 발견해 재현에 두 번째 행위자가 불필요함을 밝힘; 본인 코드 추적으로 전체 재확인)

</details>

### 서명 관련 테스트 3건 — 재사용 게이트 판정 무근거·부수 취소 무단언·타입전용 불변식 (P4)
컷 감사(testing specialist)가 mutation-check 로 적발, 전부 latent(현재 관측된 실패 없음): ① `contract-signing.test.ts` 의 compose/구판본/레거시 재사용 테스트 셋이 `bindDraftRef` 시드 호출의 boolean 반환을 확인하지 않아(레거시 시드는 raw `db.update` 로 행 수도 미확인) 시드가 조용히 no-op 해도 전체 통과 — `expect(client.getContract).toHaveBeenCalledWith(...)` 로 프로브 도달을 단언할 것. ② 출처 불일치 분기(:872)는 "provider draft 를 취소하지 않는다"는 불변식을 주석으로 문서화했지만 인접 테스트의 `client.cancel` 이 무단언 `vi.fn()` 이라 이 동작이 반대(터미널 ref 분기, 취소함)와 한 줄 스왑돼도 안 걸린다 — `expect(client.cancel).not.toHaveBeenCalled()` 를 추가할 것. ③ `SigningContractPatch.providerRef?: null` 좁히기(타입 레벨 원자성 보장)를 재는 런타임 드리프트 가드가 없어 `as any` 하나로 조용히 되돌아갈 수 있다 — `@ts-expect-error` 고정 테스트나 `patchContract` 의 런타임 거부를 추가할 것. (발견: dev→main 컷 감사 — testing specialist) **~~③~~ 전제 소멸 (v0.4.55.0)**: `providerRef` 팔과 impl 의 SET 라인을 함께 **삭제**했다 — `as any` 로 값을 실어도 쓸 코드가 없어, 지킬 것이 타입이 아니라 부재다. ①② 는 남는다.

### `findDraftRef` 읽기측 출처 리터럴이 상수로 묶여 있지 않다 (P4, fail-closed 방향이라 안전)
`bindDraftRef`(쓰기측)는 `SigningDraftRef` 유니온을 받아 오타가 TS2367 컴파일 에러가 되지만, `findDraftRef`(읽기측, `signing-contract.ts:417,419`)의 `'compose'`/`'template'` 리터럴은 `provider_draft_origin` 이 `string | null` 텍스트 컬럼이라 타입 보호가 없다. 오타가 나도 방향이 안전하다(재사용 불가로만 fail-closed, 고아 초안 누적일 뿐 오문서 발송 아님) — 급하지 않다. 닫는 법: `SigningDraftRef` 옆에 `DRAFT_ORIGIN = { template: 'template', compose: 'compose' } as const` 를 export 하고 `findDraftRef` 에서 참조. (발견: dev→main 컷 감사 — security specialist)

### ~~`resolveStaleEmbedRef` 가 compose 초안을 무조건 취소한다 (P3, Stage 2 전 결론 필요)~~ — 해결 (v0.4.57.0)

**결론: 현행 동작(무조건 취소)이 옳다 — 코드는 그대로 두고 회귀 테스트로 고정했다.** 이 항목이 남긴 판단 기준이 "create 후 즉시 send 면 잔여 초안은 크래시 잔해라 취소가 맞다" 였고, Stage 2 설계가 정확히 그것이다(compose 는 초안을 **재사용하지 않는다** — 문서가 우리 DB 에 있어 언제든 다시 만들 수 있고, 재사용은 편집 후 옛 본문 발송이라는 v0.4.52.0 이 막은 사고를 되살린다). 발송 전이라 취소해도 메일 0통·잃는 작업물 0이며, 안 지우면 공급자 측 고아만 쌓인다(삭제 API 없음).

`contract-signing.ts` 의 `resolveStaleEmbedRef` 는 provider 상태가 `draft` 면 **무조건** `snowsign.cancel` 한다. Stage 2 가 compose 초안을 남기는 설계라면 **임베드 패널을 여는 것만으로 그 초안이 파괴된다**(올린 PDF·배치한 서명칸 포함). 옳은 처리는 Stage 2 의 모양에 달렸다 — create 후 즉시 send 면 잔여 초안은 크래시 잔해라 취소가 맞고, 재개 가능한 세션이면 실제 작업물이 날아간다. 지금은 compose 호출자가 0이라 무해하며 코드는 손대지 않았다(가정만 주석으로 기록). Stage 2 가 반드시 결론낼 것. (발견: 초안 출처 게이트 적대 설계 리뷰)

### ~~형제 create 경로가 `status` 를 엄격 검증해 만들어진 계약을 고아로 만들 수 있다 (P3, 선존재)~~ — 부분 해결 (v0.4.55.0)

`status` 를 `createContract` 와 같은 관대 파싱(`status?` 옵셔널, 부재는 키 부재 — 값 지어내기 금지)으로 정렬했다. 유일한 소비자(`sendFromTemplate`)는 `contractId` 만 쓴다. **겸사(`SnowSignCallOpts`/signal 부재 — 최악 90초 대기)는 남는다** — 살아있는 소비자가 없어 죽은 배관을 늘리지 않았다(아래 "`createContract` 의 opts 전달이 테스트되지 않는다" 항목이 등재한 바로 그 부류). 데드라인이 필요해지는 시점(발송 UX 개선)에 전달 테스트와 함께 넣을 것.

<details><summary>원 항목</summary>

`createContractFromTemplate`(`snowsign-client.ts`)이 `status: reqString(...)` 이라, 공급자가 초안 응답에서 `status` 를 빼면 **create 성공 후** 던져 `contract_id` 를 함께 버린다 — 공급자에는 계약이 있는데 우리는 취소 핸들이 없다. v0.4.51.0 의 `createContract` 는 같은 자리를 `status?` 옵셔널 + 관대한 읽기로 고쳤지만 형제는 선존재라 손대지 않았다(템플릿 표면이 킬 스위치로 꺼져 있어 오늘의 폭발반경은 0). 같은 처방을 적용할 것. 겸사: 이 메서드도 `SnowSignCallOpts` 를 받지 않아 사람이 기다리는 경로에 데드라인을 걸 수 없고, signal 부재가 **긴** Retry-After 캡(10초)을 선택해 최악 90초까지 간다. (발견: v0.4.51.0 적대 리뷰)

</details>

### 자체 발송 경로 실측 잔여 2건 (P4)
① **C1 은 세션별 격리를 관측하지 않았다** — 콘솔 미리보기의 칸별 소유자 라벨로 *귀속*만 확인했다(게이트는 그것으로 판정된다). "구매사 화면에 PG 칸이 안 보인다"는 실발송이 필요하다. ② **C4 는 공급자가 선언한 정책만 확인했다** — 강등 참여자의 서명 화면을 실제로 열지 않았다. 둘 다 위험 방향이 안전하다(과소주장). Stage 3 수동 QA 에서 실발송 1건으로 함께 닫을 것. 근거·측정 방법은 `docs/SNOWSIGN_SANDBOX.md` C1·C4·C7 절. (발견: v0.4.51.0 컷 감사)

### `createContract` 가 참여자 `role` 중복을 막지 않는다 (P4)
불변식 넷 중 셋(빈 참여자·빈 서명칸·서명칸 role 정합)은 있는데 **참여자 role 유일성**만 없다. 두 참여자가 같은 role 을 들면 `roles` Set 이 뭉개 서명칸 정합 검사를 통과하고, 서명칸은 `participant: <role>` **문자열**로 묶이므로 어느 쪽에 붙는지 공급자만 안다 — 그리고 계약 상세 응답에 `signature_fields` 가 없어(C1) 우리 스택은 결과를 관측할 수 없다. 오늘 폭발반경은 0이다(호출자 0, Stage 2 는 `SIGNING_ROLE_LABELS` 2종 고정이라 중복이 구조적으로 불가능). 다만 참여자를 멤버 루프로 만드는 순간 되살아나므로, Stage 2 배선 시 `new Set(roles).size === participants.length` 한 줄을 같은 불변식 블록에 넣을 것. (발견: v0.4.51.0 컷 감사)

### `createContract` 의 `opts`(signal·maxRetries) 전달이 테스트되지 않는다 (P4)
`{ ...opts, retryStatuses: MUTATING_RETRY_STATUS }` 로 넘기는데 `signal` 이 실제 fetch 까지 도달하는지 재는 테스트가 없다(429 재시도·502 비재시도 테스트는 `retryStatuses` 만 덮는다). `opts` 를 받은 이유가 "사람이 기다리는 발송 경로에 데드라인을 건다"는 것이라, 전달이 조용히 끊기면 최악 90초 대기가 5분 리스·60초 하트비트 안에서 되살아난다. 형제 메서드에 이미 signal 전달 테스트 패턴이 있으므로 복제하면 된다. (발견: v0.4.51.0 컷 감사)

### 웹훅 리미터 잔여 2건 — 전역 거절이 계약별 예산을 소모, 포화 계약 3개가 전역 창을 굶긴다 (P4)
① `take(contract)` 성공 후 `take(global)` 거절 순서라, 전역 포화 1분간 정상 계약의 이벤트 10개가 재조회 0건인 채 계약별 예산만 소모돼 다음 창까지 스로틀이 이어질 수 있다. ② 전역 30/분 ÷ 계약별 10/분 = 유효 HMAC 쌍 **3개**면 전역 창 상시 포화(계약별 키잉의 격리는 1/3 뿐). 폴링(2분) 백스톱이 있어 상태 유실은 없고 지연만 는다. 닫는 법: 전역을 먼저 보거나 전역 거절 시 계약별 카운트를 되돌리고, 전역 상한을 계약별 상한의 배수 관점에서 재산정. (발견: 릴리스 컷 적대·보안 감사 2026-08-05, v0.4.42.0)

### resend 가 무제한이다 — 알림·운영자 웹훅·감사 홍수 (P4)
`resendSigningAction` 반복 호출에 상한·쿨다운이 없다 — 호출 1회당 새 라운드 + 낙찰 PG 승인 멤버 전원 인앱 알림 + 운영자 슬랙 1건 + 감사 로그 2행(`signing.awaiting_template` + `signing.resent`). v0.4.42.0 의 확인 다이얼로그는 UI 오클릭만 막고 서버 액션은 무방비. 이메일 팬아웃은 없고(inapp 만) 2회차부터는 공급자 호출도 없다 — 소음·감사 희석 축이다. 닫는 법: `claimRemind` 패턴을 복제한 `last_resent_at` CAS 쿨다운(5~10분) 또는 RFP 당 라운드 상한. (발견: 릴리스 컷 보안 감사 2026-08-05, v0.4.42.0)

### 반송 수신자에게도 리마인더가 열려 있다 (P4)
`remind` 는 대기 참여자 전원 대상이라 bounced 주소가 껴 있어도 그대로 나간다 — 죽은 주소가 다른 서명자와 공유하는 24h 창 하나를 태우고, 반송 배너는 취소를 권하는데 리마인더 버튼은 반대를 권한다. provider 가 remind 성공 후 `email_delivery.status` 를 리셋하는지도 미실측. 닫는 법: 대기 참여자가 전원 bounced 면 리마인더 비활성(문구로 취소 유도), SANDBOX 실측 후 리셋 여부 반영. (발견: 릴리스 컷 적대 감사 2026-08-05, v0.4.42.0)

### 감사 로그 metadata 는 와이어에 실린다 — 봉인 값 반입 금지 규범 (P4)
`AuditLogPanel` 은 `metadata` 를 렌더하지 않지만 `listForWorkspace` projection 에 포함돼 **클라이언트에 도달한다**. 현재 signing metadata 는 전부 서버 생성 무해값(자사 uuid·round·상수 reason)이나, 향후 `providerRef`·수수료를 넣는 순간 렌더 없이 유출된다. 신규 감사 이벤트는 metadata 를 화이트리스트 관점으로 리뷰할 것 — 금지 키 스캔 가드 테스트도 값싸다. (발견: 릴리스 컷 보안 감사 2026-08-05, v0.4.42.0)

### getSigningStatusAction 이 RFP 코드 존재 오라클이다 (P4, 선존재)
`findByCode` → `RFP_NOT_FOUND` 를 서비스 ACL 앞에 반환하는데 `P-YYYY-NNNN` 은 열거 가능한 형식이라, 인증 사용자가 임의 코드의 존재 여부를 판별할 수 있다(내용은 불가 — `getForActor` 는 ACL-first 로 올바름). 닫는 법: 코드 해석 실패와 ACL 거절을 같은 에러로 접는다. (발견: 릴리스 컷 보안 감사 2026-08-05, v0.4.42.0)

### 쿨다운·반송 배너·서명 마감 표시에 e2e 가 없다 (P4)
v0.4.42.0 신규 표면 셋 다 유닛뿐이다 — 리마인더 쿨다운 에러 문구, bounced 지속 경고, `서명 마감` 시각 표시. 딜룸 e2e 시나리오에 편입할 것. (발견: 릴리스 컷 적대 감사 2026-08-05, v0.4.42.0)

### 템플릿 생성 입력에 상한·페이지 경계 검증이 없다 (P3)
`createSigningTemplateAction` 의 `fields: z.array(FieldInput).min(1)` 에 `.max()` 가 없어 서버 액션 바디 한도까지 서명칸이 들어간다(그대로 `POST /v1/templates` 로 전달). 워크스페이스당 템플릿 개수 상한도 없다 — 조직 공유 API 키에 템플릿이 무제한 쌓인다. 또 `pageNumber`/`x`/`y` 가 업로드된 PDF 범위 안인지 **서버가 확인하지 않는다**: `clampToPage`(`template-editor-state.ts`)는 클라이언트 전용이라 액션을 직접 부르면 페이지 밖에 서명칸을 놓을 수 있다. 실 위험은 자기 템플릿을 자기가 망치는 수준이지만, 발송 시점에 공급자가 거절하면 원인이 먼 곳에서 드러난다. 닫는 법: `fields` 상한(예: 100) + 워크스페이스당 템플릿 상한 + 페이지 수·뷰포트 대비 좌표 검증(업로드한 PDF 의 페이지 수를 알아야 하므로 생성 시점에 기록). (발견: 릴리스 컷 적대 리뷰 2026-08-04, v0.4.41.1)

### ~~템플릿 발송 경로에 공급자 멱등키가 없다 — HTTP 재시도가 이중 발송을 만든다 (P2)~~ — 해결 (v0.4.42.0)

원 항목의 두 갈래 중 ①(HTTP 재시도 이중 발송)을 **재시도 정책으로** 닫았다 — 원 항목이 제시한 두 안 중 "멱등키 전송" 안은 채택하지 않았다. 문서를 다시 보니 `integration.external_id` 는 `POST /v1/contracts`(건별 생성, 미사용)와 `POST /v1/templates` 에만 있고 **`create-contract`·`send` 는 받지 않는다** — 미문서 필드를 보내는 것은 가짜 안전장치다. 대신 `create-contract`·`send`·`remind` 세 비멱등 POST 는 429(처리 전 거절)만 재시도하고 5xx(서버가 이미 실행했을 수 있는 모호 상태)는 재시도하지 않는다(`MUTATING_RETRY_STATUS`). 실패의 뒷수습은 기존 H3 자가치유 프로브(재클릭 시 `getContract` 실상태 확인)가 맡는다. 거짓 약속이던 클라이언트 헤더 주석과 `request()` opts 타입 협소화(곁다리)도 함께 고쳤다. **②(create 후 영속 실패의 잔여 초안)는 수용**: 그 초안은 발송 전이라 메일도 월 쿼터도 소모하지 않고, 재클릭이 새 초안을 만들 뿐이다(provider 측 클러터만 남는다).

<details><summary>원 항목</summary>

`snowsign-client.ts` 헤더는 "create/send 는 `integration.external_id = signing_contract.id` 로 중복 생성/발송을 막는다(호출자 주입)"라고 적어 두었지만, `createContractFromTemplate`(`:561`)도 `sendContract`(`:581`)도 `external_id` 를 실제로 보내지 않는다 — **주석이 약속한 불변식이 이 경로에는 존재하지 않는다**(실제로 보내는 건 `createEmbedSession` 뿐, `:378`).

두 갈래로 샌다. ① **HTTP 재시도**: `request()` 의 재시도 루프(`:329`)가 메서드를 가리지 않아 `POST /send` 를 5xx 에서 기본 `maxRetries: 3`(최대 4회)으로 재시도한다. 하필 502·504 는 **서버에서 이미 실행됐을 가능성이 가장 높은** 상태라, 구매사에게 서명 요청 메일이 두 통 간다. 이 결함은 **리스 계층 아래**에 있다 — 리스와 `markSentIfAwaiting` CAS 는 *사람 둘*의 이중 발송을 막지, 한 사람의 요청을 HTTP 클라이언트가 되쏘는 것은 못 막는다. ② **create 후 영속 실패**: create 직후 `patchContract({providerRef})` 가 실패하면 catch 가 리스만 풀고 `SEND_FAILED` 를 돌려주는데 그 초안은 취소되지 않고 남으며 우리 DB 가 참조하지 않아 `provider_ref` 도 취소 핸들도 없다 — 복구 스캐너가 존재하는 이유인 바로 그 고아다.

`docs/SNOWSIGN_API.md` 의 계약 생성 요청 블록에 `integration.external_id` 가 **이미 있다** — 쓰지 않고 있을 뿐이다. 닫는 법: create 에 `integration: { external_id: 'sc:<signingContractId>' }` 를 실어 주석의 약속을 실제로 구현하거나(선호), 공급자의 dedup 의미가 확실치 않으면 최소한 비멱등 POST 를 재시도 집합에서 빼고 이미 있는 자가치유 프로브(`sendFromTemplate` 의 `getContract` staleness 검사)에 맡긴다. 곁다리로 `request()` 의 `opts` 타입이 `{ signal }` 로 좁아져 있어(`:384`) `maxRetries` 가 타입상 사라진다 — 지금은 런타임 참조 전달로 동작하지만, 누가 안에서 객체를 재구성하면 조용히 4배 재시도가 부활한다. `SnowSignCallOpts` 로 넓힐 것. (발견: 릴리스 컷 적대 리뷰 + 보안 리뷰 2026-08-04, v0.4.41.1)

</details>

### ~~서명자 본인인증이 이메일 링크뿐이다 — `security.method` 미사용 (P2)~~ — 해결 (v0.4.46.0)
계약 생성 어디에서도 `security.method` 를 보내지 않아 **이메일 링크 도달 = 서명 권한**이었다. 제품 결정은 **기본강제**(옵션 아님)로 났고, 실측이 수단을 갈랐다 — 인증수단은 **템플릿 역할 단위**로만 저장돼(`POST /v1/templates` 의 `signers[].security_method`, 문서 미기재인데 동작함) 계약별 지정이 불가능하고, `easy_cert` 역할에 phone 이 없으면 공급자가 400 을 낸다. 그래서 강등이 아니라 **차단**이다. 닫은 방식: `createTemplate` 이 `easy_cert` 를 심고 → `createContractFromTemplate` 이 phone 을 싣고 → `sendFromTemplate` 이 발송 **전에** 양측 phone(`resolveSecurityMethod`, 010 전용)과 템플릿 실제 정책(`getTemplate` 의 signers)을 확인한다. 기존 템플릿은 재저장이 스스로 갱신한다(마이그레이션 스크립트 불필요). 자력 복구를 위해 설정 > 프로필 휴대폰 인증 화면도 함께 냈다. 근거는 `docs/SNOWSIGN_SANDBOX.md` "본인인증 강제 경로 실측"(S1~S6 + 프로브).

**잔여 (P3)**: ① 임베드 경로는 여전히 이메일 인증이다 — PG 가 iframe 안에서 수신자를 직접 타이핑하고 `POST /v1/embed-sessions` 에 보안정책 파라미터가 없다. 즉 강제는 **템플릿 경로에서만** 성립한다(템플릿 없는 PG 는 임베드로 우회 가능). **검토 결론(2026-08-07): 임베드는 유지한다 — 삭제 후보가 아니다.** 템플릿은 정적 PDF 라(에디터에 `variable` 필드 없음 + `createContractFromTemplate` 이 `variables` 미전송 + `hasVariables` fail-closed) **딜별 조건을 문서에 넣을 수 없고**, 그게 PG 가맹점 계약서의 본문이다(수수료율·정산주기·가입비 = 견적 필드). signer-filled `text` 필드는 대안이 아니다 — 기본 `signing_order` 가 `parallel` 이라 구매사가 PG 미기입 계약서에 먼저 서명할 수 있다. 삭제 이득도 과대평가였다: 리스 CAS·이어받기·H3 자가치유는 템플릿 경로가 **공유**하므로 실제로 죽는 것은 `SigningSendModal`·`embed-events`·하트비트·복구 스캐너·이어받기 알림 = 600~700줄 + 액션 4~5개다. 또 템플릿 지름길은 PR#470 신설이라 **역사적 발송은 사실상 전부 임베드**이고 진행 중 `awaiting` 딜에 전환 서사가 필요하다. **갭은 코드가 아니라 실측 2건으로 닫는다**: (a) 스노우싸인 콘솔에 조직 기본 인증수단 설정이 있는가 — 있으면 임베드가 상속해 코드 0줄로 닫힌다(가장 레버리지 큰 미지수, 0-A 미확인분), (b) 임베드 위저드 참여자 설정 단계가 인증수단 선택을 노출하는가(`pnpm signing:smoke` 로 즉시 확인 가능) — 노출하면 고칠 것은 아키텍처가 아니라 임베드 패널 안내 문구다. **재검토 조건**: 에디터가 `variable` 필드를 만들고 왕복시키며 발송이 견적 값을 주입하게 되면 템플릿이 임베드를 대체할 수 있고, 그때 템플릿 경로 필수화로 100% 강제가 성립한다. ② `PG_PHONE_REQUIRED` 는 행동 요구인데 토스트라 사라진다 — 지속 경고가 맞다. ③ `phoneOtpRepo.isVerified` 는 만료·단일사용이 없어 오래된 검증 id 를 재사용할 수 있다(대상 번호의 OTP 를 통과해야 id 를 얻으므로 실해악은 낮다). ④ 과금 구조 미확인 — API 로 조회할 수단이 없다(스노우볼 상업 조건).

### RFP 삭제 CASCADE 가 완료 계약 기록까지 지운다 (P2) — **실위험 축은 닫힘 (v0.5.3.0), 행 보존 축은 잔여 (P3)**

**닫힌 것**: 계약 보관함(`contract_archives`)이 완료 시점에 완료본·감사추적인증서 **사본을 R2 에 뜬다**. 보관함 행은 `signing_contract_id` 가 `ON DELETE SET NULL` 이고 제목·상대방·견적번호·체결일을 **스냅샷**으로 들고 있어 RFP 가 지워져도 홀로 선다 — "완료본 접근 영구 상실"이라는 이 항목의 실위험은 사라졌다.

**남은 것 (P3)**: ① `signing_contracts` 행 자체의 CASCADE 는 그대로다 — 지워지면 `provider_ref` 를 잃어 **공급자 쪽 계약을 조작(취소·리마인더)할 수 없다**. 사본이 있으니 읽기는 되지만 쓰기 핸들은 못 되찾는다. 닫는 법은 RESTRICT/SET NULL DDL 이고, 그건 RFP 삭제 UX 를 함께 정해야 하는 별건이다. ② **하이드레이션 전에 RFP 가 지워지면 사본이 영영 안 생긴다** — `providerRef` 를 회복할 수 없어 그 pending 은 즉시 `failed` 가 된다(거짓 pending 으로 두지 않는 것이 맞지만, 완료~1분 사이의 삭제는 여전히 사본 없이 끝난다).

<details><summary>원문 (부분 해결 전 기록)</summary>

### RFP 삭제 CASCADE 가 완료 계약 기록까지 지운다 (P2)
`signing_contracts.rfp_id` → `rfps ON DELETE CASCADE`. RFP 를 지우면 **완료된 계약의 행(provider_ref 포함)이 소멸**해 provider 쪽 계약은 살아있는데 완료본·감사추적인증서 접근 경로를 영구 상실한다 — 문서 사본을 안 갖는 설계라 이 행이 유일한 열쇠다. 전자문서 보존 관행상 완료 계약 기록은 불변 보존이 표준. 활성 계약 cancel 미전파(아래 상용 하드닝 ③)와 뿌리가 같지만 이쪽은 **기록 보존** 축이다. 닫는 법: completed 행은 CASCADE 에서 제외(RESTRICT, 또는 rfp_id nullable + SET NULL + rfp 식별 스냅샷 컬럼) — DDL 설계 필요, 공유 DB db:push 함정 주의. (발견: 업계 표준 감사 2026-08-05)

</details>

### 발송 전·진행 중에 계약서를 앱에서 볼 수 없다 (P3)
`completed` 전까지 양측 누구도 문서를 못 본다(view-model 의 `docs` 는 completed 에만 존재). 구매사는 서명 요청 메일을 열기 전까지 무슨 문서가 오는지 모르고, PG 도 발송 후 자기가 보낸 문서를 재확인 못 한다. 표준은 발송 전 미리보기·진행 중 열람이지만 "PDF 무보관" 원칙과 충돌한다 — 완화책은 템플릿 경로 한정(등록 시 브라우저가 PDF 를 쥐므로 썸네일/사본 저장 가능). **무보관 원칙 유지 여부 제품 결정 필요.** (발견: 업계 표준 감사 2026-08-05)

### 참여자 열람 시각·참여자별 서명 감사 이력이 없다 (P3)
`SigningParticipant` 에 `viewedAt` 필드 자체가 없고(상태 칩 `열람함`만), 참여자 상태는 `patchParticipant` 덮어쓰기라 이력이 아니다. 참여자별 서명/열람을 감사 로그로 남기려면 reconcile 의 스냅샷 비교(비-CAS)가 동시 폴에 이중 기록을 만드는 문제를 먼저 풀어야 한다(운영자 알림이 in_progress 를 제외한 것과 같은 이유). provider 가 열람 **시각**을 회신하는지도 미확인(문서엔 status=viewed 만 명시). 상세 이력은 완료 후 감사추적인증서 PDF 로 폴백. (발견: 업계 표준 감사 2026-08-05)

### 웹훅 리플레이 방지 잔여 — 타임스탬프 헤더 실측 (P3)
v0.4.42.0 이 contract_id 화이트리스트 + 재조회 리미터(계약별 10/분 + 전역 30/분)로 **증폭 축은 닫았지만**, 같은 (body, signature) 쌍의 재전송 자체는 여전히 유효하다(타임스탬프/nonce 없음 — trigger-only 설계라 상태 부작용은 0). Public API 문서에 웹훅 절이 없어 provider 가 타임스탬프 헤더를 보내는지부터 실측이 필요하다(콘솔 전송 로그 또는 수신 헤더 덤프 1회). 보내면 허용창 검증 추가, 안 보내면 수용 리스크로 못박는다. (발견: 업계 표준 감사 2026-08-05)

### 기존 계약서 템플릿에는 서명 기한이 소급되지 않는다 (P3)
`deadline_days: 30` 은 **새로 만드는** 템플릿에만 실린다 — provider 에 템플릿 수정 API 가 없어 기존 템플릿으로 보낸 계약은 여전히 영구 유효다. 같은 제품에서 PG 마다 만료 여부가 갈리는 상태. 에디터에는 30일 고지를 넣었지만(v0.4.42.0) 기존 템플릿 소유자에게는 닿지 않는다. 닫는 법(제품 결정): ⓐ 백필 — 기존 템플릿을 같은 PDF·좌표로 재생성 또는 ⓑ 사용자 재등록 유도(목록에 기한 없음 배지 + 안내) 또는 ⓒ 그대로 두고 문서화. (발견: /ship Red Team 2026-08-05) — **v0.4.43.0 갱신 둘**: ① 원문의 "PDF 바이트를 안 준다" 는 틀렸다 — `/download` 는 JSON 봉투로 1시간 presigned URL 을 주고 그 URL 이 실제 바이트를 준다(템플릿 수정 기능이 이 경로로 PDF 를 되읽는다). ⓐ 가 기술적으로는 가능해졌다. ② 수동 구제책이 생겼다: 템플릿 **수정**에서 저장만 눌러도 재생성 경로라 `deadline_days` 가 실린다. 능동 유도(배지)는 여전히 미결.

### 만료·재시도 정책의 provider 실동작 실측 대기 (P3)
v0.4.42.0 코드는 문서 기반이다 — SANDBOX 스모크로 확인할 것: ① `deadline_days: 30` 으로 만든 템플릿의 계약이 실제로 `expires_at` 을 갖고 기한 후 `expired` 로 전이하는지(T9 의 역방향), ② 비멱등 no-retry 전환 후 5xx 실패 → 재클릭 시 H3 프로브가 실발송을 정확히 갈라내는지. 결과는 `docs/SNOWSIGN_SANDBOX.md` 에 행 추가. (발견: 업계 표준 감사 2026-08-05)

### 서명 오류가 Sentry 에는 정규화되고 Axiom 에는 원문으로 나간다 (P4)
`captureSigningError` 는 non-`SnowSignError` 의 `.message` 를 일부러 버린다(`observability.ts:45-48`) — DB 오류 메시지에 참여자 `name`/`email` 이 섞일 수 있고 `sendDefaultPii: true` 라서다. 그런데 같은 throwable 이 바로 옆 `logger.error(..., { err: String(e) })` 로는 **원문 그대로** Axiom 에 간다(이번 컷이 그런 줄을 5개 늘렸다: `send_probe_failed`·`send_from_template_failed`·`bind_finalize_failed`·`reattach_finalize_probe_failed`·`sweep_row_threw`). 같은 값에 대해 두 줄이 상반된 전제를 쓰고 있는 셈이다. Axiom 이 노출이 덜한 싱크라 P4 지만, 정답은 이미 코드 안에 있다 — `reconcileStatus` 의 `err: e instanceof SnowSignError ? e.code : String(e)` 를 복사하면 된다. (발견: 릴리스 컷 보안 리뷰 2026-08-04, v0.4.41.1)

### 복구 노출 대장(recovery_refs) 상한이 상관키 게이트를 시간제한으로 만든다 (P3)
바인딩 게이트의 규칙은 "복구 스캔이 한 번이라도 노출한 공급자 계약은 어느 딜에 붙이든 그 딜의 상관키를 통과해야 한다"인데, 근거인 `recovery_refs` 가 `RECOVERY_DISCLOSURE_CAP = 200` 으로 오래된 것부터 잘려 나간다(`drizzle/signing-contract.ts`). 스캔 한 번에 최대 12건이므로 ~17회 스캔이면 옛 ref 가 대장에서 사라지고, 그 뒤 임베드 경로(`source === 'embed'`)로 도착한 attach 는 `participantsMatchDeal` 을 거치지 않는다. 즉 불변식이 실제로는 **영구가 아니라 최근 200건 한정**이다. 실 위험은 낮다(그 사이 대부분 바인딩돼 잠긴다)만 문서화된 규칙과 구현이 다르다. 닫는 법: 대장을 계약별로 분리하거나(행당 배열이 아니라 별도 테이블) 상한을 시간 기준으로 바꾼다. (발견: 릴리스 컷 적대 리뷰 2026-08-04, v0.4.41.1)

### onAward 자가치유 스윕의 48시간 지평 (P3)
`sweepMissingContracts` 는 `findAwardedRfpsWithoutContract` 를 `SWEEP_RECENCY_MS = 48h` 로 제한한다. 폴링 cron 이 48시간 넘게 죽어 있으면 그 구간에 선정된 딜은 **영구히** 스윕 대상에서 빠져 양측 모두 계약 탭을 못 본다(선정 시점 Sentry 이벤트 한 번이 유일한 흔적). 반대 방향도 있다: `rfps.updatedAt` 은 아무 상태 전이로도 갱신되므로, 오래된 선정 딜에 뒤늦은 상태 변경이 생기면 창 안으로 다시 끌려 들어와 **새 대기 라운드와 양측 알림이 만들어진다**. 닫는 법: 지평을 `awardedAt` 기준으로 바꾸고(전이로 흔들리지 않는다), 지평 밖 미생성 건은 별도 알림으로 올린다. (발견: 릴리스 컷 적대 리뷰 2026-08-04, v0.4.41.1)

### 서드파티 렌더링 표면의 방어 심화 3건 (P4)
전부 지금 뚫려 있다는 뜻이 아니라, 이 릴리스로 앱 안에 **서드파티 iframe + 클라이언트 PDF 렌더러**가 동시에 생겼으니 값싼 층을 하나씩 더 두자는 항목이다. ① `ContractTemplateEditor` 의 `getDocument({data})` 가 pdf.js `isEvalSupported` 기본값(true)을 그대로 쓴다 — 자기 파일·자기 브라우저 범위이고 `pdfjs-dist@6.2.108` 은 CVE-2024-4367 보다 한참 뒤지만 `isEvalSupported: false` 는 공짜다. ② `SigningSendEmbed` 의 postMessage 핸들러가 `e.origin` 은 정확일치로 보지만 `e.source === iframe.contentWindow` 는 보지 않는다 — 그 오리진이 우리 임베드만 호스팅하는 지금은 충분하나 역시 공짜다. ③ 앱 전체에 `Content-Security-Policy` 헤더가 없다(`next.config.*`·`deploy/Caddyfile` 모두). 선존재 항목이지만 위 둘이 생긴 지금이 넣기 좋은 시점이다 — 임베드 오리진·워커·pdf.js 를 허용 목록으로 명시해야 해서 작지 않은 작업이다. (발견: 릴리스 컷 보안 리뷰 2026-08-04, v0.4.41.1)

### 계약 탭 잔여 폴리시 2건 (P3)
딜룸 '계약' 탭 재설계(v0.4.6.0) 최종 리뷰가 남긴 후속. (① 타임라인 마일스톤 상태의 스크린리더 미노출은 **해결됨** — `nodeStatusLabel`이 노드 상태어를 파생하고 `SigningTimeline`이 Chip 없는 노드에 `sr-only`로 붙인다. 2026-07-22) (② 완료본 다운로드 링크의 새 창·다운로드 고지 누락은 **해결됨** — 링크 텍스트에 `sr-only` 로 '새 탭에서 내려받아요'를 넣어 접근성 이름에 싣는다. 시각적으로는 기존 Download 아이콘이 그대로 알린다. 2026-07-22) ③ **계약 탭이 종결 계약에도 항상 기본 탭이 된다** — 몇 달 전 완료·취소된 계약이라도 딜룸을 열 때마다 견적 비교를 뒤로 밀어낸다. 스펙대로의 동작이라 결함은 아니지만 종결 상태에선 기본 탭을 양보할지 제품 판단 필요. (발견: /superpowers 최종 브랜치 리뷰 2026-07-21) ④ **계약 탭 기본 활성은 마운트 시점 1회 결정(useState 초기값)** — 선정 직후 router.refresh() 로 계약이 생겨도 이미 열려 있는 딜룸의 탭은 바뀌지 않는다(사용자가 보던 탭을 시스템이 뺏지 않는다는 판단, /ship 리뷰에서 확인). 딜룸을 다시 열면 계약 탭이 기본이다.

### ~~실 SnowSign 스모크 미실행 — 건별 임베드 4대 가정 미검증 (P1)~~ — 해결 (v0.4.37.0)
실 API 키로 딜룸에서 계약 1건을 끝까지 발송해 Q1~Q4 를 전부 실측했다. 결과·측정 방법·부수 확인은 `docs/SNOWSIGN_SANDBOX.md` 가 SSOT. 요약: **Q1 완주 ✅**, **Q2 `snowsign.embed.contract_sent` / `payload.contract_id` ✅**(추정 상수가 전부 맞았다), **Q3 `external_id` 회신 ❌**(아래 항목으로 이어짐), **Q4 `https://snowsign.jtsnowball.com`** — API 호스트와 별개. 우리 sandbox 최소 집합이 임베드를 깨뜨리지 않는 것도 함께 확인했다. 이 과정에서 실결함 3건(리스 미반납·리스 형태·external_id 고정으로 인한 409)을 잡아 고쳤다. **남은 것은 e2e 자동화** — 아래 별도 항목.

### external_id 소유 검증이 현재 무력 — 단일 org 계약 바인딩 (P2)
`attachProviderContract` 는 `detail.externalId` 로 "이 provider 계약이 우리 것인가"를 검증하도록 짜여 있지만, **실측 결과 `GET /v1/contracts/{id}` 가 `external_id` 를 회신하지 않아 그 분기가 한 번도 실행되지 않는다**(SNOWSIGN_SANDBOX Q3). 지금 실제 게이트는 ACL(낙찰 PG)과 `provider_ref` 바인딩 유일성 둘뿐이다. 남는 위험: 단일 `SNOWSIGN_API_KEY`=1 org 라, **다른 계약의 UUID 를 아는 PG 가 그 계약을 자기 딜에 바인딩**할 수 있다(그러면 그 계약의 상태·완료본 다운로드에 접근한다). 실 위험은 낮다 — 계약 id 는 비열거·불투명 UUID 이고, 바인딩은 선착순이라 이미 붙은 계약은 뺏기지 않는다. **v0.4.38.0 정정**: 「어느 PG-facing 화면에도 노출되지 않는다」는 더 이상 사실이 아니다 — 고아 복구 다이얼로그가 후보의 id 를 브라우저로 보낸다(화면 텍스트로 렌더하지는 않는다). 다만 그 목록은 `participantsMatchDeal` 을 통과한 것뿐이고 같은 술어를 바인딩에서 한 번 더 적용하므로, 근거가 '아무 데도 안 보인다'에서 '이 딜의 당사자인 계약만 보인다'로 바뀐 것이다. 닫는 법: ① 스노우싸인에 `external_id` 회신(또는 조회 필터) 요청 — 가장 깔끔하다, ② 발송 직후 우리가 아는 유일한 단서인 **참여자 이메일**로 교차 확인(구매사 담당이 수신자에 없으면 이미 `participantMismatch` 로 잡히므로 이를 경고가 아닌 차단으로 승격), ③ org 분리(키 다중화). 코드는 그대로 두면 공급자가 필드를 추가하는 순간 저절로 살아난다. (발견: 실 API 실측 2026-08-01, v0.4.37.0)

### ~~템플릿 업로드 세션에 소유 바인딩이 없다 — 크로스-테넌트 클레임 표면의 이동~~ — 해결 (Wave 2)

세션 발급 시 서버가 `uploadId` 를 **워크스페이스에 HMAC 서명 바인딩한 토큰**으로 감싸 돌려주고(`lib/server/signing/upload-token.ts`), `createTemplate` 이 호출자의 세션 워크스페이스로 서명을 재계산해 대조한다. 불변식은 은닉이 아니라 **위조 불가**다 — presigned POST 의 `fields.key` 에 업로드 id 가 비칠 수 있으나(공급자가 정하는 값), 남의 id 를 알아도 자기 워크스페이스로는 서명이 맞지 않는다. DB 테이블 대신 서명을 고른 이유: 바인딩 수명이 10분(스노우싸인 세션 TTL)이라 테이블을 두면 만료 청소가 딸려오는데, 서명 토큰은 상태가 없어 프로세스 재시작에도 견디고 만료가 토큰 안에 들어 있다. 시크릿(`AUTH_SECRET`) 부재 시 fail-closed. (해결: Wave 2 2026-08-04)

<details><summary>원 항목</summary>

### 템플릿 업로드 세션에 소유 바인딩이 없다 — 크로스-테넌트 클레임 표면의 이동 (P3)

v0.4.37.0 에서 "해결"된 크로스-테넌트 링크 클레임은 `snowsignTemplateId` 축에서만 닫혔다(신형 `createSigningTemplateAction` 은 그 값을 provider 응답에서 파생). 그런데 같은 액션이 **클라이언트가 보낸 `documentUploadId`** 를 소유 검증 없이 받는다 — 업로드 세션은 워크스페이스가 아니라 **API 키(=조직 전체 공유)** 단위라, 다른 PG 의 진행 중 `upl_…` id 를 알아낸 PG 가 그 워크스페이스의 PDF 로 자기 템플릿을 만들 수 있다. 실 위험은 낮다(id 비열거·10분 TTL·알아낼 경로 없음)만 클레임 표면이 사라진 게 아니라 옮겨간 것임을 기록해 둔다. 닫는 법: 업로드 세션 발급 시 `uploadId→workspaceId` 를 서버가 기억(만료 TTL 포함)하고 createTemplate 에서 대조. (발견: Wave 0 적대 리뷰 2026-08-03)

</details>

### 복구 스캔의 외부 호출 예산이 실측치의 4배다 (P2)

`listRecoveryCandidates` 의 문서화된 예산은 "목록 ≤4 + 상세 12 = 클릭당 최대 16회"인데, 그건 **논리 호출** 수다. `snowsign-client.ts` 의 재시도(`MAX_RETRIES = 3`, `attempt` 0~3)가 논리 호출당 최대 4번의 HTTP 요청을 만들므로 실제 상한은 **클릭당 64 요청**이다. 스노우싸인 rate limit 은 100 req/분이고 **모든 PG 테넌트가 키 하나를 공유한다**. 게다가 `poll-signing-status` cron 이 매분 `POLL_LIMIT = 50` 을 순차로 태우므로 기준선이 이미 50%다 — 세 명이 같은 분에 '보낸 계약서 찾기'를 누르면 한도를 넘고, 429 는 재시도를 부르므로 정확히 포화된 순간에 부하가 배가된다. 닫는 법: 이 경로에만 재시도 예산을 낮게 주거나(opts.maxRetries), `RealSnowSignClient` 앞에 프로세스 내 토큰버킷을 두고(PM2 `instances: 1` 이라 인프로세스로 충분) 대화형 경로에 우선권을 준다. 문서의 예산 수치도 **HTTP 요청 단위**로 다시 쓴다. (발견: /ship 성능·적대 리뷰 2026-08-03)

### ~~복구 스캔의 후보 필터가 행마다 DB 를 때린다 — 데드라인 밖~~ — 해결 (Wave 3)

배치 조회(`findBoundProviderRefs`, `inArray`) 1회로 바꾸고 abort 체크를 넣었다. 순서는 날짜 필터 → 배치 조회 → 언바운드 필터 → 정렬 → 슬라이스 — 슬라이스를 먼저 하면 상위 N 이 전부 바인딩된 경우 아래 멀쩡한 후보가 있는데도 0건이 된다. (해결: Wave 3 2026-08-04)

<details><summary>원 항목</summary>

### 복구 스캔의 후보 필터가 행마다 DB 를 때린다 — 데드라인 밖 (P2)

`scanRecoveryCandidates` 의 `for (const row of seen.values())` 가 행마다 `findByProviderRef` 를 순차 호출한다. `seen` 은 상태 2종 × 페이지 2장 × `perPage: 100` = **최대 400행**이고, 공유 키라 다른 테넌트 계약도 함께 들어오므로 붐비는 플랫폼에서는 400이 병리적 최악이 아니라 정상값이다. 게다가 이 루프에는 `signal.aborted` 검사가 없어(검사는 다음 루프인 상세 조회 파도에만 있다) 12초 데드라인 **밖에서** 리스를 쥔 채로 돈다. 닫는 법: 정렬·`slice(0, RECOVERY_MAX_DETAIL_LOOKUPS)` 를 **먼저** 하고, 남은 id 만 `inArray` 한 방으로 조회하는 `findBoundProviderRefs(refs): Promise<Set<string>>` 를 추가한다(부분 유니크 인덱스가 이미 커버). 루프에 abort 검사도 넣는다. (발견: /ship 성능·유지보수·적대 리뷰 2026-08-03)

</details>

### ~~복구 다이얼로그가 부모 리렌더마다 스캔을 다시 쏜다 — 자기 리스에 자기가 막힌다~~ — 해결 (Wave 3)

`scan` 을 ref 로 고정해 마운트 1회로 만들었다(부모가 조건부 마운트라 mount === open). 의존성을 되돌리는 변이로 가드가 실제로 잡는 것을 확인했다. (해결: Wave 3 2026-08-04)

<details><summary>원 항목</summary>

### 복구 다이얼로그가 부모 리렌더마다 스캔을 다시 쏜다 — 자기 리스에 자기가 막힌다 (P2)

마운트 스캔 effect 의 의존성이 `scan` prop 인데, `SigningTab` 이 그걸 JSX 인라인 화살표로 넘겨 매 렌더 새 함수다. 다이얼로그가 열려 있는 동안 `SigningTab` 이 리렌더되면(`setBusy`, 라이브 알림, 형제의 `router.refresh()`) 스캔이 통째로 다시 나간다 — 최대 64 요청 + 위 N+1 을 또 쓰고, **진행 중인 첫 스캔이 아직 리스를 쥐고 있어** 두 번째가 `SEND_HELD_BY_TEAMMATE` 를 받는다. 그러면 화면은 "다른 담당자가 계약서를 작성하고 있어요"를 자기 자신에 대해 띄우고 자기 리스를 이어받으라고 권한다. `alive` 플래그는 결과 반영만 막지 서버 작업을 막지 않는다. 닫는 법: 다이얼로그 안에 `useRef` 1회 가드(부모가 memo 하는 것에 기대지 않는다). (발견: /ship 성능·유지보수·적대 리뷰 2026-08-03)

</details>

### 템플릿 목록의 `다시 불러오기` 가 말없이 실패한다 (P4)

`ContractTemplateList` 의 `retryLoad` 는 `if (!result.ok) return;` + 빈 `catch` 라, 장애가 이어지는 동안 버튼이 **죽은 컨트롤**처럼 보인다 — 스피너도 토스트도 상태 변화도 없다. 인플라이트 가드도 없어 연타하면 요청이 두 번 나간다. 기존 테스트(`다시 불러오기가 또 실패하면 에러 표면이 유지된다`)는 이 무반응을 **결함이 아니라 사양으로 못박고 있다**. 닫는 법: 재시도 중 표시 + 실패 토스트 + 인플라이트 가드, 그리고 그 테스트의 의미를 "표면 유지"에서 "실패를 말한다"로 옮긴다. (발견: 적대 리뷰 F3 2026-08-04, PR#478)

### 템플릿 에러 문구가 화면마다 다른 다음 행동을 요구한다 (P3)

`TEMPLATE_NOT_FOUND`·`NO_LINKED_TEMPLATE` 의 SSOT 문구는 **딜룸 발송 경로**를 위해 쓰였다("삭제됐다면 계약서를 직접 올려 주세요"). 그런데 `/contract-templates` 목록 화면에서 같은 코드가 나면 그 안내는 말이 안 된다 — 거기엔 올릴 딜룸이 없다. 그래서 목록의 이름 변경은 아직 SSOT 를 못 쓰고 하드코딩된 `'이름을 바꾸지 못했어요'` 로 남아 있다(서버는 `TEMPLATE_NOT_FOUND`/`FORBIDDEN` 을 구분해 돌려주는데도). 단순히 배선하면 사용자에게 엉뚱한 행동을 시킨다. 닫는 법: 표면별 오버라이드(호출부가 코드→문구 맵을 주입)이거나, 두 화면에서 모두 성립하는 문구로 다시 쓰기. 어느 쪽이든 **문구가 화면 문맥에 종속된다**는 사실을 SSOT 구조가 인정해야 하는 문제다. (발견: 적대 리뷰 F4 2026-08-04, PR#478)

### ~~에디터가 PDF 교체 시 진행 중 렌더를 취소하지 않는다~~ — 해결 (v0.4.43.0)

렌더 effect 가 진행 중 `RenderTask` 를 지역 변수로 추적하고 cleanup 에서 `cancel()` 한다 — 취소로 인한 reject 는 기존 `cancelled` 가드가 침묵시킨다(토스트 없음). 템플릿 **수정** 기능 도입으로 "문서 로드 후 교체"가 1급 경로가 되면서 선행 수정으로 닫았다.

<details><summary>원 항목</summary>

`ContractTemplateEditor` 의 페이지 렌더 effect 는 `cancelled` 불리언만 두고 pdf.js `RenderTask.cancel()` 을 호출하지 않는다 — 플래그는 다음 루프 반복과 토스트만 막지, 이미 발사된 렌더는 canvas 위에서 계속 돈다. 첫 PDF 렌더가 도는 중에 같은 페이지 수의 두 번째 PDF 를 올리면 페이지 번호로 keyed 된 동일 `<canvas>` 를 재사용해 pdf.js 가 "Cannot use the same canvas during multiple render() operations" 로 던지고, 토스트 한 번 뒤 루프가 중단돼 이후 페이지가 빈 채 남는다. 닫는 법: 페이지별 RenderTask 를 보관해 cleanup 에서 cancel, 또는 canvas key 에 문서 식별자를 섞어 재사용을 끊는다. (발견: 적대 리뷰 2026-08-05, PR#483)

</details>

### 손상 PDF 업로드가 공급자 쪽 고아 업로드를 남긴다 (P4)

`handleUpload` 가 pdf.js 파싱 **전에** 스노우싸인 업로드부터 완료하므로, 파싱에 실패하는 손상 PDF 도 업로드 세션을 소비하고 공급자 저장소에 고아 파일로 남는다(우리 DB 에는 흔적 없음, 만료 청소 추정). 실해악은 낮지만 조직 공유 업로드 자리 예산(v0.4.41.1)을 불필요하게 쓴다. 닫는 법: 파싱(문서 열림·페이지 수 확인) 후 업로드로 순서를 바꾼다 — 역방향 고아(파싱 성공/업로드 실패)는 로컬 상태 초기화뿐이라 생기지 않는다. (발견: 적대 리뷰 2026-08-05, PR#483)

### 이어받기 확인창에 포커스 회귀 테스트가 한 경로뿐이다 (P4)

PR#478 이 템플릿 경로의 포커스 인계 사고(확인창이 손을 바꾸며 포커스가 배경 `aria-hidden` 버튼으로 샘)를 고치고 회귀 테스트를 붙였지만, **임베드 경로의 이어받기 확인창에는 같은 테스트가 없다**. 지금은 그 경로에 확인창 인계가 없어 안전하지만, 이 사고의 교훈은 "클릭만 하는 테스트는 포커스 결함을 구조상 못 잡는다"였다. 딜룸의 다른 확인창들도 같은 사각지대에 있다. 닫는 법: 확인창 포커스 계약(열리면 포커스가 그 안에 있다)을 공통 헬퍼로 뽑아 destructive 확인창마다 건다. (발견: 적대 리뷰 gaps 2026-08-04, PR#478)

### 브라우저 뒤로가기가 계약서 작성 이탈 확인을 건너뛴다 (P3)

`SigningSendModal`(v0.4.39.0)은 백드롭·Esc·닫기 세 경로를 전부 확인 다이얼로그로 수렴시킨다 — 작성물이 스노우싸인 안에만 있어 언마운트가 곧 소실이기 때문이다. 그런데 딜룸이 인터셉트 라우트라 **브라우저 뒤로가기**는 `SigningTab` 을 통째로 언마운트하고, 그 경로에는 확인이 없다(리스는 언마운트 effect 가 정상 반납한다). 노출 자체는 인라인 패널 시절과 같아 **회귀는 아니지만**, 확인 다이얼로그를 붙인 순간 "이탈은 다 막혀 있다"는 기대가 생기므로 한 구멍만 남은 상태가 됐다. 같은 노출은 딜룸의 다른 작성 화면(견적 위저드)도 공유한다. 닫는 법: `beforeunload` 는 SPA 내 이동을 못 잡으므로 `popstate` 가드나 딜룸 레벨의 공통 이탈 가드가 필요하고, 어느 쪽이든 딜룸 전체의 이탈 정책이라 이 기능 단독으로 결정할 일이 아니다. (발견: /ship 사전 착륙 리뷰 2026-08-03, v0.4.39.0)

### ~~스캔이 읽기인데 강제 취득까지 한다~~ — 해결 (Wave 3)

복구 경로에서 `takeOver` 를 인자째 제거했다. 리스는 비어 있을 때만 잡고, 막히면 어디서 이어받는지 안내한다 — 파괴적 조작의 진입점은 임베드 한 곳이다. (해결: Wave 3 2026-08-04)

<details><summary>원 항목</summary>

### 스캔이 읽기인데 강제 취득까지 한다 (P3)

`listRecoveryCandidates({takeOver:true})` 는 목록을 만들기 위해 동료의 리스를 강제로 뺏고(= 그 사람 작성물을 버리고) 끝나면 곧바로 반납한다. 스캔은 읽기라 정확성상 배타가 필요 없다. 사용자는 '이어받기'라는 문구로 확인했는데 실제로 일어나는 일은 "목록 하나 보려고 동료 작업을 버림"이다. 닫는 법: 스캔에는 리스를 요구하지 않거나(작성 중인 사람과의 상호배타는 포기), 확인 문구를 실제 결과에 맞게 고친다. (발견: /ship 적대 리뷰 2026-08-03)

</details>

### ~~상세 조회 실패가 truncated 를 세우지 않아 이중 발송을 유도한다~~ — 해결 (v0.4.40.1)

상세 조회 catch 가 `truncated = true` 를 세우고, 다이얼로그는 0건이어도 `truncated` 면 "확인하지 못한 계약이 있어요 … 결과가 비어 있을 수 있어요"로 문구를 가르고 재시도 버튼을 남긴다. 재시도는 `truncated` 를 지우지 않는다 — 지우면 렌더 조건이 무너져 재시도 버튼 자체가 사라진다(스테일 결과는 `phase !== 'scanning'` 으로 가린다). (해결: Wave 1 2026-08-03, 다이얼로그 문구는 Wave 3 에서 보강)

<details><summary>원 항목</summary>

### 상세 조회 실패가 truncated 를 세우지 않아 이중 발송을 유도한다 (P2)

상세 조회 파도의 `catch { return null }` 는 한 건 실패가 스캔 전체를 무너뜨리지 않게 하려는 것인데, `truncated` 를 세우지 않는다. 429 소진이나 5xx 로 **진짜 후보가 하나 떨어져 나가면** 화면은 "보낸 계약서를 찾지 못했어요"를 띄우고 문구가 '계약서 올리기'로 유도한다 — 이 기능이 막으려던 이중 발송 그 자체다. 닫는 법: 실패 건수를 세어 `truncated` 에 반영하고, 0건 + 실패 있음이면 "확인하지 못한 계약이 있어요"로 문구를 가른다. (발견: /ship 적대 리뷰 2026-08-03)

</details>

### ~~서명 완료된 고아는 영영 복구할 수 없다~~ — 해결 (Wave 3)

`completed` 를 스캔 대상에 넣되 수락 근거를 **서버가 기록한 노출 사실**(`isRefDisclosed`)에 걸었다(클라이언트가 보내는 `source` 로 가르지 않는다). 종결은 새 전이를 만들지 않고 기존 `ensureFinalized` 를 태운다. 화면은 별도 구획·자동선택 금지·연결 전 확인. (해결: Wave 3 2026-08-04)

<details><summary>원 항목</summary>

### 서명 완료된 고아는 영영 복구할 수 없다 (P2)

`RECOVERY_SCAN_STATUSES = ['pending','in_progress']` 라, 아무도 '보낸 계약서 찾기'를 누르기 전에 **양측이 서명을 마치면**(스노우싸인이 메일을 즉시 보내므로 평범하다) 그 계약은 후보에 오르지 않는다. 딜룸은 완주된 계약을 두고 `awaiting_pg_template` 에 영구히 갇히고, 유일한 출구인 `resend` 는 새 라운드를 열어 서명을 처음부터 다시 받게 한다. `completed` 를 스캔 대상에 넣을지, 넣는다면 바인딩 시 상태 전이를 어떻게 할지가 제품 판단이라 여기 남긴다. (발견: /ship 적대 리뷰 2026-08-03)

</details>

### ~~복구 바인딩이 발송 시각을 지금으로 덮고 상태를 sent 로 낮춘다~~ — 해결 (v0.4.40.1)

세 갈래를 전부 공급자 쪽 사실로 되돌렸다: `sentAt: detail.sentAt ?? now`, 상태는 provider 가 `in_progress`(한쪽이 이미 서명)면 `in_progress` 유지, 팬아웃 문구는 `source !== 'embed'` 일 때 "보낸 계약서를 딜룸에 연결했어요"로 가른다. 판정을 `source === 'recovery'` 가 아니라 **`!== 'embed'`** 로 둔 것이 요점이다 — `source` 는 클라이언트가 보내는 선택 필드라 빠질 수 있고, 빠졌을 때 안전한 쪽은 "새로 발송됐다"가 아니라 "이미 나간 것을 연결했다"이다. (해결: Wave 1 2026-08-03)

<details><summary>원 항목</summary>

### 복구 바인딩이 발송 시각을 지금으로 덮고 상태를 sent 로 낮춘다 (P2)

`attachProviderContract` 가 `markSentIfAwaiting(active.id, { sentAt: now.toISOString() })` 로 **지금**을 발송 시각으로 박는다. 복구는 정의상 **과거에** 나간 계약을 뒤늦게 잇는 것이라, 딜룸 타임라인이 실제보다 몇 시간~며칠 늦은 시각을 보여준다. `detail.sentAt` 은 이미 손에 있다(후보 목록이 그 값을 렌더한다). 같은 자리에서 상태도 항상 `sent` 로 굳는데, 공급자가 `in_progress`(= 한쪽이 이미 서명함)를 주는 경우에도 그렇다 — 그리고 곧바로 `signing.sent` 팬아웃이 나가 구매사에게 "이메일로 받은 링크에서 서명을 진행해 주세요"라고 알린다(이미 서명을 마친 사람에게). 닫는 법: `sentAt` 은 `detail.sentAt ?? now`, 상태는 `mapProviderContractStatus(detail.status) ?? 'sent'`, 팬아웃 문구는 복구 출처(`source === 'recovery'`)일 때 "보낸 계약서를 딜룸에 연결했어요"로 가른다. (발견: /ship 적대 리뷰 2026-08-03, v0.4.38.0)

</details>

### ~~임베드 하트비트가 종결 실패를 일시 오류로 취급한다~~ — 해결 (Wave 3)

유예를 거부목록에서 허용목록으로 뒤집었다 — 근거가 있는 `CONTRACT_BUSY` 하나만 봐준다. 종결 코드는 즉시 닫는다. (해결: Wave 3 2026-08-04)

<details><summary>원 항목</summary>

### 임베드 하트비트가 종결 실패를 일시 오류로 취급한다 (P2)

`SigningTab` 의 하트비트가 `SEND_TAKEN_OVER` 만 즉시 종결로 보고 나머지 실패는 전부 한 틱(60s) 유예를 준다(`busyStreakRef < 2`). 그런데 `ALREADY_SENT`·`CONTRACT_NOT_FOUND`·`FORBIDDEN` 은 **확정적**이다 — 그 임베드는 다시는 바인딩될 수 없다. 구매사가 취소했거나 다른 경로가 먼저 바인딩한 뒤에도 패널이 최대 2분간 살아 있고, 그 창에서 PG 가 발송을 마치면 스노우싸인에는 살아 있는 계약이 생기는데 `attachProviderContract` 는 이를 거부한다 — `provider_ref` 를 못 얻으니 취소 핸들조차 없는 고아가 된다. 닫는 법: 실패를 두 부류로 가른다(종결: `SEND_TAKEN_OVER`·`ALREADY_SENT`·`CONTRACT_NOT_FOUND`·`FORBIDDEN` → 즉시 닫기 / 일시: `CONTRACT_BUSY`·`INVALID_INPUT`·네트워크 → 기존 1틱 유예). (발견: /ship 적대 리뷰 2026-08-03, v0.4.38.0)

</details>

### 스캔 상태 목록과 바인딩 수락 목록이 `sent` 에서 어긋난다 (P3)

`DISPATCHED_PROVIDER_STATUSES` 는 `sent` 를 발송된 것으로 **수락**하고 `KNOWN_NOOP_PROVIDER_STATUSES` 도 알려진 값으로 열거하는데, `RECOVERY_SCAN_STATUSES = ['pending','in_progress']` 는 그 상태를 **스캔하지 않는다.** 공급자가 발송 직후 상태로 `sent` 를 주는 순간(현재 실측상으로는 안 주지만 수락 목록이 그 가능성을 인정하고 있다) 아직 서명 전인 멀쩡한 고아가 후보에서 통째로 빠지고, 화면은 '찾지 못했어요' → '계약서 올리기'로 유도해 이중 발송을 만든다. 위의 `completed` 고아 항목과는 다른 축이다(그건 이미 서명 끝난 것, 이건 아직 서명 전인 것). 닫는 법: `RECOVERY_SCAN_STATUSES` 를 `DISPATCHED_PROVIDER_STATUSES` 에서 파생하고, 둘의 정합을 드리프트 가드 테스트로 못박는다. (발견: /ship 적대 리뷰 2026-08-03, v0.4.38.0)

### ~~사이드바 첫 마운트가 딜룸의 알림 스트림을 끊는다 — 이어받기 신호 유실~~ — 해결 (Wave 3)

`activeWorkspaceId` 가 아직 undefined 면 버릴 캐시가 없으므로 채택만 하고 스트림을 끊지 않는다. 진짜 워크스페이스 전환은 기존 테스트가 계속 지킨다. (해결: Wave 3 2026-08-04)

<details><summary>원 항목</summary>

### 사이드바 첫 마운트가 딜룸의 알림 스트림을 끊는다 — 이어받기 신호 유실 (P2)

이어받기 차단 신호가 기존 SSE 싱글턴을 타는데, `subscribeToLiveNotifications` 는 스트림만 열고 `activeWorkspaceId` 를 세우지 않는다. 나중에 `useNotifications` 가 마운트되면(모바일은 사이드바가 Sheet 안이라 닫혀 있는 동안 언마운트 상태다) `resetForWorkspace` 가 `undefined !== workspaceId` 를 보고 **딜룸이 의존하는 바로 그 EventSource 를 닫았다 다시 연다.** 그 재연결 틈에 도착한 `signing.send_taken_over` 는 리플레이가 없어 그대로 유실되고, 밀려난 PG 는 위 하트비트 폴백(최대 2분)으로 떨어진다. 닫는 법: `subscribeToLiveNotifications` 가 워크스페이스 id 를 받아 기록하게 하거나, `activeWorkspaceId` 가 아직 `undefined` 이고 스트림을 라이브 구독자가 열었다면 `resetForWorkspace` 를 no-op 으로 둔다. (발견: /ship 적대 리뷰 2026-08-03, v0.4.38.0)

</details>

### 후보 목록이 같은 당사자의 두 딜을 구분해 주지 않는다 (P3)

상관키(`participantsMatchDeal`)는 구매사 담당자 + 낙찰 PG 멤버를 요구하는데, **같은 구매사 담당자와 같은 PG 사이의 두 딜**은 그 조건을 똑같이 만족한다. 다이얼로그가 보여주는 것은 제목·날짜·수신자 수뿐이라 사람이 D1 과 D2 를 가릴 근거가 없다. 잘못 고르면 D2 의 계약이 D1 에 붙고(양측에 알림까지 간다) `findByProviderRef` 가 그것을 D2 의 스캔에서 제외하므로 **D2 는 영구 고아가 된다**. '고르는 건 사람이다'라는 설계의 전제가 무너지는 지점이다. 닫는 법: 후보에 구매사 워크스페이스명·견적번호 등 딜을 가리는 정보를 싣거나(공급자 payload 에 없으면 실을 수 없다 — 확인 필요), 같은 당사자 다중 딜일 때 경고를 띄운다. (발견: /ship 적대 리뷰 2026-08-03)

### 이어받기로 갈린 중복 계약에 보상 취소 경로가 없다 (P3)

발송 리스를 강제로 이어받는 순간(v0.4.38.0) 밀려난 동료의 임베드는 살아 있다 — 스노우싸인에 **임베드 세션을 취소하는 API 가 없다**(생성 하나뿐, `docs/SNOWSIGN_API.md` 엔드포인트 전수 확인). 즉시 차단 신호(인앱 알림 → SSE → 패널 닫기)와 ≤60초 하트비트 폴백이 창을 아주 좁히지만 0 으로 만들지는 못한다. 그 찰나에 동료가 발송을 누르면 **구매사에 서명 요청이 두 통 가고**, 진 쪽 계약은 우리가 `provider_ref` 를 받지 못해 딜룸의 `cancel` 로 손댈 수 없다(취소가 그 값으로 동작한다). 확인 다이얼로그가 이 가능성을 문구로 경고하는 것이 현재의 전부다 — 사용자 결정으로 보상 경로는 이번 범위 밖. 닫는 법: ① 이어받기 뒤 짧은 시간 안에 `participantsMatchDeal` 로 스캔해 우리가 모르는 새 계약을 찾아 PG 에게 취소를 제안(고아 복구 스캔의 재사용), ② 스노우싸인에 세션 무효화 API 요청. (발견: v0.4.38.0 이어받기 설계)

### 유휴 탭이 하트비트로 리스를 무한 연장하는 근본 원인은 그대로 (P3)

이어받기는 대증요법이다. 진짜 원인은 **임베드 패널이 열려 있기만 하면 사람이 손대지 않아도 60초마다 리스가 갱신된다**는 것 — 자리를 비운 탭 하나가 팀 전체를 영구히 막고, 그걸 푸는 유일한 길이 남의 작업을 밀어내는 것이다. 근본 해결은 유휴 감지다: N분간 임베드 안에서 아무 조작이 없으면 하트비트를 멈추고(리스가 스스로 만료된다) 화면에 '아직 작성 중이세요?'를 띄운다. 어려운 점은 **iframe 안의 조작을 우리가 볼 수 없다**는 것 — 부모 문서의 focus/visibility 만으로 판정하면 실제로 PDF 를 편집 중인 사람의 리스를 끊는다. 실현 가능한 근사: 탭이 `hidden` 인 채로 N분 지속되면 중단(포그라운드 작업은 절대 끊지 않는다). 이어받기와 독립이라 후속으로 둔다. (발견: v0.4.38.0 이어받기 설계)

### ~~서명칸 좌표의 **원점**이 확인되지 않았다~~ — 해결 (확인만, 코드 변경 없음)

**좌상단이 맞다 — y-플립은 필요 없다.** 콘솔 템플릿 미리보기에서 `(72,72)` 칸이 페이지 상단, `(72,160)` 칸이 그 아래에 있었다(좌하단 원점이면 순서가 뒤집힌다). 화면 실측도 일치했다: 612pt 가 711px 로 렌더(배율 1.16), 두 칸 간격 103px÷1.16=88pt=160−72 ✓, 첫 칸 상단 오프셋 72pt ✓. `docs/SNOWSIGN_API.md` 의 "원점은 페이지 좌상단" 서술이 이제 실측으로 뒷받침된다. 기록은 `docs/SNOWSIGN_SANDBOX.md` T6 행. (확인: 2026-08-04 콘솔)

<details><summary>원 항목</summary>

### 서명칸 좌표의 **원점**이 확인되지 않았다 (P1)

템플릿 경로 실측(2026-08-03, `docs/SNOWSIGN_SANDBOX.md` "템플릿 경로 실측")에서 T5 는 통과했다 — 우리가 보낸 `position_x/y` 가 정규화 없이 그대로 왕복한다. **그런데 T5 는 "보낸 값이 보존된다"만 말하지 원점이 어디인지는 말하지 않는다.** 문서(`docs/SNOWSIGN_API.md`)는 "PDF.js `getViewport({scale:1})` 기준 pixel, 원점은 페이지 좌상단"이라고 적고 있지만 이건 실측되지 않은 서술이고, PDF 좌표계의 기본 원점은 **좌하단**이다. 둘이 어긋나면 에디터에서 상단에 놓은 서명칸이 실제 문서에서는 하단에 찍힌다 — 그리고 그 사실은 **계약서가 상대에게 나간 뒤에야** 드러난다.

지금까지 만들어진 모든 템플릿이 같은 방향으로 틀리게 되므로 P1 로 둔다(기능은 "동작"하는데 결과물이 조용히 잘못된 유형). 닫는 법: 실측에서 발송한 계약(`938eb0c2-…`, 서명칸을 1페이지 `(72,72)`·`(72,160)` 에 배치)의 서명 메일을 열어 서명칸이 페이지 **상단** 좌측에 있는지 눈으로 확인한다. 하단이면 에디터가 보내는 `position_y` 에 `pageHeight - y - height` y-플립이 필요하고, 회귀 테스트로 그 변환을 고정해야 한다. 확인 결과는 `docs/SNOWSIGN_SANDBOX.md` T6 행에 기록한다. (발견: 템플릿 경로 실측 2026-08-03)

</details>

### 업로드 토큰 TTL 10분이 에디터 작업 시간을 자를 수 있다 (P3)

`UPLOAD_TOKEN_TTL_MS`(10분)는 `docs/SNOWSIGN_API.md:439` 의 "업로드 세션은 10분 동안 유효합니다"에서 **추론**한 값이다. 그 문장은 *업로드* 창에 대한 것이고, `POST /v1/templates` 가 그 창을 지난 `document_upload_id` 를 여전히 받는지는 **실측된 적이 없다**(`docs/SNOWSIGN_SANDBOX.md` 템플릿 경로 실측에 해당 행이 없다). 공급자가 더 관대하다면 이 토큰이 **여러 장짜리 계약서에 서명칸을 배치하는 사람 작업에 없던 10분 데드라인을 새로 건 것**이 된다.

~~실패가 조용한 것도 문제다 — 서버는 `UPLOAD_SESSION_EXPIRED` 를 돌려주는데 `ContractTemplateEditor` 가 일반 문구('템플릿을 저장하지 못했어요')로 삼킨다.~~ — 문구 축은 해결 (v0.4.45.0): `UPLOAD_SESSION_EXPIRED` 가 SSOT(`error-messages.ts`)에 등록돼 원인(유효 시간 경과)과 행동(다시 저장)을 말한다. 게다가 공급자는 자기 `expires_at` 을 응답에 주는데(`SNOWSIGN_API.md:432`) `snowsign-client.ts` 가 버린다 — 추측 대신 그 값을 미러링할 수 있다(잔여).

닫는 법: ⓐ 스모크에 "업로드 후 N분 뒤 createTemplate" 행을 추가해 실제 창을 재고, ⓑ `expires_at` 을 파이프라인에 태워 TTL 을 공급자 값으로 맞추고, ⓒ 만료 에러에 재업로드를 안내하는 문구를 붙인다. (발견: Wave 2 독립 리뷰 2026-08-04) — **v0.4.43.0 갱신**: 템플릿 **수정** 경로는 이 문제가 구조적으로 없다 — 업로드가 저장 버튼 시점에 처음 나가므로(deferred) 배치 작업이 아무리 길어도 TTL 과 만나지 않는다. 이 항목은 **생성** 플로 한정으로 남는다(생성도 deferred 로 바꾸는 것이 근본 해법 후보). — v0.4.42.1 이 재업로드 복구의 전제를 명시적으로 보존함: 같은 PDF(이름·바이트 크기·페이지 기하 모두 일치) 재업로드는 배치 필드를 유지하고, 다른 문서로의 교체만 초기화한다(dev→main 컷 적대 리뷰가 파일 크기 비교 누락을 지적해 이름·기하만으로는 같은 문서를 오판할 수 있었던 점을 닫았다 — 아래 "계약서 에디터 잔여 하드닝 3건" 참조).

### 계약서 템플릿 에디터 UX 잔여 4건 (v0.4.45.0 리뷰 이관, P4)

v0.4.45.0 의 적대·디자인 리뷰가 지적했으나 이번에 고치지 않은 것들. 코드로 닫힌 것(저장 중 이탈·편집 잠금, 업로드 타임아웃, 진행률 라이브 리전, 이름 변경 잠금, 교체 확인창 파일명)은 여기 없다.

- **배치 필드에 키보드 리사이즈 경로가 없다**: 이동(화살표)·삭제(Delete)는 키보드로 되지만 크기 조절은 Rnd 핸들(마우스) 전용이다. 서명칸 기본 크기가 대부분 맞아떨어져 실차단은 아니지만, 키보드-only 사용자는 크기를 못 바꾼다. 닫는 법: 수정자 키 조합(예: Alt+화살표)을 `resizeField` 에 배선하거나 선택 필드의 수치 입력(x/y/w/h)을 붙인다.
- **`role=status` 가 같은 문구를 연속으로 낼 때 재낭독이 보장되지 않는다**: 목록의 프리페치 공지(`템플릿을 불러오는 중이에요…`)는 행 A 실패 → 행 B 시작에서 같은 문자열로 돌아온다 — 스크린리더는 보통 *내용 변경* 에만 반응하므로 두 번째가 조용할 수 있다. 실제 AT 로 확인이 필요하다(타이밍·AT 의존). 닫는 법: 공지 문자열에 대상 템플릿 이름을 실어 매번 달라지게 한다.
- **드래그 중 Rnd 의 z-index 가 sticky 툴바(z-10)를 넘을 수 있다**: 라이브러리가 드래그 중인 요소를 앞으로 끌어올리는 구현이면 스크롤 상단에서 필드가 툴바 위에 잠깐 그려진다. 설치된 react-rnd 버전에서 실제로 그러는지는 미확인이고, 발생해도 순수 시각 문제다.
- **로딩 스켈레톤이 헤더 액션 자리를 항상 그린다**: 실제 목록은 비면 헤더 액션을 감추므로(EmptyState 가 CTA 소유), 템플릿 0개인 첫 방문에서는 스켈레톤의 버튼 자리가 사라지며 깜빡인다. 반대로 항상 감추면 템플릿이 있는 사용자가 반대 깜빡임을 본다 — 정상 사용 상태(템플릿 보유)를 기준으로 현행을 택했다. 행 높이는 `ml-auto` 라 리플로는 없다.

(발견: v0.4.45.0 적대·디자인 리뷰 2026-08-06)

### 계약서 템플릿 에디터의 이탈 가드가 헤더 취소 버튼뿐이다 (P4)

v0.4.42.1 이 넣은 취소 확인(작업물 있을 때)은 헤더 취소 버튼만 지킨다 — 사이드바 내비게이션·브라우저 뒤로가기·새로고침·탭 닫기는 그대로 통과해 배치 작업이 조용히 사라진다. 딜룸 `SigningSendModal` 의 "브라우저 뒤로가기 미가드" P3 와 같은 계열(라우트 수준 이탈 정책 부재)이라, 닫을 때 그 항목과 한 번에 설계한다(beforeunload + 라우터 가드). (발견: 적대 리뷰 2026-08-05) — **v0.4.45.0 갱신**: 저장 중 이탈은 헤더 취소 버튼을 잠가 막았다(진행 중 저장은 언마운트해도 완주해 서버에 남으므로, 열어두면 확인창의 '사라져요'가 거짓말이 된다). 남은 구멍은 여전히 라우트 수준 경로들이며, 그 경로로 나가면 저장이 완주해 사용자가 못 본 '저장했어요' 결과가 목록에 남는다.

### ~~ContractTemplateList 의 무음 실패 경로 2곳~~ — 해결 (v0.4.45.0)

~~`handleSaved` 는 저장 직후 목록 재조회 액션이 reject(네트워크)하면 catch 없이 조용히 죽는다 — 사용자는 '저장했어요' 토스트를 봤는데 목록에 방금 템플릿이 없다. `retryLoad` 는 `!result.ok` 를 무음으로 삼키고 재시도 버튼에 pending 표시도 없다.~~ 두 경로 모두 try/catch + 토스트로 닫고, `retryLoad` 에는 pending 라벨('불러오는 중…')·비활성도 붙였다(에디터와 같은 독트린). (발견: 적대 리뷰 2026-08-05)

### 템플릿 동시 수정은 last-write-wins (P4)

v0.4.43.0 의 템플릿 수정은 잠금·버전 대조가 없다 — 두 담당자가 같은 템플릿을 열어 각자 저장하면 나중 저장이 provider 템플릿 id 를 덮고 먼저 것은 무해한 고아가 된다(데이터 오손은 없고 한쪽 편집이 사라질 뿐. 단 0행 스왑 — 그 사이 **삭제**된 경우 — 은 `TEMPLATE_NOT_FOUND` 로 정직하게 실패한다, 릴리스 컷 리뷰 반영). 수정 중 rename 도 같은 결말(에디터 저장이 name 을 함께 쓴다). 발송 리스 같은 CAS 를 붙이려면 행에 갱신 카운터가 필요한데, 템플릿 편집 빈도상 과설계라 수용한다 — 실사용에서 충돌 보고가 나오면 재평가. (발견: 기능 설계 2026-08-05)

### 템플릿 확인·수정 잔여 하드닝 8건 (릴리스 컷 리뷰 이관, P4)

v0.4.43.0 컷의 스페셜리스트 6종 + Red Team 리뷰가 지적했으나 이번 컷에서 고치지 않고 이관한 것들. 코드로 닫힌 것(PG 승인 게이트·실바이트 캡·세션 재사용·오라클 접기 등)은 여기 없다.

- **프록시 업스트림 SSRF 방어**: `handleTemplatePdf` 의 서버측 fetch 는 provider 가 준 URL 을 따라간다 — `reqAbsoluteUrl` 이 http(s) 만 허용하지만 https 강제·사설망 차단·redirect 통제는 없다. provider 응답이 오염됐을 때만 성립하는 방어-심층 축이라 이관(계약 완료본은 302 라 이 표면이 없다). 닫는 법: https 강제 + `redirect:'manual'` 재검증 — 단 실 provider 의 redirect 사용 여부 실측 후(끊으면 기능이 죽는다).
- **템플릿 읽기 경로 전용 리미터**: 수정 진입은 클릭당 provider 2회(getTemplate + download)로 웹훅 리미터의 "대화형 ~20/분" 예산 안에 살며, 재시도 예산 1 로 증폭은 눌렀다. 그러나 전용 카운터는 없다 — 조직 규모가 커지면 webhook-rate-limit 패턴의 per-workspace 예산을 붙인다.
- **PDF 바이트 파이프라인 Blob 화**: ArrayBuffer 로 들고 다니면서 파싱마다 `slice(0)` 복사 + 저장 시 `new File([bytes])` 복사 — 50MB 문서면 메인스레드 힙에 최대 ~2배. `pdfRes.blob()` 을 단일 출처로 삼으면 복사가 한 번으로 준다. 또 교체 후에도 initialRef·목록 editorState 가 옛 바이트를 쥐고 있어 세션 동안 이중 보관된다(계약서 PDF 는 보통 수 MB 라 실해악 낮음).
- ~~**프리페치 잠금의 a11y**: `disabled` 전환이 방금 누른 버튼의 포커스를 떨군다 — `aria-busy` + 클릭 가드 + sr-only `role=status`(PhoneVerificationField 선례) 패턴으로 교체.~~ — 해결 (v0.4.45.0): 누른 버튼은 활성 유지 + `aria-busy` + ref 재진입 가드, sr-only `role=status` 공지 추가. 다른 진입점 잠금은 유지.
- **행 액션 하이어라키**: `수정` 도입으로 `이름 변경` 이 부분집합이 됐다(에디터가 이름도 저장). 셋이 같은 무게의 text 버튼 — 이름 변경을 케밥으로 접거나 수정에 흡수하는 제품 결정 필요.
- **서비스·에디터 DRY**: `update()` 가 `createTemplate()` 의 provider 페이로드(signers·deadlineDays)를 복제하고, 에디터의 세션 발급+presigned POST 시퀀스도 create/edit 두 곳이다 — 각각 헬퍼로 추출.
- **수정 전파 시맨틱 가시화**: 템플릿 수정은 그 템플릿을 골라 둔 기존 견적의 발송에도 새 판을 쓴다(의도된 시맨틱 — 개정판 갈아끼우기). 다만 화면 어디에도 "이 템플릿을 N 개 견적이 쓰고 있다"는 신호가 없다 — 에디터 헤더에 연결 수 배지 + 발송 시 실제 사용한 provider template id 를 `signing_contracts` 에 감사 기록.
- **콘솔발 signer 설정 fidelity**: 변수 실린 템플릿은 `TEMPLATE_UNSUPPORTED` 로 게이트했지만, 콘솔에서 signer 에 `security_method`(본인인증 등)를 붙인 경우는 감지하지 못한다 — 재생성이 기본 이메일 인증으로 조용히 강등시킨다. `getTemplate` 이 signers 를 파싱해 비기본 설정도 게이트할 것(우리 에디터로 만든 템플릿은 전부 기본값이라 정상 경로 영향 없음).

(발견: 릴리스 컷 스페셜리스트·Red Team 리뷰 2026-08-06)

### 계약서 에디터 잔여 하드닝 3건 (dev→main 컷 적대 리뷰, P4)

v0.4.42.1 을 main 으로 컷하는 과정의 독립 적대 리뷰가 세 가지를 더 지적했다 — 전부 사소하거나 발생 조건이 좁아 이번 컷에서 고치지 않고 남긴다.

- **창 레벨 드래그 가드가 `dataTransfer.types` 를 안 본다**: 에디터가 떠 있는 동안 `window` 의 `dragover`/`drop` 을 무조건 `preventDefault` 한다(브라우저가 PDF 를 열러 떠나는 것 방지). 부작용으로 같은 화면 안에서 텍스트를 드래그하는 네이티브 동작(예: 템플릿 이름 입력칸의 선택 텍스트를 다른 곳에 드롭)도 함께 막힌다 — 다만 이 폼엔 그런 드래그를 할 이유가 사실상 없어 체감 영향은 낮다. 닫는 법: `e.dataTransfer?.types?.includes('Files')` 로 파일 드래그에만 반응하게 좁힌다.
- **교체 업로드 중 배치된 필드가 계속 드래그·리사이즈 가능하다**: 저장 버튼·필드 추가 툴바·파일 열기 트리거는 `uploading` 동안 잠그지만, 이미 배치된 `Rnd` 박스는 잠그지 않는다 — 옛 필드를 드래그하는 도중 교체 문서 파싱이 끝나 `fields`가 초기화되면 어느 쪽 상태 갱신이 이기는지에 따라 자리가 되돌아가는 정도이고 크래시나 데이터 오손은 아니다.
- ~~**업로드 중 네트워크 단절이 "PDF 처리 실패"로 오분류된다(이 diff 이전부터)**: S3 멀티파트 POST 의 `fetch` 자체가 reject 하면 pdf.js 파싱 실패와 같은 catch·같은 문구('PDF를 처리하지 못했어요')로 떨어진다.~~ — 해결 (v0.4.45.0): 업로드가 XHR 로 바뀌며(진행률 표시) onerror=reject 를 별도 catch 로 받아 네트워크 전용 문구('PDF를 올리지 못했어요. 네트워크 연결을 확인하고…')로 갈랐다. 생성·수정 저장 두 경로 모두.

(발견: dev→main 릴리스 컷 적대 리뷰 2026-08-05, Claude subagent)

### ~~스노우싸인 웹훅이 실측된 적 없다~~ — 해결 (실제로 동작 중이었다, 코드 변경 없음)

**추정이 틀렸다.** 콘솔(조직 관리 → 웹훅)에 `prod-support-b` 가 **활성**으로 등록돼 있고 URL 은 `https://partner.support-b.com/api/signing/webhook`, 구독 이벤트 7종에 **발송 계열(`계약서 발송됨`)이 포함**된다(P2 가 물었던 ⓐ 항목 — 완료 계열만이 아니다). 전송 로그는 운영 서버가 **200** 으로 받고 있음을 보여준다: `2026-08-04 02:16 계약 취소됨 200`, `02:15 계약서 발송됨 200`, `2026-08-02 01:04 계약서 발송됨 200`. 앞 두 건은 이번 실측이 만든 계약이다. 우리 라우트는 시크릿 미설정 시 fail-closed 401 이므로 **200 은 운영 env 에 `SNOWSIGN_WEBHOOK_SECRET` 이 채워져 있고 HMAC 검증이 통과한다는 직접 증거**다(ⓑ 항목). "폴링이 100% 를 혼자 했다"는 성립하지 않는다.

남는 한계(부채 아님, 사실 기록): 200 은 수신·ack 까지만 증명한다 — 그 뒤 `after()` 비블로킹 재조회의 성공 여부는 별개이고, 그 구간은 폴링 백스톱과 같은 경로다. 근거·payload 형태는 `docs/SNOWSIGN_SANDBOX.md` "T10" 절. **교훈: Public API 문서에 절이 없다는 것이 기능이 없다는 뜻은 아니었다** — 문서 부재를 기능 부재로 읽은 것이 이 항목의 오진 원인이다. (확인: 2026-08-04 콘솔)

<details><summary>원 항목</summary>

### 스노우싸인 웹훅이 실측된 적 없다 (P2)

`CLAUDE.md` 는 상태 동기화를 "웹훅(저지연 트리거) + 폴링(백스톱)"으로 서술하지만, **웹훅 경로는 한 번도 실행된 적이 없다.** 근거: ① Public API 문서(`docs/SNOWSIGN_API.md`)에 **웹훅 절이 아예 없다** — 등록 엔드포인트도 이벤트 목록도 없다. `lib/server/signing/webhook.ts` 첫 주석의 "SnowSign 은 진행 이벤트를 등록 URL 로 POST 한다"(이벤트 이름까지 구체적)는 문서 근거가 없는 가정이다. ② 시크릿은 API 가 아니라 스노우싸인 **콘솔**에서 발급받는 out-of-band 값이다. ③ 실측(2026-08-01) 당시 `SNOWSIGN_WEBHOOK_SECRET` 이 비어 있었고 라우트는 미설정 시 fail-closed 401 이므로, 웹훅이 왔어도 처리될 수 없었다. 즉 지금까지 **폴링이 100% 를 혼자 했을 가능성이 높고**, 서명 완료가 딜룸에 반영되는 지연이 문서가 말하는 것보다 길다. 확인 항목: ⓐ 콘솔에 웹훅 URL 이 등록돼 있는지 + 이벤트 목록에 **발송 계열**이 있는지(완료 계열만이면 고아 복구 트리거로는 못 쓴다), ⓑ 운영 env 에 시크릿이 채워져 있는지. 확인 전까지 웹훅을 설계의 저지연 경로로 신뢰하면 안 된다. 완화: 폴링 백스톱이 이미 돌고 있어 기능은 성립한다(느릴 뿐). (발견: v0.4.37.0 고아 복구 설계 중)

</details>

### ~~임베드 완료 유실 시 고아 계약 복구 경로 없음~~ — 해결 (v0.4.38.0)

딜룸 계약 탭의 **`보낸 계약서 찾기`** 로 PG 가 직접 잇는다. 자동 채택이 아니라 후보를 보여주고 사람이 고르는 방식이다 — 상관키(참여자 이메일)는 휴리스틱이라 기계가 틀리면 남의 계약이 이 딜룸에 붙는다. 이 선택으로 cron·스케줄 마커·주기적 예산 소모·감사 로그 위조가 전부 사라져 스키마 변경 없이 끝났다.

상관키는 **구매사 담당자 + 낙찰 PG 워크스페이스 승인 멤버** 둘 다다(`participantsMatchDeal`). 구매사 하나로는 "이 딜"이 아니라 "이 구매사"를 가리켜, 한 담당자가 견적을 여럿 낸 평범한 상황에 대기 중인 딜이 다른 딜의 계약을 집어온다. PG 쪽은 `bid.submittedBy` 가 아니라 워크스페이스 전체 — 견적 낸 사람과 계약 보낸 사람이 다를 수 있다. 예산은 클릭당 최대 16회(목록 ≤4 + 상세 12)에 12초 데드라인. 정렬 순서를 가정하지 않고 여러 장이면 마지막 장도 받아 직접 정렬하며, `in_progress` 도 훑는다(구매사가 먼저 서명한 고아).

### 고아를 발견하지 못하는 PG 는 여전히 갇힌다 (P3)

`보낸 계약서 찾기` 는 PG 가 딜룸에 다시 들어와야 쓸 수 있다. 고아 상태는 조용해서 아무 신호도 가지 않는다. 완화책으로 7일 재넛지 문구를 양쪽 다 담게 고쳤지만(「아직 안 보냈다면 올려서 보내고, 이미 보냈다면 딜룸에서 연결해요」) 7일은 길다.

값싼 다음 수: **알림 전용 cron**. 되돌린 자동 채택 설계는 루프가 뒤집혀 있었다(딜마다 목록을 다시 받아 10 × 101 = 1010회). 목록을 **한 번** 받아 메모리에서 모든 대기 행의 (구매사, PG-org) 쌍과 맞추면 상세 조회가 딜 수가 아니라 후보 수에 비례한다. 채택은 하지 않고 "이 딜에 연결할 수 있는 계약서가 있어요" 알림만 — 스케줄 마커도, 감사 행위자 문제도, 리스 침범도 없다. (발견: v0.4.38.0)

### `pollPending` 이 이미 rate limit 을 넘길 수 있다 (P2)

스노우싸인 rate limit 은 **분당 100회**이고 그 키를 모든 PG사·모든 서명 기능이 공유한다. 그런데 `pollPending(50)` 이 2분마다 돌면서 계약당 `getContract` 1회를 쓰고, `request()` 는 429/5xx 에 최대 4시도까지 재시도한다 — **틱당 최대 200 요청**이다. 429 가 나면 재시도가 증폭시키고 `attachProviderContract` 의 재조회부터 실패해 고아가 더 생긴다. 클라이언트에는 토큰 버킷도, 서킷 브레이커도, 총 데드라인도 없다(NTS 어댑터에는 셋 다 있다 — `lib/integrations/nts.ts`, 다만 모듈 사설 싱글턴이라 그대로는 재사용 불가). 최소 조치: `Retry-After` 존중 + 429 백오프 확대. 제대로 하려면 NTS 의 버킷을 파라미터화해 추출한다. (발견: v0.4.38.0 고아 복구 설계 중)

### ~~org 스코핑 잔여 갭 — 미링크 템플릿 첫 조회/링크 소유검증 (P2)~~ — 해결 (v0.4.37.0)
템플릿 개념 자체가 폐지되면서 이 표면이 사라졌다. 단일 org 안에서 남의 리소스를 클레임하는 위험은 이제 **계약 바인딩**으로 옮겨갔고, `attachProviderContract` 가 ACL 재검증 + `provider_ref` 유일성 + (회신되면) `external_id` 소유 검증으로 막는다. 아래는 이력 보존용 원문. ~~`getTemplateDetail`/`linkTemplate` 은 이미 다른 워크스페이스가 링크한 SnowSign 템플릿은 거부(FORBIDDEN/TEMPLATE_ALREADY_LINKED)하지만, **아직 아무도 링크 안 한 신규 템플릿의 첫 조회/링크**는 임의 PG 가 할 수 있다(단일 SNOWSIGN_API_KEY=1 org 구조의 잔여 노출). 실 위험은 낮음(템플릿 ID 는 비열거·불투명, 어느 PG-facing 화면에도 노출 안 됨). 닫는 법: SnowSign `getTemplate` 응답이 임베드 세션의 `external_id`(`ws:<workspaceId>`)를 회신하면 소유 검증으로 게이트 — **Phase 11 에서 API 회신 여부 확인 후 구현**.~~ (발견: /ship security+red-team+code-quality 3중 리뷰 2026-07-19, v0.4.1.0)

### ~~동시 resend 시 PERSIST_FAILED (결과 정상, 에러만 덜 깔끔) (P3)~~ — 해결 (v0.4.37.0)
`resend` 가 더 이상 아무것도 발송하지 않고 대기 라운드만 열기 때문에 보상 취소 경로 자체가 사라졌다. 동시 resend 는 활성 partial-unique 위배를 `CONTRACT_BUSY` 로 옮겨 반환한다. 아래는 이력 보존용 원문. ~~두 resend 가 좁은 창에서 겹치면 한쪽은 claim 을 잃고 다른 한쪽은 활성 partial-unique 위배로 `PERSIST_FAILED`(+ 보상 취소로 SnowSign 계약 정리)를 받는다 — 이중 라이브 계약은 없어 결과는 정상이지만 에러 코드가 `CONTRACT_BUSY` 보다 혼란스럽다. RFP 단위 advisory lock 또는 claim 실패 재-read 로 매끈하게 개선 검토.~~ (발견: /ship red-team 2026-07-19, v0.4.1.0 — MINOR 수용)

### 상용 하드닝 잔여 (감사·쿼터·cascade) (P3)
플랜의 상용 요건 중 PARTIAL: ① 감사 로그의 계약 수준 전이는 v0.4.42.0 이 채웠지만(declined/expired/제공자취소/resent/reminded 추가) **참여자 수준**(viewed·per-participant-sign)은 여전히 미기록 — 위 "참여자 열람 시각" 항목 참조, ② org 월 발송 쿼터 근접 선제 알림 없음(`QUOTA_EXCEEDED` 는 반응형 에러로만 노출), ③ RFP 삭제 시 DB cascade 는 로컬 행만 지우고 활성 SnowSign 계약에 `cancel` 을 전파하지 않음 — 기록 보존 축은 위 "RFP 삭제 CASCADE" 항목(P2)으로 승격됨, ~~④ deadline↔expires 정렬(provider `expiresAt`/`deadlineDays` 로컬 미영속)~~ — ④ 해결 (v0.4.42.0: 템플릿 생성에 `deadline_days: 30` 전송 + reconcile 이 `expires_at` 미러링 + 진행 카드 마감 표시. 기존 템플릿은 update API 부재로 소급 불가). (발견: /ship plan-completion 감사 2026-07-19, v0.4.1.0)

### 완료본 다운로드 프록시 하드닝 — 호스트 allowlist + ACL-first (P3, 선존재)
**범위 주석 (v0.5.3.0)**: 이 항목은 딜룸의 **공급자 프록시**(`download-handler.ts`)에 대한 것이다. 계약 보관함이 만든 두 번째 다운로드 표면(`/api/contract-archives/{id}/download`)은 여기 해당하지 않는다 — URL 이 공급자 응답이 아니라 **우리 R2 presign** 이라 호스트 allowlist 축이 애초에 없고, ACL 도 존재검사보다 먼저다(행 소유 불일치에 403 이 아니라 404 를 내 존재 오라클을 만들지 않는다). 즉 이 항목의 두 축은 보관함 라우트에서 이미 닫힌 채로 태어났다.

`download-handler.ts`가 302 리다이렉트하는 `download_url`은 이제 `reqAbsoluteUrl`로 http/https 절대 URL만 허용하지만 **호스트 제약이 없고 `http:`도 통과**한다(제공자 신뢰값이라 user-controllable 아님·SSRF 아님 — 방어심층만). 또 `getDownloadUrl`은 `getForActor`와 달리 존재검사→ACL 순서라 비당사자가 404/403로 계약 존재를 구분할 수 있다(unguessable UUID라 실위험 negligible, 이번 diff는 오히려 raw 코드 대신 친절 페이지로 누출 축소). 검토: SnowSign/S3 다운로드 호스트 pin(+https 강제), `getDownloadUrl` ACL-first 정합. (발견: /ship security 리뷰 2026-07-20, v0.4.2.0)

### `sendFromTemplate` 의 lost-race 분기 — 실제 발송된 계약이 무보정으로 `canceled` 처리됨 (P2)
`sendFromTemplate`(Task 6, 임베드 없는 발송)의 `ContractNoLongerAwaitingError` 분기는 `attachProviderContract` 의 동명 분기와 겉모습은 같지만 성격이 다르다 — `attachProviderContract` 는 PG 가 임베드에서 직접 만든 계약을 뒤늦게 바인딩하는 것이라 보상 취소가 틀린 선택이지만, `sendFromTemplate` 은 **이 계약을 우리가 직접 만들고 발송했다.** `catch` 에 도달하는 시점엔 이미 `snowsign.createContractFromTemplate` + `sendContract` 가 성공해 양측에 서명 요청 메일이 나갔을 수 있는데, 왕복 도중 구매사 취소 등으로 로컬 행이 `awaiting_pg_template` 을 벗어나 있으면 이 행은 그대로 `canceled` 로 굳는다. 폴링 reconcile 도 7일 넛지 cron 도 이 행을 다시 들여다보지 않아 — 사실상 사람이 직접 알아채지 못하는 한 영구 고아다. 이번 수정으로 `captureSigningError` 호출을 추가해 Sentry 관측은 생겼지만 **자동 보정은 없다**(범위 밖). 닫는 법: 보상 취소 경로(제공자 계약에 `provider_ref` 가 이미 있다면 그걸로 취소를 시도) 또는 이 특정 상태 전이만 겨냥한 재조정 스윕. (발견: code-review 2026-08-03, task-6 후속)

## Performance / N+1

### N+1 쿼리수 가드가 RFP·bid 갈래를 한 번도 타지 않는다 — 측정된 "4쿼리"는 반쪽이다 (P2)
`conversationLoaders.sqlcount.test.ts` 의 `seedConversations` 가 `rfpId` 없는 평문 메시지만 보내서 `lastMessages` 의 `rfpId` 가 전부 null 이다. 그러면 `rfpIds`·`awardedBidIds` 가 빈 배열이라 `rfpRepo.findByIds`·`bidRepo.findPgWsIdsByIds` 가 **SQL 을 내지 않고 조기 반환**한다 — 가드가 고정한 "4 and 4" 는 **RFP 없는 경로만**이고 실제 경로는 7문이다.

문제는 그 다음이다. 테스트 헤더가 스스로 "레포 메서드 **안에** 숨은 루프(예: id 마다 도는 findByIds)도 잡는다"고 주장하는데, 정확히 그 두 레포에 대해서는 성립하지 않는다 — 미래에 `findByIds` 가 id 마다 루프를 돌아도 이 가드는 초록이다. 낙찰된 RFP 를 참조하는 마지막 메시지를 최소 1건 시드해서 `findByIds` + `allowedByRfp` + `findPgWsIdsByIds` 가 실제로 돌게 한 뒤 상수를 다시 고정해야 한다. (발견: v0.4.49.0 컷 감사)

### 같은 PR 에서 de-N+1 한 나머지 세 로더에는 쿼리수 가드가 없다 (P3)
`listConversationsForViewer` 만 가드가 있고 `loadConversationThread`(멤버별 `getFor` → `maxLastReadAt`, RFP별 `findById` → `findByIds`) · `loadBuyerRfpDetail`(`findById` 반복 → `findDisplayInfoByIds`) · `loadUserProfileForViewer`(`isMember` 루프 → `isMemberOfAny`)는 전부 **출력이 동일한** 재작성이라 루프로 되돌려도 기존 테스트 전부가 통과한다. (발견: v0.4.49.0 컷 감사)

### `isMemberOfAny` 가 `ORDER BY` 없는 `LIMIT 1` — 프로필 카드 회사명이 새로고침마다 바뀔 수 있다 (P3)
`drizzle/workspace.ts:406`. 대상 사용자가 **뷰어와 대화 중인 상대 워크스페이스 2곳 이상**에 속하면 Postgres 가 먼저 내놓는 행이 반환되고, 그 값이 `presenceWorkspaceId` 와 프로필 카드의 workspace 블록을 결정한다. 대체된 루프(`user-profile-loader.ts` 의 `cpIds` Set 순회)는 대화 목록 순서라 결정적이었다. ACL 영향은 없다(후보 전부가 정당한 상대). 결정적 `orderBy` 추가로 끝난다. (발견: v0.4.49.0 컷 감사)

### 낙찰 패자 팬아웃이 아직 워크스페이스당 `notify()` 1회다 (P3)
`services/rfp.ts:180` 의 `for (const loserWsId of loserWsIds)` 가 패자 워크스페이스마다 `notify()` 를 불러 award 트랜잭션 안에서 INSERT 문이 N개 나간다 — 이 PR 이 다른 곳에서 전부 접은 바로 그 패턴이다. title·body·linkUrl·channels 가 패자 전원 동일하고 `NotifyRecipient` 가 이미 자기 `workspaceId` 를 들고 다니므로, 전원을 한 `recipients` 배열로 펴서 `notify()` 1회로 접힌다. N = 허용 PG 수 − 1. (발견: v0.4.49.0 컷 감사)

### `chat_conversations.pg_ws_id` 에 단독 인덱스가 없다 (P3)
복합 UNIQUE `(buyer_ws_id, pg_ws_id)` 의 **후행 컬럼**이라 PG 뷰어의 `listForWorkspace` 는 순차 스캔한다. 그 쿼리가 v0.4.47.0 의 "151→4" 를 떠받치는 4문 중 하나이고, **대화가 쌓이는 쪽이 바로 PG 측**(그 PG에게 메시지 보낸 모든 구매사)이다. 왕복은 접혔지만 남은 기본 쿼리가 PG 측에서 인덱스 없이 돈다. Postgres 는 FK 컬럼을 자동 인덱싱하지 않으므로 워크스페이스 삭제 캐스케이드도 같은 스캔을 문다. `index('chat_conversations_pg_ws_idx').on(t.pgWsId, t.lastMessageAt)` — DDL 이라 배포 런북 선행 단계 필요. (발견: v0.4.49.0 컷 감사)

### `lastByConversations` 의 `DISTINCT ON` 이 대화별 전체 메시지를 읽고 정렬한다 (P3)
인덱스는 `(conversation_id, created_at ASC)` 인데 `ORDER BY` 는 `(conversation_id ASC, created_at DESC, id DESC)` — 방향이 섞였고 세 번째 키 `id` 는 인덱스에 아예 없다. Postgres 는 `DISTINCT ON` 에 loose/skip index scan 이 없어서, 대화당 1행을 뽑으려고 **나열된 모든 대화의 모든 메시지 행**을 읽고 정렬한다. 왕복 수는 고정됐지만 메시지 수 축은 그대로 열려 있다(옛 코드도 같은 행을 다 가져와 JS 로 보냈으므로 회귀는 아니다). 대화 id 마다 `LIMIT 1` 하는 lateral join 이면 기존 인덱스로 역방향 프로브 1회씩이면 된다. (발견: v0.4.49.0 컷 감사)

### `loadConversationThread` 가 스레드 전체를 무제한으로 가져온다 (P3)
`LIMIT`·커서 없이 전체 메시지 + 작성자 조인 + 첨부 전부를 대화 열 때마다 가져와 RSC 페이로드로 재직렬화한다. 이 PR 이 이 함수의 읽음표시·RFP 조회는 배치화했지만 무제한 축은 남겼다 — 오래된 구매사-PG 관계일수록 페이로드가 무한정 커진다. `(created_at, id)` 커서 + 역순 `LIMIT`. (발견: v0.4.49.0 컷 감사)

### 프레즌스 fetch 에 타임아웃이 없고, 이제 무조건 호출된다 (P3)
`realtime/centrifugo.ts:159` 의 `presentUserIdsInConversation` 은 `AbortSignal`·타임아웃 없는 생 `fetch` 라 Centrifugo 가 멎으면 `sendMessage` 가 **무한정 매달린다**. v0.4.47.0 이 이 호출을 트랜잭션 **밖**으로 뺀 것은 진짜 개선이다(더 이상 풀 커넥션을 물고 늘어지지 않는다). 다만 두 가지가 남았다 — ① 호출이 `recipients` 확인 **전**으로 올라가 무조건 1회 나간다(옛 코드는 `for (const m of recipients)` 안이라 승인 수신자가 0명이면 0회였다), ② 여전히 무제한 대기다. `AbortSignal.timeout(...)` 하나면 닫힌다.

부수로 `approvedMemberRecipients` 가 트랜잭션 안(tx 스코프 스냅샷)에서 앞(`chat.ts:160`, tx 없음)으로 옮겨져, 멤버십 변경 경합 창이 **트랜잭션 본문 길이에서 저 무제한 프레즌스 fetch 길이로** 넓어졌다. 방향은 무해하지만(방금 승인된 멤버가 메시지 1건의 알림을 놓침) 창이 실질적으로 커졌다. (발견: v0.4.49.0 컷 적대 감사 2차 패스)

### `ChatService.sendMessage` 가 대화를 두 번 조회한다 (P4)
프레즌스를 트랜잭션 밖으로 뺀 v0.4.47.0 수정이 공통 경로에 중복 조회를 남겼다 — 호출자가 `conversationId` 를 안 주면 `findPair` 가 트랜잭션 밖에서 돌고, 트랜잭션 안 `findOrCreatePair` 가 같은 짝을 다시 해석한다(첫 조회의 id 는 버려진다). 메시지 전송마다 +1 SELECT. 중복 제거가 목적인 PR 에서 생긴 것이라 특히 갚을 값어치가 있다. (발견: v0.4.49.0 컷 감사)

### `SWEEP_BATCH=200` 의 근거가 이 배포 토폴로지에 없고, 회수율이 200/시간으로 고정됐다 (P3)
`app/api/cron/sweep-uploads/batch.ts:12` 의 모듈 주석은 "플랫폼 함수 타임아웃 안에 끝나도록"을 근거로 드는데, 이 앱은 Lightsail 자체호스팅 PM2 `next start` 라 **그런 타임아웃이 없고** 크론(`17 * * * *`)은 이미 `flock -n` 으로 중첩을 막는다. 즉 존재하지 않는 위험을 막으면서 실재하는 상한을 도입했다 — 회수율 200/시간 ≈ 4,800/일 고정이라, 업로드 폭주나 R2 장애 복구 뒤 백로그가 고정 속도로만 빠지는 동안 고아 객체가 R2 에 남는다(자기치유·유한·무손상이지만 스루풋 회귀). `DEPLOY_LIGHTSAIL.md` 의 "시간당 1회면 충분"이 더는 무조건 참이 아니다. 크론을 5~10분으로 올리거나(락이 있으니 공짜) 런북에 드레인 속도를 명시할 것. 부수: `drizzle/attachment.ts:200` 의 LIMIT 서브쿼리에 `ORDER BY` 가 없어 어떤 200행이 뽑힐지 임의다(단일 flock 크론에서는 무해). (발견: v0.4.49.0 컷 감사)

### `signing_contracts.recovery_refs` 배열 겹침 조회에 GIN 인덱스가 없다 (P2)
`isRefDisclosed`(`drizzle/signing-contract.ts`)가 `recovery_refs && ARRAY[$1]::text[]` 로 조회하는데 이 컬럼에 인덱스가 없다 — **스키마 전체에 GIN 인덱스가 한 개도 없음**(확인: `rg "\bgin\b|\.using\(" lib/db/schema/` 0건. `gin` 으로 grep 하면 `login-attempts` 가 걸리는 오탐이니 단어 경계 필수). 선언된 인덱스는 `active_rfp_uniq`(부분)·`status_polled_idx`·`provider_ref_uniq`(부분) 셋뿐이다.

계약 바인딩마다 2회 호출되고(`contract-signing.ts`) `signing_contracts` 는 append-only(재발송이 늘 새 행, 삭제 없음)라 **테이블 전체 seq scan 이 영구히 커진다**. 한 줄 DDL이지만 이 레포는 PUSH-ONLY 라 배포 런북에 DDL 선행 단계가 필요하다 — v0.4.42.0 운영 500 사고가 정확히 그 누락이었다([[project_0442-deploy-missing-ddl-incident]] 참조).

### ~~`sweep-uploads` cron 이 무한정 직렬 R2 삭제 — 타임아웃 시 객체가 영구 고아가 된다 (P2)~~ — 해결 (v0.4.47.0)
`app/api/cron/sweep-uploads/route.ts` 가 `deleteStalePending(cutoff)` 로 stale 행을 **먼저 전부 삭제**하고(`.returning({id})`, **LIMIT 없음**), 반환된 id 마다 `await storage.delete(id)` 를 직렬 호출한다.

문제는 순서다 — DB 행은 이미 커밋돼 사라졌는데 객체 삭제는 루프 중이라, 함수 타임아웃이 나면 **남은 객체를 가리키던 행이 이미 없어서 다음 sweep 이 다시 찾지 못한다**. 즉 백로그(장애·업로드 폭주) 한 번이 R2 고아 객체를 영구히 남긴다. 1000건 × ~50ms ≈ 50초로 플랫폼 함수 타임아웃에 걸린다.

**해결(v0.4.47.0): 순서가 아니라 상한을 고쳤다.** row-first 순서는 라우트 모듈 주석이 이미 근거를 들어 선택한 것이라(보이지 않는 pending 행을 남기는 것보다 이름이 결정적인 고아 객체가 낫다) 뒤집지 않았다. 진짜 미문서화 위험은 무제한 배치였고, `deleteStalePending(cutoff, limit)` + `SWEEP_BATCH=200`(`app/api/cron/sweep-uploads/batch.ts` 단일 출처)으로 한 틱을 유한하게 만들었다. 남은 행은 `pending` 인 채 다음 틱이 회수한다. DELETE 에 LIMIT 이 없어 서브쿼리로 표현한다. 여전히 열려 있는 개선은 S3 `DeleteObjects` 배치(1000키/콜)와 병렬 삭제다.

### ~~채팅 전송이 **열린 트랜잭션 안에서** 수신자마다 Centrifugo HTTP 를 호출한다 (P2)~~ — 해결 (v0.4.47.0)
`ChatService.sendMessage`(`services/chat.ts`)의 `db.transaction` 안 수신자 루프가 `isUserPresentInConversation`(`realtime/centrifugo.ts` — Centrifugo HTTP API)을 멤버마다 부른다. Centrifugo 가 느리거나 안 뜨면 **Postgres 트랜잭션 수명이 수신자 수 × 외부 응답시간만큼 늘어난다**. 커넥션 풀은 `max: 10`(`lib/db/client.ts`)이고 이 경로는 메시지 보낼 때마다 탄다.

**해결(v0.4.47.0)**: 프레즌스를 트랜잭션 진입 전으로 옮기고, **대화당 1회**로 줄였다. 두 번째가 핵심이다 — Centrifugo `presence` 응답은 애초에 채널 전체 클라이언트 목록이라, 수신자마다 부르면 같은 페이로드를 N번 받아 1비트씩만 쓰고 버리는 구조였다(트랜잭션 밖으로 뺀 1차 수정만으로는 N 직렬이 N 병렬이 됐을 뿐 횟수는 그대로였다). `presentUserIdsInConversation(convId): Set<userId>` 가 새 진입점이고 `isUserPresentInConversation` 은 그 위의 얇은 래퍼로 남아 digest flush 가 계속 쓴다. 첫 메시지(대화 행이 아직 없음)에는 아예 호출하지 않는다 — 채널이 `chatChannel(conversationId)` 로 파생되는데 그 UUID 가 트랜잭션 안에서 만들어져 아무도 구독할 수 없으므로 반드시 false 다.

**남은 것 (P3)**: 같은 루프의 `hasPendingChatNotification` 이 여전히 수신자당 1쿼리다(`IN (...)` 배치 대상). `team-chat.ts` 는 수신자당 `hasPendingTeamNotification` + `hasPendingTeamMentionNotification` 2회라 더 심하고, **프레즌스 이관도 안 됐다** — 팀 채팅 경로는 손대지 않았다. `NotificationRepo` 에 `hasPendingFor(userIds[])` 배치 메서드를 추가하면 양쪽이 함께 접힌다.

### ~~`approvedMemberRecipients` 를 같은 tx·같은 인자로 두 번 부른다 (P4)~~ — 해결 (v0.4.47.0)
`RfpService.createRfp` 가 PG 워크스페이스마다(이메일 팬아웃 / 인앱 팬아웃) 같은 조회를 두 번 했다. `acceptPgRequest` 도 같은 모양이었고 첫 호출이 `if` 블록 안이라 조건 밖으로 끌어올렸다(인앱 팬아웃은 무조건 나간다). 호출 횟수 가드 테스트 동반.

### `WorkspaceRepo.findById` 는 1쿼리가 아니라 4쿼리다 (참고 — 위 항목들의 배율)
`hydrate()`(`drizzle/workspace.ts`)가 본체 select 외에 멤버-users 조인 + bizProfile(조건부) + 로고 blob 을 각각 조회한다. 이름 하나만 쓰는 호출부도 4쿼리를 낸다. v0.4.47.0 의 대화 목록 실측 **151쿼리/30대화** 가 정확히 이 구조다(`1 + 30×(3 hydrate + 1 메시지 + 1 읽음)`). 가벼운 대안이 이미 있다 — `getDisplayInfo`(단건)·`findDisplayInfoByIds`(배치, v0.4.47.0 추가)·`getName`. **단건 `findById` 호출부 중 이름/로고만 쓰는 곳**(`rfp-detail-loader` 의 구매사 워크스페이스·PG 상세, `app/(app)/rfp-create/page.tsx`)이 남아 있다. `settings/members` 는 `ws.members` 를 실제로 쓰므로 정당하다.

### 병렬 감사 **미검증** 후보 — 착수 전 각 항목을 직접 확인할 것 (P3)
아래는 병렬 조사 에이전트가 보고했으나 **내가 코드로 확인하지 않은** 항목이다. 위 항목들과 달리 근거가 2차 정보라 그대로 믿고 고치면 안 된다 — 착수 시 해당 파일을 열어 재확인하는 것이 첫 단계다. 잃어버리지 않으려고 남긴다.

**인덱스 후보 (위 GIN 항목과 같은 PR 에서 일괄 검증·추가하면 효율적)**
- `chat_conversations.pg_ws_id` 단독 — 기존 `pair_uniq(buyer_ws_id, pg_ws_id)` 는 buyer 가 선행이라 PG 측 `listForWorkspace`·presence ACL 이 못 쓴다는 주장
- `biz_profiles.biz_no` — `RfpRepo.save` 의 `WHERE biz_no = ? ORDER BY created_at DESC`
- `notifications (user_id, workspace_id) WHERE read_at IS NULL` 부분 인덱스 — `workspace.listForUser` 의 상관 서브쿼리가 멤버십 행마다 재평가되며 **모든 인증 페이지 로드**에서 돈다는 주장. 사실이면 이 목록에서 가장 값어치 있다
- `signing_contracts.rfp_id` 전 상태용 — 기존 인덱스가 부분(active 상태만)이라 종결 라운드 조회가 빠진다는 주장
- `rfp_team_messages.workspace_id` 단독 / `lower(users.email)` / `outbox_entries (to_addr, event, status)`

**코드 후보**
- `app/(app)/layout.tsx` 의 `userRepo.findById` — React `cache()` 미적용이라 요청당 2~3회, 게다가 `passwordHash` 포함 전체 행을 읽고 JS 로 버린다는 주장. 소비하는 건 `{name, avatarUpdatedAt}` 뿐
- `outbox.flush` 의 행별 `markResult` — 성공 시 `1+N`, 전건 실패 시 `2+2N` UPDATE. 배치 상한은 있음(기본 50)
- `team-chat.ts` 의 첨부 메타 재조회 — 바로 윗줄 `findUnclaimedByIds` 가 같은 행을 이미 한 쿼리로 가져왔고, 재조회는 호출자 순서 복원용이라 메모리에서 처리 가능하다는 주장

### N+1 전수조사 잔여 — 카디널리티 낮은 지점 8건 (P4)
`lib/`·`app/`·`components/` 전수조사(2026-08-07)에서 후보 42곳을 기계적으로 열거해 전부 판정했다. 사용자 대면 읽기 경로 4건과 `notify()` 팬아웃은 해소했고(대화 목록은 30개 대화 기준 실측 **151 → 4 SQL**), 아래는 카디널리티가 낮거나 사용자 대면이 아니라 남긴 것들이다. 전부 위치·형태가 확인된 상태라 착수 시 재조사가 필요 없다.

- `contract-signing.ts` `nudgeStaleAwaiting` — 계약당 rfp+bid 조회. cron, `limit=50` 상한
- `contract-signing.ts` `pollPending` — 계약당 외부 API 호출이 본질이라 DB N+1 이 아님(수정 대상 아님)
- `contract-signing.ts` reconcile 참여자 루프 — 계약당 참여자 2~3명
- `outbox/{chat,team-chat}-digest-flush.ts` — 엔트리당 `markResult`. 배치 상한 있음
- `workspace.ts` `listMembershipsWithMembers` — 사용자 소속 워크스페이스 수(보통 1~3)
- `workspace.ts` 워크스페이스 생성 시 초기 멤버 insert — 1회성
- `services/{chat,team-chat}.ts` digest 루프 — 수신자당 `hasPending*Notification` 1쿼리. **수신자별 게이팅이라 `notify()` 배치화로 접을 수 없다** — 접으려면 그 판정을 배치 조회로 먼저 바꿔야 한다
- `rfp.ts` 초대 draft/승격·재요청 루프 — PG 수 상한

### RFP 발송 초대 팬아웃이 트랜잭션 안에서 PG마다 이메일을 렌더링한다 (P3)
`RfpService` 의 발송 경로는 허용 PG 마다 `invitationRepo.save` 1회 + `renderRfpInvited`(React 이메일 렌더, CPU) 1회를 **트랜잭션이 열린 채** 수행한다. 안쪽 멤버 루프는 `notify()` 배치화로 접혔지만(v0.4.47.0) 바깥 PG 루프는 `1 + 2N` 으로 남았다.

배치화하려면 두 가지가 걸린다: ① 초대 토큰이 PG별로 달라 `saveMany` 에 앞서 토큰을 미리 생성해야 하고, ② 렌더링된 본문에 PG별 고유 `inviteUrl` 이 박혀 있어 렌더 결과를 공유할 수 없다. 실질적인 개선은 배치 insert 보다 **렌더링을 트랜잭션 밖으로 빼는 것**이다. 초대 토큰 생성 경계를 건드리므로 단독 PR 로 다룬다.

## Chat / Realtime

### 워크스페이스별 읽음 상태 E2E 2건 — 라이브 영수증·오프라인 digest worker (P1)
`conversation-read-state` 출고 계획에서 단위·통합 테스트로는 확인했지만, 아래 두 실제 경로를 Playwright/worker 통합으로 아직 검증하지 않았다.

- 구매사가 메시지를 보내고 PG가 `/messages`를 열었을 때 PG cursor 저장·워크스페이스 범위 실시간 이벤트·구매사 스레드의 최신 커버 메시지 한 건만 `읽음` 표시되는 흐름
- PG가 오프라인인 채 digest window가 닫혔을 때 워커가 워크스페이스별 미확인 메시지를 다시 계산해 이메일 한 통을 보내고, 그 전에 읽음 또는 presence가 생기면 발송을 취소하는 흐름

**Deferred from plan:** `~/.gstack/projects/bothsides-platform-dev-supporter-b/yeonseong-chore-conversation-read-state-ship-test-plan-20260906-005645.md` (2026-09-07).
**Priority:** P1

### presence M2 착수 시 — history 잉여 표면 재평가 + deriveActivity 실배선 (P4)
presence 관계 게이트 전환(2026-07-23, THREAT_MODEL §2.3/§2.6)이 남긴 후속 두 가지. ① `history_size: 1`/`history_ttl: 60s`/`allow_history_for_subscriber` 는 현재 소비 코드 0곳(`.history()` 호출 부재 — config 주석의 late-observer 복구는 aspirational)이라 관계-내 내용 주입의 60초 보관 표면만 남긴다. M2 활동 레이어가 실제로 history 를 쓰지 않기로 하면 세 키를 제거(드리프트 가드 갱신 동반). ② `deriveActivity` 의 `{state}` enum 검증은 publication 핸들러가 없어 도달 불가능한 코드 — M2 에서 publication 소비를 배선할 때 이것이 계획된 게이트임을 THREAT_MODEL §2.4 가 명기한다. (발견: /ship 적대 리뷰 2026-07-23)

## Design

### `UserPhoneForm` 폴리시 5건 — 같은 화면 형제 행과 어긋난다 (P4)
v0.4.46.0 이 낸 설정 > 프로필의 휴대폰 인증 행이 바로 아래 `WorkspaceNameForm`·`WorkspaceBizNoForm` 과 다섯 군데에서 갈린다. 하드룰 위반은 아니고 전부 일관성·§6·UX_WRITING 문제다.
① 설명문(`:60`)이 `md-label-small`(11px, 메타 라벨 전용)인데 형제 행의 같은 성격 문장은 13px body-medium 이고 그쪽 코드 주석이 그 규칙을 명시한다(DESIGN.md §3) — 같은 화면 같은 개념에 두 크기.
② 취소 버튼(`:95`)이 `disabled:opacity-50` — DESIGN.md §12 의 프로젝트 표준은 38 이다(50 은 shadcn `ui/*` 래퍼 값인데 이 컴포넌트는 래퍼도 `primitives/*` 도 아니다). `disabled:cursor-not-allowed` 도 빠졌다.
③ 편집 트리거 라벨(`:80`)이 `변경` 인데 형제 두 행은 같은 어포던스를 `수정` 이라 부른다 — 인접 3행에 두 단어. (`인증하기` 쪽은 `PhoneVerificationField` 와 맞아 정당하다.)
④ 빈 상태 값(`:73`)이 `등록 안 됨` — 음슴체 명사구라 UX_WRITING §1(해요체)·§3(긍정형) 위반이고, 두 행 아래는 같은 개념을 `아직 사업자번호가 등록되지 않았어요.` 로 쓴다.
⑤ OTP 검증 성공 후 `updateMyPhoneAction` 왕복(`:36-38`)에 진행 표시가 없다 — 보이는 변화가 취소 버튼 흐려짐뿐이라 DESIGN.md §6 의 한국어 진행 라벨 요구(`저장 중…`)를 안 지킨다. `PhoneVerificationField` 는 자기 전송 단계에 이미 표시하므로 이 컴포넌트가 소유한 왕복만 침묵한다. (발견: v0.4.49.0 컷 감사)

### 계약서 템플릿 킬 스위치 로딩 스켈레톤이 4px 점프한다 (P4, v0.4.56.0 플래그 on 으로 잠복)
`app/(app)/contract-templates/loading.tsx:12` 가 `flex items-center gap-3 py-3`(12+20+12 = 44px)로 헤더 스트립을 그리는데, 뒤따르는 페이지는 `description` 없는 `PageHeader` 라 `h-12`(48px)다 — 스켈레톤이 걷힐 때 4px 밀린다. 선존재 전체 목록 스켈레톤이 `pt-3` 를 쓰는 건 맞다(플래그 켠 페이지는 description 을 넘겨 2행 스트립이 된다). 꺼진 경로만 `h-12` 로 맞추면 된다. **플래그가 켜진 지금은 off 경로가 렌더되지 않아 잠복** — 재비활성화 시 위 off-branch 테스트 복원과 함께 처리. (발견: v0.4.49.0 컷 감사)

### 로딩 라벨 한국어화 잔여 — `UPLOADING…` 3곳 + 드리프트 가드 부재 (P4)
v0.4.44.0 이 `LOADING…` 을 전면 한국어화(`처리 중…`/`불러오는 중이에요…`)하고 DESIGN.md §6 이 영문 진행 라벨 폐지를 규정했지만, 같은 계열의 `UPLOADING…` 이 `components/messages/MessageComposeSheet.tsx`·`components/inbox/bid-wizard/BidStepProposal.tsx`·`components/rfp/RfpAttachmentDropzone.tsx` 세 곳에 남아 있다(`RfpAttachmentDropzone.test.tsx` 가 리터럴을 고정). 한국어 라벨(예: `올리는 중…`)로 바꾸면서 새 컨벤션의 드리프트 가드 테스트(JSX 문자열 리터럴에서 `/(?<!UP)LOADING…/` + `UPLOADING…` 그렙 — 기존 `lib/design/__tests__` 소스 스캔 패턴 재사용)를 함께 넣어야 재발이 막힌다. 인접 발견: 새 해요체 자리표시 라벨 옆에 선존재 합쇼체 부제가 병치되는 화면 4+1곳 — invite 클라이언트 4곳(`초대 링크를 확인하는 중입니다` 등)과 `password/reset` 완료 화면(`비밀번호가 변경되었습니다.` + 리다이렉트 대기를 `불러오는 중이에요…` 로 표기) — 은 UX_WRITING §1·§2 정리 스윕(스코프 B) 몫. (발견: /ship 스페셜리스트 리뷰 2026-08-06)

### 모션 토큰 손복사본이 `tokens.css` 쪽으로는 안 묶여 있다 (P4)
`lib/theme/view-transition.ts` 의 `DURATION` 은 WAAPI 가 리터럴을 요구해 `styles/tokens.css` 의 `--md-sys-motion-duration-medium-4` 를 손으로 복사한 값이고, 주석은 테스트가 "드리프트를 막는다"고 적고 있다. 실제로 `__tests__/view-transition.test.ts` 가 막는 것은 **소스↔테스트** 한 축뿐이다 — 리터럴을 쓴 것 자체는 옳지만(상수를 import 하면 `X === X` 가짜 테스트), 누가 `tokens.css` 의 토큰 값을 바꾸면 테마 리빌만 조용히 토큰과 갈라지고 전 테스트가 그린으로 남는다. 이 레포엔 이미 정답 패턴이 있다 — `app/__tests__/chrome-colors.test.ts` 가 `tokens.css` 를 직접 읽어 캔버스 hex 체인을 고정하고, `lib/design/__tests__/text-contrast.test.ts` 도 tokens.css 의 hex 를 읽는다. 같은 방식으로 tokens.css 에서 duration 토큰 값을 파싱해 소스 리터럴과 대조하면 세 지점이 한 번에 묶인다. 실피해는 "토큰을 고쳤는데 테마 전환만 옛 값" 정도라 P4. **범위 축소 (v0.4.48.0)**: `EASING` 은 이제 토큰 복사본이 아니라 `linear` 라 이 축에서 빠졌다 — 남은 것은 duration 한 값뿐이다. (발견: /ship 릴리스 컷 리뷰 2026-07-31)

### 접힘 사이드바에서 하위 항목에 도달할 수 없다 (P3)
48px 아이콘 모드에서 `SidebarSection` 의 children 이 `group-data-[collapsible=icon]:hidden` 으로 통째로 사라지고 chevron 도 숨는다 — `진행중`·`마감`·`신규`·`견적 보냄` 으로 가는 경로가 **없다**(리스트 페이지에 들어가 다시 고르는 우회뿐). 현재 접힘 툴팁은 라벨만 보여준다. 표준 해법은 접힘 레일 항목 hover 시 하위 항목 플라이아웃. 접힘 모드를 상시로 쓰는 사용자에게는 상태 필터가 사실상 없는 셈이다. (발견: /frontend-design 사이드바 리뷰 2026-07-29)

### `useIsMobile` 의 768px 와 Tailwind `md:` 의 48rem 이 어긋난다 (P3, 선존재)
`lib/hooks/useIsMobile.ts` 는 `MOBILE_BREAKPOINT = 768`(**px**)로 판정하는데, Tailwind v4 의 `md:` 는 `48rem`(**루트 폰트 상대**)이고 `@theme` 에 `--breakpoint-md` 오버라이드가 없다. 루트 폰트가 16px 가 아니면 둘이 갈린다 — 접근성 설정으로 글자를 키웠거나 브라우저 텍스트 줌을 쓰는 사용자에게 흔하다. 루트 20px·뷰포트 800px 이면 CSS 는 모바일로 보고(헤더 숨김, `MobileShellBar` 표시) JS 는 데스크톱으로 봐서, 모바일 바의 토글이 시트를 여는 대신 데스크톱 사이드바를 접는데, 그 트리는 `hidden md:block` 이라 이 폭에서 애초에 안 보인다 — 사용자에겐 **버튼이 아무 반응도 없는** 것으로 읽히고 `sidebar_state` 쿠키만 조용히 접힘으로 바뀐다(다음에 `md` 위 폭으로 올라가면 이유 없이 접힌 채로 뜬다). 툴팁도 함께 뜬다. 반대로 루트 12px·뷰포트 700px 이면 데스크톱 헤더가 보이는데 사이드바는 off-canvas 시트다. 둘 다 복구 가능한 상태라 P3 이지만, 접기 토글이 헤더로 옮겨가면서 "가시성은 CSS·동작은 JS" 분리가 처음으로 하중을 받게 됐다. 해법은 `@theme` 에 `--breakpoint-md: 768px` 를 박아 픽셀 기준으로 맞추거나, 트리거 가시성을 `useIsMobile` 로 파생시키는 것 — 전자는 앱 전역 브레이크포인트를 바꾸므로 별도 스윕이 필요하다. 드리프트 가드 테스트로 `MOBILE_BREAKPOINT` 와 해석된 `md` 를 묶어두면 재발을 막는다. (발견: /ship red-team 리뷰 2026-07-31)

### 앱 셸에 banner 랜드마크가 없다 (P3, 선존재·상속)
`SidebarInset` 이 `<main>` 을 렌더하는데(`components/ui/sidebar.tsx`) `AppSidebarLayout` 이 `Header` 와 `MobileShellBar` 를 그 **안**에 넣는다. `<main>` 하위의 `<header>` 는 banner 랜드마크가 되지 않아, 스크린리더 사용자가 전역 크롬(브레드크럼·검색·사용자 메뉴)으로 점프할 방법이 없다. shadcn 정본 블록도 똑같이 헤더를 `SidebarInset` 안에 두므로 상속된 결함이다. 고치려면 헤더를 `SidebarInset` 밖으로 빼야 하는데 그건 **전체 폭 상단 바 개편**과 같은 작업이고, `DESIGN.md` 의 "별도 글로벌 톱바는 없다" 결정을 뒤집는 사안이라 별도 판단이 필요하다 — 톱바 개편을 다시 검토한다면 이것이 유일한 구조적 근거다. (발견: shadcn 정본 대조 2026-07-30)

### `새 견적 요청` 이 상태 필터와 같은 층위다 (P3)
`lib/nav/nav-config.ts` 에서 구매사의 유일한 핵심 액션(`/rfp-create`)이 `진행중`·`마감` 필터와 **같은 `SidebarSubItem` 문법**으로 렌더된다 — 무게가 같아 '만들기'가 '거르기' 사이에 묻힌다. PG 쪽에는 대응하는 생성 액션 자체가 없어 두 워크스페이스의 사이드바 문법이 비대칭이다. 승격 방식(전용 버튼 / 섹션 상단 분리 / 헤더 이동)은 제품 판단. (발견: /frontend-design 사이드바 리뷰 2026-07-29)

### 사이드바 푸터 IA 가 DESIGN.md 와 표류 (P4)
~~`DESIGN.md` 의 **Sidebar** 절 footer 항목은 footer = 알림 / 테마 토글 / 사용자 아바타로 규정하는데, 실제는 문의하기 / 테마 / 접기(+모바일 아바타)다. 알림은 상단 nav 로 올라갔고 문의하기는 문서에 없다. 지원 액션·표시 설정·크롬 컨트롤 세 종류가 한 칸에 섞여 있는 것도 원인.~~ — **부분 해결 (v0.4.36.0)**: 크롬 컨트롤(사이드바 접기)이 헤더 좌측으로 빠지면서 세 종류 중 하나가 정리됐고, DESIGN.md 도 현행화했다. 잔여는 지원 액션(문의하기) vs 표시 설정(테마)이 여전히 한 칸에 있다는 것 — 둘뿐이라 우선순위는 더 낮아졌다. (발견: /frontend-design 사이드바 리뷰 2026-07-29)

### 접힘 시 워크스페이스 타입(`구매사`/`PG`)이 사라진다 (P4)
`WorkspaceSwitcher` 의 타입 Chip 이 `group-data-[collapsible=icon]:hidden` 이고 접힘 트리거에는 툴팁이 없다. buyer·PG 워크스페이스를 둘 다 가진 사용자는 48px 모드에서 아바타만 보고 자기가 어느 쪽에 있는지 판단해야 한다. 실제 위험은 처음 본 것보다 작다(아바타가 워크스페이스별로 다르고 하위 nav 도 `견적 요청` vs `받은 견적 요청` 으로 갈린다) — 그래서 P4. 고치려면 `useSidebar()` 결합 + 툴팁이 필요한데, `WorkspaceSwitcher.test.tsx` 가 `SidebarProvider` 없이 `div[data-collapsible]` 목으로만 도는 하네스라 테스트 재작성이 함께 든다. (발견: /frontend-design 사이드바 리뷰 2026-07-29)

### 전역 `keep-all` 이후 좁은 flex/grid 트랙 실측 스윕 미완 (P3)
`word-break: keep-all` 은 한글 텍스트 런의 **min-content 폭**을 1글자에서 가장 긴 어절로 올린다. 짝인 `overflow-wrap: break-word` 는 (CSS Text 3 상) soft-wrap 기회가 min-content 계산에서 제외되므로 그 증가를 상쇄하지 **않는다** — `min-width:auto` 에 기대는 flex/grid 아이템(`min-w-0` 없는 행·칸반 카드·테이블 셀·칩)은 좁은 뷰포트에서 줄바꿈 대신 트랙을 밀어낼 수 있다. 라이트/다크 데스크톱과 랜딩은 실측했고 문제 없었지만, **360px 폭에서 밀도 높은 면(칸반 보드·사이드바·딜룸 탭·비교표)은 미실측**이다. 넘치는 곳은 `min-w-0` 추가 또는 국소 `break-normal`. (발견: /ship performance 리뷰 2026-07-29)

### 스노우싸인 임베드 iframe 하드닝 — sandbox 는 해결, `frame-src` CSP 는 미해결 (P2)
**sandbox·referrerPolicy 는 해결 (v0.4.37.0)**: 임베드가 `/signing-templates` 에서 딜룸 계약 탭(`SigningSendEmbed`)으로 옮겨오면서 `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"`(top-navigation 계열 의도적 제외) + `referrerPolicy="no-referrer"` 를 걸었다. 이로써 침해된 임베드가 흐름 도중 최상위를 피싱 페이지로 돌리는 벡터는 닫혔다. **다만 이 권한 집합은 실 스노우싸인이 무엇을 요구하는지 모르는 채 정한 추정치다** — 실 스모크(Q1)에서 임베드가 깨지면 필요한 것만 되열어야 한다.

**`frame-src` CSP 는 여전히 없다 (P2)**: 확인해보니 레포·`deploy/Caddyfile` 어디에도 `Content-Security-Policy` 헤더가 **아예 없다** — 즉 이건 "frame-src 한 줄 추가"가 아니라 CSP 자체를 도입하는 별도 과제다(Sentry·Axiom·Channel.io·Centrifugo·R2 등 모든 소스를 열거해야 하고 잘못 조이면 앱이 깨진다). 그 전까지 남는 위험은 그대로다: postMessage 의 fail-closed 오리진 가드가 `new URL(iframeUrl).origin` 으로 **공급자가 준 문자열에서** 신뢰 오리진을 파생하므로, 이 가드는 allowlist 가 아니라 "API 가 알려준 호스트를 믿는다"다. 공급자측 침해·응답 변조·`SNOWSIGN_API_URL` 오설정 중 하나만 성립하면 적대 오리진이 프레임되는 동시에 신뢰받는 postMessage 피어가 된다. CSP 도입과 별개로 **값싸게 조일 수 있는 축**은 남아 있다: 기대 임베드 오리진을 env 에 핀하고 오리진이 다른 `iframe_url` 은 **서버에서** 거부한다(핀 값은 스모크 Q4 가 알려준다). 스킴·형식 검증(`reqAbsoluteUrl`)은 v0.4.35.3 에서 이미 해결됐다. (발견: /ship security 리뷰 2026-07-29 · 적대 리뷰 2026-07-30. v0.4.37.0 에서 sandbox 해결 + CSP 부재 사실 정정)

### postMessage 핸들러가 `e.source` 를 검증하지 않음 (P4)
`SigningSendEmbed` 의 리스너는 `e.origin` 만 대조하므로 같은 오리진의 다른 창(임베드가 연 팝업·사용자가 열어둔 다른 스노우싸인 탭)이 보낸 메시지도 통과한다. 도달 조건이 좁고(이미 신뢰 오리진), 무엇보다 **여기서 온 계약 id 는 신뢰 대상이 아니다** — `attachProviderContract` 가 ACL 재검증 + `getContract` 재조회 + 바인딩 유일성으로 다시 막는다. 고치려면 iframe ref 를 잡아 `e.source !== ref.current?.contentWindow` 를 거른다. (발견: /ship security 리뷰 2026-07-29. v0.4.37.0 에서 딜룸 임베드로 이관 — 완료 1회 가드는 함께 해결됐다)

### ~~postMessage 완료 핸들러에 1회 가드가 없다 (P3)~~ — 해결 (v0.4.37.0)
`SigningSendEmbed` 가 `doneRef` 로 완료를 1회만 처리한다. 서버(`attachProviderContract`)도 멱등이라 이중 방어다.

### ~~수동 폴백 토글이 포커스를 버린다 / 세션 중간 리사이즈 (P3)~~ — 해결 (v0.4.37.0)
수동 템플릿 ID 입력 폴백이 화면과 함께 사라졌다. (고아 복구는 v0.4.38.0 에서 `보낸 계약서 찾기` 로 해결됐다 — 사람이 id 를 타이핑하는 게 아니라 서버가 좁힌 후보를 고르는 방식이라, 필터 없는 수동 입력이 열어젖힐 소유 검증 갭을 만들지 않는다.)

### 임베드 단계 레이아웃에 실브라우저 회귀 가드가 없다 (P3)
v0.4.35.2 의 카드 유출 회귀는 **레이아웃 계산이 있어야만** 잡힌다 — jsdom 은 계산하지 않는다. 임베드가 딜룸 계약 탭으로 옮겨오면서 그 화면(`/signing-templates`)과 함께 문제의 `min-h-0` 체인도 사라졌지만, 새 위치에서 같은 붕괴가 재발할 여지는 남는다. 낮은 뷰포트에서 "카드 bottom ≥ 내부 컨트롤 bottom" 을 재는 Playwright 스펙이 필요한데 임베드 세션 스텁이 선행 과제다. (발견: /ship 적대 리뷰 2026-07-30, v0.4.35.2. v0.4.37.0 에서 대상 화면 이관)

### ~~계약서 템플릿 하드 삭제가 크로스-테넌트 링크 클레임을 푼다 (P3)~~ — 해결 (v0.4.37.0)
템플릿 개념이 폐지되면서 링크·삭제·재링크라는 상태 기계 자체가 사라졌다.

### ~~딜룸 로더의 계약서 템플릿 조회가 상태 무관 상시 실행~~ — 해결 (Wave 2)

`listByWorkspace` 는 **BidWizard 가 실제로 렌더될 때만** 돈다(`pgDealRoomShowsBidWizard`). `findSigningTemplateId`+`findById` 는 이미 `awardedToMe` 로 게이트돼 있었다. 조건을 화면과 공유하는 단일 출처로 뺀 이유는 성능이 아니라 **비대칭** 때문이다 — 로더가 더 가져오면 쿼리 한 번 낭비지만, 덜 가져오면 위저드가 빈 목록으로 렌더돼 픽커가 사라지고 초안의 템플릿 선택이 '삭제됨'으로 오인돼 해제된다. `PgDealRoomBody.test.tsx` 의 드리프트 가드가 상태 조합마다 "술어 === 화면에 위저드가 있는가"를 대조한다(술어를 깨면 실패하는 것으로 확인). (해결: Wave 2 2026-08-04)

<details><summary>원 항목</summary>

### 딜룸 로더의 계약서 템플릿 조회가 상태 무관 상시 실행 (P4) — **재개봉 (PR#470)**
~~해결 (v0.4.37.0): `loadPgRfpDetail` 이 더 이상 템플릿을 조회하지 않는다(쿼리 2개 감소).~~ 템플릿 재도입으로 `loadPgRfpDetail` 이 다시 `listByWorkspace` + `findSigningTemplateId` 를 상태 무관 상시 실행한다 — BidWizard 픽커·딜룸 지름길 표시용이지만 awaiting 아닌 딜룸에도 나간다. **낭비 비율 상승 (v0.4.49.0) → 원상 복귀 (v0.4.56.0)**: kill switch 가 꺼져 있던 동안은 `PgDealRoomBody` 가 두 결과를 전부 버려 소비자가 0 이었다(그동안 고치면 이득 100%). **재활성화로 소비자(BidWizard 피커·딜룸 지름길)가 돌아와** 원래의 "awaiting 아닌 딜룸에도 조회가 나간다" 수준의 낭비로 되돌아갔다 — 상태 조건부 조회로 좁히는 원 처방은 그대로 유효.

</details>

### ~~`findBySnowsignTemplateId` 가 시퀀셜 스캔 (P4)~~ — 해결 (v0.4.37.0)
테이블과 함께 삭제됐다.

### 재요청(2라운드) 재제출이 직전 라운드의 계약서 선택을 이어받지 않는다 (P4) — **재개봉 (PR#470)**
~~해결 (v0.4.37.0): 견적별 계약서 선택(`bids.signing_template_id`)이 폐지됐다 — 이어받을 값이 없다.~~ 컬럼이 부활하면서 갭도 부활했고 더 넓어졌다 — `signingTemplateId` 가 `BidDraft` 에도 없어 **초안 복원조차** 선택을 무음으로 떨어뜨린다("그대로 불러왔어요" 토스트가 거짓). 재견적 라운드는 NULL 로 저장. 수정 예정: 감사 수정계획 Wave 2 (M23).

### 사용자 문구가 내부 명칭 '딜룸'을 노출 (P4)
신규 문구 5곳(+기존 알림 body)이 `딜룸` 을 쓰는데 UX_WRITING §8 용어집에 없고
화면 어디에도 그 이름의 탭·nav 가 없다. 사용자가 가본 적 없는 이름으로 안내받는다.
용어집에 추가하고 기존 문구까지 정렬하거나, 실제 경로 이름으로 교체한다.
(발견: /ship design 리뷰 2026-07-29)

### ~~`listSigningTemplatesAction` 이 호출자·테스트 없는 죽은 서버 액션 (P4, 선존재)~~ — 해결 (v0.4.37.0)
템플릿 액션 6개가 모두 삭제됐다.

### ~~계약서 템플릿: 역할이 1개인 계약서는 저장 불가 (P3)~~ — 해결 (v0.4.37.0)
역할 매핑 화면 자체가 사라졌다. 서명 역할은 이제 PG 가 스노우싸인 임베드 안에서 직접 정하므로 앱이 강제하는 제약이 없다.

### ~~계약서 템플릿 목록에 행 액션이 없다 (P3)~~ — 해결 (v0.4.33.0)
행 `[⋯]` 메뉴에 `이름 바꾸기`·`삭제`를 붙였다(repo 에 `updateName`/`remove` 추가, 둘 다 워크스페이스 스코프). 삭제는 하드 삭제지만 안전하다 — 이미 보낸 계약은 SnowSign 에 살아 있고 `signing_contracts.snowsign_template_id` 는 FK 없는 텍스트 사본이라 이력이 남으며, 이 템플릿을 골라둔 견적은 `ON DELETE SET NULL` 로 사전 선택만 풀린다. '기본 지정 해제'는 요구 자체가 사라졌다 — 견적별 선택 모델로 바뀌며 `is_default` 를 제거했다.

### ~~초대 수락 화면이 하드코딩 목업 + 거절 버튼 무동작 (P3)~~ — 해결 (v0.4.24.0, 삭제)
`app/(public)/invite/page.tsx` 를 배선하는 대신 **삭제**했다. 조사 결과 이 bare `/invite` 는 **어디서도 링크되지 않는 고아 라우트**였다 — 실 초대는 전부 `/invite/rfp/[token]`·`/invite/workspace/[token]` 로 가고(이메일 템플릿·서비스 레이어에 bare `/invite` 링크 0건), 목업이 읽던 `?token=` 을 생성하는 코드도 없었다. 토큰 없이는 바인딩할 실데이터 자체가 없으므로 배선은 성립하지 않는 선택지였다. 거절 액션도 실 워크스페이스 초대 플로우에 애초에 없는 기능이라(초대는 무시하면 되고 철회는 초대자 쪽에서 한다), 무동작 버튼이 가리고 있던 미구현 기능은 없다.

**주의 — `lib/auth/route-decision.ts` 의 `/invite` 는 지우면 안 된다.** 그것은 bare 페이지용 등록이 아니라 `PUBLIC_PREFIXES` 의 **서브트리 프리픽스**이고, 실 초대 경로 두 개가 여기에 의존한다 — 빼면 비인증 방문자의 워크스페이스 초대 링크가 `/login?next=...` 로 튕긴다. 같은 이유로 `app/(public)/invite/layout.tsx` 도 남겼다: 하위 두 페이지가 자기 metadata 를 선언하지 않아 그 레이아웃이 **토큰 URL 의 유일한 noindex 출처**다(파일에 주석으로 명시). (발견: /ship 적대 리뷰 F14, 2026-07-22, v0.4.11.0 · 해결 v0.4.24.0)

### ~~3차 텍스트 톤 소멸에 따른 위계 재설계 — 육안 확인 필요 (P3)~~ — 해결 (v0.4.25.0, ①은 원인 이관)
세 후보의 처리가 갈렸다.

- **② 업로드 지시문 / 용량 힌트 (`BidStepProposal.tsx`·`RfpAttachmentDropzone.tsx`) — 고침.** 지시문을 `md-label-large` + `on-surface` 로 승격해 13px/주톤 위 11px/보조톤의 2축 단차를 만들었다. `md-label-large` 를 고른 근거는 크기 확보가 아니라 역할이다 — 두 요소 모두 실제 컨트롤(`<button>` / `role="button"`)의 라벨이고 DESIGN.md §3 이 Label Large 를 "버튼·nav·Chip"에 배정한다. 톤은 2단으로 유지했으므로 `WizardStepSidebar`·`PgProcessStepRail` 선례와 같은 문법이다. 두 파일 모두 "두 단이 같은 표기로 다시 붙으면 실패"하는 회귀 테스트로 잠갔다.
- **③ `ProblemCard.tsx` 장식 숫자 — 고침.** `clamp(28px,4vw,44px)` → `clamp(18px,2vw,24px)`. 모든 뷰포트에서 자기 `h3`(`clamp(20px,2.8vw,30px)`)보다 작도록 잡았다(18<20 · 2vw<2.8vw · 24<30, 교차 없음). TODO 가 열어 둔 opacity 선택지는 **반려**했다 — DESIGN.md §12 가 `opacity-38` 을 disabled 전용으로 잡아 두어 같은 화면에서 반투명이 두 의미를 갖게 되고, 더 구조적으로는 대비 가드(`lib/design/__tests__/text-contrast.test.ts`)가 `tokens.css` 의 hex 를 읽어 비율을 계산하므로 합성색을 볼 수 없다. §2 가 색으로 만들기를 거부한 sub-AA 톤을, 하필 가드가 눈먼 지점에 만드는 셈이다. §2 의 처방("색이 아니라 타입스케일")이 곧 크기 축소다.
- **① `CostComparisonChart.tsx:22/25` — 위계 문제가 아니었다.** 원인은 아래 "랜딩 `text-[var(--text-*)]`" 실버그이고, 그 항목으로 이관한다. 두 줄은 지금 조상 크기(14px)를 상속하고 색 토큰까지 덮여 있어 "같은 색·크기·서체"로 보였을 뿐이다. 애초에 둘은 같은 baseline 행의 좌측 차트 제목 / 우측 단위 주석이라 **동급이 맞다** — 위계를 세울 쌍이 아니라 공간 분리가 구분을 지는 쌍이다.

(발견: /ship design 리뷰 2026-07-22, v0.4.11.0 · 해결 v0.4.25.0)

<details><summary>원문</summary>

v0.4.12.0 이 `outline` 을 텍스트에서 걷어내면서 텍스트 색이 2단(`on-surface`/`on-surface-variant`)으로 줄었다(같은 릴리스에서 라이트 `on-surface-variant` 를 `#5F646D` 로 어둡게 조정해 대비 자체는 전 표면 계층에서 AA 를 넘겼다 — 남은 것은 위계 문제다). AA 를 통과하면서 `on-surface-variant` 보다 옅은 색은 만들 수 없으므로(상한 L≤0.175 vs 실제 L=0.161) 그 아래 위계는 타입스케일로 만들어야 하는데, 스윕은 색만 올렸고 크기·굵기는 손대지 않았다. 명시적으로 접은 두 곳(`WizardStepSidebar` 라벨·`PgProcessStepRail` 제목 — 배지·도트가 상태를 대신 진다) 외에 리뷰가 지목한 잔여 후보: ① `components/landing/CostComparisonChart.tsx:25` 이어브로우와 단위 라벨이 같은 색·크기·서체가 됨, ② `BidStepProposal.tsx:57`·`RfpAttachmentDropzone.tsx:160` 의 "업로드 지시문 / 용량 힌트" 두 단이 한 톤으로 붙음, ③ `ProblemCard.tsx:13` 의 clamp(28–44px) 장식 숫자가 워터마크에서 읽히는 2차 요소로 바뀜(대형 텍스트라 AA 기준은 3:1 이므로 opacity 로 되돌릴 여지 있음). 전부 신뢰도 3–4 의 육안 판단 건이라 `/design-review` 로 실제 화면을 보고 결정한다. (발견: /ship design 리뷰 2026-07-22, v0.4.11.0)

</details>

### ~~랜딩 `text-[var(--text-*)]` 36곳이 폰트 크기를 적용하지 않고 색 토큰까지 덮는다 (P2)~~ — 해결
36곳을 `text-sm` 으로 고정해 무효 유틸리티와 색 클로버를 함께 없앴다(확정 방침대로 크기 델타 0 — 시각 변화는 색 복구뿐). 동반 가드 `lib/design/__tests__/text-size-token-drift.test.ts` 가 hint 없는 `text-[var(--비색상토큰)]` 형태를 전 소스에서 잡는다: 정식 표기 `text-[length:var(--md-typescale-*)]`(42곳)는 잡지 않고, 매처가 공허하지 않음을 양방향 변이 테스트로 못박았다. 클래스 리터럴은 `__tests__/` 안에만 뒀다(`globals.css` 의 `@source not "../**/__tests__/**"`).

`--md-sys-color-surface-variant`·`hsl(var(--sidebar-border))`·`--sidebar-width` allowlist 는 **더 센 "고아 변수" 가드**의 전제조건이었고 그 가드는 채택하지 않았으므로 이번 범위 밖이다 — 아직 열려 있는 별건이다.

<details><summary>원문</summary>

`components/landing/**` 36곳이 폰트 크기를 `text-[var(--text-2xs)]` 형태로 쓴다. 두 겹으로 깨져 있다.

① **Tailwind v4 는 `text-[var(--x)]` 의 타입을 추론하지 못하고 무조건 `color:` 로 컴파일한다.** 빌드 산출물로 확인했다 — `.text-\[var\(--text-2xs\)\] { color: var(--text-2xs); }` (named `text-sm` 은 정상적으로 `font-size:` 를 낸다). 즉 36곳 전부 **폰트 크기가 한 번도 적용된 적이 없고** 조상 크기(body 14px)를 상속한다. ② **`--text-2xs`·`--text-md` 는 정의 자체가 없다** — `styles/tokens.css`·`app/globals.css`·Tailwind 기본 테마 어디에도 없다. `--text-xs/-sm/-base` 는 Tailwind 기본값으로 존재해 `color: 0.875rem` 같은 선언이 된다. 어느 쪽이든 computed-value 시점에 무효라 `color` 가 상속으로 떨어지고, 생성된 `.text-[var(--text-*)]` 규칙이 같은 레이어에서 `.text-[var(--md-sys-color-*)]` 보다 **뒤에** 와서 **의도한 색 토큰까지 조용히 덮는다.**

원인은 토큰 삭제 고아다: `3108b3a3`("Korean Editorial Modernism 토큰 → MD3 교체", 2026-05-10)가 구 스케일(`--text-2xs:0.625rem` … `--text-md:0.875rem`)을 지웠는데 사용처가 남았다.

**실제 대비 결함 3건**: `LandingNav.tsx:76` 헤더 CTA 의 `on-primary` 흰색이 덮여 파란 버튼 위 어두운 글자 · `CustomerTypesGrid.tsx:24`, `PgLanding.tsx:117` 의 primary 블루 강조 숫자가 본문 색으로 렌더.

**수정 방침 (사용자 결정, 2026-07-26): 크기 변화 없이 간다.** 36곳을 현재 렌더 크기와 같은 `text-sm`(14px)으로 고정해 무효 유틸리티와 색 클로버만 고친다 — 시각 델타는 색 복구뿐. 구 스케일(10/12/14px 3단) 복원은 별건으로 분리하고 `/design-review` 시각 승인을 받는다. **`--text-xs/-sm/-base` 를 `@theme` 에서 재정의하면 안 된다** — 그 세 이름은 Tailwind 기본값(12/14/16px)이고 앱 면 29곳(랜딩엔 0곳)이 named 유틸리티로 그 값에 의존한다.

**동반 가드**: `text-[var(--x)]` 의 var 가 색 토큰(`--md-sys-color-*`)이 아니면 실패하는 드리프트 가드를 `lib/design/__tests__/` 에 추가한다(`_source-scan.ts` 재사용, 접두어 SSOT 는 `design-hardrule-allowlist.mjs`). 주의 둘: 정식 표기 `text-[length:var(--md-typescale-*)]`(앱 20+곳)를 잡으면 안 되고, 클래스 리터럴은 반드시 `__tests__/` 안에만 둔다(`app/globals.css:12` 의 `@source not` 제외 대상 — 밖에 두면 Tailwind 스캐너가 읽어 `next dev` 가 500 으로 죽는다, `build` 는 exit 0 이라 CI 로 못 잡는다). 더 센 가드로 "className 안의 모든 `var(--x)` 가 정의돼 있는지" 검사하는 고아-변수 가드도 가능하다(전 레포 미정의 이름 14개뿐). 다만 착지 전 부수 수정 3건이 필요하다 — `--md-sys-color-surface-variant`(존재한 적 없는 토큰; `app/(public)/signup/pg/page.tsx:132`·`.../workspace/PgWorkspaceStep.tsx:95` 의 안내 박스에 배경이 없고 hover 가 죽어 있다), `components/ui/sidebar.tsx:484` 의 shadcn v3 잔재 `hsl(var(--sidebar-border))`, 그리고 인라인 `style` 로 주입되는 `--sidebar-width`/`--sidebar-width-icon` allowlist.

(발견: Design TODO 조사 2026-07-26 — 위 항목 ① 의 실제 원인)

</details>

### ~~인앱 테마 토글이 브라우저 크롬 색을 안 따라감 (P3)~~ — 해결 (v0.4.26.0)
`lib/theme/chrome-color.ts` 의 `syncChromeColor` 를 테마 스토어의 단일 초크포인트 `applyTheme`(`lib/stores/theme.ts`)과 `app/layout.tsx` 의 FOUC 방지 인라인 스크립트 두 곳에서 호출한다. 스토어 쪽 한 지점으로 명시 set·`system` resolve·`matchMedia change`·rehydrate 네 갈래가 전부 덮이고, 인라인 스크립트가 하이드레이션 전 구간을 맡는다.

**media 없는 태그 하나를 head 맨 앞에 만들어 소유한다.** HTML 은 "tree order 상 `media` 가 매치되는 **첫** theme-color 태그"를 쓰므로, 항상 매치되는 태그를 맨 앞에 두면 Next 의 media 스코프 태그 두 개를 늘 이긴다. 그 둘은 손대지 않고 JS 이전 첫 페인트·무JS 환경의 OS 기준 폴백으로 남는다.

**처음 구현은 Next 의 두 태그를 직접 덮어썼고, e2e 가 그것을 잡았다.** 하이드레이션에서 React 가 서버 렌더 값과 달라진 태그를 매칭하지 못해 같은 name 의 태그를 하나 더 끼워 넣는다 — 실측으로 theme-color 가 3개(우리가 덮은 light/dark + React 가 되살린 스테일 light)가 됐다. React 가 소유한 노드를 건드리지 않는 것이 교훈이고, `e2e/theme-persistence.spec.ts` 의 "하이드레이션 후에도 크롬 색이 인앱 테마를 유지한다" 가 이 회귀를 잠근다. 유닛 테스트만으로는 절대 잡히지 않았을 종류다.

**뷰 트랜지션은 훅하지 않았다.** `applyTheme` 안(t=0)에서 갱신한다. `transition.finished` 를 훅하면 크롬 갱신 경로가 둘로 갈리고, 폴백 3개(`startViewTransition` 부재·reduced-motion·`inFlight` 재진입)에 각각 호출을 달아야 한다. 크롬 색은 애니메이트되지 않으므로 얻는 것도 없다.

**로직이 두 벌인 것은 의도다.** 인라인 스크립트는 번들 이전에 실행돼야 해서 `lib/theme/chrome-color.ts` 를 import 할 수 없다. 값은 양쪽 모두 `CANVAS_COLOR` 를 보간하므로 색 리터럴은 갈리지 않는다.

부수 정리: 캔버스 hex 의 JS 사본을 `lib/theme/canvas-colors.ts` 하나로 모았다(이전엔 `app/layout.tsx`·`app/manifest.ts` 에 흩어져 있었다). `app/__tests__/chrome-colors.test.ts` 가 tokens.css → `CANVAS_COLOR` → viewport/manifest 체인과 "두 파일에 hex 리터럴 없음"을 함께 고정한다. (발견: /ship design 리뷰 2026-07-21 · 해결 v0.4.26.0)

<details><summary>원문</summary>

`app/layout.tsx` 의 `viewport.themeColor` 는 `prefers-color-scheme`(OS 설정)으로만 분기하는 정적 선언이라, 사용자가 인앱 테마 토글로 OS 와 다른 테마를 고르면 캔버스는 다크인데 모바일 상태바는 라이트(또는 반대)로 남는다. 값 자체는 캔버스 토큰과 일치하며(`app/__tests__/chrome-colors.test.ts` 가 고정), DESIGN.md §2 에 범위 한정 문구로 명문화해 둔 상태 — 기능 결함이 아니라 미구현 축이다. 닫는 법: 테마 스토어가 클래스를 토글할 때 `<meta name="theme-color">` 의 content 도 함께 갱신해 크롬이 실효 캔버스를 따라가게 한다. (발견: /ship design 리뷰 2026-07-21)

</details>

### ~~AnimatedBrandMark 진입 애니메이션 — DESIGN.md 예외 미문서화 (P4)~~ — 해결 (v0.4.25.0, 문서만)
이 항목이 열려 있는 동안 문서는 이미 따라잡혀 있었다. DESIGN.md §9 에 세 번째 예외 `> **예외 — 브랜드 마크 진입 (Brand Mark Entrance).**` 이 4조건(하드 로드 1회 · reduced-motion 정적 렌더 · `pathLength`/`fillOpacity` 만 구동 · 브랜드 컬러 단일)과 함께 명문화돼 있고, §9 의 하드룰 문장·닫는 문장과 §6 "로딩 모션", CLAUDE.md 의 Motion 항목이 모두 네 예외를 같은 순서로 열거한다. 4조건은 전부 `components/primitives/__tests__/AnimatedBrandMark.test.tsx` 10 테스트(SSOT 경로 · aria-hidden · reduced-motion 정적 렌더 · 엘리먼트 타입 무교체 · `pathLength` 0→1 · 타이밍 · 순수 `<path>` 정착 · dash 시작점 · `DRAW_PATH`↔`BRAND_MARK_PATH` 기하 동일성)가 잠근다.

이번에 실제로 고친 것은 **미문서화 마운트 지점 하나**다: `SidebarBrand` 는 랜딩 데모 셸(`components/landing/demo-app/DemoSidebar.tsx`)도 마운트하는데 §9 구현 노트에 없었다. 랜딩 면이지만 이 컴포넌트는 §9 "랜딩·마케팅 모션"의 reduced-motion 면제를 **취하지 않는다**는 사실도 함께 적었다(나중에 "최적화"로 그 가드가 지워지는 것을 막기 위해).

**CLAUDE.md↔DESIGN.md 예외목록 드리프트 가드는 의도적으로 두지 않는다(YAGNI).** 이 항목이 스테일로 남아 막았을 실패는 *TODO 한 줄*이지 출하된 결함이 아니다. 문서 텍스트 테스트는 churn 대비 신호가 가장 낮아 — 한국어 문장을 다듬을 때마다 빨개지면 매처를 무의미해질 때까지 느슨하게 만드는 훈련이 된다. 기존 가드들(`mono-label-drift`·`outline-text-drift`·`text-contrast`)이 값을 하는 이유는 전부 **소스**를 걸으며 사람이 눈으로 검증할 수 없는 사실을 단언하기 때문이다. "네 예외" 개수 불일치는 10초면 눈에 띈다. (발견: /ship 문서 동기화 점검, dev→main 릴리스 컷 2026-07-17 · 해결 v0.4.25.0)

### ~~한글 본문이 단어 중간에서 줄바꿈된다 — `word-break: keep-all` 부재 (P2)~~ — 해결 (v0.4.30.0)

`app/globals.css` 의 `body` 에 `word-break: keep-all` + `overflow-wrap: break-word` 를 걸고 DESIGN.md §3 에 "줄바꿈" 절로 규칙을 박았다. 짝인 `overflow-wrap` 이 없으면 공백 없는 긴 토큰(URL·이메일·`tmpl_…` 외부 ID)이 좁은 칸을 밀어낸다. **`anywhere` 가 아니라 `break-word`** 인 이유는 `anywhere` 가 flex 아이템의 min-content 폭까지 바꿔 기존 레이아웃을 흔들기 때문. 국소 해제는 Tailwind `break-normal` 한 클래스.

CSS 라 유닛 테스트로 못 잡는다 — 검증은 브라우저 시각 스윕(좁은 컨테이너 위주: 사이드바 nav·칩·칸반 카드·딜룸 레일·알림 목록·비교표 헤더·토스트·모바일 폭·랜딩 히어로)으로 했다. (발견: /qa dev→main 릴리스 워크 2026-07-26 · 해결: 템플릿 두 화면 디자인 통일 패스)

## SEO / Branding

### 브랜드명 리터럴 하드코딩 — SSOT 미참조 (P3)
`서포트 B`→`서포트비` 전환(v0.2.78.0) 과정에서 확인됨: 이메일/SMS 제목 템플릿 11개 파일(`lib/server/services/{rfp,bid,chat,team-chat,auth,workspace}.ts`, `lib/server/outbox/{chat-digest-flush,team-chat-digest-flush}.ts`, `lib/server/outbox/templates/_layout.tsx`, `lib/server/actions/auth/sendPhoneOtpAction.ts`, `lib/server/notifications/admin-signup.ts`)와 `scripts/generate-og-image.ts`가 브랜드명을 SSOT 참조 없이 리터럴로 하드코딩한다(SSOT 는 `siteConfig.name` 하나 — v0.4.3.0 에서 `PRODUCT_NAME` 이 거기서 파생하도록 정리됐다). 이번 리네임에서 12개 파일을 find/replace로 손대야 했던 것이 비용 증거. 후속: 공유 상수를 각 subject 템플릿에 interpolate하도록 리팩터(별도 PR — 템플릿 로직 변경이라 문구 교체보다 범위가 큼). (발견: /ship maintainability+adversarial 리뷰 2026-07-07, 브랜드 전환 PR — 두 리뷰어가 독립적으로 동일 패턴 지적)

## Landing

### 푸터 링크 5개가 `href="#"` — 그중 하나가 법적 고지 (P2)
`components/shell/Footer.tsx` 의 서비스 소개(34)·이용 방법(35)·요금 안내(36)·전자금융거래 약관(54)·공지사항(71) 이 전부 `href="#"` 라 클릭하면 페이지 최상단으로 점프할 뿐 아무 일도 없다. 법적 고지 3개 중 이용약관·개인정보 처리방침은 실제 Notion 문서로 연결되는데 **전자금융거래 약관만 죽어 있다** — 결제 플랫폼이라 이 항목부터 실제 URL 이 필요하다.

**목적지를 추측해서 채우면 안 된다.** 요금 안내는 랜딩에 `#pricing` 앵커가 있지만 푸터는 `/login` 등 앵커가 없는 면에도 렌더되므로, 거기로 걸면 죽은 링크가 깨진 링크로 바뀔 뿐이다. 실제 URL 을 받거나, 문서가 생길 때까지 해당 항목을 내리는 쪽으로 결정할 것. (발견: /qa dev→main 릴리스 워크 2026-07-26)

### ScrambleText rAF 루프가 헤드라인이 화면 밖으로 스크롤돼도 계속 돎 (P3)
`components/landing/hero/ScrambleText.tsx`의 순환 문구 스크램블 애니메이션은 `document.hidden`(탭 백그라운드)에만 반응해 일시정지하고, 히어로 섹션 자체가 스크롤로 화면 밖에 나가도 rAF 루프(60ms 글리프 갱신 + 프레임당 setState)가 계속 돈다(리크는 아님 — cleanup은 정상, 비용도 작은 span 10여 개 스타일 재계산 정도로 트리비얼). 수정 방향: `HeroPinnedScene`이 이미 갖고 있는 `scrollYProgress`를 prop으로 내려받아 히어로 트랙을 벗어나면 정지하거나(`HeroAsciiField`가 쓰는 방식과 동일), 또는 별도 IntersectionObserver를 둔다. (발견: /ship performance+adversarial 리뷰 2026-07-03, `feat/hero-headline-scramble` — 두 리뷰어가 독립적으로 동일 지점 지적)

## Signup / Auth

### approval_status 에 CHECK 제약 없음 — 현재 노출 0, 방어심층만 (P4)
`workspace_members.approval_status` 는 제약 없는 `text` 라서, 값이 드리프트하면(`'Approved'`·`'active'`·`''`) `isApprovedAdmin` 이 false 가 되고 fail-open 이 생긴다. **다만 v0.4.10.0 에서 쓰기 경로를 전수 조사한 결과 드리프트를 만들 수 있는 코드가 없다** — 양쪽 레포 통틀어 쓰기는 5곳이고 전부 캐논니컬 리터럴 아니면 컬럼 default 다: 메인 `workspace.ts` `addMember`(`MemberApprovalStatus` 로 타입 강제됨), 메인 `auth.ts` canonical-PG 합류(`'pending_approval'` 리터럴), 컬럼 default(`'approved'`), 어드민 `approveMemberAction`/`rejectMemberAction`(각각 `'approved'`·`'rejected'` 리터럴 + `WHERE approval_status='pending_approval'` CAS 가드). 어드민 레포에는 `drizzle.config.ts` 도 db 스크립트도 없어 push 로 스키마를 바꿀 수도 없다(스키마 파일은 쿼리 타이핑용 읽기 전용 미러).

즉 **원래 이 항목이 P2 로 적혔던 근거(“별도 레포라 타입에 안 묶여 드리프트 가능”)는 사실이 아니다.** 남는 위험은 수동 psql 실수, 또는 앞으로 어느 레포든 새 쓰기 경로가 생기는 경우뿐이다.

붙일 때 참고: `attachments.status`·biz-profiles·rfps 가 이미 같은 패턴(text + CHECK)을 쓰므로 관례에는 부합한다. 데이터가 깨끗하면 `pnpm db:push` 한 번으로 끝나고(additive), 붙이기 전 `SELECT approval_status, count(*) FROM workspace_members GROUP BY approval_status;` 로 분포만 확인하면 된다. 드리프트 행이 있으면 **임의로 `'approved'` 로 덮지 말 것** — 승인된 적 없는 멤버에게 실효 admin 을 주게 된다. 어드민 레포 스키마 미러에도 같이 반영해야 나중에 db:push 가 생겨도 안 지워진다. (재검토: v0.4.10.0 — P2 → P4 하향)

### 사업자 상태 차단이 클라이언트 전용 — 서버가 클라 status 를 그대로 신뢰 (P2 → 대부분 해소, 잔여만)

**⚠ 아래 원문의 전제는 이제 사실이 아니다 (재확인 2026-07-29).** `updateWorkspaceBizProfileAction` 은 v0.4.29.0 부터 **클라이언트가 보낸 `taxType`/`status` 를 쓰지 않는다** — `resolveBizProfileForWrite` 로 국세청을 직접 재조회해 판정하고, 저하(미검증 통과)도 허용하지 않으며(`BIZ_LOOKUP_UNAVAILABLE` 로 거부), 영속되는 값은 조회 결과다. 즉 "액션을 직접 호출하면 폐업 사업자번호가 저장된다"는 설정 경로에서는 성립하지 않는다. 원문이 예고한 설계 결정 3건(트랜잭션 밖 외부 호출·장애 시 fail-closed·레이트리밋)도 그때 함께 내려졌다.

**남은 범위**: ① **구매사 가입 경로**(`BuyerWorkspaceForm`)가 같은 처리를 받았는지 미확인 — 원문이 설정과 함께 묶었던 축이다. ② PG 가입 경로는 아래 `PG 가입 BizLookupField blockedStatuses 누락 (P3)` 이 따로 다룬다. 착수 시 이 항목을 가입 경로로 좁혀 다시 쓸 것.

<details><summary>원문 (설정 경로 부분은 stale)</summary>

`BizLookupField` 의 `blockedStatuses` 는 폐업·휴업이면 `onResult` 를 호출하지 않아 제출 버튼을 잠그는 **UI 게이트**다. 서버는 이를 재검증하지 않는다 — `updateWorkspaceBizProfileAction` 의 `BizProfilePatch` 는 `status: z.enum(['active','suspended','closed'])` 로 세 값을 모두 받고, 저장 시 `status: bizPatch?.status ?? base!.status` 로 **클라이언트가 보낸 값을 그대로 영속**한다. 따라서 액션을 직접 호출하면 폐업 사업자번호가 저장된다. 구매사 가입 경로(`BuyerWorkspaceForm`)도 v0.4.9.0 이전부터 동일한 구조라 신규 결함이 아니라 **선존재 아키텍처 갭**이다.

**주의 — 얕은 수정은 실효가 없다**: 서버 스키마에서 `closed`/`suspended` 를 거부하는 것만으로는 못 막는다. 서버가 상태를 클라이언트에게서 받으므로 `status:'active'` 로 위조하면 그대로 통과한다. 실제 방어는 서버가 NTS 를 재조회해 판정하는 것이며, 그러면 ① 트랜잭션 안에서 외부 API 를 호출할지, ② NTS 장애 시 fail-open/fail-closed(정상 사용자의 정보 수정까지 막을지), ③ 레이트리밋([[NTS 엣지 IP 제한]] 항목과 연결) 세 가지 설계 결정이 따라온다. CLAUDE.md 가 명시한 "서버 액션/API 라우트 데이터 경계 강제는 의도적 후속" 정책과 같은 계열이며, `PG 멤버십 승인 서버 데이터 경계 강제 (P2)` 와 함께 처리하는 게 자연스럽다. (발견: /ship 인라인 보안 검토 2026-07-22, v0.4.9.0 — 유저 확인 후 이번 PR 은 클라이언트 전용 범위로 확정)

</details>

### 이메일 인증 성공 순간 라이브 리전이 통째로 언마운트 + 포커스 유실 (P3)
`EmailVerifySection` 은 성공 시 `if (verified) return <Chip label="✓ 이메일 인증 완료" />` 로 폼 서브트리 전체를 갈아끼운다 — 그 안에 있던 `role="status"` 라이브 리전도 같은 커밋에서 사라지므로 성공은 끝내 소리로 전해지지 않고, 사용자의 포커스는 방금 타이핑하던 입력칸과 함께 `<body>` 로 떨어진다. 자동 제출(v0.4.28.0)로 버튼 클릭이 사라지면서 되돌아갈 포커스 대상도 없어졌다. 4초 폴링(다른 탭 링크 인증 감지)이 타이핑 도중 `verified` 를 뒤집는 경로도 같은 증상이다. `PhoneVerificationField` 의 `setStep('verified')` → '인증 완료 ✓' 도 평범한 `<span>` 이라 동일. 고치려면 성공 노드를 유지되는 라이브 리전 안에 렌더하고 전환 시 포커스를 옮겨야 하는데, 두 컴포넌트의 성공 상태 구조를 함께 손봐야 한다. jsdom 은 언마운트 시 포커스 이동도 라이브 리전 낭독도 모델링하지 않아 유닛으로는 잡히지 않는다. (발견: /ship 적대 리뷰 2026-07-28, v0.4.28.0)

### PG 가입 BizLookupField blockedStatuses 누락 (P3)
PG 가입 플로우도 `BizLookupField` 를 사용하며 현재 `blockedStatuses` 가 없다. PG 도메인에서도 폐업·휴업 사업자를 차단해야 하는지 정책 결정 후 `blockedStatuses={['closed', 'suspended']}` 추가. 구매사 가입·설정 두 경로는 v0.4.9.0 에서 닫혔고, 차단 문구는 두 문맥이 공유하도록 '가입할 수 없어요'→'사용할 수 없어요' 로 중립화됐다. (발견: v0.2.27.2 adversarial 2026-06-20, P3 — 정책 미확정)

### 이메일 링크 스캐너가 /auth/verify 토큰을 사용자 대신 소모할 수 있음 (P4)
`/auth/verify?token=` 은 마운트 즉시 제스처 없이 `verifyEmailAction` 을 자동 발사한다. JS 를 실행하는 이메일 보안 스캐너(기업 메일 게이트웨이의 헤드리스 브라우저 — AWS 대역에서 관측됨)가 링크를 미리 열면 원타임 토큰이 소모되고 `markEmailVerified` 까지 수행될 수 있다. 실피해는 낮다: ① 같은 메일에 6자리 코드가 병행 동봉되고, ② `/pending-approval` 폴링이 verified 를 감지해 정상 진행되며, ③ 사용자가 이후 같은 링크를 누르면 '링크가 만료되었습니다' 를 보지만 실제로는 이미 인증 완료 상태라 자기치유된다(③의 문구 혼란이 이 항목의 실체). 근본 차단은 제스처 게이트(도착 화면에서 [인증하기] 클릭 시에만 consume)지만 모든 실사용자에게 클릭 1회를 추가하므로, CS 로 혼란이 실제 관측되기 전에는 보류. (발견: Sentry `fe54955a` 근본원인 분석 2026-08-12 — AWS IP 봇의 auto-POST 네트워크 실패가 unhandled rejection 으로 적발됐고, 그 unhandled rejection 자체(+ 실사용자 무한 스피너)는 같은 분석에서 catch + 재시도 UI 로 해결됨. `EmailVerifySection` 의 동일 클래스 2곳도 함께 봉합)

### /auth/verify 는 응답이 "거절" 될 때만 빠져나온다 — 영영 안 끝나는 요청은 여전히 무한 스피너 (P4)
v0.4.54.0 이 `verifyEmailAction` 의 **reject** 를 잡아 오류 화면 + 다시 시도로 바꿨지만, 탈출 조건이 "프로미스가 settle 됐다" 하나뿐이다. 요청이 거절되지도 응답하지도 않고 **매달려 있으면**(연결은 수립됐는데 응답을 안 주는 캡티브 포털·중간 프록시) `state` 는 `'loading'` 에 머물고 원래 증상인 무한 스피너가 그대로 재현된다 — `app/(public)/auth/verify/page.tsx` 의 마운트 효과(:38-54)와 `retry`(:59-72) 어느 쪽에도 `AbortController`·`Promise.race`·타임아웃이 없다. 끊긴 연결은 보통 reject 로 떨어져 이미 닫힌 경로라 남은 트리거는 이 "블랙홀" 한 종류뿐이고, 그래서 P4 다. 닫는 법은 두 호출부를 공통 타임아웃으로 감싸 만료 시 `network_error` 로 보내는 것인데, **몇 초로 할지가 제품 판단**이라 값 없이 넣지 않았다(짧으면 느린 모바일에서 멀쩡한 인증을 죽인다). (발견: /ship 컷 감사 adversarial 2026-08-13, v0.4.54.0)

## Workspace / Members

### 워크스페이스 로고 신선도에 출처가 둘이다 — 같은 화면에서 어긋날 수 있다 (P3)
`logoUpdatedAt` 을 읽는 경로가 두 갈래다. **컬럼**(`workspaces.logo_updated_at`)을 읽는 쪽이
다수파이고(`getDisplayInfo`·`findDisplayInfoByIds`·`search`·`listCanonicalPgWorkspaces`),
**블롭 테이블**(`workspace_logo_blobs.updated_at`)을 조회하는 쪽은 `findById` 하나다
(`lib/server/repositories/drizzle/workspace.ts` 의 별도 SELECT). 쓰기는
`app/api/workspace/[id]/avatar/route.ts` 가 **트랜잭션 없이 두 문장으로** 한다 —
`logoRepo.upsert()` 다음 `setLogoUpdatedAt()`, 삭제는 `remove()` 다음 `setLogoUpdatedAt(null)`.
둘 사이에서 실패하면 두 출처가 갈린다.

**이 갈라짐 자체는 선존재**지만, 로고 신원 수정(v0.9.2.0)이 PG 딜룸 로더를 `findById` →
`getDisplayInfo` 로 옮기면서 **한 화면 안의 불일치**를 새로 만들었다: PG 딜룸은
`RfpBriefPanel`/`BidContextStrip`(이제 컬럼)과 채팅 레일(`conversationLoaders.ts` 의
`loadConversationThread` → 여전히 `findById`, 블롭)이 **같은 구매사 워크스페이스**를 나란히
그린다. 그 전에는 둘 다 `findById` 라 항상 일치했다. 부분 실패 후 사용자는 브리프에는
이니셜, 바로 옆 채팅에는 로고를 보게 된다.

되돌리지 않은 이유: 컬럼이 다수파 출처이고 `findById` 가 예외다(게다가 `findById` 는
멤버·bizProfile 까지 하이드레이트하는 무거운 조회다). 방향은 컬럼이 맞다.

닫는 법(둘 중 하나, 둘 다 이 PR 범위 밖):
① **쓰기를 원자화** — 근본 원인. 단 API 라우트에서 `getDb()` 를 부르면 repo-boundary 가드에
   걸리므로(`lib/server/services/**` 밖 호출 금지) 로고 쓰기를 서비스로 올려야 한다.
② **읽기를 통일** — `conversationLoaders.ts` 의 남은 `findById` 로고 소비처를
   `getDisplayInfo`/`findDisplayInfoByIds` 로 옮긴다. 더 좁지만 ①을 남긴다.
①이 원인에 가깝다. (발견: v0.9.2.0 /ship red-team 리뷰)

### 워크스페이스 정렬 변경이 chat.ts/shell-access.ts의 순서 의존 로직에 준 부수효과 (P4)
사이드바 워크스페이스 스위처 드랍다운을 PG우선+이름순으로 정렬하려고 `WorkspaceRepo.listForUser`/`listAllWorkspacesForMaster`의 `ORDER BY`를 리포지토리 레이어에서 바꿨다(v0.4.28.2). 이 두 메서드 결과가 표시 목적 외에도 쓰이는 곳이 있다: ① `chat.ts`의 `counterpartyEmail`로 채팅을 시작하는 경로가 `memberships.find(m => m.type === wantType)`로 첫 매칭 워크스페이스를 고르는데, 동일 타입 멤버십이 여러 개인 유저는 이제 가입순 대신 이름순으로 뽑힌다. ② `shell-access.ts`의 `workspaces.find(...) ?? workspaces[0]` fallback(세션의 workspaceId가 현재 멤버십 목록에 없는 드문 경우)도 동일하게 영향받는다. 두 경우 모두 동일 타입 멤버십이 여러 개인 유저에게만 해당하는 좁은 엣지 케이스라 리스크를 감수하고 그대로 배포하기로 결정(/ship 적대 리뷰에서 발견, 사용자 확인 후 수용). 후속: 필요해지면 정렬을 리포지토리 레이어 대신 WorkspaceSwitcher 클라이언트 쪽으로 옮겨 두 소비처의 원래 순서 의미를 보존. (발견: /ship 적대 리뷰 2026-07-29)

### 미승인 PG 멤버의 인라인-게이트 API 라우트 잔여 노출 (P4)
승인 게이트(2026-07-24, `isPgMembershipBlocked` — `requirePgSession` + `requireActiveWorkspace` 이중 배선으로 PG 전용 표면과 채팅·보드·계약 라이프사이클 등 양측 공용 액션까지 차단)가 닫고 남은 표면: `auth()`+3층 인라인 게이트를 직접 쓰는 공유 라우트(`app/api/files/presign`·`files/[id]/complete`, `centrifugo/connection-token`)와 세션 없는 server-to-server `centrifugo/subscribe`(멤버십 row 기준)는 `approval_status` 를 읽지 않는다. 실행 가능한 동작은 첨부 presign·WS 연결/구독 정도로 실익이 낮고(상태 변경 액션은 전부 게이트됨), connection-token 은 route-local TTL 캐시와의 staleness 트레이드오프가 있어 별도 판단 필요. (발견: 서버 데이터 경계 구현 중 2026-07-24 — 원 P2 항목의 잔여 분리, red-team 리뷰로 requireActiveWorkspace 갭 소급 종결)

## Storage / R2

### R2 고아 객체 sweeper (P3)
`scripts/sweep-r2-orphans.ts` — ListObjectsV2(prefix `attachments/`) → `attachmentRepo.findExistingIds` 배치 대사 → row 없는 키 중 LastModified 24h 초과만 DeleteObjects. `--dry-run` 지원, PM2 cron(일 1회) 등록. 고아 발생 경로: RFP 삭제 cascade(`rfpRepo.deleteById`, `_purgeUnverifiedSignup`) + sweep-uploads 의 객체 삭제 실패 잔존분. bid_note 삭제는 bid.ts가 storage.delete() 명시 호출로 이미 커버. **주의**: 이 sweeper는 "row 없는 객체" 방향만 정리한다. 반대 방향 중 **pending row(업로드 미완료)는 presigned 전환으로 `/api/cron/sweep-uploads` 가 이미 커버** — 남는 미커버는 "ready row인데 객체가 없는" 희귀 케이스(현재 R2 presigned URL 이 NoSuchKey 를 반환)뿐. (발견: /ship adversarial 리뷰 2026-07-05, presigned 전환 반영 2026-07-05)

## 견적 확장 (current_terms)

### 오픈보드 공개 범위 제품 검토 — 특히 customPaymentMethodLabels (P2)
문서가 오랫동안 "구매사명·제목·홈페이지만"이라 서술해 온 탓에 가려져 있었지만, 오픈보드는 실제로 9필드를 공개해 왔다(코드·가드 테스트는 처음부터 일관, 산문만 스테일 — v0.4.3.0 에서 정정). 추가 6필드는 전부 비경쟁 정보라는 판단이지만 **`customPaymentMethodLabels` 는 구매사가 직접 입력한 자유 텍스트가 비초대 PG 전원에게 브로드캐스트되는 유일한 필드**다. 구매사가 거기에 내부 명칭·거래처명 같은 걸 적을 수 있어 노출 적절성은 코드 문제가 아니라 제품 결정이다. 검토 축: ① 그대로 공개, ② 게시판에서만 제거(초대 PG 에겐 유지), ③ 입력 시 공개 사실을 고지. (발견: /ship 적대적 리뷰 2026-07-21)

### ~~요청조건 뷰 솔루션 표기 무테스트 (P3)~~ — 해결 (v0.4.23.0)
`components/rfp/RequestConditionsView.tsx` 전용 테스트(`__tests__/RequestConditionsView.test.tsx`)를 추가해 `formatSolution` 상세 접미사 분기(`self`/`other` + 상세 → 괄호 병기)와 렌더 경로를 커버했다: 상세 있음/없음, 솔루션사 선택 시 접미사 미부착, 어휘 밖 값 fail-open, 운영 필드 유무에 따른 섹션·행 생략. (발견: /ship 커버리지 감사 2026-07-21 · 해결 v0.4.23.0)

### ~~SCREEN_DESIGN 이 삭제된 컬럼을 아직 문서화 (P4)~~ — 해결 (v0.4.23.0)
`SCREEN_DESIGN.md` 의 현재 카드 수수료 opt-out 설명을 `current_terms` JSONB + `hidden_from_pg` 저장 구조로 갱신하고, v0.2.26.2 에서 DROP 된 `current_fee_visible_to_pg` 는 앱 계층 파생값(`currentFeeVisibleToPg`)임을 명기했다. (발견: /ship maintainability 리뷰 2026-07-21 · 해결 v0.4.23.0)

### (조건부) hidden_from_pg write-edge 검증 (P3)
현재는 hidden_from_pg 가 hiddenFromPgFromVisibility(수수료 공개여부)로만 채워져 안전. **추후 buyer 가 임의 필드를 숨길 수 있게 되면** write-edge 에서 HIDEABLE_PG_PATHS 검증 추가 필요 — 안 하면 PG_STRIP 핸들러 없는 숨김 경로 fail-open 누출. (선택, doc-edge 채택 시 함께)

### currentTermsFromDiscrete 빈문자열 정규화 (P3)
'' 입력을 문서에 그대로 담음(현재 falsy 라 UI 무해). omit 으로 정규화하면 더 깔끔. (발견: /ship 리뷰 2026-06-18)

## Bid Wizard

### ~~정산한도 0 차단이 클라이언트 전용 — 서버는 여전히 0 을 받는다 (P2)~~ — 해결
`submitBidAction`·`saveQuoteTemplateAction` 의 `settleLimit` 을 `.nonnegative()` → `.positive()` 로 좁혔다. **TODO 가 지목한 `submitBidAction` 하나로는 부족했다** — 클라이언트 게이트 `isSettleLimitValid` 는 견적 위저드와 템플릿 드로어 **두 표면**을 덮으므로 서버도 두 곳을 덮어야 같은 판정이 된다. 갱신 대상 테스트도 명시된 5곳이 아니라 `dispatchIntegration.test.ts` 2곳을 더한 7곳이었다.

**남은 축 — 기존 행**: 운영 DB 에 이미 `settle_limit=0` 인 견적이 있고, 서버 검증은 과거 데이터를 정리하지 않는다. 표시 계층 폴백 여부는 아래 **`비교 화면의 0원 표기 폴리시`(P3)** 와 같은 질문이라 그쪽에서 함께 결정한다 — 가입비는 `없어요`, 정산한도는 입력 차단, 보증보험은 미정인 상태에서 "과거 0 행을 어떻게 읽힐 것인가"만 따로 정하면 네 번째 답이 생긴다.

### 비교 화면의 `0원` 표기 폴리시 — 보증보험만 남았다 (P3)
같은 패널 안에서 0 이 세 가지로 읽힌다: 가입비는 `없어요`(PR#432), 월 정산한도는 이제 **0 자체를 못 만들게** 막았고(v0.4.27.0), **보증보험만 `0원` 으로 남았다**. 실측(`/rfp/P-2604-0001` 비교 패널): `월 정산한도 80,000,000원` · `보증보험 0원`.

**정산한도에 쓴 해법(입력 차단)을 보증보험엔 쓸 수 없다** — 보증보험은 필수가 아니고 0 이 정당한 값이라(보험 없음) 막을 게 아니라 **표기**를 정해야 한다. 즉 남은 것은 "보험 없음"을 어떻게 읽히게 할지의 제품 결정이고, 가입비가 이미 `없어요` 로 답한 것과 같은 질문이다. CLAUDE.md 는 확정 결정에 닿는 판단을 QA 패치로 넣지 말고 멈추고 묻게 하므로 여기 남긴다.

원 발견은 직전 릴리스 QA 의 ISSUE-005(`정산한도·보증보험 0원`)였는데 TODOS 에 등재되지 않아 유실될 뻔했다 — 정산한도 절반은 그 사이 해소됐다. (발견: /qa dev→main 릴리스 워크 2026-07-26 · 범위 정정 /qa 릴리스 검증 워크 같은 날)

### deriveAnyFeeFilled 경계값 전용 테스트 부재 (P3)
`components/inbox/bid-wizard/bid-wizard-validation.ts`의 `deriveAnyFeeFilled`(BidWizard.tsx에서 분리된 공용 함수, 튜토리얼 fixture 검증과 공유)에 전용 단위 테스트가 없다 — `fee='0'`(포함돼야 함), `fee='-1'`(제외돼야 함), 공백 문자열(`parseFloat`→NaN, 제외돼야 함), 다중 tier 중 하나만 채워진 경우, 빈 fees/methods 등 경계값이 미검증. (발견: /ship 테스트 스페셜리스트 리뷰, dev→main 릴리스 컷 2026-07-17)

**해소 (v0.4.23.0)**: 스칼라 판정 4개 경계값(v0.4.3.0)에 이어 조합 축도 `__tests__/bid-wizard-validation.test.ts` 가 커버한다 — 빈 fees/methods, 구간제 수단의 단일 구간만 채워진 경우·구간 없는 평키(키 규약 위반=미입력), 선택되지 않은 수단 무시, 비구간 단일 수단, 커스텀 수단(값 유무), 다수 수단 혼재(음수·빈칸 제외)까지 `deriveAnyFeeFilled` 자체 동작을 검증한다.

## NTS / 사업자번호 조회

### 엣지 레벨 IP별 rate limit 부재 (P3)
v0.4.9.0 이 `lookup()` 에 총 데드라인(`NTS_LOOKUP_DEADLINE_MS`)을 걸어 **단일 요청의 홀드시간**은 잘렸지만, 남은 축은 **동시 요청 수**다. `lookupBizNoAction` 은 가입 플로우용으로 의도적으로 비인증이고 `deploy/Caddyfile` 에도 IP 단위 제한이 없어, 유일한 방어선은 여전히 in-process 전역 leaky-bucket(IP 단위 아님)뿐이다. 데드라인 덕분에 요청당 점유는 상한이 생겼으니 우선순위는 P1→P3 으로 내렸다. 검토: 이 액션에 한해 엣지/게이트웨이 레벨 IP별 rate limit. (발견: /ship 적대 리뷰 2026-07-17, 부분 해소 v0.4.9.0)

### 방치 알림 드롭이 7일 창을 태운다 + `notified` 가 배달이 아니라 클레임을 센다 (P3)
`notifyStaleSent` 는 CAS(`claimStaleNotify`)를 **보내기 전에** 찍는다(의도적 — 보낸 뒤 찍으면 실패 시 중복 발화가 남는다). 대신 전송이 429 로 떨어져도 그 계약의 **7일 재알림 창은 이미 소진**된다. 하필 드롭 확률은 방치 계약이 많은 날 높아지므로, 이 보상 통제는 **가장 필요한 날에 가장 약해진다**. 겹쳐서 `notified += 1` 이 전송 결과와 무관하게 올라가 크론 응답의 `staleNotified` 가 과다 계상된다 — 운영자가 "50건 알림" 과 "50건 클레임, 40건 리밋 드롭" 을 구분할 수 없다. 닫는 법: 레포에 이미 있는 모양을 복제한다 — `last_reminded_at` 의 실패 시 정확일치 CAS 롤백(`REMIND_COOLDOWN` 경로). `notifySigningOperator` 가 v0.5.4.0 에서 async 가 되어 전송 결과를 돌려주기 쉬워졌다. (발견: /ship 적대 리뷰 2026-08-31)

### 운영자 슬랙 알림에서 사용자 입력 URL 이 자동 링크된다 (P4)
가입 알림은 두 줄이고 아래 줄이 심사 링크다. 상호(셀프 가입 자유 입력)에 `https://…` 를 심으면 진짜 링크 **위에** 클릭 가능한 링크가 하나 더 놓인다 — 줄 접기 덕에 아래 줄을 치환하지는 못하니 위조가 아니라 **경쟁**이고, 운영 채널이 사내라 현재는 수용했다. 닫으려면 `escapeSlackText` 에서 `://` 를 무해화하는 쪽이 싸다(상호를 코드 스팬으로 감싸는 방법도 있으나 백틱 처리를 함께 해야 한다). (발견: /ship 적대 리뷰 2026-08-31)

### Sentry 스크러버가 URL 안의 자격증명을 못 지운다 (P3)
슬랙 Incoming Webhook 은 **URL 자체가 자격증명**이다(`https://hooks.slack.com/services/T…/B…/…`). `sentry.server.config.ts` 는 `sendDefaultPii: true` 이고 Sentry Node 계측은 아웃바운드 요청 URL 을 브레드크럼·스팬에 기록하는데, `lib/observability/scrubber.ts` 의 `SUBSTRING_KEYS = ['token','secret','authorization']` 는 **키 이름만** 보므로 `url` 키에 걸리지 않는다. 즉 같은 스코프에서 예외가 잡히면 웹훅 URL 이 통째로 Sentry 로 갈 수 있다. **이 PR 이 만든 축이 아니다** — 삭제된 디스코드 경로도 같은 형태(URL 안 시크릿)였다. 닫는 법: `scrubEvent` 에 값 기반 URL 리댁션(`hooks.slack.com/services/...` → 절단형) 또는 `beforeBreadcrumb` 훅. (발견: /ship security specialist 2026-08-30)

## Quote / 가입비 후속

### 정산 그리드 고아 셀 (P4)
`BidStepSettlement`·`QuoteTemplateDrawer`의 2열 그리드에 단일-스팬 필드 3개(정산한도·보증보험·가입비)라 마지막 행에 빈 셀이 남는다. /design-review로 시각 판정 후 정리. (발견: v0.3.6.0 /ship design specialist)

### 가입비 회수기간(payback) 표시 — 데이터 확인 후 결정 (P3)
`ImprovementSummary` 가입비 행은 이제 ₩0 을 '없어요' 로 읽히게 하고 '1회성 비용' 캐비앗을 상시 병기해 **헤드라인 판정 밖이라는 사실**을 알린다. 남은 축은 **materiality** 다 — 고액 가입비가 첫 해 수수료 절감을 잡아먹는 경우 '좋아져요' 헤딩이 여전히 낙관적으로 읽힌다.

계산 자체는 가능하다: `current_terms` 에 `annualPgVolume`·`feeRate` 가 있으므로 `가입비 ÷ (연간거래액 × 수수료차 ÷ 12)` = 회수 개월수이고, `BuyerDealRoomBody` 가 이미 같은 `rfp` 객체를 들고 있어 prop 하나 거리다. 신규 계약(`contractType==='new'`)은 두 필드가 서버에서 stripped 라 계산 불가 → 현재의 캐비앗으로 폴백.

**착수 전 확인할 것**: ① 가입비>0 인 견적 비율, ② `annualPgVolume` 입력률. 둘 다 낮으면 실질 대상이 거의 없는 기능이다. `SELECT count(*) FILTER (WHERE signup_fee > 0), count(*) FROM bids;` 로 갈린다.

**주의 — 순진한 대안은 틀렸다**: "가입비>0 이면 헤딩 중립화" 는 PG 다수가 가입비를 받으면 헤딩이 상시 중립이 되어 신호가 죽는다. 옳게 하려면 "첫 해 절감액을 가입비가 넘어설 때만" 이어야 하고, 그 판정이 곧 위 회수기간 계산이다. 둘은 별개 선택지가 아니다. (발견: v0.3.6.0 /ship red-team + opus review — 범위 정정·부분 해소 2026-07-22)

**참고 — 원 항목의 전제 2건은 부정확했다**: ① "보증보험과 동일 패턴" 은 렌더링에만 해당한다. 판정 제외의 실제 이유는 제품 결정이 아니라 구조다 — `CurrentTermsV1` 에 `signupFee` 키가 없어 구매사가 현재 가입비를 입력하는 경로 자체가 없고, 따라서 비교 기준선이 존재하지 않는다(보증보험은 `currentGuaranteeInsurance` 가 있다). ② "정렬 제외" 는 가입비 특정이 아니다 — `sortBidsByCardFee` 는 카드 수수료 단일 축이라 월 정산한도·보증보험도 똑같이 빠져 있다.
