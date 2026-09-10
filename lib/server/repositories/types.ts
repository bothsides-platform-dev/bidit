// Repository interfaces — backend-agnostic contracts.
// Drizzle implementations live in ./drizzle/*.
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { DB } from '@/lib/db/client';
import type { PgliteDB } from '@/lib/db/client-pglite';
import type { ContractDoc } from '@/lib/types/contract-doc';

import type { RFP, RfpStatus } from '@/lib/types/rfp';
import type { RfpInvitation } from '@/lib/types/invitation';
import type { PgRequest, PgRequestStatus, OpportunityListing } from '@/lib/types/pg-request';
import type {
  Workspace,
  WorkspaceMembershipSummary,
  MemberApprovalStatus,
  WorkspaceType,
} from '@/lib/types/workspace';
import type { User } from '@/lib/types/user';
import type { UserOnboarding, OnboardingKey, OnboardingTaskState } from '@/lib/types/onboarding';
import type { SignupSource } from '@/lib/types/signup-source';
import type { BizProfile } from '@/lib/types/biz-profile';
import type { Bid, PaymentMethod, TierRates } from '@/lib/types/bid';
import type { BoardColumn, ColumnKind } from '@/lib/types/column';
import type { Attachment } from '@/lib/types/common';
import type { Contract } from '@/lib/types/contract';
import type { Notification, NotificationChannel } from '@/lib/types/notification';
import type { AttachmentRecord } from './attachment-record';
import type { VerificationToken } from '@/lib/types/auth';
import type { BatchSender, OutboxEntry, OutboxEvent } from '../outbox/types';
import type { RfpRequoteRequest } from '@/lib/types/rfp-requote-request';
import type {
  SigningContract,
  SigningContractPatch,
  SigningDraftRef,
  SentContractSnapshot,
  SigningParticipant,
  SigningParticipantPatch,
  PgSigningTemplate,
} from '@/lib/types/signing';
import type { ContractArchive } from '@/lib/types/contract-archive';
import type { WorkspaceNameChangeRequest } from '@/lib/types/workspace-name-change';
import type { WorkspaceDisplay } from '@/lib/types/workspace';

// Tx union — postgres-js DB, pglite DB, or a transactional handle from either.
// `any` generics are localised here so individual method signatures stay clean.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = DB | PgliteDB | PgTransaction<any, any, any>;

export type TokenClaimResult =
  | { ok: true; invitation: RfpInvitation }
  | { ok: false; reason: 'expired' | 'used' | 'invalid' };

// ── RFP ───────────────────────────────────────────────────────────────
/**
 * RFP 신규 생성 insert 입력 — createRfp 가 발급한 bizProfile 스냅샷 id 를 직접 들고,
 * 도메인 RFP 매핑이 거치는 bizNo 룩업/allowlist 동기화 없이 컬럼을 그대로 적재한다.
 * (RfpRepo.save 는 bizProfile.bizNo 로 기존 프로필을 매칭해 일부 필드가 누락되므로 별도 경로.)
 */
export type NewRfpInsert = {
  id: string;
  code: string;
  buyerWsId: string;
  bizProfileId: string | null;
  title: string;
  memo: string;
  websiteUrl: string | null;
  mainProducts: string | null;
  annualPgVolume: string | null;
  currentFeeRate: string | null;
  currentSettlementLimit: string | null;
  currentGuaranteeInsurance: string | null;
  currentSettlementCycle: string | null;
  deliveryServicePeriod: string | null;
  boardVisible: boolean;
  currentFeeVisibleToPg: boolean;
  contractType: 'new' | 'renewal' | null;
  currentSolution: string | null;
  currentSolutionDetail: string | null;
  deadline: Date;
  status: RfpStatus;
  requiredPaymentMethods: string[];
  customPaymentMethods: { id: string; label: string }[];
  createdBy: string;
  sentAt: Date | null;
};

export interface RfpRepo {
  /** RFP insert/upsert(by id). 테스트 fixture 및 시드 전용 — 프로덕션 쓰기는 insertNew 사용. */
  save(rfp: RFP, tx?: Tx): Promise<void>;
  /** createRfp 전용 신규 insert — 스냅샷 bizProfileId·전 컬럼을 그대로 적재 (save 의 bizNo 룩업 우회). */
  insertNew(values: NewRfpInsert, tx?: Tx): Promise<void>;
  /** id(uuid) 단건 조회. 없으면 undefined. */
  findById(id: string, tx?: Tx): Promise<RFP | undefined>;
  /** code(P-YYMM-NNNN) 단건 조회 — URL/표시용 식별자. 없으면 undefined. */
  findByCode(code: string, tx?: Tx): Promise<RFP | undefined>;
  /** 한 구매사 워크스페이스의 모든 RFP. */
  /**
   * findById 의 배치판. findById 는 본체 조인 + 허용 PG 조회로 **2쿼리**라
   * id 마다 부르면 2N 이 된다 — 이 메서드는 개수와 무관하게 2쿼리.
   * 존재하지 않는 id 는 결과에서 빠진다. 순서 미보장.
   */
  findByIds(ids: string[], tx?: Tx): Promise<RFP[]>;
  findByBuyerWs(wsId: string, tx?: Tx): Promise<RFP[]>;
  /** 상태 전이 + 패치. DB 레이어에서 `WHERE status=$prev` 동시성 가드. */
  transition(id: string, to: RfpStatus, patch?: Partial<RFP>, tx?: Tx): Promise<RFP>;
  /** 통일 칸반: pipeline 보드 커스텀 컬럼 배치. null = 자동분류 복귀. */
  setBoardColumn(rfpId: string, columnId: string | null, tx?: Tx): Promise<void>;
  /** 오픈 게시판 노출 토글 (opt-out). */
  setBoardVisible(rfpId: string, visible: boolean, tx?: Tx): Promise<void>;
  /** 마감 직접 갱신 — transition 은 status 전용. */
  updateDeadline(id: string, deadline: Date, tx?: Tx): Promise<void>;
  /** code → id + 소유 워크스페이스 (경량, 소유권 게이트). findByCode 는 전체 hydrate 라 무겁다. */
  findIdAndOwnerByCode(
    code: string,
    tx?: Tx,
  ): Promise<{ id: string; buyerWsId: string } | undefined>;
  /** id → 소유 워크스페이스만 (ACL/업로드 게이트). */
  findOwnerById(id: string, tx?: Tx): Promise<{ buyerWsId: string } | undefined>;
  /** YYMM 카운터를 원자적으로 증가시켜 다음 RFP code(`P-YYMM-NNNN`) 발급. */
  reserveNextCode(yearMonth: string, tx?: Tx): Promise<string>;
  /** 구매사 검색 — 화이트리스트 projection(code·title·memo·status). pattern 은 호출자가 escape+wrap. */
  searchForBuyer(wsId: string, pattern: string, tx?: Tx): Promise<unknown[]>;
  /** 초성 검색용 — searchForBuyer 와 동일 projection, ilike 없이 ws-scope 만 fetch (호출자가 JS 필터). */
  listForBuyer(wsId: string, limit: number, tx?: Tx): Promise<unknown[]>;
  /** RFP 단건 하드삭제(by id). 자식(bids·invitations·allowlist 등)은 FK CASCADE. 온보딩 샘플 삭제 경로. */
  deleteById(id: string, tx?: Tx): Promise<void>;
}

// ── Invitation ────────────────────────────────────────────────────────
/** findByPgWorkspace 반환 행 — buyerName 은 RFP 발신 구매사 워크스페이스명 (카드/목록 표기용). */
export type PgInvitationPair = {
  invitation: RfpInvitation;
  rfp: RFP;
  buyerName: string;
};

export interface InvitationRepo {
  /** 초대 발송 — raw 토큰을 hash로 변환해 저장. raw 비저장. */
  save(inv: RfpInvitation, rawToken: string, tx?: Tx): Promise<void>;
  /** id 조회. */
  findById(id: string, tx?: Tx): Promise<RfpInvitation | undefined>;
  /** raw 토큰의 sha256 hash로 조회. claim 전 email 매칭 검사용. */
  findByTokenHash(tokenHash: string, tx?: Tx): Promise<RfpInvitation | undefined>;
  /** 한 RFP의 초대 목록. */
  findByRfp(rfpId: string, tx?: Tx): Promise<RfpInvitation[]>;
  /** 여러 RFP의 초대를 rfpId별 Map으로 배치 조회 (buyer 칸반 N+1 제거). */
  findByRfpIds(rfpIds: string[], tx?: Tx): Promise<Map<string, RfpInvitation[]>>;
  /** 한 RFP의 draft 상태 초대만 조회 — sendDraftInvitationsAction 일괄 발송용. */
  findDraftsByRfp(rfpId: string, tx?: Tx): Promise<RfpInvitation[]>;
  /** (rfpId, pgWsId) 쌍으로 단건 조회 — status 불문. acceptPgRequest 분기용. */
  findByRfpAndPg(rfpId: string, pgWsId: string, tx?: Tx): Promise<RfpInvitation | undefined>;
  /** draft row 삽입 (tokenHash = 'draft-{invId}' placeholder). */
  saveDraft(invId: string, rfpId: string, pgWsId: string, expiresAt: Date, tx?: Tx): Promise<void>;
  /** draft → pending: rawToken hash 갱신 + status='pending' + sentAt/expiresAt 갱신. */
  promoteDraft(invId: string, rawToken: string, now: Date, expiresAt: Date, tx?: Tx): Promise<void>;
  /** draft 상태일 때만 원자적으로 pending 승격. 발송 경합 판정용. */
  promoteDraftIfDraft(invId: string, rawToken: string, now: Date, expiresAt: Date, tx?: Tx): Promise<boolean>;
  /** draft 초대만 원자적으로 삭제. 삭제에 성공했는지 반환. */
  removeDraft(rfpId: string, pgWsId: string, tx?: Tx): Promise<boolean>;
  /** PG 워크스페이스에 발송된 활성 초대 + RFP pair — 인박스/칸반 공통 fetcher. */
  findByPgWorkspace(pgWsId: string, tx?: Tx): Promise<PgInvitationPair[]>;
  /** 토큰 atomic claim — 만료/사용/무효 분기. 동일 raw 토큰 동시 진입 가드. */
  claimToken(rawToken: string, userId: string, tx?: Tx): Promise<TokenClaimResult>;
  /** 워크스페이스 멤버십 단위 접근권 — 초대된 PG ws의 모든 멤버 통과. */
  canAccess(rfpId: string, pgWsId: string, tx?: Tx): Promise<boolean>;
  /**
   * `accepted` 상태의 초대를 `opened` 로 한 번만 전이. 이미 `opened` 이상이면 no-op.
   * inbox 상세 RSC 진입 시 호출 — 열람 기록(read-receipt) 목적. 칸반 분류에는 영향 없음 (검토중 단계 제거 후 sent/opened 모두 신규(received) 로 분류).
   */
  markOpened(invitationId: string, openedAt: Date, tx?: Tx): Promise<void>;
  /** 통일 칸반: pg pipeline 보드 커스텀 컬럼 배치. null = 자동분류 복귀. */
  setBoardColumn(invitationId: string, columnId: string | null, tx?: Tx): Promise<void>;
}

// ── RfpRequoteRequest (마감 전 협상 라운드) ───────────────────────────
export interface RfpRequoteRequestRepo {
  /** 요청 1건 생성 — (rfp,pg,round) UNIQUE 위배 시 throw. */
  create(req: RfpRequoteRequest, tx?: Tx): Promise<void>;
  /** 한 RFP의 모든 재요청 — createdAt asc. */
  findByRfp(rfpId: string, tx?: Tx): Promise<RfpRequoteRequest[]>;
  /** (rfp, pg) 의 pending 요청 — 없으면 undefined. submit 라운드 게이트용. */
  findPendingByPair(rfpId: string, pgWsId: string, tx?: Tx): Promise<RfpRequoteRequest | undefined>;
  /** PG 워크스페이스의 모든 pending 요청 — 인박스/칸반 '재요청' 배지 bulk 조회. */
  findPendingByPgWs(pgWsId: string, tx?: Tx): Promise<RfpRequoteRequest[]>;
  /** pending → responded 원자 전이(`WHERE status='pending'`). */
  markResponded(id: string, at: Date, tx?: Tx): Promise<void>;
}

