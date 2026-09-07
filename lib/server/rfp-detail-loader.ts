// RFP 상세 데이터 로더 — 전체 페이지(app/(app)/rfp/[id], app/(app)/inbox/[rfpId])가
// 사용한다. server-only (repo factory import).
//
// auth-free: 세션/redirect 가드는 page shell 책임. 로더는 workspaceId 등 이미 해소된
// 인자만 받아 repo 호출 + 데이터 가공만 한다 (buyer-kanban-loader 컨벤션). 덕분에
// pglite + seed 로 auth mock 없이 단위 테스트 가능하다.
import {
  getAttachmentRepo,
  getBidQuoteTemplateRepo,
  getBidRepo,
  getInvitationRepo,
  getPgRequestRepo,
  getPgSigningTemplateRepo,
  getRfpRepo,
  getSigningContractRepo,
  getUserRepo,
  getWorkspaceRepo,
  getRfpRequoteRequestRepo,
} from './repositories/factory';
import type { WorkspaceDisplay } from './repositories/types';
import { toQuoteTemplateOption } from './quote-template-option';
import type { QuoteTemplateOption } from '@/lib/types/bid';
import { pgDealRoomShowsBidWizard } from '@/lib/rfp/pg-bid-wizard-visibility';
import type { RFP } from '@/lib/types/rfp';
import { STRIP_PATH_FEE_RATE } from '@/lib/types/rfp-terms';
import type { Bid } from '@/lib/types/bid';
import type { Attachment } from '@/lib/types/common';
import type { InvitationStatus } from '@/lib/types/invitation';
import type { RfpRequoteRequestStatus } from '@/lib/types/rfp-requote-request';
import type { SigningView } from '@/lib/types/signing';
import {
  toSigningTemplateOption,
  type SigningTemplateOption,
} from '@/lib/server/signing-template-option';
import { stripProviderRefs } from './services/contract-signing';

/** 선정 후 교환되는 담당자 연락처 — 회사명 + 개인 이름·이메일·전화(nullable). */
export type DealContact = {
  workspaceName: string;
  name: string;
  email: string;
  phone: string | null;
};

export type BuyerRfpDetailData = {
  rfp: RFP;
  /** submitted 상태 입찰 중 PG별 최신 라운드만. */
  bids: Bid[];
  rfpFiles: Attachment[];
  companyName: string;
  /** 초대(허용) PG 목록 — 워크스페이스 신원을 통째로 담는다(이름만 담으면 로고가 샌다). */
  inviteList: { ws: WorkspaceDisplay; status: InvitationStatus }[];
  /** pgWsId → 워크스페이스 신원(상호명·유형·로고 버전). 이름 맵과 로고 맵을 나누지 않는다. */
  pgWsById: Record<string, WorkspaceDisplay>;
  /** 오픈 게시판에서 들어온 미결(pending) 참여 요청 — 구매사 검토용. */
  pendingRequests: { id: string; pgWs: WorkspaceDisplay; message: string; createdAt: string }[];
  /** pgWsId → 최신 재요청 요약(없으면 키 없음). */
  requoteByPg: Record<string, { status: RfpRequoteRequestStatus; round: number; deadline: string }>;
  /** pgWsId → 직전 라운드 견적(델타 표시용; 없으면 키 없음). */
  priorBidByPg: Record<string, Bid>;
  canEdit: boolean;
  authorId: string;
  authorName: string;
  /** awarded 일 때만 — 선정된 PG 담당자 연락처. 그 외 상태는 null. */
  awardedPgContact: DealContact | null;
  /** 선정 후 전자서명 상태(활성 없으면 최신). 계약이 없으면 null. */
  signing: SigningView | null;
};

