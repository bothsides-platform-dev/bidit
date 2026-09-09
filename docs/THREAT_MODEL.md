# THREAT_MODEL.md — 위협 모델 · 수용 리스크 대장

이 문서는 **위협 관련 결정과 수용 리스크(Accepted Risk, AR-N)** 를 기록하는 living doc 이다. 방어 메커니즘 자체의 SSOT 는 언제나 **코드 + 가드 테스트**이며, 이 문서의 각 항목은 해당 가드 테스트를 링크한다 — 산문이 코드와 3벌로 드리프트하는 사고(CLAUDE.md 의 OpportunityListing 블록이 남긴 교훈)를 피하기 위해 여기서는 *결정·근거·재검토 트리거*만 서술한다.

**유지 규칙**: 신뢰 경계를 바꾸는 변경(채널 ACL, 공개 projection, 웹훅 검증, presign 정책 등)은 이 문서의 해당 절을 같은 PR 에서 갱신한다. 수용 리스크를 해소했다면 AR 항목을 삭제하지 말고 "해소됨(날짜)" 으로 남긴다.

## 1. 신뢰 경계 · 자산

| 자산 | 민감도 | 경계 (SSOT 위치) |
|---|---|---|
| 봉인 입찰 데이터 (수수료·입찰 내용·경쟁사 수) | 최고 — 제품 핵심 불변식 | 서버 로더 strip + 명시 projection (§3.1) |
| 멤버 PII (이메일·이름·연락처) | 높음 | 관계 fail-closed 로더 (§3.1, `lib/server/user-profile-loader.ts`) |
| 첨부파일 (RFP·입찰·채팅) | 높음 | R2 presigned + ACL 302 프록시 (§3.3) |
| 계약 보관 문서 (완료본·감사추적인증서 R2 사본, 플랫폼 밖 계약서 업로드) | 높음 | 행 소유 워크스페이스 게이트(업로드 마무리만 업로더 본인) + presigned 302 (§3.3) |
| 전자서명 계약 (SnowSign) | 높음 | ACL-first 로더 + HMAC 웹훅 (§3.2) |
| 온라인 presence (누가 접속 중 + **누가 누구를 보는가**) | 중간 — 관찰자 축이 경쟁사-집합 신호로 승격될 수 있음 (§2.3) | 관계 게이트 subscribe-proxy (§2.3, 2026-07-23 전환) |
| 워크스페이스 디렉터리 (name↔UUID 맵) | 중간 — presence·기타 UUID 키 표면의 비익명화 오라클 | buyer 세션 + type=pg 한정 게이트 (§2.7) |

## 2. Realtime (Centrifugo)

자체호스팅 Centrifugo v6 (Caddy `wss://`, `deploy/centrifugo/config.yaml`). 채널 이름의 단일 출처는 `lib/realtime/channels.ts`.

### 2.1 연결 인증

- 연결 토큰: `lib/server/realtime/token.ts` — HS256, `sub` = userId, `info` = `{ workspaceId }` (→ Centrifugo `connInfo`), TTL 30m. 서버 서명이므로 **`user`/`connInfo.workspaceId` 는 클라이언트가 위조 불가**.
- 발급 라우트 `app/api/centrifugo/connection-token/route.ts`: 세션 필수(401) + 세션 취소(401) + 이메일 미인증(403) 게이트, 동시 in-flight load-shed(503, 기본 25 — `CENTRIFUGO_TOKEN_MAX_INFLIGHT` 로 조정). 즉 **모든 WS 연결은 인증 세션 뒤에 있다**.
- 세션 강제 종료: `disconnectCentrifugoUser` (session_version bump 후 호출).

### 2.2 채널 ACL 매트릭스

| 네임스페이스 | 채널 형식 | ACL | 가드 |
|---|---|---|---|
| `chat` | `chat:conversation:<uuid>` | subscribe-proxy — 대화 양측 ws 멤버만 | `app/api/centrifugo/subscribe/__tests__/route.test.ts` |
| `team` | `team:rfp:<rfpId>:<wsId>` | subscribe-proxy — ws 멤버 ∧ RFP 접근권 (buyer/PG 팀 채널 분리 = 봉인 입찰 불변식) | 상동 (t1–t6) |
| `presence` | `presence:ws:<wsId>` | subscribe-proxy — **관계 게이트** (멤버십∨대화∨RFP 초대∨pending 콜드피치, `PresenceAccessRepo.canObserve`) | 상동 (p1–p5) + `deploy/__tests__/centrifugo-presence-namespace.test.ts` + `lib/server/repositories/drizzle/__tests__/presence-access.test.ts` |

subscribe-proxy(`app/api/centrifugo/subscribe/route.ts`)의 불변식: 항상 HTTP 200, 모든 거부는 동일한 generic deny(존재 오라클 없음), 예외 → deny(fail-closed), uuid 게이트 후 DB 접근.

### 2.3 AR-1 — presence 관찰자 신원 노출 (**해소됨 2026-07-23** — 관계 게이트 전환)

**원 노출 (D1 완전 공개 모델, 2026-06-21 ~ 2026-07-23)**: 인증된 raw WS 클라이언트가 워크스페이스 UUID `V` 를 알면 `presence:ws:<V>` 를 구독하고 `sub.presence()`/join/leave 로 두 축을 열거할 수 있었다 —
1. **온라인 비트 축**: `V` 멤버 중 현재 온라인인 userId 목록.
2. **관찰자 축(더 민감)**: co-observer 의 `user` + `connInfo.workspaceId`. PG 가 구매사 브리프를 열람하거나 견적을 작성하는 순간 그 구매사 채널에 관찰자로 등장하므로(`RfpBriefPanel`·`BidContextStrip` → `CounterpartyProfileCard` → `useWorkspacePresence(buyerWsId)`), 구매사 채널의 관찰자 맵은 **"지금 이 구매사 딜에 붙어 있는 PG 집합"의 준실시간 표본** — 봉인 입찰의 경쟁사-수 불변식(`Bid.competitorCount` 는 설계상 부존재)에 닿는 신호였다.