// ── SigningContract (전자서명 계약 aggregate: 계약 + 참여자) ──────────────
export interface SigningContractRepo {
  /** 계약 + 참여자 원자 생성 — 활성 partial unique 위배 시 throw. */
  create(contract: SigningContract, participants: SigningParticipant[], tx?: Tx): Promise<void>;
  /** id 로 계약 + 참여자 조회. 없으면 undefined. */
  findById(
    id: string,
    tx?: Tx,
  ): Promise<{ contract: SigningContract; participants: SigningParticipant[] } | undefined>;
  /** RFP의 활성(awaiting/sent/in_progress) 계약 — 없으면 undefined. */
  findActiveByRfp(rfpId: string, tx?: Tx): Promise<SigningContract | undefined>;
  /** SnowSign provider_ref(계약 id)로 로컬 계약 조회 — webhook 트리거용. 없으면 undefined. */
  /** 복구 스캔이 노출한 공급자 계약 id 기록(대체 저장). 바인딩 게이트의 근거. */
  recordRecoveryDisclosure(id: string, refs: string[], tx?: Tx): Promise<void>;
  /** 이 공급자 계약 id 가 **어느 딜에서든** 스캔으로 노출된 적 있는가. */
  isRefDisclosed(ref: string, tx?: Tx): Promise<boolean>;
  findByProviderRef(providerRef: string, tx?: Tx): Promise<SigningContract | undefined>;
  /**
   * 여러 provider_ref 중 **이미 바인딩된 것**만 한 번에 돌려준다(복구 스캔 전용).
   * 행마다 findByProviderRef 를 때리면 최대 ~400회 순차 SELECT 가 12초 데드라인을
   * 발송 리스를 쥔 채 태운다. 빈 입력은 쿼리 없이 빈 집합.
   */
  findBoundProviderRefs(providerRefs: string[], tx?: Tx): Promise<Set<string>>;
  /** RFP의 모든 계약(라운드 포함) — createdAt desc. */
  findByRfp(rfpId: string, tx?: Tx): Promise<SigningContract[]>;
  /** 폴링 대상(sent/in_progress) — 오래 안 본 순(nulls first) limit 건. */
  findPollable(limit: number, tx?: Tx): Promise<SigningContract[]>;
  /** 계약 가변 필드 부분 갱신. */
  /**
   * awarded 인데 계약 행이 전무한 딜(onAward 유실) — cron 스윕 대상.
   * `awardedAfter` 최근성 창 필수(옛 딜 백필 방지), NULL awardedBidId 는 WHERE 제외.
   */
  findAwardedRfpsWithoutContract(
    limit: number,
    awardedAfter: Date,
    tx?: Tx,
  ): Promise<Array<{ rfpId: string; awardedBidId: string; createdBy: string; buyerWsId: string }>>;
  patchContract(id: string, patch: SigningContractPatch, tx?: Tx): Promise<void>;
  /**
   * 발송 **전** 초안 핸들을 기록하는 유일한 경로. `provider_ref` 와 출처(그리고 템플릿
   * 경로면 판본 id)를 **한 UPDATE** 로 쓴다 — 반쪽만 쓰이면 다음 재시도가 남의 초안을
   * 자기 것으로 오분류해 **다른 계약서를 발송한다**.
   *
   * CAS: `status='awaiting_pg_template' AND provider_ref IS NULL` 일 때만 성공한다.
   * `false` = 그 사이 다른 경로가 핸들을 쥐었다 → **호출자는 방금 만든 공급자 초안을
   * 취소해야 한다**(그것의 유일한 핸들을 쥐고 있다). `IS NULL` 이 필요한 이유는
   * `sendFromTemplate` 이 리스 **이전** 스냅샷으로 판정을 시작하기 때문이다 — 낡은
   * 리더가 남의 ref 를 덮어쓰면 취소 핸들이 사라지고 공급자 측 고아가 확정된다.
   *
   * 발송 **후** 바인딩은 이 경로를 쓰지 않는다(`markSentIfAwaiting` 이 같은 UPDATE 로
   * awaiting 을 떠난다 — 재사용 대상이 될 수 없는 근거는 그 상태 게이트다).
   */
  bindDraftRef(id: string, draft: SigningDraftRef, tx?: Tx): Promise<boolean>;
  /**
   * `bindDraftRef` 의 역연산 — 쓰기와 지우기가 같은 CAS 규율을 따른다.
   *
   * `WHERE id AND provider_ref = expectedRef AND status='awaiting_pg_template'` 일 때만
   * ref·출처·판본 세 컬럼을 **한 UPDATE** 로 NULL 로 지운다(반쪽 clear 는 다음 초안을
   * 오분류시킨다). id 만 보는 블라인드 clear 는 게이트 판정과 clear 사이(공급자 프로브
   * 왕복)에 임베드 attach 가 바인딩한 **발송된** 계약의 ref 를 지워 "sent +
   * provider_ref NULL = 영구 조정불가"(reconcile 이 즉시 반환) 행을 만들 수 있다 —
   * 기대 ref 와 awaiting 상태를 요구하면 그 최악 결과가 원천 차단된다.
   *
   * `false` = 그 사이 다른 경로가 핸들을 갈아치웠거나 행이 awaiting 을 떠났다 —
   * 호출자는 낡은 스냅샷으로 진행하지 말고 경합으로 물러나야 한다.
   */
  clearDraftRefIf(id: string, expectedRef: string, tx?: Tx): Promise<boolean>;
  /**
   * 발송 전 초안 핸들 조회 — 재사용 게이트의 입력.
   *
   * `SigningContract` 도메인 타입에 출처를 얹지 않는 이유는 `findSigningTemplateId`
   * (`bids.signing_template_id`)와 같다: 봉인 경계를 넓히지 않으려면 좁은 접근자로만
   * 읽는다. ref 가 없거나 출처를 모르는 레거시 행이면 `undefined`(= 재사용 불가).
   */
  findDraftRef(id: string, tx?: Tx): Promise<SigningDraftRef | undefined>;
  /** 참여자 가변 필드 부분 갱신. */
  patchParticipant(id: string, patch: SigningParticipantPatch, tx?: Tx): Promise<void>;
  /**
   * 멱등 완료 진입점 — 아직 종결(completed/canceled/declined/expired)되지 않은
   * 계약만 completed 로 원자 전이한다. 실제 전이했으면 true(호출자가 알림/감사),
   * 이미 종결이면 false(no-op). 동시 폴링 중복 완료를 막는다.
   */
  finalizeIfNotFinal(id: string, at: Date, tx?: Tx): Promise<boolean>;
  /**
   * 활성(awaiting_pg_template/sent/in_progress) 계약만 지정 terminal 상태로 원자 전이한다.
   * 이미 종결(completed/canceled/declined/expired)이면 전이하지 않고 false 를 반환한다.
   * declined/expired 알림 멱등화 + resend 클레임 직렬화(경쟁 상황에서 완료본 클로버 방지)에
   * 쓴다. canceled 전이는 canceledAt/cancelReason 도 함께 세팅한다.
   */
  transitionIfActive(
    id: string,
    toStatus: 'canceled' | 'declined' | 'expired',
    at: Date,
    opts?: { cancelReason?: string },
    tx?: Tx,
  ): Promise<boolean>;
  /**
   * 발송 클레임(CAS). `awaiting_pg_template` 이고 직전 클레임이 없거나 `leaseBefore`
   * 이전(리스 만료)일 때만 `claimed_for_send_at` 을 잡고 true 를 반환한다. PG 담당자
   * 둘이 동시에 '보내기'를 눌러도 SnowSign 계약이 한 건만 만들어진다.
   *
   * 상태는 건드리지 않는다 — 발송이 실패하거나 도중에 죽어도 계약은 awaiting 에
   * 남아 카드가 계속 눌리고, 리스가 만료되면 다시 잡을 수 있다.
   */
  claimForSend(
    id: string,
    at: Date,
    leaseBefore: Date,
    holderUserId: string,
    tx?: Tx,
  ): Promise<boolean>;
  /**
   * 강제 이어받기 — 리스가 살아 있어도 가져오고, **밀려난 사람**을 함께 알려준다.
   *
   * `claimForSend` 와 딱 하나 다르다: 만료 조건이 없다. 상태 조건은 그대로라
   * 이미 발송된 계약은 여전히 못 가져온다(강제는 경합에 대한 것이지 상태에 대한
   * 게 아니다). 동시 이어받기 둘 중 하나만 성공한다.
   *
   * 리스가 비어 있었으면 `displacedUserId: null` — 알릴 사람이 없다는 뜻이다.
   */
  forceClaimForSend(
    id: string,
    at: Date,
    holderUserId: string,
    tx?: Tx,
  ): Promise<{ taken: false } | { taken: true; displacedUserId: string | null }>;
  /**
   * 리스 현황 — 누가 언제부터 쥐고 있는지. 리스가 없으면 undefined.
   * 도메인 타입(`SigningContract`)에는 싣지 않는 내부 값이라 이 좁은 리드로만 본다
   * (그 타입은 구매사에게도 흘러가므로 PG 인력 정보를 얹지 않는다).
   */
  findSendLease(
    id: string,
    tx?: Tx,
  ): Promise<{ claimedAt: Date; holderUserId: string | null } | undefined>;
  /**
   * 발송된 조항형 계약의 문서 스냅샷 — **좁은 전용 리더**(`findSigningTemplateId` 선례).
   * 도메인 타입·목록 projection 에 얹지 않는다: 조항 60개·본문 4000자까지 허용되므로
   * 딜룸 로드마다 페이로드를 타면 안 된다. 템플릿·임베드 계약은 undefined.
   */
  findSentDocument(id: string, tx?: Tx): Promise<SentContractSnapshot | undefined>;
  /**
   * 발송 성공 영속의 CAS. `awaiting_pg_template` 일 때만 `sent` 로 전이하고 provider
   * 정보를 기록한다. 클레임은 SnowSign 왕복 **전**에 잡히므로 send-vs-send 만 막는다 —
   * 왕복 도중 도착한 구매사 취소를 이 CAS 가 이기지 못하게 해서, 종결된 계약이 발송
   * 성공으로 되살아나는 것을 막는다. 졌으면 false(호출자가 provider 계약을 보상 취소).
   */
  markSentIfAwaiting(
    id: string,
    patch: {
      providerRef: string;
      sentAt: string;
      /** 복구 바인딩은 provider 실상태(in_progress)를 존중한다 — 기본은 sent. */
      status?: 'sent' | 'in_progress';
      /**
       * 이 재바인딩의 초안 출처 — **필수다**(옵셔널이면 미래 호출자가 빠뜨려 출처
       * 스테일이 재발한다). `null` = 출처 없음(임베드 attach·복구·자가치유). 이
       * 메서드는 `provider_ref` 의 두 번째 쓰기 경로이므로 출처·판본 컬럼을 **같은
       * UPDATE** 로 정리한다 — 안 하면 남아 있던 template 출처가 임베드 계약에 옮겨
       * 붙어 재사용 게이트가 거짓 출처를 참으로 읽는다.
       *
       * `{ origin: 'compose' }` 는 판본을 갖지 않는다(그 경로엔 provider 템플릿이
       * 없다). compose 를 `null` 로 뭉뚱그리지 않는 이유는 null 의 뜻이 다르기
       * 때문이다 — null 은 "출처를 지운다"라서 발송된 compose 계약이 출처 미상으로
       * 남고, 이후 어떤 판독기도 그 계약이 어느 경로로 나갔는지 알 수 없다.
       *
       * compose 팔은 대신 **문서 스냅샷을 필수로 요구한다**. 그 경로만이 문서를 우리
       * DB 에 갖고, 그 서식 행은 수정 가능하다 — 스냅샷 없이 발송하면 "무엇을
       * 보냈는지 모르는 계약"이 남는다. 필수로 두면 그 상태가 컴파일 타임에 표현
       * 불가능해진다(출처·판본을 한 UPDATE 로 묶은 것과 같은 규율).
       */
      draft:
        | { origin: 'template'; snowsignTemplateId: string }
        | { origin: 'compose'; sentDocument: SentContractSnapshot }
        | null;
    },
    tx?: Tx,
    /**
     * 리스 소유 CAS(선택) — 리스를 쥔 채 provider 왕복을 도는 발송 경로(템플릿)가
     * 자기 `claimedAt` 토큰을 걸면, 왕복 중 `forceClaimForSend` 에 밀린 발송이
     * 여기서 진다. 정확일치 규약(renewSendClaim 과 동일).
     */
    opts?: { claimedAt?: Date },
  ): Promise<boolean>;
  /**
   * 하트비트 연장 — `currentClaimedAt` 이 정확히 일치하고 아직 awaiting 일 때만
   * `newClaimedAt` 으로 갱신하고 true. 리스가 만료돼 다른 발송자가 재취득했거나
   * 이미 발송됐으면 false 이고, 호출부는 자기 세션을 멈춰야 한다.
   *
   * 리스를 짧게 가져가면서(탭 닫기·크래시·이탈을 "핑이 멎음" 하나로 수렴) 진짜
   * 작업 중인 세션은 무한히 살려 두기 위한 primitive.
   */
  renewSendClaim(
    id: string,
    currentClaimedAt: Date,
    newClaimedAt: Date,
    tx?: Tx,
  ): Promise<boolean>;
  /**
   * 클레임 즉시 해제 — 리스 만료를 기다리지 않고 다시 열 수 있게 한다(닫기·언마운트·
   * 발송 실패). `claimedAt` 이 일치할 때만 지운다: 리스 만료 후 다른 발송자가
   * 재취득했다면 옛 발송자의 뒤늦은 해제가 남의 살아있는 클레임을 풀어선 안 된다.
   */
  releaseSendClaim(id: string, claimedAt: Date, tx?: Tx): Promise<void>;
  /**
   * 리마인더 쿨다운 클레임 — `last_reminded_at IS NULL OR < cooldownBefore` 일 때만
   * `at` 으로 갱신(CAS). 판정과 기록이 한 문장이라 동시 클릭 둘이 함께 통과할 수 없다.
   */
  claimRemind(id: string, at: Date, cooldownBefore: Date, tx?: Tx): Promise<boolean>;
  /**
   * 리마인더 클레임 되돌리기 — provider 발송이 실패한 경우에만. `at` 정확일치 CAS 라
   * 그 사이 다른 클레임이 성립했다면 남의 것을 풀지 않는다.
   */
  releaseRemindClaim(id: string, at: Date, tx?: Tx): Promise<void>;
  /**
   * 오래 방치된 awaiting_pg_template 계약 — createdAt 이 nudgeBefore 이전이고 최근
   * (nudgeBefore 이후) 재넛지되지 않은(lastPolledAt null 또는 nudgeBefore 이전) 것만,
   * 오래된 순. 재넛지 스로틀 마커로 lastPolledAt 을 재사용한다(awaiting 은 폴링 대상이 아님).
   */
  findStaleAwaiting(nudgeBefore: Date, limit: number, tx?: Tx): Promise<SigningContract[]>;
  /**
   * **공급자 마감이 없는 채로** 오래 열려 있는 발송 계약 — 조항형(compose) 경로의
   * 방치 감지. `expires_at IS NULL` 이 곧 "이 계약은 스스로 만료될 수 없다"이고,
   * 템플릿 경로 계약은 provider 가 만료시키므로 애초에 이 집합에 남지 않는다
   * (술어가 compose 를 이름으로 특정하지 않는 이유 — 정의가 자기 설명적이다).
   */
  findStaleSent(
    sentBefore: Date,
    realertBefore: Date,
    limit: number,
    tx?: Tx,
  ): Promise<SigningContract[]>;
  /**
   * 방치 알림 클레임 — 판정과 기록이 한 UPDATE(CAS). 1분 폴러의 두 틱이 겹쳐도
   * 한 번만 알린다. `claimRemind` 와 같은 규율이되 **컬럼이 다르다**(겸용하면
   * 운영자 알림이 사용자용 리마인더 쿨다운을 잡아먹는다).
   */
  claimStaleNotify(id: string, at: Date, realertBefore: Date, tx?: Tx): Promise<boolean>;
  /** 기존 계약에 참여자 추가 — awaiting→sent 전이 시 사용. */
  insertParticipants(participants: SigningParticipant[], tx?: Tx): Promise<void>;
}