export type PgRfpDetailData = {
  rfp: RFP;
  /** 본인 워크스페이스가 이미 제출한 입찰 중 최신 라운드(있으면). */
  myBid: Bid | undefined;
  /** 구매사 워크스페이스 신원(상호명·로고 버전) — 아바타를 그리는 화면이 통째로 받는다. */
  buyer: WorkspaceDisplay;
  /** 본 PG 워크스페이스 공유 견적 템플릿 — BidForm 불러오기용(요율표). */
  quoteTemplates: QuoteTemplateOption[];
  /** 진행 중인 재요청(있으면 PG가 다시 제출 가능). */
  pendingRequote: { message: string; deadline: string; round: number } | null;
  /**
   * 이 견적이 선정되었고 승자가 본인 워크스페이스인지. 승자 신원은 노출하지 않고
   * 본인 여부만 파생한다(봉인입찰 경계). false 면 미선정(또는 선정 전).
   */
  awardedToMe: boolean;
  /** awardedToMe 일 때만 — 구매사 담당자 연락처. 미선정/선정 전은 null(누출 방지). */
  buyerContact: DealContact | null;
  /** awardedToMe 일 때만 — 전자서명 상태. 미낙찰 PG 는 null(봉인 경계). */
  signing: SigningView | null;
  /**
   * 워크스페이스가 보유한 계약서 서식 — BidWizard 선택용.
   *
   * 좁은 projection 을 쓴다(`toSigningTemplateOption`) — 조항형 서식의 `document` 는
   * 픽커가 쓰지 않는데 그대로 실으면 모든 딜룸 페이로드가 문서째로 불어난다.
   */
  signingTemplates: SigningTemplateOption[];
  /**
   * awardedToMe && `findSigningTemplateId(rfp.awardedBidId)` 가 가리키는 서식.
   *
   * **이름만이 아니라 종류도 함께 준다** — 딜룸이 발송 경로를 갈라야 하기 때문이다
   * (조항형은 `sendComposedContract`, PDF 는 `sendFromTemplate`). 이름만 주면 화면이
   * 종류를 추측해야 하고, 틀리면 서비스의 종류 게이트에 막혀 사용자는 원인 모를
   * 실패를 본다.
   */
  linkedSigningTemplate: SigningTemplateOption | null;
};

/**
 * 사라진 워크스페이스 행의 자리표시자 — 이름 대신 id 를 노출하던 기존 폴백(`?? wsId`)을
 * 신원 객체로 옮긴 것. 로고는 없으므로 이니셜로 떨어진다.
 */
function unknownPgWorkspace(wsId: string): WorkspaceDisplay {
  return { id: wsId, name: wsId, type: 'pg', logoUpdatedAt: null };
}

/**
 * 딜룸 전자서명 상태 로드 — 활성 계약(없으면 최신 라운드) + 참여자. 없으면 null.
 * ACL 은 호출자(buyer 소유 / PG awardedToMe)가 이미 검증했다는 전제. 진행 중
 * (sent/in_progress + providerRef)이면 진입 시 SnowSign 과 lazy reconcile 한다
 * (best-effort — 폴링 실패가 화면을 막지 않는다).
 */
async function loadSigningView(rfpId: string): Promise<SigningView | null> {
  const repo = await getSigningContractRepo();
  const active = await repo.findActiveByRfp(rfpId);
  const latest = active ?? (await repo.findByRfp(rfpId))[0];
  if (!latest) return null;
  if ((latest.status === 'sent' || latest.status === 'in_progress') && latest.providerRef) {
    try {
      const { getContractSigningService } = await import('./services/contract-signing');
      await (await getContractSigningService()).reconcileIfStale(latest.id);
    } catch {
      // 폴링 실패는 무시 — 마지막으로 동기화된 상태를 그대로 보여준다.
    }
  }
  const found = await repo.findById(latest.id);
  return found ? { contract: found.contract, participants: found.participants } : null;
}


// 봉인입찰 strip allowlist — 경로 → RFP 페이로드 변이. PG_STRIP 의 키 집합이 곧 처리 가능한
// 숨김 경로의 전부다. rfp-terms.ts 의 HIDEABLE_PG_PATHS(쓰기측 SSOT)가 이 키들의 부분집합임을
// pg-strip-coverage 드리프트 테스트가 강제 → 핸들러 없는 숨김 경로가 PG로 새는 fail-open 을 차단
// (쓰기측이 만들 수 있는 모든 숨김 경로는 반드시 대응 핸들러를 가진다). 경로는 current_terms 문서
// 구조 기준; 앱 레이어는 flat RFP 타입 그대로(flat-edge 영구 설계, PR #238 cutover 완료).
export const PG_STRIP: Record<string, (rfp: RFP) => void> = {
  [STRIP_PATH_FEE_RATE]: (r) => {
    r.currentFeeRate = undefined;
  },
};