전제조건이었던 "워크스페이스 UUID 지득"도 실질 장벽이 아니었다 — §2.7 의 디렉터리 API 가 당시 임의 인증 계정에 name↔UUID 맵(최대 500건)을 반환했으므로, 결합 시 노출 등급은 "관련 당사자만" 이 아니라 **"검증된 계정 누구나"** 였다. (초기 문서화가 이 두 사실을 부정확하게 서술했던 것을 적대 리뷰 2026-07-23 이 반증 — 그 정정이 본 전환의 직접 계기다.)

**해소**: presence 네임스페이스를 chat/team 과 같은 subscribe-proxy 로 전환. 허가 술어 = `PresenceAccessRepo.canObserve` (§2.6). 이제 presence 맵은 **해당 워크스페이스와 실제 사업 관계가 있는 당사자**에게만 보인다.

**잔여(수용)**: ① 관계 당사자 상호 간 관찰자 노출은 유지된다 — 대화 상대·초대 PG·pending 콜드피치 상대는 서로의 온라인/관찰을 본다(제품 기능 그 자체). ② 탐지 없음 — Centrifugo OSS 에는 채널 단위 감사 로그가 없다. ③ config 롤백(`allow_subscribe_for_client` 복원)은 공개 모델을 그대로 되살린다 — 롤백은 의식적 보안 결정이어야 하며, 드리프트 가드가 실수 롤백을 막는다.

**핀**: `deploy/__tests__/centrifugo-presence-namespace.test.ts` — proxy 활성 + 공개 fallback 키 부재를 단언(반전 이력: 이 가드는 2026-07-23 이전엔 정확히 반대(공개 모델)를 단언했다).

### 2.4 AR-2 — presence publish flood · 내용 주입, rate limit 부재 (수용)

원 설계(OV6)는 "per-client publish rate limit 필수"를 요구했으나, **per-connection/user 연산 rate limit 은 Centrifugo PRO 전용**이라 OSS 자체호스팅에서는 구현 불가하다. 수용하되 정확한 사실 위에서:

- **실효 완화**: ① 연결 자체가 인증 게이트(§2.1) + 토큰 발급 load-shed. ② publish 는 subscriber 한정(`allow_publish_for_subscriber`)이고, **2026-07-23 부터 subscribe 가 관계 게이트이므로 publish 가능 집단도 관계 당사자로 축소**됐다 (공개 모델에서는 "누구나 구독 → 누구나 publish" 라 이 완화가 공허했다).
- **명목뿐인 완화(주의)**: `deriveActivity` 의 `{state}` enum 검증(`lib/realtime/presence.ts`)은 현재 **도달 불가능한 코드**다 — presence 구독은 publication 핸들러를 등록하지 않고, state 는 서버 서명 connInfo 에서만 읽히며, 토큰은 state 를 서명하지 않는다. 쓰레기 publish 가 무해한 실제 이유는 "아무도 읽지 않아서"이지 enum 검증이 아니다. M2 활동 레이어를 배선하는 엔지니어는 이 검증을 "이미 방어됨"으로 읽지 말 것 — publication 소비를 켜는 순간 이것이 *계획된* 게이트다.
- **내용 주입·은닉 릴레이 축**: 관계 당사자는 임의 페이로드를 상대 presence 채널에 publish 할 수 있고 `history_size: 1`/`history_ttl: 60s` 가 60초 보관한다. 현재 `.history()` 호출 코드는 0곳(config 주석의 late-observer 복구는 aspirational) — 보관은 순수 잉여 표면이다. 관계 게이트로 "임의 인증 계정 → 임의 워크스페이스" 주입은 닫혔지만, 관계 내 주입은 남는다. M2 착수 시 history 필요성을 재평가하고, 불요면 `history_*`·`allow_history_for_subscriber` 제거 검토(TODOS 참조).
- **잔여**: 인증·관계 게이트를 통과한 계정에 의한 CPU/fanout 남용 — Axiom 로그·PM2/Centrifugo 메트릭으로 사후 탐지.

### 2.5 배포 불변식 — subscribe-proxy 공유 비밀 fail-open

`CENTRIFUGO_PROXY_SECRET` 미설정 시 subscribe-proxy 라우트는 비밀 헤더 검사를 **건너뛴다**(의도된 fail-open — dev 에서 컨테이너 없이 동작). 설정 시에는 상수시간 비교. **prod 에서는 반드시 설정**해야 하며(라우트가 Caddy 뒤에서 공개 도달 가능), 컨테이너 쪽 주입 경로는 `CENTRIFUGO_VAR_PROXY_SECRET` — **prod compose 와 dev compose(realtime 프로필) 모두** 이 브리지를 정의한다(한쪽만 있으면 v5 `static_http_headers` 팬텀 키 사고와 같은 "헤더 없는 프록시 → 전 구독 거부" 클래스가 재발한다). 가드: `deploy/__tests__/centrifugo-proxy-secret.test.ts` (양쪽 compose 단언).

### 2.6 presence 관계 게이트 — 구현 기록 (2026-07-23)