// ── PgSigningTemplate (PG 재사용 계약서 템플릿) ─────────────────────────
export interface PgSigningTemplateRepo {
  /** PDF 업로드 서식 생성 — id 미지정 시 발급. */
  create(
    template: {
      id?: string;
      workspaceId: string;
      snowsignTemplateId: string;
      name: string;
      createdBy: string;
    },
    tx?: Tx,
  ): Promise<void>;
  /**
   * 조항형 서식 생성 — provider 왕복이 없다. 문서가 우리 DB 에 있으므로
   * 스노우싸인에는 아무것도 만들지 않는다(발송 시점에 렌더해 건별 계약으로 보낸다).
   */
  createComposed(
    template: {
      id?: string;
      workspaceId: string;
      name: string;
      document: ContractDoc;
      createdBy: string;
    },
    tx?: Tx,
  ): Promise<void>;
  /**
   * 조항형 서식의 문서·이름 교체 — 행 id 를 유지하는 in-place UPDATE.
   * `bids.signing_template_id` 연결이 살아남아야 하므로 delete+create 는 금지다.
   * 반환은 "그 종류의 행이 실제로 갱신됐는가" — pdf 행이나 사라진 행이면 false.
   */
  updateComposedDocument(
    id: string,
    name: string,
    document: ContractDoc,
    tx?: Tx,
  ): Promise<boolean>;
  /** id 단건 조회. 없으면 undefined. */
  findById(id: string, tx?: Tx): Promise<PgSigningTemplate | undefined>;
  /** 한 워크스페이스의 모든 템플릿, 생성일 오름차순. */
  listByWorkspace(workspaceId: string, tx?: Tx): Promise<PgSigningTemplate[]>;
  /** 이름 변경 — 소유 워크스페이스 검증은 서비스 레이어 책임. */
  updateName(id: string, name: string, tx?: Tx): Promise<void>;
  /**
   * provider 템플릿 교체 + 이름 동기화 — 수정 저장(재생성 후 교체)의 영속 절반.
   * 행 in-place UPDATE 다: delete+create 는 bids.signing_template_id(ON DELETE
   * SET NULL)를 끊어 견적에 연결해 둔 템플릿 선택이 조용히 사라진다.
   * 반환은 "행이 실제로 교체됐는가" — 소유 검증과 이 UPDATE 사이의 provider
   * 왕복 동안 동료의 삭제가 끼어들면 0행이 되고, 이를 성공으로 보고하면
   * 에디터가 거짓 '저장했어요'를 띄운다.
   */
  updateProviderTemplate(
    id: string,
    snowsignTemplateId: string,
    name: string,
    tx?: Tx,
  ): Promise<boolean>;
  /** 단건 하드 삭제. */
  remove(id: string, tx?: Tx): Promise<void>;
}

// ── ContractArchive (계약 보관함) ────────────────────────────────────
export interface ContractArchiveRepo {
  /** 완료 계약의 양쪽(buyer/pg) pending 행을 한 번에 insert. onConflictDoNothing — 멱등. */
  insertPendingSigningPair(
    rows: Array<{
      workspaceId: string;
      signingContractId: string;
      rfpCode: string;
      title: string;
      counterpartyName: string | null;
      contractedAt: Date | null;
    }>,
    tx?: Tx,
  ): Promise<void>;
  /** Workspace 잠금 아래에서 cap 확인과 pending insert를 한 트랜잭션으로 수행. */
  insertPendingUploadWithinCap(
    row: {
      id: string;
      workspaceId: string;
      title: string;
      counterpartyName?: string | null;
      contractedAt?: Date | null;
      documentKey: string;
      documentName: string;
      documentSize: number;
      createdBy: string;
    },
    cap: number,
  ): Promise<boolean>;
  findById(id: string, tx?: Tx): Promise<ContractArchive | undefined>;
  /** coalesce(contracted_at, created_at) desc 정렬. */
  listByWorkspace(workspaceId: string, tx?: Tx): Promise<ContractArchive[]>;
  /** source='signing' pending 을 계약 단위로 묶어 오래된 순 반환. */
  findPendingSigningGroups(
    limit: number,
    tx?: Tx,
  ): Promise<Array<{ signingContractId: string; attempts: number; rfpCode: string | null }>>;
  /** 같은 계약의 두 행을 함께 ready 로 (pending 인 행만). */
  markSigningReady(
    signingContractId: string,
    doc: {
      documentKey: string;
      documentName: string;
      documentSize: number;
      auditKey: string;
      auditName: string;
    },
    tx?: Tx,
  ): Promise<void>;
  recordSigningAttempt(signingContractId: string, at: Date, tx?: Tx): Promise<void>;
  markSigningFailed(signingContractId: string, at: Date, tx?: Tx): Promise<void>;
  /** signing 행이 죽어(SET NULL) providerRef 를 영영 회복할 수 없는 pending 을 failed 로. 처리 행 수 반환. */
  failOrphanedSigningPending(at: Date, tx?: Tx): Promise<number>;
  /** ready 전이 성공 여부 반환(0행 = false). source='upload' + pending 인 행만. */
  markUploadReady(id: string, tx?: Tx): Promise<boolean>;
  /**
   * completed 이면서 낙찰 포인터(rfps.awardedBidId not null)가 있는데 보관함
   * 행이 전무한 signing_contracts id — completedAt asc. 낙찰 포인터가 없는
   * 완료 계약(RFP 재요청·삭제 등으로 소실)은 createPendingForContract 가
   * 영구히 RFP_NOT_FOUND 로 실패하므로 후보에서 제외한다 — 안 그러면 이
   * 스윕이 그 건에 예산을 매번 뺏겨 다른 정상 건을 굶긴다.
   */
  findCompletedContractsMissingArchive(limit: number, tx?: Tx): Promise<string[]>;
  /**
   * source='upload' + pending + cutoff 이전 행을 **최대 `limit` 개** 삭제하고
   * (id, documentKey) 를 반환한다. 상한이 필수인 이유: 호출자가 삭제된 행마다 R2
   * 객체를 지우는데 행은 이미 커밋돼 있어, 루프가 닿지 못한 객체는 가리키는 것이
   * 없는 고아가 된다(첨부 스윕의 `deleteStalePending` 과 같은 규율).
   */
  deleteStaleUploadPending(
    cutoff: Date,
    limit: number,
    tx?: Tx,
  ): Promise<Array<{ id: string; documentKey: string | null }>>;
  removeUpload(id: string, tx?: Tx): Promise<void>;
  /** source='upload' + pending 행만 원자적으로 삭제. ready 전이와 경합하면 false. */
  removePendingUpload(id: string, tx?: Tx): Promise<boolean>;
}

// ── PgRequest (오픈 게시판 콜드 피치) ──────────────────────────────────
export interface PgRequestRepo {
  /** 요청 1건 생성 — (rfpId, pgWsId) UNIQUE 위배 시 throw(중복 요청 차단). */
  create(req: PgRequest, tx?: Tx): Promise<void>;
  /** id 단건 조회. */
  findById(id: string, tx?: Tx): Promise<PgRequest | undefined>;
  /** 한 RFP의 모든 요청 — 구매사 검토 목록(상태 필터는 호출부). createdAt asc. */
  findByRfp(rfpId: string, tx?: Tx): Promise<PgRequest[]>;
  /** (rfp, pg) 쌍의 현재 요청 상태 — 없으면 undefined. 게시판/액션 제외 판정용. */
  findPairStatus(rfpId: string, pgWsId: string, tx?: Tx): Promise<PgRequestStatus | undefined>;
  /** pending → accepted|rejected 원자 전이(`WHERE status='pending'`). 이미 결정됐으면 no-op. */
  markDecided(
    id: string,
    status: 'accepted' | 'rejected',
    decidedByUserId: string,
    at: Date,
    tx?: Tx,
  ): Promise<void>;
  /**
   * PG 게시판 — 발견 가능한 오픈 RFP 목록. 공개 경계가 이 쿼리에 있다:
   * SELECT는 화이트리스트 컬럼만(수수료/현재조건 미포함). WHERE status='sent'
   * AND deadline>now AND board_visible=true, 그리고 이미 allowlist 됐거나
   * 어떤 상태로든 요청 행이 있는 RFP는 제외.
   */
  findOpenRfpsForPg(pgWsId: string, now: Date, tx?: Tx): Promise<OpportunityListing[]>;
}

// ── Workspace ─────────────────────────────────────────────────────────
export type TeamMember = { userId: string; name: string; joinedAt: string; avatarUpdatedAt: string | null };

export interface PresenceAccessRepo {
  /**
   * presence:ws:<targetWsId> subscribe-proxy ACL 관계 술어 — 멤버십 ∨ 대화 ∨
   * RFP 초대 쌍 ∨ pending 콜드피치 쌍(방향 대칭). 관찰자의 활성 워크스페이스는
   * 프록시가 알 수 없으므로 전 멤버십 기준. rejected 콜드피치는 허가하지 않는다.
   */
  canObserve(userId: string, targetWsId: string, tx?: Tx): Promise<boolean>;
}