function stripHiddenFromPg(rfp: RFP): void {
  // hidden_from_pg 가 단독 strip 권위 (Phase E — 레거시 currentFeeVisibleToPg 폴백 제거).
  // 모든 행은 dual-write/backfill 로 hidden_from_pg 가 채워져 있다는 전제(fallback 없음).
  for (const path of rfp.hiddenFromPg ?? []) PG_STRIP[path]?.(rfp);
  // PG 페이로드에 가시성 정책 메타데이터(숨김 경로 목록)를 노출하지 않는다 — 서버 strip 으로 충분.
  rfp.hiddenFromPg = undefined;
}

// 항상-제거되는 buyer 전용 필드 — opt-out(stripHiddenFromPg)과 별개로, PG 가 절대
// 받아선 안 되는 값들. loadPgRfpDetail 은 full RFP 를 'use client' 컴포넌트로 직렬화
// 하므로(RSC payload) 렌더 게이트만으론 누출된다 — 여기서 server-side 로 비운다.
//   - allowedPgWorkspaceIds: 경쟁사 로스터 + 수 (봉인입찰 핵심 불변식)
//   - awardedBidId: 낙찰 입찰(승자) id
//   - createdBy / boardColumnId / boardVisible / currentFeeVisibleToPg: 구매사 내부 메타
//   - bizProfile: bizNo·grade 만 PG 브리프에 노출, 세무·감사 필드는 제거
//     (gradeSource 는 BizProfile 필수 필드라 중립값 'unset' 으로 둔다)
// 분류 완전성(모든 RFP 키가 visible/stripped 중 하나)은 아래 컴파일타임 가드가 강제한다.
function stripBuyerOnlyFromPg(rfp: RFP): void {
  rfp.allowedPgWorkspaceIds = [];
  rfp.awardedBidId = undefined;
  rfp.createdBy = '';
  rfp.boardColumnId = null;
  rfp.boardVisible = undefined;
  rfp.currentFeeVisibleToPg = undefined;
  if (rfp.bizProfile) {
    rfp.bizProfile = {
      bizNo: rfp.bizProfile.bizNo,
      grade: rfp.bizProfile.grade,
      gradeSource: 'unset',
    };
  }
}

// ── PG 페이로드 필드 분류 (드리프트 가드, fail-closed) ────────────────────────────
// 모든 RFP 키는 'PG 노출' 또는 'strip' 중 정확히 하나로 분류돼야 한다. 새 RFP 필드가
// 추가되면 아래 컴파일타임 단언이 분류될 때까지 빌드를 깨뜨려, 새 필드가 분류 누락으로
// PG 페이로드(RSC)에 조용히 새는 것을 막는다. (bizProfile 은 키 자체는 노출이되 중첩
// 필드만 stripBuyerOnlyFromPg 가 좁힌다 — 중첩 경계는 rfp-detail-loader.test.ts 가 고정.)
const _PG_STRIPPED_RFP_KEYS = [
  'allowedPgWorkspaceIds',
  'awardedBidId',
  'createdBy',
  'boardColumnId',
  'boardVisible',
  'currentFeeVisibleToPg',
  'hiddenFromPg',
] as const;
const _PG_VISIBLE_RFP_KEYS = [
  'id', 'code', 'buyerWsId', 'bizProfile', 'title', 'memo', 'websiteUrl',
  'mainProducts', 'annualPgVolume', 'currentFeeRate', 'currentSettlementLimit',
  'currentGuaranteeInsurance', 'currentSettlementCycle', 'deliveryServicePeriod',
  'currentSolution', 'currentSolutionDetail', 'rfpFiles', 'deadline', 'status',
  'createdAt', 'sentAt', 'updatedAt', 'requiredPaymentMethods',
  'customPaymentMethods', 'contractType',
] as const;
type _UnclassifiedRfpKey = Exclude<
  keyof RFP,
  (typeof _PG_STRIPPED_RFP_KEYS)[number] | (typeof _PG_VISIBLE_RFP_KEYS)[number]
>;
const _assertRfpKeysExhaustive: _UnclassifiedRfpKey extends never
  ? true
  : ['UNCLASSIFIED RFP KEY — add to _PG_STRIPPED_RFP_KEYS or _PG_VISIBLE_RFP_KEYS', _UnclassifiedRfpKey] =
  true;