- **술어** (`lib/server/repositories/drizzle/presence-access.ts`): `canObserve(userId, targetWsId)` = 멤버십 ∨ 대화 ∨ RFP 초대 쌍(상태 무관) ∨ **pending** 콜드피치 쌍(거절은 영구 — rejected 는 절대 허가 금지). 전 절 방향 대칭. 대화-이전 UI 표면 5곳(`RfpBriefPanel`·`BidContextStrip`·`RfpInviteManager`·`FocusComparison`·`RfpPendingRequests`)이 초대·콜드피치 절에 의존한다 — 대화 게이트만 있으면 이 표면들의 점이 조용히 꺼진다(rev1 이 정확히 이 지점에서 좌초해 D1 이 됐던 이력).
- **관찰자 ws 해석**: v6 subscribe-proxy 페이로드에는 `connInfo` 가 포함되지 않는다(공식 문서 확인 2026-07-23, centrifugal.dev proxy 문서 — SubscribeRequest 필드에 info 없음). 따라서 서명된 `user`(userId)의 **전 멤버십** 기준으로 판정한다 — 활성 워크스페이스 개념이 프록시에 없으므로 이것이 유일하게 올바른 축이다.
- **config**: presence 블록 = `subscribe_proxy_enabled: true` + `allow_subscribe_for_client` **부재 필수** — v6 권한 평가는 "먼저 허용하는 메커니즘이 이긴다" 순서(공식 channel permission 문서 확인 2026-07-23)라 남겨두면 proxy deny 후 fallback grant 로 공개 모델이 조용히 부활한다.
- **배포 순서 (역순 = 전면 블랙아웃)**: ① 앱 배포(프록시 분기 포함) → ② `docker compose -f docker-compose.prod.yml restart centrifugo` → ③ 관계 계정 2종으로 점 육안 확인 + 무관 계정 raw 클라이언트 deny 확인. 런북: `docs/DEPLOY_LIGHTSAIL.md` §Centrifugo.
- **비용·거동**: 탭당 최대 51채널(INTEREST_CAP 50 + 자기 채널) × 재연결마다 proxy 왕복, 채널당 최대 4회 인덱스 점조회(조기 반환). proxy deny 는 centrifuge-js 에 비일시 오류로 전달돼 재시도 루프를 만들지 않고, 해당 점은 offline 으로 읽힌다(무관 워크스페이스 점이 있던 자리 = 오늘의 offline 과 동일 UX).

### 2.7 AR-3 — 워크스페이스 디렉터리 API (**게이트 도입 2026-07-23**, 잔여 수용)

`GET /api/workspaces/search` 는 name↔UUID 디렉터리(최대 500건)를 반환한다. **2026-07-23 이전에는 인증만 통과하면 양방향(type=buyer 포함) 전체 열거가 가능**했고, 이것이 §2.3 관찰자 축의 비익명화 오라클이었다. 현재 게이트: **buyer 활성 세션 + `type=pg` 질의만 허용**(정규 소비자 = 견적요청 위저드 PG 피커 단일). 구매사 디렉터리(type=buyer)는 소비자가 없어 전면 거부.

**노출 축소 (v0.4.53.0)**: 디렉터리가 이제 `status='active'` 로 한정된다 — 그 전에는 조건이 `type` 하나뿐이라 **심사 대기(`pending`)·정지(`suspended`) 워크스페이스까지** 모든 구매사의 피커에 떴다(셀프서비스 생성 기본값이 `pending` 이므로 아무나 만든 이름이 즉시 열거됐다). 같은 조회에서 테스트용 PG(이름에 `test`/`테스트` 포함)도 기본 제외된다 — 규칙 단일 출처는 `lib/features/test-pg.ts`, 유일한 게이트는 `DrizzleWorkspaceRepository.search()` 다. **이건 보안 경계가 아니라 가시성 조정이다**: 해제 수단이 `support-b-show-test-pg=1` 쿠키라 이름을 아는 사람은 누구나 켤 수 있고(`/login/ops` 의 숨은 URL 과 같은 성격), 위 인증·역할 게이트가 실제 경계로 남는다.

**잔여(수용)**: 가입이 열려 있으므로 buyer 계정을 만들면 PG 디렉터리는 여전히 열거 가능하다 — 위저드 피커가 전체 목록을 요구하는 한 구조적이며, PG 디렉터리 자체는 저민감(PG 사는 공개 영업 주체)으로 판단. 재검토 트리거: PG 측이 UUID 로 키되는 새 공개 표면 추가, 또는 buyer 가입 게이트 완화. 가드: `app/api/workspaces/search/__tests__/route.test.ts`, `lib/server/repositories/drizzle/__tests__/workspace.test.ts`(status·이름 게이트).

## 3. 포인터 절 — 다른 신뢰 경계 (여기가 SSOT 아님)

각 항목의 규범 서술과 강제 지점은 링크된 코드·테스트·문서가 소유한다. 이 절은 색인일 뿐이다.

### 3.1 봉인 입찰 공개 경계
오픈보드 공개 필드 화이트리스트는 `OpportunityListing`(`lib/types/pg-request.ts`) + 명시 SELECT projection + exact-key 가드 테스트가 강제하고, 산문 SSOT 는 CLAUDE.md Domain Context 블록 한 곳이다. 초대 PG 대상 필드 숨김은 `hidden_from_pg` 경로 allowlist 를 `PG_STRIP` 이 fail-closed 로 strip 한다(`loadPgRfpDetail`). 신원 카드 PII 는 `lib/server/user-profile-loader.ts` 가 관계 fail-closed.