export interface WorkspaceRepo {
  /** 워크스페이스 + 멤버 동기화. */
  save(ws: Workspace, tx?: Tx): Promise<void>;
  /** id 조회 — 멤버/bizProfile hydration 포함. */
  findById(id: string, tx?: Tx): Promise<Workspace | undefined>;
  /** 유저가 속한 모든 워크스페이스 — 스위처용 경량 projection (hydration 없음). */
  listForUser(
    userId: string,
    tx?: Tx,
  ): Promise<WorkspaceMembershipSummary[]>;
  /**
   * 마스터/운영자 스위처용 — 모든 active 워크스페이스를 synthetic admin 멤버십
   * (role:'admin', unreadCount:0)으로 반환. 최대 500개. 멤버십 무관.
   */
  listAllWorkspacesForMaster(tx?: Tx): Promise<WorkspaceMembershipSummary[]>;
  /** 유저가 해당 워크스페이스의 멤버인지 여부 (boolean). 권한 게이트 단일 소스. */
  isMember(userId: string, workspaceId: string, tx?: Tx): Promise<boolean>;
  /**
   * 해당 워크스페이스 멤버 user id 배열 — 읽음(read-receipt) 계산(conversationLoaders) 전용.
   * 승인 상태 필터가 없으므로 알림 팬아웃에는 쓰지 말 것 — approvedMemberRecipients 를 사용한다.
   * 순서 미보장.
   */
  memberUserIds(workspaceId: string, tx?: Tx): Promise<string[]>;
  /** 멘션 자동완성/렌더용 팀 로스터 — {userId, name, joinedAt}. 승인된(approved) 멤버만, 시스템 계정 제외. */
  teamRoster(workspaceId: string, tx?: Tx): Promise<TeamMember[]>;
  /** 해당 워크스페이스 멤버 이메일 배열 — outbox 발송 fanout용. 순서 미보장. */
  memberEmails(workspaceId: string, tx?: Tx): Promise<string[]>;
  /** canonical_pg_key가 있는 사전 시딩 PG 워크스페이스 목록 — PG 가입 회사 선택 UI용. */
  listCanonicalPgWorkspaces(): Promise<{ id: string; name: string; canonicalPgKey: string; logoUpdatedAt: string | null }[]>;
  /**
   * 이름 검색 — 워크스페이스 피커. q 있으면 ilike 부분일치(limit 20), 없으면 전체(limit 500).
   * **status='active' 만** 반환한다 — 심사 대기/정지 워크스페이스는 피커에 뜨면 안 된다.
   * `includeTest` 미지정이면 테스트용 PG 를 제외한다(규칙: `lib/features/test-pg.ts`).
   * 해제는 `SHOW_TEST_PG_COOKIE` 쿠키를 읽는 호출자가 결정한다.
   */
  search(opts: { type: WorkspaceType; q?: string; includeTest?: boolean }, tx?: Tx): Promise<{ id: string; name: string; logoUpdatedAt: string | null }[]>;
  /** 단일 워크스페이스 상호명 — 이메일/알림 표기. 없으면 undefined. */
  getName(workspaceId: string, tx?: Tx): Promise<string | undefined>;
  /** active 워크스페이스 상호명 — 상태가 다르거나 없으면 undefined. 쓰기 게이트용. */
  getActiveName(workspaceId: string, tx?: Tx): Promise<string | undefined>;
  /**
   * 표시용 경량 정보 — 신원 카드/메시지 컴포즈가 상대 워크스페이스를 그리는 데 필요한
   * 최소 필드(id·상호명·유형·로고 버전)만. 멤버/bizProfile hydration 없음. 없으면 undefined.
   */
  getDisplayInfo(workspaceId: string, tx?: Tx): Promise<WorkspaceDisplay | undefined>;
  /**
   * getDisplayInfo 의 배치판 — 워크스페이스 이름/로고를 id 목록으로 한 번에.
   * RFP 상세·대화 목록 로더가 id 마다 findById 를 돌던 N+1 을 없앤다.
   * 존재하지 않는 id 는 결과에서 빠진다(자리표시자 없음). 순서 미보장.
   */
  findDisplayInfoByIds(ids: string[], tx?: Tx): Promise<WorkspaceDisplay[]>;
  /**
   * isMember 의 배치판 — 주어진 워크스페이스 중 사용자가 속한 곳 하나의 id,
   * 없으면 null. 프로필 카드가 상대 워크스페이스마다 isMember 를 돌던 루프를
   * 대체한다. 빈 목록은 조회 없이 null.
   */
  isMemberOfAny(userId: string, workspaceIds: string[], tx?: Tx): Promise<string | null>;
  /** 승인된(approvalStatus='approved') 멤버 전원 팬아웃 대상 (userId+email), role 무관. 시스템 계정 제외. 인앱/이메일 알림 발송 대상. 순서 미보장. */
  approvedMemberRecipients(workspaceId: string, tx?: Tx): Promise<{ userId: string; email: string }[]>;
  /**
   * 여러 워크스페이스의 승인된(approvalStatus='approved') 멤버를 (workspaceId, userId, role, email)
   * 평면 목록으로 배치 조회. 시스템 계정 제외. 빈 입력은 빈 배열. 초대 일괄 발송(멤버 알림 + 메일)용.
   */
  memberRecipientsBatch(
    wsIds: string[],
    tx?: Tx,
  ): Promise<{ workspaceId: string; userId: string; role: string; email: string }[]>;
  /** active 상태 워크스페이스 (id+type) — 마스터/스위치. 없거나 비활성이면 undefined. */
  findActiveById(workspaceId: string, tx?: Tx): Promise<{ id: string; type: WorkspaceType } | undefined>;
  /**
   * 사전 시딩된 canonical PG 워크스페이스 (type='pg' AND status='active' AND
   * canonical_pg_key IS NOT NULL) 단건 — PG 가입 합류 입력 검증용. 위 조건 중 하나라도
   * 어긋나거나 없으면 undefined.
   */
  findActiveCanonicalPgById(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ id: string; name: string; canonicalPgKey: string } | undefined>;
  /** 가장 먼저 만들어진 active 워크스페이스 (id+type) — 마스터 기본 진입. 없으면 undefined. */
  findEarliestActiveWorkspace(
    tx?: Tx,
  ): Promise<{ id: string; type: WorkspaceType } | undefined>;
  /** (userId, workspaceId) 멤버십 — role+type+승인상태. 없으면 undefined. */
  getMembership(
    userId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ role: string; type: WorkspaceType; approvalStatus: MemberApprovalStatus } | undefined>;
  /** 유저의 최초 가입 멤버십 (earliest joinedAt). 없으면 undefined. */
  findInitialMembership(
    userId: string,
    tx?: Tx,
  ): Promise<
    { workspaceId: string; role: string; type: WorkspaceType; approvalStatus: MemberApprovalStatus } | undefined
  >;
  /**
   * 유저의 모든 멤버십 + 각 워크스페이스의 사람 멤버 — 탈퇴 상태 화면(마지막 admin / solo 판정).
   * createdAt 순서 미보장; 호출부가 멤버 수·역할로 분기한다.
   */
  listMembershipsWithMembers(
    userId: string,
    tx?: Tx,
  ): Promise<
    {
      workspaceId: string;
      name: string;
      role: string;
      approvalStatus: MemberApprovalStatus;
      /** 시스템 계정은 제외된다 — `hydrate()` 의 UI 멤버 목록과 같은 규칙. */
      members: { userId: string; role: string; approvalStatus: MemberApprovalStatus }[];
    }[]
  >;
  /** bizProfile 포인터 갱신. */
  setBizProfilePointer(workspaceId: string, bizProfileId: string, tx?: Tx): Promise<void>;
  /** 현재 bizProfileId (경량). 없거나 미설정이면 undefined. */
  getBizProfileId(workspaceId: string, tx?: Tx): Promise<string | undefined>;
  /**
   * 현재 bizProfileId + 상호명 단건 조회 — RFP 작성 시 스냅샷·발신자명 확보용.
   * 워크스페이스 없으면 undefined (소유권/존재 게이트). bizProfile 미설정이면 null.
   */
  getBizProfileIdAndName(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ bizProfileId: string | null; name: string } | undefined>;
  /** 주어진 id 중 type='pg' 인 워크스페이스 id 부분집합. 빈 입력은 빈 배열. PG allowlist 검증용. */
  filterPgIds(ids: string[], tx?: Tx): Promise<string[]>;
  /** 운영자 심사 전 이름 변경 요청 생성. 대기 요청 UNIQUE 위반은 호출자가 분기한다. */
  createNameChangeRequest(
    input: { workspaceId: string; requestedByUserId: string; currentName: string; requestedName: string },
    tx?: Tx,
  ): Promise<void>;
  /** 가장 최근 이름 변경 요청. 없으면 undefined. */
  findLatestNameChangeRequest(workspaceId: string, tx?: Tx): Promise<WorkspaceNameChangeRequest | undefined>;
  /** 로고 버전 스탬프 — 업로드 시 now(Date), 삭제 시 null. */
  setLogoUpdatedAt(workspaceId: string, value: Date | null, tx?: Tx): Promise<void>;
  /**
   * 경량 workspace 생성 (save()는 멤버 동기화까지 하는 무거운 버전 — 이건 단순 insert).
   * 멤버십/컬럼/온보딩 시드는 호출부 책임.
   */
  createBare(
    params: { id: string; type: WorkspaceType; name: string; bizProfileId: string | null },
    tx?: Tx,
  ): Promise<void>;
  /** 멤버 추가 (onConflictDoNothing — 중복 race 안전). */
  addMember(
    params: { workspaceId: string; userId: string; role: string; approvalStatus?: MemberApprovalStatus },
    tx?: Tx,
  ): Promise<void>;
  /** 멤버십 승인 상태 단건 조회. 행 없으면 undefined. */
  getMemberApprovalStatus(
    userId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<MemberApprovalStatus | undefined>;
  /** 워크스페이스의 pending(미만료) 초대 목록 — 설정 > 멤버 화면. */
  listPendingInvitations(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ email: string; createdAt: Date; role: string }[]>;
  /** tokenHash 로 워크스페이스 초대 + 워크스페이스명 조인. 없으면 undefined. */
  findInvitationByTokenHash(
    tokenHash: string,
    tx?: Tx,
  ): Promise<
    | {
        invitedEmail: string;
        status: string;
        expiresAt: Date;
        workspaceName: string;
        workspaceId: string;
      }
    | undefined
  >;
  /**
   * 초대 원자적 클레임 (조건부 UPDATE: status='pending' AND expires_at>now).
   * 이미 사용/만료면 실패. 멤버 추가·이메일 인증은 호출부(addMember 등) 책임.
   */
  claimInvitation(
    invitationId: string,
    userId: string,
    tx?: Tx,
  ): Promise<
    | { ok: true; workspaceId: string; role: string }
    | { ok: false; reason: 'expired' }
  >;
  /** 워크스페이스 관리자(admin) 이메일 — RFP 초대 랜딩 프리필. 없으면 undefined. */
  findAdminEmail(workspaceId: string, tx?: Tx): Promise<string | undefined>;
  /**
   * 멤버 초대 row 생성 (pending). (workspace, lower(email)) pending UNIQUE 위배 시
   * throw — 호출부가 isUniqueViolation 로 ALREADY_INVITED 분기. invitedEmail 은
   * 호출부가 normalize 한 값을 그대로 적재.
   */
  createInvitation(
    params: {
      workspaceId: string;
      invitedEmail: string;
      invitedByUserId: string;
      role: 'admin' | 'member';
      tokenHash: string;
      expiresAt: Date;
    },
    tx?: Tx,
  ): Promise<void>;
  /**
   * 재발송 — 매칭되는 pending 초대(workspace + lower(email))의 tokenHash·expiresAt
   * 갱신. 갱신된 행이 있으면 true(=재발송 대상 존재), 없으면 false(INVITE_NOT_FOUND).
   */
  resetPendingInvitationToken(
    params: { workspaceId: string; email: string; tokenHash: string; expiresAt: Date },
    tx?: Tx,
  ): Promise<boolean>;
  /**
   * 취소 — 매칭되는 pending 초대(workspace + lower(email))를 'expired' 로 전이.
   * 전이된 행이 있으면 true, 없으면 false(INVITE_NOT_FOUND).
   */
  expirePendingInvitation(
    params: { workspaceId: string; email: string },
    tx?: Tx,
  ): Promise<boolean>;
  /**
   * tokenHash 로 초대 claim 입력 조회 — acceptInvite 의 사전검사(status/expiresAt/
   * invitedEmail) + claimInviteInTx 입력(id/workspaceId/role/expiresAt) 용. 없으면 undefined.
   * (findInvitationByTokenHash 는 워크스페이스명 조인의 표시용 projection 이라 별도.)
   */
  findInvitationClaimByTokenHash(
    tokenHash: string,
    tx?: Tx,
  ): Promise<
    | {
        id: string;
        workspaceId: string;
        role: 'admin' | 'member';
        expiresAt: Date;
        status: string;
        invitedEmail: string;
      }
    | undefined
  >;
  /** 워크스페이스의 admin 역할 멤버 수 — 마지막 admin 강등 가드(LAST_ADMIN). */
  countAdmins(workspaceId: string, tx?: Tx): Promise<number>;
  /**
   * `countAdmins` 와 같은 수를 세되 승인된 admin 행에 `FOR UPDATE` 잠금을 건다.
   * 마지막 admin 가드처럼 "세고 나서 쓰는" 경로는 반드시 이 쪽을 트랜잭션 안에서
   * 써야 한다 — 그렇지 않으면 동시 강등 둘이 서로를 못 보고 통과해 admin 이 0명이 된다.
   */
  countApprovedAdminsForUpdate(workspaceId: string, tx?: Tx): Promise<number>;
  /** 멤버 역할 변경. */
  updateMemberRole(
    params: { workspaceId: string; userId: string; role: 'admin' | 'member' },
    tx?: Tx,
  ): Promise<void>;
  /** 멤버 제거. */
  removeMember(params: { workspaceId: string; userId: string }, tx?: Tx): Promise<void>;
  /** 주어진 워크스페이스들을 삭제 (멤버/RFP 등은 FK cascade). 빈 배열은 안전한 no-op. 계정 탈퇴 solo 정리용. */
  deleteWorkspaces(ids: string[], tx?: Tx): Promise<void>;
  /** 한 유저의 모든 멤버십 row 삭제 — 계정 탈퇴용. */
  removeAllMembershipsForUser(userId: string, tx?: Tx): Promise<void>;
}

// ── User ──────────────────────────────────────────────────────────────
export interface UserRepo {
  /** upsert(by id). bcrypt hash는 호출자 책임. */
  save(user: User & { passwordHash: string }, tx?: Tx): Promise<void>;
  /**
   * 신규 가입 user insert — 미인증·active 기본값으로 고정 (emailVerified=false,
   * status='active', avatarColor='ink'). 이메일 UNIQUE 위배 시 throw (호출부가
   * isUniqueViolation 로 EMAIL_TAKEN 분기). save(upsert)와 달리 충돌 시 갱신하지 않는다.
   */
  create(
    params: {
      id: string;
      email: string;
      passwordHash: string;
      name: string;
      phone: string;
      /** First-touch 가입 유입 경로(lib/types/signup-source.ts). 모든 가입 경로가 전달할 수 있다. */
      signupSource?: SignupSource;
    },
    tx?: Tx,
  ): Promise<void>;
  /** id 조회. */
  findById(id: string, tx?: Tx): Promise<User | undefined>;
  /**
   * 신원 카드용 프로필 필드 projection — id 매칭 **+ 시스템 계정 제외**(WHERE is_system_account=false).
   * 시스템/마스터 계정은 모든 멤버 표면에서 숨긴다는 불변식을 이 경로에도 적용(fail-closed):
   * 시스템 계정이거나 행이 없으면 undefined. (findById 는 시스템 계정도 반환하므로 신원 노출엔 부적합.)
   */
  findProfileById(
    userId: string,
    tx?: Tx,
  ): Promise<
    { id: string; name: string; email: string; avatarUpdatedAt: string | null } | undefined
  >;
  /**
   * 연락처 projection — id 매칭 **+ 시스템 계정 제외**(findProfileById 와 동일 fail-closed).
   * 선정 후 담당자 연락처 교환용. 시스템 계정이거나 행이 없으면 undefined. phone 은 nullable.
   */
  findContactById(
    userId: string,
    tx?: Tx,
  ): Promise<{ name: string; email: string; phone: string | null } | undefined>;
  /** id 로 passwordHash 단건 조회 — 계정 탈퇴 비밀번호 확인용. 없으면 undefined. */
  findPasswordHashById(userId: string, tx?: Tx): Promise<string | undefined>;
  /**
   * email 매칭 행의 passwordHash 갱신 + sessionVersion +1 — 비밀번호 재설정.
   * sessionVersion bump 로 재설정 전 발급된 세션을 무효화한다.
   */
  updatePassword(email: string, passwordHash: string, tx?: Tx): Promise<void>;
  /**
   * id 매칭 행의 email 교체 + sessionVersion +1 — 이메일 변경 확정.
   * 새 email UNIQUE 위배 시 throw (호출부가 isUniqueViolation 로 EMAIL_TAKEN 분기).
   */
  updateEmail(userId: string, newEmail: string, tx?: Tx): Promise<void>;
  /**
   * id 매칭 행의 phone 교체 — 설정 화면의 휴대폰 인증이 유일한 호출자다.
   *
   * email 과 달리 로그인 식별자가 아니므로 `sessionVersion` 을 올리지 않는다
   * (번호를 바꿨다고 다른 기기에서 로그아웃될 이유가 없다). 값은 `normalizePhone`
   * 이 하이픈을 벗긴 숫자만 형태여야 한다 — 발송 경로가 그 형태를 전제로
   * 하이픈을 다시 붙인다.
   */
  updatePhone(userId: string, phone: string, tx?: Tx): Promise<void>;
  /**
   * 계정 소프트 삭제 — deletedAt 스탬프 + lastActiveWorkspaceId=null +
   * sessionVersion +1 (탈퇴 계정의 모든 미만료 JWT 무효화).
   */
  softDelete(userId: string, tx?: Tx): Promise<void>;
  /** email 조회 — passwordHash 포함(로그인용). */
  findByEmail(
    email: string,
    tx?: Tx,
  ): Promise<(User & { passwordHash: string }) | undefined>;
  /** 이메일 인증 플래그 전환 — signup_email 토큰 소비 시 호출. 매칭 없으면 no-op. */
  markEmailVerified(email: string, tx?: Tx): Promise<void>;
  /** JWT 무효화용 sessionVersion 단건 조회. 유저 없으면 undefined. */
  getSessionVersion(userId: string, tx?: Tx): Promise<number | undefined>;
  /** sessionVersion +1 — 멤버 제거 등 세션 무효화가 필요한 경우. */
  bumpSessionVersion(userId: string, tx?: Tx): Promise<void>;
  /** 이메일 인증 플래그 단건 조회(DB 라이브 read). 유저 없으면 undefined. */
  getEmailVerified(userId: string, tx?: Tx): Promise<boolean | undefined>;
  /** 이메일로 인증 플래그 조회 — 계정 없으면 undefined(미등록 식별용). */
  findEmailVerifiedByEmail(email: string, tx?: Tx): Promise<boolean | undefined>;
  /** 해당 이메일 계정 존재 여부(인증 여부 무관). */
  existsByEmail(email: string, tx?: Tx): Promise<boolean>;
  /** 이메일 대소문자 무시(lower) 매칭으로 userId 조회. 없으면 undefined. */
  findIdByEmailCI(email: string, tx?: Tx): Promise<string | undefined>;
  /** id 기준 이메일 인증 전환 — 미인증 행만(WHERE 가드). 매칭 없으면 no-op. */
  markEmailVerifiedById(userId: string, tx?: Tx): Promise<void>;
  /** 마지막 활성 워크스페이스 기억값 갱신. */
  setLastActiveWorkspace(userId: string, workspaceId: string, tx?: Tx): Promise<void>;
  /** 프로필 사진 버전 스탬프 — 업로드 시 now(Date), 삭제 시 null. */
  setAvatarUpdatedAt(userId: string, value: Date | null, tx?: Tx): Promise<void>;
  /**
   * 로그인용 raw auth projection — 도메인 매핑이 버리는 deletedAt·lastActiveWorkspaceId
   * 와 JWT 스탬프에 필요한 name·sessionVersion 포함.
   */
  findAuthRowByEmail(
    email: string,
    tx?: Tx,
  ): Promise<
    | {
        id: string;
        email: string;
        name: string;
        passwordHash: string | null;
        emailVerified: boolean;
        deletedAt: Date | null;
        lastActiveWorkspaceId: string | null;
        sessionVersion: number;
      }
    | undefined
  >;
  /** 마스터/운영자 계정 insert-if-absent — 인증 완료·시스템 계정으로 생성, userId 반환. */
  provisionMaster(params: { email: string; name: string }, tx?: Tx): Promise<string>;
  /** 유저 단위 온보딩 상태 조회 — 관대한 읽기(migrateUserOnboarding 통과). 없으면 빈 문서. */
  getOnboarding(userId: string, tx?: Tx): Promise<UserOnboarding>;
  /**
   * 온보딩 태스크 상태 병합 patch — 단일 statement jsonb merge, 다른 키/기존 필드를
   * 덮어쓰지 않는다. 멱등(같은 patch 재호출 시 결과 동일).
   */
  markOnboarding(
    userId: string,
    key: OnboardingKey,
    patch: OnboardingTaskState,
    tx?: Tx,
  ): Promise<void>;
}

// ── PgProfile ─────────────────────────────────────────────────────────
export interface PgProfileRepo {
  /**
   * PG 워크스페이스 프로필 row 생성 — PG 가입 시. serviceScope 는 null 로 둔다
   * (이후 검증 단계에서 채움). slaDays 미지정 시 null. (workspace_id, biz_no).
   */
  create(
    params: { workspaceId: string; bizNo: string; slaDays?: number | null },
    tx?: Tx,
  ): Promise<void>;
}

// ── BizProfile ────────────────────────────────────────────────────────
export interface BizProfileRepo {
  /** 불변 — 신규 row 생성. id는 호출자가 발급(uuid). */
  save(profile: BizProfile & { id: string }, tx?: Tx): Promise<void>;
  /** id 조회. */
  findById(id: string, tx?: Tx): Promise<(BizProfile & { id: string }) | undefined>;
}

// ── Bid ───────────────────────────────────────────────────────────────
export interface BidRepo {
  /**
   * 입찰 저장 — `(rfpId, pgWsId, round)` UNIQUE 위배 시 throw.
   *
   * `signingTemplateId` 는 이 파라미터 객체 타입에만 존재하는 쓰기 전용 필드다 —
   * `Bid` 도메인 타입에는 없다(봉인 경계, `findSigningTemplateId` 주석 참조). 저장은
   * 되지만 어떤 읽기 경로(`findById`/`findByRfp`/`findByPgWs`)도 이 값을 반환하지
   * 않는다 — 읽기는 아래 `findSigningTemplateId` 좁은 경로로만 한다.
   */
  save(bid: Bid & { signingTemplateId?: string }, tx?: Tx): Promise<void>;
  /** id 조회. */
  findById(id: string, tx?: Tx): Promise<Bid | undefined>;
  /**
   * 이 견적에 연결된 계약서 템플릿 id — 없으면 undefined.
   *
   * **봉인 경계 때문에 전용 경로다.** `signingTemplateId` 를 `Bid` 도메인 타입(즉
   * `rowToBid`)에 넣으면 `BuyerRfpDetailData.bids: Bid[]` 를 타고 구매사 비교표까지
   * 그대로 흘러가, PG 가 어떤 계약서를 골랐는지가 노출된다. 이 값을 읽어야 하는 곳은
   * 발송 경로(`ContractSigningService.sendFromTemplate`)와 PG 자기 화면 로더뿐이므로
   * 좁은 리드로만 연다.
   */
  findSigningTemplateId(bidId: string, tx?: Tx): Promise<string | undefined>;
  /**
   * 낙찰 bid → 소유 PG 워크스페이스만 좁게, 여러 건 한 번에. 대화 목록의
   * '선정 종료 닫힘' 판정용.
   *
   * `findSigningTemplateId` 와 같은 이유로 `Bid` 도메인 타입을 쓰지 않는다 —
   * findById 로 받으면 수수료·메모와 첨부 조회까지 딸려와 봉인 입찰 재무 정보가
   * 채팅 로더로 흘러간다. 없는 id 는 결과에서 빠진다.
   */
  findPgWsIdsByIds(ids: string[], tx?: Tx): Promise<{ id: string; pgWsId: string }[]>;
  /** 한 RFP의 모든 입찰. */
  findByRfp(rfpId: string, tx?: Tx): Promise<Bid[]>;
  /** 여러 RFP의 입찰을 rfpId별 Map으로 배치 조회 (buyer 칸반 N+1 제거). */
  findByRfpIds(rfpIds: string[], tx?: Tx): Promise<Map<string, Bid[]>>;
  /** 한 PG 워크스페이스의 모든 입찰. */
  findByPgWs(pgWsId: string, tx?: Tx): Promise<Bid[]>;
  /** 입찰 상태 전이 (withdraw 등). */
  updateStatus(id: string, status: Bid['status'], tx?: Tx): Promise<void>;
  /** 구매사 검색 — bids⋈rfps⋈workspaces projection. pattern 은 호출자가 escape+wrap. */
  searchForBuyer(wsId: string, pattern: string, tx?: Tx): Promise<unknown[]>;
  /** 초성 검색용 — searchForBuyer 와 동일 projection, ilike 없이 ws-scope+submitted 만 fetch (호출자가 JS 필터). */
  listForBuyer(wsId: string, limit: number, tx?: Tx): Promise<unknown[]>;
  /** PG 검색 — bids⋈rfps projection. pattern 은 호출자가 escape+wrap. */
  searchForPg(wsId: string, pattern: string, tx?: Tx): Promise<unknown[]>;
  /** 초성 검색용 — searchForPg 와 동일 projection, ilike 없이 ws-scope+submitted 만 fetch (호출자가 JS 필터). */
  listForPg(wsId: string, limit: number, tx?: Tx): Promise<unknown[]>;
  /** bidId → 소속 RFP id + 소유 구매사 (ACL/업로드 게이트). */
  findRfpOwner(
    bidId: string,
    tx?: Tx,
  ): Promise<{ rfpId: string; buyerWsId: string } | undefined>;
  /**
   * bidId → 입찰 소유 PG ws + 소속 RFP id (bids 단독, rfps 조인 없음). 첨부 ACL 전용:
   * PG fast-path(bid.pgWsId === viewer ws)를 RFP 존재 여부와 무관하게 판정해야 하므로
   * innerJoin 하는 findRfpOwner 와 분리한다. 없으면 undefined.
   */
  findOwner(
    bidId: string,
    tx?: Tx,
  ): Promise<{ pgWsId: string; rfpId: string } | undefined>;
}

// ── Kanban Column ─────────────────────────────────────────────────────
export interface ColumnRepo {
  /** 한 보드 (workspace_id, kind) 의 컬럼 — position 오름차순. */
  listByBoard(workspaceId: string, kind: ColumnKind, tx?: Tx): Promise<BoardColumn[]>;
  /** id 단건 조회. 없으면 undefined. */
  findById(id: string, tx?: Tx): Promise<BoardColumn | undefined>;
  /** 컬럼 1개 생성. */
  create(col: BoardColumn, tx?: Tx): Promise<void>;
  /** 일괄 생성 — 워크스페이스 시드/백필용. */
  createMany(cols: BoardColumn[], tx?: Tx): Promise<void>;
  /** 제목/색/위치 패치. */
  update(
    id: string,
    patch: Partial<Pick<BoardColumn, 'title' | 'color' | 'position'>>,
    tx?: Tx,
  ): Promise<void>;
  /** 컬럼 삭제 — placement 는 FK cascade. is_system 가드는 액션 레이어 책임. */
  remove(id: string, tx?: Tx): Promise<void>;
}

// ── BidNote ───────────────────────────────────────────────────────────
/** 저장/조회용 BidNote 모양 — DB 컬럼 + 조회 시 hydrated 필드(authorName,
 *  attachments). lib/types/bid-note.ts 는 Date를 string으로 직렬화한
 *  클라이언트용 모양이라 분리. */
export type BidNoteRecord = {
  id: string;
  bidId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  /** findByBid 가 users 와 join 해 채움. save 시점에는 사용되지 않음. */
  authorName?: string;
  /** findByBid 가 attachments(owner_kind='bid_note') 로 join 해 채움. */
  attachments?: Attachment[];
};

export interface BidNoteRepo {
  /** 노트 row 저장 — 첨부는 별도 attachments 테이블에 polymorphic 연결. */
  save(note: BidNoteRecord, tx?: Tx): Promise<void>;
  /** 한 bid의 노트 — 생성 순서(오래된 → 최신). authorName, attachments
   *  hydrated. */
  findByBid(bidId: string, tx?: Tx): Promise<Required<BidNoteRecord>[]>;
  /** noteId로 stub 조회 — id + bidId만 반환. removeNote 소유권 체인용. */
  findById(noteId: string, tx?: Tx): Promise<Pick<BidNoteRecord, 'id' | 'bidId'> | undefined>;
  /** noteId에 연결된 attachment id 목록 — storage best-effort 정리용. */
  findAttachmentIds(noteId: string, tx?: Tx): Promise<string[]>;
  /** 단건 삭제 — DB cascade가 attachments 처리. */
  remove(noteId: string, tx?: Tx): Promise<void>;
}

// ── Notification ──────────────────────────────────────────────────────
export interface NotificationRepo {
  /** 인앱/이메일 알림 저장. */
  save(n: Notification, tx?: Tx): Promise<void>;
  /**
   * save 의 배치판 — 알림 팬아웃이 수신자마다 INSERT 를 돌지 않도록 한 문장으로.
   * append-only 라 충돌 처리 없음(save 와 동일).
   */
  saveMany(ns: Notification[], tx?: Tx): Promise<void>;
  /** 사용자+워크스페이스 최근 알림(생성 역순) — limit 제한. `channel` 지정 시 SQL에서 필터. */
  findRecentForUser(
    userId: string,
    workspaceId: string,
    limit: number,
    channel?: NotificationChannel,
    tx?: Tx,
  ): Promise<Notification[]>;
  /** 단건 읽음 처리. */
  markRead(id: string, tx?: Tx): Promise<void>;
  /** 사용자+워크스페이스 전부 읽음 처리. */
  markAllRead(userId: string, workspaceId: string, tx?: Tx): Promise<void>;
  /**
   * 동일 window 내 queued 상태 chat.message 알림 존재 여부 — 인앱 알림 중복 방지용.
   *
   * dedupe 범위는 **대화 단위**(`threadLinkUrl`)다. notifications 에는 대화 컬럼이
   * 없어 링크가 유일한 식별자이며, 워크스페이스 전체로 잡으면 구매사가 PG 여럿과
   * 대화 중일 때 한 대화의 queued 알림이 다른 대화의 새 알림을 삼킨다.
   */
  hasPendingChatNotification(
    userId: string,
    workspaceId: string,
    threadLinkUrl: string,
    windowStart: Date,
    tx?: Tx,
  ): Promise<boolean>;
  /**
   * 한 대화 스레드의 queued 인앱 알림을 읽음 처리한다 — 사용자가 그 대화를 열고
   * 실제로 보고 있을 때 배지를 걷어내는 경로. 대화 식별자는 `hasPendingChatNotification`
   * 과 같은 linkUrl 이며, 1:1 대화(`/messages?c=…`)와 팀 스레드(`/messages?t=…`)에
   * 모두 쓴다.
   *
   * ⚠️ 판정은 링크 하나뿐이고 **type 을 보지 않는다** — 같은 스레드를 가리키는
   * 알림이면 종류를 가리지 않고 함께 걷힌다(현재 `team_chat.mention` 이 그렇고,
   * 스레드를 열어 본 이상 배지가 남을 이유가 없어 의도된 동작이다). 앞으로 그
   * 링크를 재사용하는 알림 종류를 추가한다면 이 정리 대상에 함께 들어간다.
   */
  markChatThreadRead(
    userId: string,
    workspaceId: string,
    threadLinkUrl: string,
    /**
     * 정리 상한 — 방금 저장한 읽음 cursor(ISO). 이 시각 **이후에** 만들어진 알림은
     * 사용자가 본 적 없는 메시지의 것이라 남긴다(cursor 저장과 이 UPDATE 사이에
     * 도착한 메시지). 필수인 이유: 빠뜨리면 조용히 무제한 정리로 돌아간다.
     */
    readAt: string,
    tx?: Tx,
  ): Promise<void>;
  /** 동일 window 내 pending team_chat 인앱 알림 존재 여부(rfp 단위 dedupe). */
  hasPendingTeamNotification(userId: string, rfpId: string, windowStart: Date, tx?: Tx): Promise<boolean>;
  /** 소유권 검증 + type 조회 (markRead/retryEmail). 없거나 타인 것이면 undefined. */
  findOwnedById(
    notificationId: string,
    userId: string,
    tx?: Tx,
  ): Promise<{ id: string; type: string } | undefined>;
  /** 동일 window 내 team_chat.mention 인앱 알림 존재 여부(멘션 전용 dedupe). */
  hasPendingTeamMentionNotification(userId: string, rfpId: string, windowStart: Date, tx?: Tx): Promise<boolean>;
}

// ── Contract ──────────────────────────────────────────────────────────
export interface ContractRepo {
  /** 수주 확정. RFP에 1:1 unique. */
  save(c: Contract, tx?: Tx): Promise<void>;
  /** RFP 조회 — 수주 행 단건. */
  findByRfp(rfpId: string, tx?: Tx): Promise<Contract | undefined>;
}

// ── VerificationToken ─────────────────────────────────────────────────
export interface VerificationTokenRepo {
  /** 발급 — raw 비저장, hash만. */
  save(
    token: Omit<VerificationToken, 'token'> & { tokenHash: string },
    tx?: Tx,
  ): Promise<void>;
  /** atomic 소비 — 미사용/미만료만 통과. 성공 시 row 반환. */
  consume(
    tokenHash: string,
    now: Date,
    tx?: Tx,
  ): Promise<(Omit<VerificationToken, 'token'> & { tokenHash: string }) | undefined>;
  /** 만료 전 조회 — UI에서 토큰 유효성 미리보기. */
  findValid(
    tokenHash: string,
    now: Date,
    tx?: Tx,
  ): Promise<(Omit<VerificationToken, 'token'> & { tokenHash: string }) | undefined>;
  /**
   * 같은 (email, purpose) 의 미사용·미만료 토큰을 일괄 burn. passwordForgotAction
   * 등 새 토큰을 발급하는 동일 transaction 안에서 호출해 OWASP Forgot Password
   * 권장(prior token invalidation)을 구현. 이미 consumed 인 row 는 건드리지 않아
   * 원래의 consumedAt 타임스탬프를 보존함.
   */
  invalidatePending(
    params: {
      email: string;
      purpose: 'signup_email' | 'password_reset' | 'email_change';
      now: Date;
    },
    tx?: Tx,
  ): Promise<void>;
  /**
   * 이메일 재전송 시 이전 토큰을 expire(expiresAt=now)만 하고 consumedAt은 NULL
   * 유지. 불변식: consumedAt IS NOT NULL ⟺ 사용자가 직접 인증 완료.
   * invalidatePending(consumedAt 스탬프)과 달리 폴링/게이트에서 미인증 상태를 구분 가능.
   */
  expirePendingByEmail(
    params: {
      email: string;
      purpose: 'signup_email' | 'password_reset' | 'email_change';
      now: Date;
    },
    tx?: Tx,
  ): Promise<void>;
  /**
   * 6자리 코드(해시)로 atomic consume. meta.emailCode와 codeHash가 일치하고
   * 미사용·미만료인 토큰을 consumedAt 스탬프. 동시 호출 race-safe(UPDATE WHERE).
   */
  consumeByEmailCode(
    params: {
      email: string;
      purpose: 'signup_email' | 'password_reset' | 'email_change';
      codeHash: string;
      now: Date;
    },
    tx?: Tx,
  ): Promise<(Omit<VerificationToken, 'token'> & { tokenHash: string }) | undefined>;
  /**
   * 활성(미사용·미만료) 토큰의 6자리 코드 시도 상태 조회 — 가장 최근 발급분 1건.
   * emailCodeHash 는 meta.emailCode. 코드 무차별 대입 제한(F2)용. 없으면 undefined.
   */
  findActiveEmailCodeToken(
    params: {
      email: string;
      purpose: 'signup_email' | 'password_reset' | 'email_change';
      now: Date;
    },
    tx?: Tx,
  ): Promise<{ id: string; attempts: number; emailCodeHash: string | null } | undefined>;
  /** 코드 오입력 시 attempts +1 (race-tolerant, 전화 OTP와 동일 패턴). */
  bumpEmailCodeAttempts(id: string, tx?: Tx): Promise<void>;
}

// ── Attachment ────────────────────────────────────────────────────────
export interface AttachmentRepo {
  /** 첨부 row 저장 — 파일 본체는 다른 스토리지. */
  save(a: AttachmentRecord, tx?: Tx): Promise<void>;
  /** id 조회 — 서버 전용 record (storagePath 포함) 반환. */
  findById(id: string, tx?: Tx): Promise<AttachmentRecord | undefined>;
  /** RFP 소유 첨부 목록 — 공개 Attachment 필드만, uploadedAt 오름차순. */
  findByRfp(rfpId: string, tx?: Tx): Promise<Attachment[]>;
  /** 메시지 ID 배열로 첨부 목록 일괄 조회 — chatMessageId IN (ids), uploadedAt asc. */
  findByChatMessageIds(ids: string[], tx?: Tx): Promise<(Attachment & { chatMessageId: string })[]>;
  /** 대화 전체 첨부 목록 — chat_messages JOIN, uploadedAt asc. */
  findByConversationId(conversationId: string, tx?: Tx): Promise<Attachment[]>;
  /**
   * draft 첨부를 owner row 에 링크 (exclusive-arc). owner 는 정확히 한 키만 설정 —
   * 그 컬럼을 set 한다. 모든 owner 컬럼이 IS NULL 인 행만 갱신(이미 링크된 행
   * re-parent 방지). uploadedBy 지정 시 업로더 소유분만. 빈 ids 는 안전한 no-op.
   * 실제로 연결된 id를 반환해 호출자가 삭제/연결 경합을 검증할 수 있다.
   */
  claim(
    params: {
      ids: string[];
      owner: {
        rfpId?: string;
        bidId?: string;
        bidNoteId?: string;
        chatMessageId?: string;
        rfpTeamMessageId?: string;
      };
      uploadedBy?: string;
    },
    tx?: Tx,
  ): Promise<string[]>;
  /** claim 전 소유권·미링크 검증용 — 모든 owner 컬럼 IS NULL 인 행만 projection 반환. */
  findUnclaimedByIds(
    ids: string[],
    tx?: Tx,
  ): Promise<Pick<AttachmentRecord, 'id' | 'rfpId' | 'bidId' | 'bidNoteId' | 'uploadedBy'>[]>;
  /** 단건 삭제 (고아 정리). */
  remove(id: string, tx?: Tx): Promise<void>;
  /** pending 행만 원자적으로 삭제. ready 전이와 경합하면 false. */
  removePending(id: string, tx?: Tx): Promise<boolean>;
  /** 업로더가 소유한 ready 미연결 첨부만 원자적으로 삭제. */
  removeReadyUnclaimedByUploader(id: string, uploadedBy: string, tx?: Tx): Promise<boolean>;
  /**
   * 두 단계 presigned 업로드 완료 시 호출 — status='pending' 인 행만 'ready' 로
   * 전환한다. 전환됐으면 true, 이미 ready 이거나 존재하지 않으면 false.
   */
  markReady(id: string, tx?: Tx): Promise<boolean>;
  /**
   * cutoff 이전에 업로드된 status='pending' 행을 전부 삭제 — 호출자가 R2 객체도
   * 함께 정리할 수 있도록 삭제된 id 배열을 반환한다.
   */
  deleteStalePending(cutoff: Date, limit?: number, tx?: Tx): Promise<string[]>;
}

// ── Outbox ────────────────────────────────────────────────────────────
export interface OutboxRepo {
  /**
   * 메일 전송 큐 enqueue — dedupeKey UNIQUE 위배 시 null. `scheduledAt` 생략 시
   * 컬럼 기본값 now()(즉시 발송 대상). 지연 발송(예: chat digest 윈도우 종료
   * 시각)에는 미래 시각을 명시.
   */
  enqueue(
    params: {
      event: OutboxEvent;
      to: string;
      subject: string;
      html: string;
      dedupeKey?: string;
      maxAttempts?: number;
      scheduledAt?: Date;
    },
    tx?: Tx,
  ): Promise<OutboxEntry | null>;
  /**
   * enqueue 의 배치판 — 알림 팬아웃이 수신자마다 INSERT 를 돌지 않도록 한 문장으로.
   * 이미 존재하는 dedupeKey 는 건너뛴다(enqueue 와 동일). **같은 배치 안의** 중복
   * 키도 1건으로 collapse 된다(DO NOTHING 은 같은 문장 안 선행 삽입과도 조정한다).
   * 반환값 없음 — 호출자가 개별 성패를 쓰지 않는다.
   */
  enqueueMany(
    params: {
      event: OutboxEvent;
      to: string;
      subject: string;
      html: string;
      dedupeKey?: string;
      maxAttempts?: number;
      scheduledAt?: Date;
    }[],
    tx?: Tx,
  ): Promise<void>;
  /**
   * 송신 대기 batch 조회. `chat.message` 행은 전용 chat-digest 처리기 소관이므로
   * 제외 — generic 메일러가 coalesce 전 raw 메시지 메일을 보내면 안 됨.
   */
  pending(limit: number, tx?: Tx): Promise<OutboxEntry[]>;
  /**
   * Due chat-digest 행: `status='pending' AND event='chat.message' AND
   * scheduled_at <= now()`, scheduled_at 오름차순. 전용 chat-digest 처리기
   * (cron + post-commit)가 본문 재계산·읽음 단락 후 markResult 한다. lease/
   * SKIP-LOCKED 없는 단순 read — 중복발송 가드는 처리기 책임.
   */
  dueChatDigests(limit: number, tx?: Tx): Promise<OutboxEntry[]>;
  /** Due team-chat-digest rows — owned by the team-digest flush processor. */
  dueTeamChatDigests(limit: number, tx?: Tx): Promise<OutboxEntry[]>;
  /**
   * 전송 결과 반영(성공/실패 + 시도횟수 +1). 실패 시 `retryable:false` 면 즉시
   * 'failed'(영구 오류 — 잔여 시도 낭비 방지), 그 외엔 maxAttempts 도달 시에만
   * 'failed'. `nextScheduledAt` 가 주어지면 다음 시도 시각을 그 값(now()+백오프)
   * 으로 재설정한다. retryable/nextScheduledAt 생략은 레거시 호환(일시 오류 취급).
   */
  markResult(
    id: string,
    result:
      | { ok: true }
      | { ok: false; error: string; retryable?: boolean; nextScheduledAt?: Date },
    tx?: Tx,
  ): Promise<void>;
  /**
   * Drain pending entries through `batchSender` (Resend's batch API).
   *
   * Postgres impl uses `SELECT ... FOR UPDATE SKIP LOCKED LIMIT $limit` so
   * concurrent flush callers (cron + post-commit fire-and-forget) don't
   * double-deliver, then sends the whole claim in <=100-row chunks (paced) — an
   * N-recipient fan-out becomes ceil(N/100) API calls, keeping bursts under
   * Resend's rate limit. Returns counts: `ok` = batch reported ok, `failed` =
   * batch reported !ok (regardless of whether maxAttempts was hit on this pass —
   * `markResult` decides the persistent state).
   */
  flush(
    batchSender: BatchSender,
    limit?: number,
    tx?: Tx,
  ): Promise<{ ok: number; failed: number }>;
  /** retryEmail — 특정 수신자+이벤트의 가장 최근 failed outbox 행. 없으면 undefined. */
  findLatestFailed(
    params: { to: string; event: OutboxEvent },
    tx?: Tx,
  ): Promise<{ id: string } | undefined>;
  /** failed → pending 재시도 전환 (status 만 갱신 — attempts/lastError 보존). */
  requeue(id: string, tx?: Tx): Promise<void>;
}

// ── Chat: Conversation ────────────────────────────────────────────────
/** Buyer↔PG conversation row (one per workspace pair). */
export type ChatConversation = {
  id: string;
  buyerWsId: string;
  pgWsId: string;
  lastMessageAt: Date | null;
  createdAt: Date;
};

export interface ChatConversationRepo {
  /**
   * Idempotent on the (buyer_ws_id, pg_ws_id) unique — returns the existing
   * conversation or creates one. The buyer↔PG type invariant is the caller's
   * responsibility (FK alone cannot express it).
   */
  findOrCreatePair(
    buyerWsId: string,
    pgWsId: string,
    tx?: Tx,
  ): Promise<ChatConversation>;
  /**
   * 페어 읽기 전용 조회 — 없으면 undefined, **행을 생성하지 않는다**.
   * 채팅 레일의 표시용 해소 경로: 열람·포커스 추종만으로 빈 대화가 생기면
   * 상대 인박스에 관심 신호가 새므로(sealed-bid), 생성은 첫 전송에만 맡긴다.
   */
  findPair(
    buyerWsId: string,
    pgWsId: string,
    tx?: Tx,
  ): Promise<ChatConversation | undefined>;
  /** id 단건 조회. 없으면 undefined. */
  findById(id: string, tx?: Tx): Promise<ChatConversation | undefined>;
  /**
   * 한 워크스페이스의 대화 목록 — viewer 의 side(buyer/pg)에 매칭되는 행만,
   * last_message_at desc (nulls last). 비공개 ACL: pg viewer 는 pg_ws_id=내WS
   * 만, buyer viewer 는 buyer_ws_id=내WS 만 본다.
   */
  listForWorkspace(
    wsId: string,
    viewerType: WorkspaceType,
    tx?: Tx,
  ): Promise<ChatConversation[]>;
  /** 인박스 정렬키 갱신 — 메시지 전송 시. */
  touchLastMessageAt(id: string, at: Date, tx?: Tx): Promise<void>;
}

// ── Chat: Message ─────────────────────────────────────────────────────
/** Canonical (Postgres-only) chat message row. */
export type ChatMessageRecord = {
  id: string;
  conversationId: string;
  authorUserId: string;
  authorWsId: string;
  body: string;
  rfpId: string | null;
  createdAt: Date;
};

export type ChatMessageWithAuthor = ChatMessageRecord & {
  authorName: string;
  authorEmail: string;
  authorAvatarUpdatedAt: Date | null;
};

export interface ChatMessageRepo {
  /** 메시지 insert. 첨부 링크는 액션 레이어 책임. */
  save(msg: ChatMessageRecord, tx?: Tx): Promise<void>;
  /**
   * 대화별 **마지막 메시지 1건**을 한 번에. 대화 목록 로더가 대화마다
   * listByConversation 으로 전체 이력을 받아 `at(-1)` 만 쓰던 N+1 을 없앤다.
   * 메시지가 없는 대화는 결과에서 빠진다. created_at 동률은 id 로 결정적 정렬.
   */
  lastByConversations(conversationIds: string[], tx?: Tx): Promise<ChatMessageRecord[]>;
  /** 한 대화의 모든 메시지 — created_at asc. */
  listByConversation(
    conversationId: string,
    tx?: Tx,
  ): Promise<ChatMessageRecord[]>;
  /** messageId → 소속 대화 id (첨부 ACL 게이트). 없으면 undefined. */
  findConversationId(
    messageId: string,
    tx?: Tx,
  ): Promise<{ conversationId: string } | undefined>;
  /**
   * 한 대화의 모든 메시지 + 작성자 이름·이메일(users 조인) — created_at asc.
   * 스레드 로더 전용. 인박스 목록 로더는 가벼운 listByConversation 을 쓴다.
   */
  listByConversationWithAuthor(
    conversationId: string,
    tx?: Tx,
  ): Promise<ChatMessageWithAuthor[]>;
}

// ── RFP Team Chat: Message ────────────────────────────────────────────
/**
 * RFP-scoped internal team message. Scope = (rfpId, workspaceId) — buyer team
 * and each PG team have fully separate threads (sealed-bid invariant).
 */
export type RfpTeamMessageRecord = {
  id: string;
  rfpId: string;
  workspaceId: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
};

/** Read shape — authorName hydrated from users, attachments from the
 *  exclusive-arc attachments table (empty array when none). */
export type RfpTeamMessageWithAuthor = RfpTeamMessageRecord & {
  authorName: string;
  authorAvatarUpdatedAt: Date | null;
  attachments: Attachment[];
};

export type TeamThreadSummary = {
  rfpId: string;
  lastMessageAt: Date;
  lastBody: string;
  lastAuthorUserId: string;
};

export interface RfpTeamMessageRepo {
  /** 메시지 insert (append-only). */
  save(msg: RfpTeamMessageRecord, tx?: Tx): Promise<void>;
  /** 한 (rfp, workspace) 스코프의 모든 메시지 — created_at asc. */
  listByScope(
    rfpId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<RfpTeamMessageWithAuthor[]>;
  /** 워크스페이스가 메시지를 남긴 모든 RFP 의 스레드 요약(rfp별 마지막 메시지). */
  listThreadsForWorkspace(workspaceId: string, tx?: Tx): Promise<TeamThreadSummary[]>;
  /**
   * messageId → 메시지를 소유한 워크스페이스 (첨부 ACL sealed-bid 게이트). 메시지의
   * 스코프 ws 가 viewer ws 와 같을 때만 통과해야 하므로 그 한 컬럼만 반환. 없으면 undefined.
   */
  findOwner(
    messageId: string,
    tx?: Tx,
  ): Promise<{ workspaceId: string } | undefined>;
}

// ── Chat: Message Template ────────────────────────────────────────────
/** Workspace-shared chat message template — hydrated DB shape. */
export type ChatMessageTemplate = {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface ChatTemplateRepo {
  /** 템플릿 생성 — id 미지정 시 발급. 워크스페이스 공유. */
  create(
    template: {
      id?: string;
      workspaceId: string;
      title: string;
      body: string;
      createdBy: string;
    },
    tx?: Tx,
  ): Promise<void>;
  /** id 단건 조회. 없으면 undefined. */
  findById(id: string, tx?: Tx): Promise<ChatMessageTemplate | undefined>;
  /** 한 워크스페이스의 모든 템플릿 — cross-workspace isolation 근거. */
  listByWorkspace(workspaceId: string, tx?: Tx): Promise<ChatMessageTemplate[]>;
  /** 단건 삭제. */
  remove(id: string, tx?: Tx): Promise<void>;
}

// ── Bid: Quote Template (견적 요율표) ──────────────────────────────────
/** PG-workspace-shared bid quote template — hydrated DB shape. */
export type BidQuoteTemplate = {
  id: string;
  pgWsId: string;
  name: string;
  settleCycle: string;
  settleLimit: number;
  guaranteeInsurance: number;
  signupFee: number;
  paymentFees: Partial<Record<PaymentMethod, number | TierRates>>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface BidQuoteTemplateRepo {
  /** 템플릿 생성 — id 미지정 시 발급. PG 워크스페이스 공유. */
  create(
    template: {
      id?: string;
      pgWsId: string;
      name: string;
      settleCycle: string;
      settleLimit: number;
      guaranteeInsurance: number;
      signupFee: number;
      paymentFees: Partial<Record<PaymentMethod, number | TierRates>>;
      createdBy: string;
    },
    tx?: Tx,
  ): Promise<void>;
  /** 단건 수정 — 소유권 검증은 액션 레이어 책임. updated_at 갱신. */
  update(
    id: string,
    fields: {
      name: string;
      settleCycle: string;
      settleLimit: number;
      guaranteeInsurance: number;
      signupFee: number;
      paymentFees: Partial<Record<PaymentMethod, number | TierRates>>;
    },
    tx?: Tx,
  ): Promise<void>;
  /** id 단건 조회. 없으면 undefined. */
  findById(id: string, tx?: Tx): Promise<BidQuoteTemplate | undefined>;
  /** 한 PG 워크스페이스의 모든 템플릿 — cross-workspace isolation 근거. */
  listByWorkspace(pgWsId: string, tx?: Tx): Promise<BidQuoteTemplate[]>;
  /** 단건 삭제. */
  remove(id: string, tx?: Tx): Promise<void>;
}

// ── Chat: Conversation Read State ─────────────────────────────────────
/** 워크스페이스 멤버별 대화 읽음 상태 row. 미읽음 배지 + 라이브 읽음 영수증 근거. */
export type ChatConversationRead = {
  conversationId: string;
  workspaceId: string;
  userId: string;
  lastReadAt: Date;
};

export interface ChatReadRepo {
  /** (conversation, workspace, user) PK upsert — 저장된 monotonic last_read_at 반환. */
  upsert(
    conversationId: string,
    workspaceId: string,
    userId: string,
    at: Date,
    tx?: Tx,
  ): Promise<Date>;
  /** (conversation, workspace, user) 읽음 row 조회. 없으면 undefined. */
  getFor(
    conversationId: string,
    workspaceId: string,
    userId: string,
    tx?: Tx,
  ): Promise<ChatConversationRead | undefined>;
  /**
   * 여러 대화의 내 읽음 row 를 한 번에. 대화 목록 로더가 대화당 getFor 를 도는
   * N+1 을 없앤다. 읽음 기록이 없는 대화는 결과에서 빠진다(자리표시자 없음).
   */
  getForMany(
    conversationIds: string[],
    workspaceId: string,
    userId: string,
    tx?: Tx,
  ): Promise<ChatConversationRead[]>;
  /**
   * 지정한 워크스페이스의 가장 최근 last_read_at. 없으면 undefined.
   * 멤버십을 뒤늦게 추론하지 않고 읽은 당시의 워크스페이스를 직접 조회한다.
   */
  maxLastReadAt(
    conversationId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<Date | undefined>;
}

// ── RFP Team Message Read State ───────────────────────────────────────
/** (rfp, workspace, user) 팀 스레드 읽음 row — 통합 인박스 팀 안읽음 배지 근거. */
export type RfpTeamMessageRead = {
  rfpId: string;
  workspaceId: string;
  userId: string;
  lastReadAt: Date;
};

export interface RfpTeamMessageReadRepo {
  /** (rfp, workspace, user) PK upsert — last_read_at 갱신(idempotent, monotonic). */
  upsert(rfpId: string, workspaceId: string, userId: string, at: Date, tx?: Tx): Promise<void>;
  /** (rfp, workspace, user) 읽음 row 조회. 없으면 undefined. */
  getFor(rfpId: string, workspaceId: string, userId: string, tx?: Tx): Promise<RfpTeamMessageRead | undefined>;
}

// ── Audit Log (C5) ────────────────────────────────────────────────────
/** 신규 감사 행 — createdAt/id 는 DB 가 채운다. */
export type NewAuditLog = {
  actorUserId: string;
  /** 워크스페이스 무관 이벤트(auth.*)는 null. */
  actorWorkspaceId?: string | null;
  /** '<도메인>.<행위>' — rfp.award, bid.submit, workspace.member_invite … */
  action: string;
  entityType?: string | null;
  /** uuid 또는 RFP code(P-2605-0042) — text 로 수용. */
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** (createdAt, id) 복합 커서 — 동일 타임스탬프에서도 누락 없는 페이지네이션. */
export type AuditLogCursor = { createdAt: string; id: string };

/** 조회 행 — actorName 은 users join 으로 hydrate (탈퇴 사용자는 null 허용). */
export type AuditLogRecord = {
  id: string;
  actorUserId: string;
  actorWorkspaceId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  /** ISO string. */
  createdAt: string;
  actorName: string | null;
  /**
   * True when the action was performed through master/operator authority.
   * New workspace-management events snapshot this at write time; legacy rows
   * fall back to the actor's current allowlist membership. The actor's email
   * itself is never exposed to the client.
   */
  viaMaster: boolean;
};

export interface AuditLogRepo {
  /** 감사 행 기록 — 호출자는 해당 작업의 트랜잭션(tx)을 넘긴다. */
  insert(entry: NewAuditLog, tx?: Tx): Promise<void>;
  /** 워크스페이스 스코프 최신순 목록 — 설정 > 활동 기록 화면용. */
  listForWorkspace(
    workspaceId: string,
    opts: { limit: number; before?: AuditLogCursor },
  ): Promise<AuditLogRecord[]>;
}

// ── PhoneOtp ──────────────────────────────────────────────────────────
export interface PhoneOtpRepo {
  /** 지정 window 내 해당 번호로 발급된 OTP 수 — 발송 레이트리밋용. */
  countRecent(phone: string, since: Date, tx?: Tx): Promise<number>;
  /** OTP 발급 row 생성 — code 는 호출자가 해시. 생성된 id 반환. */
  create(
    params: { phone: string; codeHash: string; expiresAt: Date },
    tx?: Tx,
  ): Promise<string>;
  /** 미인증·미만료 활성 OTP 1건 (created_at asc). 없으면 undefined. */
  findActive(
    phone: string,
    now: Date,
    tx?: Tx,
  ): Promise<{ id: string; codeHash: string; attempts: number } | undefined>;
  /** (id, phone) 의 인증완료(verified_at not null) 존재 여부. */
  isVerified(id: string, phone: string, tx?: Tx): Promise<boolean>;
  /** 코드 오입력 시 attempts +1. */
  bumpAttempts(id: string, tx?: Tx): Promise<void>;
  /** verified_at 스탬프. */
  markVerified(id: string, at: Date, tx?: Tx): Promise<void>;
  /** 단건 삭제 — SMS 발송 실패 롤백용. */
  remove(id: string, tx?: Tx): Promise<void>;
}

// ── WorkspaceLogo ─────────────────────────────────────────────────────
export interface WorkspaceLogoRepo {
  /** 로고 바이트+mime — GET /avatar. 없으면 undefined. */
  find(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ bytes: Buffer; mime: string } | undefined>;
  /** 존재 여부만 — 로고 blob 존재 여부 체크. */
  exists(workspaceId: string, tx?: Tx): Promise<boolean>;
  /** upsert(by workspace_id). */
  upsert(workspaceId: string, bytes: Buffer, mime: string, tx?: Tx): Promise<void>;
  /** 단건 삭제. */
  remove(workspaceId: string, tx?: Tx): Promise<void>;
}

export interface UserAvatarRepo {
  /** 아바타 바이트+mime — GET /api/user/[id]/avatar. 없으면 undefined. */
  find(
    userId: string,
    tx?: Tx,
  ): Promise<{ bytes: Buffer; mime: string } | undefined>;
  /** 존재 여부만. */
  exists(userId: string, tx?: Tx): Promise<boolean>;
  /** upsert(by user_id). */
  upsert(userId: string, bytes: Buffer, mime: string, tx?: Tx): Promise<void>;
  /** 단건 삭제. */
  remove(userId: string, tx?: Tx): Promise<void>;
}

// ── RfpAllowedPg ──────────────────────────────────────────────────────
export interface RfpAllowedPgRepo {
  /** RFP 에 PG 워크스페이스들을 allowlist 등록 (onConflictDoNothing). */
  add(rfpId: string, pgWsIds: string[], tx?: Tx): Promise<void>;
  /** 한 RFP의 PG 워크스페이스 허용 목록에서 단건 제거. */
  remove(rfpId: string, pgWsId: string, tx?: Tx): Promise<void>;
  /** 한 RFP 의 허용 PG 워크스페이스 id 목록. */
  listPgWsIds(rfpId: string, tx?: Tx): Promise<string[]>;
  /** (rfpId, pgWsId) 가 allowlist 에 있는지. */
  has(rfpId: string, pgWsId: string, tx?: Tx): Promise<boolean>;
}

// ── VerificationApplication ───────────────────────────────────────────
export interface VerificationApplicationRepo {
  /**
   * 워크스페이스 생성 시 인증 신청 row 생성. status 는 DB 기본값
   * ('submitted') 을 사용하므로 호출자는 id·workspaceId·orgType 만 넘긴다.
   */
  create(
    params: { id: string; workspaceId: string; orgType: 'buyer' | 'pg' },
    tx?: Tx,
  ): Promise<void>;
}

// ── RiskFlag ──────────────────────────────────────────────────────────
/**
 * 운영자(admin 콘솔)용 durable 위험 플래그. 사용자에게는 노출되지 않는다.
 *
 * 첫 사용처: 국세청 장애로 사업자번호를 검증하지 못한 채 통과시킨 가입건에
 * `biz_unverified` 를 남겨, 승인 심사에서 수동 확인이 필요하다는 사실이 유실되지
 * 않게 한다. (렌더링은 별도 레포 `admin-supporter-b` 의 몫 — 여기서는 기록만 한다.)
 */
export type RiskFlagSeverity = 'critical' | 'warning' | 'info';

export type RaiseRiskFlagParams = {
  entityType: string;
  entityId: string;
  flagType: string;
  severity: RiskFlagSeverity;
};

export type RiskFlagRecord = {
  id: string;
  entityType: string;
  entityId: string;
  flagType: string;
  severity: string;
  resolvedAt: Date | null;
  createdAt: Date;
};

export interface RiskFlagRepo {
  raise(params: RaiseRiskFlagParams, tx?: Tx): Promise<void>;
  findByEntity(entityType: string, entityId: string, tx?: Tx): Promise<RiskFlagRecord[]>;
}

// ── LoginAttempt ──────────────────────────────────────────────────────
/** 레이트리밋 카운터 행 — key 는 `email:<addr>` 또는 `ip:<addr>`. */
export type LoginAttemptRecord = {
  count: number;
  lockedUntil: Date | null;
};

export interface LoginAttemptRepo {
  /** key(email|ip) 의 현재 카운터 row. 없으면 undefined. */
  findByKey(key: string, tx?: Tx): Promise<LoginAttemptRecord | undefined>;
  /** upsert(by key) — 시도 누적. updatedAt 은 호출자가 now 로 넘긴다. */
  upsert(
    key: string,
    rec: { count: number; lockedUntil: Date | null; updatedAt: Date },
    tx?: Tx,
  ): Promise<void>;
  /** 성공 로그인 시 keys 삭제. 빈 배열은 안전한 no-op. */
  clear(keys: string[], tx?: Tx): Promise<void>;
}