void _assertRfpKeysExhaustive;

/** PG별 최신 라운드(submitted)만 남긴다. */
function pickCurrentBids(submitted: Bid[]): Bid[] {
  const byPg = new Map<string, Bid>();
  for (const b of submitted) {
    const cur = byPg.get(b.pgWsId);
    if (!cur || b.round > cur.round) byPg.set(b.pgWsId, b);
  }
  return [...byPg.values()];
}

/**
 * 구매사 상세 데이터. 소유하지 않거나 없는 RFP면 null(→ page 가 not-found UI).
 */
export async function loadBuyerRfpDetail(args: {
  code: string;
  workspaceId: string;
  userId: string;
  userName: string;
}): Promise<BuyerRfpDetailData | null> {
  const rfp = await (await getRfpRepo()).findByCode(args.code);
  if (!rfp || rfp.buyerWsId !== args.workspaceId) return null;

  const allBids = await (await getBidRepo()).findByRfp(rfp.id);
  const submitted = allBids.filter((b) => b.status === 'submitted');
  const bids = pickCurrentBids(submitted);

  // 직전 라운드(현재 라운드 바로 아래 최댓값) — 델타 표시용.
  const priorBidByPg: Record<string, Bid> = {};
  for (const cur of bids) {
    const prior = submitted
      .filter((b) => b.pgWsId === cur.pgWsId && b.round < cur.round)
      .sort((a, b) => b.round - a.round)[0];
    if (prior) priorBidByPg[cur.pgWsId] = prior;
  }

  // 재요청 요약 — pgWsId별 라운드 최댓값 1건.
  const requoteRows = await (await getRfpRequoteRequestRepo()).findByRfp(rfp.id);
  const requoteByPg: Record<string, { status: RfpRequoteRequestStatus; round: number; deadline: string }> = {};
  for (const r of requoteRows) {
    const cur = requoteByPg[r.pgWsId];
    if (!cur || r.round > cur.round) {
      requoteByPg[r.pgWsId] = { status: r.status, round: r.round, deadline: r.deadline };
    }
  }

  const rfpFiles = await (await getAttachmentRepo()).findByRfp(rfp.id);

  const wsRepo = await getWorkspaceRepo();
  const ws = await wsRepo.findById(rfp.buyerWsId);
  const companyName = ws?.name ?? '—';

  // allowedPgWorkspaceIds 가 초대 목록의 소스. invitation row 의 status 를 머지.
  const invitations = await (await getInvitationRepo()).findByRfp(rfp.id);
  const invByWsId = new Map<string, InvitationStatus>();
  for (const inv of invitations) {
    if (inv.pgWsId) invByWsId.set(inv.pgWsId, inv.status);
  }

  const allPgWsIds = Array.from(
    new Set([...rfp.allowedPgWorkspaceIds, ...bids.map((b) => b.pgWsId)]),
  );
  const allPgWorkspaces = await wsRepo.findDisplayInfoByIds(allPgWsIds);
  const pgWsById: Record<string, WorkspaceDisplay> = {};
  allPgWorkspaces.forEach((w) => {
    pgWsById[w.id] = w;
  });

  const inviteList = rfp.allowedPgWorkspaceIds.map((wsId) => ({
    ws: pgWsById[wsId] ?? unknownPgWorkspace(wsId),
    status: invByWsId.get(wsId) ?? ('draft' as InvitationStatus),
  }));

  // 오픈 게시판 콜드 피치 — pending 만 검토 목록에 노출. PG 상호명 hydrate.
  const allRequests = await (await getPgRequestRepo()).findByRfp(rfp.id);
  const pendingReqRows = allRequests.filter((r) => r.status === 'pending');
  const reqWsIds = Array.from(new Set(pendingReqRows.map((r) => r.pgWsId)));
  const reqWorkspaces = await wsRepo.findDisplayInfoByIds(reqWsIds);
  const reqWsById = new Map(reqWorkspaces.map((w) => [w.id, w]));
  const pendingRequests = pendingReqRows.map((r) => ({
    id: r.id,
    pgWs: reqWsById.get(r.pgWsId) ?? unknownPgWorkspace(r.pgWsId),
    message: r.message,
    createdAt: r.createdAt,
  }));

  // 선정 완료 시에만 선정 PG 담당자 연락처를 부착(연락처 교환). 그 외 상태는 null.
  let awardedPgContact: DealContact | null = null;
  if (rfp.status === 'awarded' && rfp.awardedBidId) {
    const awardedBid = allBids.find((b) => b.id === rfp.awardedBidId);
    if (awardedBid) {
      const contact = await (await getUserRepo()).findContactById(awardedBid.submittedBy);
      if (contact) {
        awardedPgContact = { workspaceName: pgWsById[awardedBid.pgWsId]?.name ?? '—', ...contact };
      }
    }
  }

  const canEdit = rfp.status === 'sent' && new Date(rfp.deadline).getTime() > Date.now();

  // 전자서명 상태 — 구매사는 자기 RFP 계약을 항상 본다(소유 가드는 위에서 통과).
  // 구매사 경로 — provider 식별자를 벗겨 내려보낸다(봉인 경계, 헬퍼는 서비스 소유).
  const signingRaw = await loadSigningView(rfp.id);
  const signing = signingRaw
    ? { contract: stripProviderRefs(signingRaw.contract), participants: signingRaw.participants }
    : null;

  return {
    rfp,
    bids,
    rfpFiles,
    companyName,
    inviteList,
    pgWsById,
    pendingRequests,
    requoteByPg,
    priorBidByPg,
    canEdit,
    authorId: args.userId,
    authorName: args.userName,
    awardedPgContact,
    signing,
  };
}