### 3.2 SnowSign 전자서명
웹훅 `POST /api/signing/webhook` 은 HMAC-SHA256 검증 + payload 불신(트리거 전용, 상태는 재조회 단일 경로), 시크릿 미설정 시 401 fail-closed. **v0.4.42.0 추가**: `contract_id` 는 임베드/액션 경로와 같은 `CONTRACT_ID_RE` 화이트리스트를 통과해야 하고(형식 검증을 통과한 것만 리미터 예산을 소모한다), 재조회는 인메모리 **계약별 10/분 + 전역 백스톱 30/분**(`webhook-rate-limit.ts`, PM2 단일 fork 전제)으로 캡한다 — 리플레이에 타임스탬프/nonce 방어가 없어 인증 요청 1개가 provider `getContract` 1회로 증폭되던 DoS 축을 닫은 것. 전역 카운터 하나가 아니라 계약별 키잉인 이유: 유효 쌍 하나의 재전송이 창을 상시 포화시켜 **다른 모든 계약**의 웹훅 트리거를 굶기는 것을 막는다. 초과·형식 불일치 스킵은 `logger.warn`(`signing.webhook_throttled`/`webhook_id_rejected`)으로 관측된다(초과분은 200 ack 만, 폴링이 백스톱). **잔여 수용**: 재전송 자체는 여전히 유효하다(상태 부작용 0) — provider 타임스탬프 헤더 실측 후 재평가, TODOS.md Signing 절. 계약 조회·조작 ACL 은 낙찰 PG ws + buyer ws, `getForActor` ACL-first. 상세는 CLAUDE.md Domain Context.

두 번째 인바운드 경계 — **발송 임베드의 `postMessage`** (`SigningSendEmbed`, v0.4.37.0 에서 템플릿 등록 화면 폐지와 함께 딜룸 계약 탭으로 이관). **스테이크가 올라갔다**: 예전 메시지는 "템플릿 id" 를 실어왔지만 지금은 **어떤 스노우싸인 계약을 우리 계약 행에 바인딩할지**를 실어온다. 그래서 클라이언트 가드는 방어심층일 뿐이고 **진짜 게이트는 서버**다 — `attachProviderContract` 가 ① ACL 재검증(낙찰 PG 인가) ② `getContract` 재조회(실재하는가) ③ **실제 발송 여부**(`isDispatchedProviderStatus` — `draft` 거부) ④ `provider_ref` 바인딩 유일성(다른 계약이 이미 쥐고 있지 않은가) ⑤ `markSentIfAwaiting` CAS 를 모두 통과해야 상태가 바뀐다. 멱등이라 중복 도착은 무해하다. ③이 없으면 완료 이벤트를 위조하거나 초안 id 를 흘려 **아무에게도 발송되지 않은 계약으로 딜룸을 `sent` 로 만들고 양측에 알림까지 트리거**할 수 있었다(구매사는 오지 않을 서명 메일을 기다린다).

**⚠️ 소유 검증은 현재 작동하지 않는다 (수용, P2).** 코드에는 `external_id === sc:<signingContractId>` 검증이 있지만, 실측(2026-08-01, `docs/SNOWSIGN_SANDBOX.md` Q3) 결과 `GET /v1/contracts/{id}` 응답에 `external_id`·`integration` 키가 **아예 없어** 그 분기가 한 번도 실행되지 않는다. 따라서 위 목록의 ①③④⑤만이 실제 방어선이다(②는 실재 확인까지만 한다). 남는 위험: 단일 `SNOWSIGN_API_KEY`=1 org 이므로 **다른 계약의 UUID 를 아는 PG 가 그것을 자기 딜에 바인딩**해 상태·완료본에 접근할 수 있다. 도달성은 낮다(계약 id 는 비열거·불투명 UUID, 이미 바인딩된 계약은 선착순 가드로 보호됨). **v0.4.38.0 정정**: 「어느 PG-facing 화면에도 노출되지 않음」은 더 이상 사실이 아니다 — 고아 복구 다이얼로그가 후보의 `providerContractId` 를 브라우저로 보낸다(화면 텍스트로 렌더하지는 않는다). 다만 그 목록은 `participantsMatchDeal` 을 통과한 것뿐이라 **노출 범위를 정하는 건 이제 그 술어**다. **바인딩 게이트는 노출 사실로 판정한다**: 스캔이 한 번이라도 내보낸 공급자 계약 id 는 어느 딜에 붙이든 그 딜의 상관키를 통과해야 한다(`signing_contracts.recovery_refs`). 초기 구현은 이 게이트를 `expectedContractId` 유무로 켰는데 그건 클라이언트가 보내는 선택 필드라, 필드 하나를 빼면 검사가 통째로 꺼졌다 — 그 상태에서는 딜 A 의 스캔으로 배운 고아 id 를 딜 B 에 붙여 구매사 B 가 구매사 A 의 계약 문서를 조회할 수 있었다(스캔 이전에는 미바인딩 계약의 id 를 알 방법 자체가 없어 도달 불가였다). 판정 근거를 서버 상태로 옮겨 닫았고, 노출된 적 없는 계약에는 걸지 않는다(오타로 어긋난 수신자는 여전히 경고로 다뤄야 취소 핸들을 얻는다). 규범은 `lib/server/services/__tests__/contract-signing.test.ts` 의 '스캔이 노출한 계약은 다른 딜에 붙지 않는다'와 그 반대편 케이스. 닫는 법은 TODOS.md Signing 절 "external_id 소유 검증이 현재 무력". 검증 코드는 지우지 않는다 — 공급자가 필드를 추가하면 그 순간 복원된다.

클라이언트 가드는 유지된다: 핸들러는 `iframeUrl` 에서 파생한 origin 과 정확히 일치하는 메시지만 받고(**파싱 실패 시 모두 거부** — v0.4.30.0 의 fail-closed 전환을 그대로 이식), 이벤트 네임스페이스(`snowsign.embed.`)와 계약 id 경로-세그먼트 화이트리스트를 `lib/signing/embed-events.ts` 순수 함수가 강제하며, 완료는 1회만 처리한다. iframe 은 `sandbox`(top-navigation 제외) + `referrerPolicy="no-referrer"` 로 가둔다. 규범은 `components/deal-room/signing/__tests__/SigningSendEmbed.test.tsx` 의 origin·1회·네임스페이스 케이스와 `lib/signing/__tests__/embed-events.test.ts` 가 SSOT.

**잔여 수용**: ① `e.source` 미검증 — 같은 origin 의 다른 창은 통과한다(서버 게이트가 뒤에 있어 실피해로 이어지지 않는다). ② 신뢰 origin 을 공급자 응답(`iframe_url`)에서 파생하므로 allowlist 가 아니다 — 앱 전체에 CSP 자체가 없어 `frame-src` 핀도 없다. 둘 다 TODOS.md Design 절 "스노우싸인 임베드 iframe 하드닝" · "postMessage 핸들러가 `e.source` 를 검증하지 않음" 참조.

**중복 발송 창 (수용, v0.4.38.0)**: 발송 리스를 **강제로 이어받을 수 있다** — 임베드를 열어둔 채 자리를 비운 탭이 하트비트로 리스를 무한 연장해 팀이 영구히 막히는 것을 푸는 유일한 길이다. 이어받기는 `awaiting_pg_template` + 낙찰 PG 워크스페이스로만 게이트되며(강제되는 것은 리스 경합뿐, 상태·ACL 은 그대로), 밀려난 사람과 감사 기록은 CAS 쓰기 시점의 실제 소유자다. **위험은 공급자에 임베드 세션 취소 API 가 없다는 데서 온다**: 뺏겨도 동료의 iframe 은 살아 있어(발급된 세션 payload `expires_at` ≈1시간) 그 화면에서 발송이 가능하다. 완화는 즉시 차단 신호다 — 밀려난 사람에게만 가는 인앱 알림이 SSE 로 그 브라우저에 닿아 패널을 내리고(발송 버튼은 우리 iframe 안에만 있다), 실시간이 끊긴 경우 ≤60초 하트비트가 같은 일을 한다. **그 신호가 닿기 위한 조건들이 실제로 성립하는지가 이 완화의 전부**라, 적대 리뷰에서 성립하지 않던 경로 넷을 닫았다: 구독이 스트림을 열지 않아 모바일(사이드바가 Sheet 안)에서 신호가 100% 죽던 것, 구독이 패널 수명에 묶여 세션 발급 왕복 중 도착한 알림이 사라지던 것, 이어받기가 발급보다 먼저 커밋돼 실패 시 동료 작업만 잃던 것, 자기 리스를 자기가 이어받아 같은 사람 iframe 이 둘 살던 것. **남는 조건**: 배포 시점에 살아 있던 리스는 소유자가 NULL 이라 그 창에서는 알림이 나가지 않는다(하트비트 폴백만 적용). 밀려난 사람이 워크스페이스 승인 멤버가 아니게 된 경우도 같다. **닫히지 않는 창**: 이어받기와 신호 도착 사이 찰나에 동료가 발송을 누르면 계약이 두 건 살아나고, 진 쪽은 `provider_ref` 를 받지 못해 딜룸에서 취소할 수 없다(구매사에는 서명 요청이 두 통 간다). 확인 다이얼로그가 이 가능성을 사용자에게 문구로 경고하며(`딜룸에서 관리할 수 없어요`), 보상 취소 경로는 이번 범위 밖이다 — TODOS.md Signing 절. 규범은 `lib/server/services/__tests__/contract-signing.test.ts` 의 이어받기 케이스와 `lib/signing/__tests__/takeover-signal.test.ts`.

**신뢰 이전 (수용)**: 임베드는 참여자 프리필을 지원하지 않아 **PG 가 구매사 서명자 이메일을 직접 타이핑한다**. 예전에는 앱이 DB 에서 양측 담당자를 뽑아 넣었다. 완화는 표시 + 사후 탐지다 — 임베드 패널이 정확한 이름·이메일을 띄우고, 바인딩 시 수신자 목록에 구매사 담당 이메일이 없으면(대소문자 무시) `participantMismatch` 로 경고해 취소를 유도한다. 이미 발송된 계약이라 차단하지는 않는다. **v0.4.42.0 강화**: 경고가 발송 직후 토스트 1회에서 **지속 표시**로 승격됐다 — 바인딩 시 buyer 역할 참여자 부재가 곧 불일치의 영속 기록이라 뷰모델이 순수 파생하고, provider 회신 `email_delivery` 를 미러링해 반송(bounced)도 참여자 칩 + 카드 경고로 남는다(주소가 맞아도 죽은 메일함인 경우까지 탐지).