/**
 * PG 상세 데이터. 초대받지 않은(canAccess=false) RFP면 null(→ page 가 notFound).
 * 부수효과: 본인 워크스페이스의 accepted invitation 을 opened 로 1회 전이(검토 시그널).
 */
export async function loadPgRfpDetail(args: {
  code: string;
  workspaceId: string;
}): Promise<PgRfpDetailData | null> {
  const rfp = await (await getRfpRepo()).findByCode(args.code);
  if (!rfp) return null;

  const invRepo = await getInvitationRepo();
  const ok = await invRepo.canAccess(rfp.id, args.workspaceId);
  if (!ok) return null;

  // 검토 시작 시그널 — accepted/sent → opened (repo SQL 이 멱등 보장).
  const invitations = await invRepo.findByRfp(rfp.id);
  const mine = invitations.find(
    (i) =>
      i.pgWsId === args.workspaceId &&
      (i.status === 'sent' || i.status === 'accepted'),
  );
  if (mine) await invRepo.markOpened(mine.id, new Date());

  // 봉인입찰 데이터 경계: 구매사가 숨기기로 한 필드를 PG 페이로드에서 server-side 제거.
  // RfpBriefPanel 렌더 게이트는 시각적 방어선일 뿐 — 서버에서 지워야 PG가 RSC
  // payload/네트워크에서 읽지 못한다. (rfp 는 findByCode 가 매 호출 새로 만든
  // request-scoped 객체라 변이 안전.) 누출 방지 우선: 일반화된 hidden_from_pg 와
  // 레거시 boolean 중 하나라도 숨김이면 제거한다.
  stripHiddenFromPg(rfp);
  // 승자 id 는 곧 strip 되므로, "내가 선정됐는지"만 파생하려고 먼저 캡처한다.
  // 이 boolean 은 승자 신원을 노출하지 않는다(본인 여부만).
  const awardedStatus = rfp.status;
  const awardedBidIdBeforeStrip = rfp.awardedBidId;
  const createdByBeforeStrip = rfp.createdBy;
  // 항상-제거되는 buyer 전용 필드(경쟁사 로스터·승자·내부 메타) — opt-out 과 별개.
  stripBuyerOnlyFromPg(rfp);

  // 구매사 첨부 hydrate — RfpBriefPanel 미리보기용.
  rfp.rfpFiles = await (await getAttachmentRepo()).findByRfp(rfp.id);

  const allBids = await (await getBidRepo()).findByRfp(rfp.id);
  const submittedMine = allBids.filter(
    (b) => b.pgWsId === args.workspaceId && b.status === 'submitted',
  );
  // 최신 라운드 submitted bid (여러 라운드 가능).
  const myBid = submittedMine.sort((a, b) => b.round - a.round)[0] ?? undefined;

  // 선정이 끝났고, 승자 입찰이 내 워크스페이스 것이면 awardedToMe=true.
  const awardedToMe =
    awardedStatus === 'awarded' &&
    !!awardedBidIdBeforeStrip &&
    allBids.some((b) => b.id === awardedBidIdBeforeStrip && b.pgWsId === args.workspaceId);

  // pending 재요청 조회 — PG가 다시 제출 가능한 상태인지 판단.
  const pendingReq = await (await getRfpRequoteRequestRepo()).findPendingByPair(rfp.id, args.workspaceId);
  const pendingRequote = pendingReq
    ? { message: pendingReq.message, deadline: pendingReq.deadline, round: pendingReq.round }
    : null;

  // 구매사 신원(상호명 + 로고 버전) — RfpBriefPanel·BidContextStrip 이 아바타까지 그린다.
  const wsRepo = await getWorkspaceRepo();
  const buyerWs = await wsRepo.getDisplayInfo(rfp.buyerWsId);
  const buyer: WorkspaceDisplay = buyerWs ?? {
    id: rfp.buyerWsId,
    name: '—',
    type: 'buyer',
    logoUpdatedAt: null,
  };

  // awardedToMe 일 때만 구매사 담당자 연락처 부착. 미선정/선정 전은 조회조차 안 함(누출 방지).
  let buyerContact: DealContact | null = null;
  if (awardedToMe && createdByBeforeStrip) {
    const contact = await (await getUserRepo()).findContactById(createdByBeforeStrip);
    if (contact) buyerContact = { workspaceName: buyer.name, ...contact };
  }

  // 본 PG 워크스페이스 공유 견적 템플릿(요율표) — 폼 채우기용 직렬화 부분집합.
  const templates = await (await getBidQuoteTemplateRepo()).listByWorkspace(
    args.workspaceId,
  );
  const quoteTemplates: QuoteTemplateOption[] = templates.map(toQuoteTemplateOption);

  // 전자서명 상태 — 낙찰 PG(awardedToMe)만 조회. 미낙찰 PG 는 조회조차 안 함(봉인 경계).
  const signing = awardedToMe ? await loadSigningView(rfp.id) : null;

  // 본 PG 워크스페이스 계약서 템플릿 — BidWizard 선택용. **위저드가 실제로 렌더될
  // 때만** 조회한다(제출 완료·선정 종료 딜룸에서는 아무도 안 쓰던 쿼리다).
  // 조건은 화면과 공유하는 단일 출처를 쓴다 — 여기서 덜 가져오면 위저드가 빈 목록으로
  // 렌더돼 픽커가 사라지고, 초안에 담긴 템플릿 선택이 '삭제됨'으로 오인돼 해제된다.
  const templateRepo = await getPgSigningTemplateRepo();
  const signingTemplates = pgDealRoomShowsBidWizard({
    hasPendingRequote: !!pendingRequote,
    isAwarded: awardedStatus === 'awarded',
    hasMyBid: !!myBid,
  })
    ? (await templateRepo.listByWorkspace(args.workspaceId)).map(toSigningTemplateOption)
    : [];

  // 낙찰 입찰에 연결된 템플릿 이름 — 딜룸 표시용. `Bid` 도메인 타입 필드로 읽지 않고
  // 좁은 접근자(findSigningTemplateId)로만 읽는다(봉인 경계, `Bid` 타입엔 이 필드가 없다).
  // 소스는 **rfp.awardedBidId** 다 — 발송(sendFromTemplate)이 그 라운드의 템플릿을
  // 쓰므로, 최신 라운드(myBid)로 읽으면 재견적 뒤 화면이 보여주는 이름과 실제 나가는
  // 문서가 갈라진다(L22).
  let linkedSigningTemplate: SigningTemplateOption | null = null;
  if (awardedToMe && awardedBidIdBeforeStrip) {
    const linkedTemplateId = await (await getBidRepo()).findSigningTemplateId(
      awardedBidIdBeforeStrip,
    );
    if (linkedTemplateId) {
      const linked = await templateRepo.findById(linkedTemplateId);
      linkedSigningTemplate = linked ? toSigningTemplateOption(linked) : null;
    }
  }

  return {
    rfp,
    myBid,
    pendingRequote,
    buyer,
    quoteTemplates,
    awardedToMe,
    buyerContact,
    signing,
    signingTemplates,
    linkedSigningTemplate,
  };
}