**서명 본인인증 강제 (v0.4.46.0, v0.4.50.0 에서 재사용 경로 봉합)**: 인증수단은 공급자가 **템플릿 역할 단위**로만 저장해 계약별로 지정할 수 없다. 그래서 "이 계약은 본인인증으로 서명된다"는 성질은 단일 검사로 만들어지지 않고 **템플릿 정책(`easy_cert`) + 발송 시 양측 phone** 의 짝으로만 성립한다. `sendFromTemplate` 이 공급자 왕복 **전에** ① `resolveSecurityMethod` 로 양측 phone(010 만) ② `getTemplate` 의 `signers[].security_method` 가 두 역할 모두 `easy_cert` 인지 정확일치 를 확인하고, 어느 쪽이든 실패하면 **강등이 아니라 차단**한다(공급자가 phone 없는 `easy_cert` 역할에 400 을 내므로 강등이 물리적으로 불가능하다). 정책 조회 실패도 통과시키지 않는다.

**v0.4.50.0 이 닫은 것**: ①②는 *새로 만드는* 계약만 지킨다. `providerRef` 가 이미 있으면 생성을 건너뛰고 곧장 발송하므로, 본인인증 도입 **이전에** 생성과 발송 사이에서 죽은 시도가 남긴 초안(= 공급자 기본 email 정책)이 ①②를 모두 통과한 뒤 그대로 나갈 수 있었다. 참여자 행에는 무조건 `easy_cert` 가 적히므로 **계약은 이메일 링크로 서명 가능한데 딜룸·타임라인은 본인인증을 주장하는** 상태가 된다(reconcile 이 바로잡는 건 계약이 나간 뒤라 강제가 아니다). 도달 경로는 평범한 재시도였고, 처방된 복구(`TEMPLATE_AUTH_NOT_ENFORCED` → 템플릿 재저장)가 오히려 방아쇠였다 — 재저장이 ②를 풀어 주면 다음 시도가 옛 초안을 재사용한다. 그래서 재사용은 이제 **양성 증명**을 요구한다: 재시도 진입의 H3 프로브가 이미 조회하는 계약 상세로 **초안 자신의 참여자 정책**(`isDraftAuthEnforced` — 참여자 2인 이상 + 전원 `identity_verification`, fail-closed)을 확인하고, 아니면 `providerRef` 를 버리고 새로 만든다. **프로브가 실패하면 발송하지 않는다**(리스는 반납, `providerRef` 는 보존 — 일시 실패였는데 실제로는 발송된 계약이었다면 지우는 순간 취소 핸들을 잃는다). ⚠️ 어휘가 갈린다: 계약 **참여자**는 `identity_verification`, 템플릿 **서명자**는 `easy_cert`(`docs/SNOWSIGN_SANDBOX.md` S4) — 혼동하면 판정이 뒤집혀 재사용이 조용히 죽는다. 리터럴 단일 출처는 `PROVIDER_ENFORCED_SECURITY_METHOD`(`lib/signing/security-method.ts`).

**초안 출처·판본 게이트 (v0.4.52.0)**: `signing_contracts.provider_ref` 는 세 경로(임베드 바인딩·템플릿 지름길·자체 발송 compose)가 공유하는 **하나의 슬롯**이고, `sendFromTemplate` 은 재진입 시 그 ref 가 있으면 create 를 건너뛰고 곧장 send 한다. 재사용 게이트가 `isDraftAuthEnforced` 하나뿐이었을 때 **다른 계약서가 발송되는 축이 둘** 있었다 — 인증 판정으로는 어느 쪽도 못 거른다(양측에 010 번호가 있으면 어느 출처의 초안이든 참여자 전원 `identity_verification` 이라 통과한다): ① compose 초안을 템플릿 버튼이 재사용(Stage 2 가 배선하면 열린다) ② **compose 없이도 성립** — 템플릿 수정이 `pg_signing_templates` 행의 provider id 를 in-place 로 갈아치우므로(그것이 수정의 목적), send 실패 → 템플릿 수정 → 재시도가 **옛 판 PDF·옛 서명칸** 초안을 발송한다. 화면은 "연결된 템플릿을 보냈다"고 말한다. 닫는 법은 재사용을 두 조건의 AND 로 좁히는 것이다 — `origin === 'template'` **그리고** 초안에 기록된 판본이 지금 연결된 템플릿과 일치. 출처 미상(이 기능 이전 행)은 **fail-closed**(없는 값을 신뢰로 읽는 것이 v0.4.50.0 fail-open 의 모양이었고, 판본 조건이 어차피 걸러 비용도 0이다). 기록은 `bindDraftRef` 가 **한 UPDATE** 로만 하고, 지우기는 `clearDraftRefIf`(기대 ref + awaiting 상태 CAS — 출처·판본을 같은 UPDATE 로 NULL) 하나다 — `SigningContractPatch` 에서 `providerRef`·`snowsignTemplateId` 팔을 **삭제**해 반쪽 쓰기·반쪽 지우기가 컴파일 타임에 표현 불가능하다(`patchContract` 는 정의된 필드만 SET 하므로 팔이 남아 있으면 출처가 직전 값으로 남아 다음 초안이 오분류된다). 재바인딩(`markSentIfAwaiting` — provider_ref 의 두 번째 쓰기 경로)도 필수 `draft` 판별 필드로 출처·판본을 같은 UPDATE 로 정리한다(템플릿 발송 = 유지, 임베드 attach·복구·자가치유 = NULL) — 안 하면 남은 template 출처가 임베드 계약에 옮겨 붙어 게이트가 거짓 출처를 참으로 읽는다. `provider_ref IS NULL` CAS 라 낡은 스냅샷이 남의 핸들을 덮어쓸 수 없고, id 만 보던 블라인드 clear 가 프로브 왕복 중 임베드 attach(리스 무요구)가 바인딩한 **발송된** 계약의 ref 를 지워 "sent + provider_ref NULL = 영구 조정불가"(reconcile 즉시 반환) 행을 만들던 축도 clear CAS 가 봉인한다 — 실패는 CONTRACT_BUSY 로 물러난다(`resolveStaleEmbedRef` 의 임베드 진입 clear 포함, 플래그 무관 상시 경로). 그리고 게이트가 검증한 ref(지금 DB)와 send 가 실제로 보내는 ref(리스 직후 스냅샷)의 **동일성을 요구한다** — 다르면 상태 프로브·인증 판정을 통과하지 않은 값이 발송되므로 검증된 쪽으로 갈아타지도 않고 CONTRACT_BUSY 로 물러난다. **판정은 리스 획득 뒤 재조회한 계약 행으로 한다** — `active`(`findActiveByRfp`) 는 `findById` 로 리스 뒤에 다시 읽고, 게이트의 비교 상대인 초안 기록(`findDraftRef`)도 게이트 호출 그 순간 새로 조회한다 — 상호배제 밖에서 읽은 스냅샷으로 판정하면 게이트가 아니다(이전에는 계약 행도 리스 이전 스냅샷이었고, 그래서 두 템플릿 시도가 서로의 ref 를 덮어쓸 수 있었다). 비교의 다른 한쪽 — 지금 보내려는 템플릿의 판본 — 도 **재사용 게이트 직전에 재조회**하며(v0.4.56.0), 이후의 정책 게이트·create·draft 기록이 전부 그 재조회본을 쓴다(게이트만 새 판을 보면 create 가 옛 판으로 만든다 — 더 나쁘다). 잔여는 재조회와 create 사이(정책 게이트 provider 왕복)에 커밋된 수정 한 부류뿐이고, 그 경우도 `bindDraftRef` 가 실제 사용한 판본을 기록해 다음 재시도의 판본 게이트가 잡는다(TODOS.md Signing 절 해결 항목의 잔여 서술 참조). 발송 **후** 바인딩(임베드)은 이 게이트 밖이며, 그 면역의 근거는 상태 게이트다(`sendFromTemplate` 이 awaiting 아닌 행에 `ALREADY_SENT`) — 그 게이트가 움직이면 면역도 함께 움직인다. 규범은 `contract-signing.test.ts` 의 `초안 출처·템플릿 동일성 게이트` 블록과 `signing-contract.test.ts` 의 `bindDraftRef`·`findDraftRef` 케이스다(각 보장은 변이로 RED 를 확인했다 — 게이트 무력화·판본 조건 제거·NULL fail-open·항상폐기·재조회 제거·CAS 술어 제거가 각각 다른 테스트를 깨뜨리고, clear·재바인딩 하드닝도 같은 방식으로 확인했다: clearDraftRefIf 의 WHERE ref 제거·WHERE status 제거·ref 동일성 분기 무력화·markSentIfAwaiting 의 출처 정리 제거가 각각 다른 테스트를 깨뜨린다). **잔여**: `createSendEmbedSession` 에도 같은 리스-이전 읽기가 남아 있다(TODOS.md Signing 절 P3).

**강제의 실제 범위 (수용)**: 위 짝은 **템플릿 지름길에서만** 성립한다. 건별 임베드 경로는 PG 가 iframe 안에서 수신자를 직접 타이핑하고 `POST /v1/embed-sessions` 에 보안정책 파라미터가 없어 **여전히 이메일 인증**이다. 규범은 `lib/server/services/__tests__/contract-signing.test.ts` 의 본인인증 게이트 케이스(phone 누락 차단·템플릿 정책 불일치 차단·초안 재사용 3분기·프로브 실패 차단)와 `lib/signing/__tests__/security-method.test.ts` 가 SSOT. 잔여(404 `provider_ref` 자가치유 없음, 옛 템플릿 판본 PDF 재사용)는 TODOS.md Signing 절.

### 3.3 파일 스토리지 (R2) — 첨부 · 계약 보관 문서
업로드 = presign 2-phase + 서버 스니핑 검증, 다운로드 = ACL 검증 후 302 presigned GET(TTL 15분). 브라우저의 PUT 대상은 최종 키가 아니라 `pending/<final>` staging 키다. complete 는 HEAD 의 ETag 로 range GET 과 CopyObject 를 조건부 실행한 뒤에만 최종 키를 ready 로 공개한다. 검증 뒤 PUT URL을 재사용해 staging 객체를 덮어써도 최종 객체는 바뀌지 않고, 검증 도중 교체는 409 로 닫힌다. 재사용된 URL로 ready 이후 다시 생긴 staging 객체는 DB pending row가 없어 앱 sweeper가 찾을 수 없으므로, 물리 키 prefix `attachments/pending/`에 별도 R2 lifecycle 만료 규칙을 둔다. 완료본 다운로드 프록시의 잔여 하드닝은 TODOS.md 참조.

**계약 보관 문서 (v0.5.3.0)** — 같은 버킷의 별도 키 공간(`contract-archives/…`)에 두 부류가 산다: 전자서명 완료본·감사추적인증서의 **우리 사본**(cron 하이드레이션)과 플랫폼 밖 계약서의 **수동 업로드**. presign·complete 라우트는 첨부 라우트와 같은 `lib/server/presigned-upload/module.ts` 전이를 쓰고, 계약 보관함 전용 어댑터가 PDF·30MB·200건 cap·행 매핑 정책을 맡는다. 다운로드까지 포함한 세 라우트(`/api/contract-archives/presign` · `/{id}/complete` · `/{id}/download`)는 3중 세션 게이트(`auth`/`isSessionRevoked`/`isEmailUnverified`)에 더해 `isPgMembershipBlocked` 를 **인라인으로 배선**한다(신규 `/api` 라우트는 프록시 매처 밖이라 인라인이 유일한 게이트다). **다운로드·삭제의 ACL SSOT 는 행 소유 워크스페이스 하나**다 — 보관함 행은 생성 시점에 이미 당사자별(buyer 1행 + PG 1행)로 갈라지므로 서명 계약의 당사자 판정을 **다시 하지 않는다**(판정을 둘로 두면 갈릴 수 있다). ⚠️ **업로드 2단계(`/complete`)만 술어가 다르다**: 아직 `pending` 인 자기 업로드를 마무리하는 호출이라 `createdBy === session.user.id`(업로더 본인)로 좁혀, 같은 워크스페이스 동료도 404 를 받는다. 즉 **한 행의 유효 주체가 단계에 따라 넓어진다**(pending = 업로더 → ready = 워크스페이스) — 새 라우트를 붙일 때 둘 중 어느 술어인지 먼저 정할 것. 남의 행에는 403 이 아니라 **404**, 비-uuid 도 404 로 맞춘다 — 상태 코드가 존재 오라클이 되지 않게(`getForActor` 의 ACL-먼저 규율과 같은 이유이고, 비-uuid 를 그대로 넘기면 Postgres 22P02 가 처리되지 않은 500 으로 샌다). presign 정책: PDF 전용 · 건당 30MB · 워크스페이스당 업로드 200건 캡 · PUT TTL 10분이며, phase-2 가 `head` 크기 + 첫 4KB 매직바이트로 **클라이언트 자기신고를 재검증**하고 불일치면 객체·행을 함께 폐기한다. 삭제는 `source='upload'` 만 — 자동 보관본은 서버(`deleteUpload`)가 거부하고 UI 의 `canDelete` 는 그 파생일 뿐이다(보존 원칙). **새 아웃바운드 축**: 하이드레이션 fetch 는 앞선 공급자 문서 경로들과 달리 사용자 브라우저를 302 로 보내지 않고 **우리 VM 에서 직접 나간다** — `https://` 강제 + 청크 누적 실바이트 30MB 캡(`content-length` 사전 게이트만으로는 chunked 응답이 헤더 없이 그냥 통과한다) + 15초 데드라인이 방어이고, **호스트 핀은 없다**(완료본 URL 이 API 호스트가 아니라 열거 불가능한 S3 presigned 라서 — 템플릿 PDF 를 302 대신 프록시하는 것과 같은 이유). 가드: `app/api/contract-archives/__tests__/*`, `lib/server/services/__tests__/contract-archive.test.ts`.

**수동 계약 업로드 동시성** — 워크스페이스당 200건 제한은 count 후 별도 insert 하지 않는다. workspace 행을 `FOR UPDATE` 로 잠근 트랜잭션 안에서 count+pending insert 를 묶어, 동시에 들어온 두 presign 이 200번째 슬롯을 함께 통과하지 못하게 한다. 검증 실패 정리는 staging 객체를 먼저 지운 뒤 pending 행 삭제 CAS를 이긴 요청만 최종 키를 지운다. 이미 ready가 된 동시 요청의 최종 객체는 패자가 제거할 수 없고, HEAD 이후 staging이 사라지면 행을 재조회해 ready는 멱등 성공·그 외는 409로 수렴한다.

**v0.9.0.0 하드닝**: 위 아웃바운드 fetch 는 이제 `https://`만 허용하고, URL 호스트의 DNS 해석값이 사설·루프백·링크로컬·예약 주소를 하나라도 포함하면 요청 전에 거부한다. fetch의 자동 redirect도 금지한다. 완료본 URL이 열거 불가능한 S3 presigned 호스트일 수 있어 호스트 핀 자체는 여전히 두지 않는다.

### 3.4 인증·게이트
셸 가드 순서·이메일 인증 게이트는 `lib/auth/shell-access.ts` + CLAUDE.md Routing Architecture. 서버 액션 데이터 경계 강제는 의도적 후속(TODOS.md P2 항목들).

**운영계정의 워크스페이스 관리 경계 (v0.10.0.0)**: `MASTER_ACCOUNT_EMAILS` allowlist에 든 운영계정은 멤버십 행 없이 선택한 모든 워크스페이스의 이름 변경 요청·멤버 초대/재발송/취소·역할 변경·내보내기와 활동 기록 조회를 할 수 있다. 쓰기 서비스는 세션의 master 표시가 아니라 DB에서 다시 읽은 사용자 이메일을 allowlist와 대조하고, 액션은 화면이 렌더한 `workspaceId`와 현재 세션 워크스페이스가 다르면 `WORKSPACE_CHANGED`로 거부한다. 운영계정도 마지막 승인 admin을 없앨 수 없으며, 트랜잭션 안의 잠금 카운트가 동시 강등·내보내기를 막는다. 권한 출처는 감사 행의 `actorWasMaster`에 쓰기 시점 값으로 남고, 레거시 행만 현재 allowlist로 폴백한다. 상세 규범과 가드는 CLAUDE.md의 같은 제목 블록, `lib/server/services/__tests__/workspace.test.ts`, `lib/server/actions/workspace/__tests__/workspaceTargetGuard.test.ts`, `app/(app)/settings/audit-log/__tests__/page.test.tsx`가 소유한다.
