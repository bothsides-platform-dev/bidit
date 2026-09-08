// lib/onboarding/tutorial-fixtures.ts
// buyer 튜토리얼(/tutorial, BuyerTutorialFlow) 전용 가상 데이터. DB 행을 만들지 않고
// 고정 데이터로 "RFP 작성 → 견적 도착 → 비교·선정" 여정을 체험시킨다. 실제 타입
// (RFP/Bid/BizProfile)으로 선언해 제품 타입이 바뀌면 빌드가 깨지게 한다(드리프트 가드
// — lib/onboarding/fixtures.ts 구 샘플 온보딩, components/landing/demo-app/demo-app-fixtures.ts
// 와 같은 패턴). 서버·클라 양쪽에서 import 가능 — DB 클라이언트·리포지토리 import 없음
// (client-safe).
import type { RFP } from '@/lib/types/rfp';
import type { Bid, MerchantTier, PaymentMethod, TierRates } from '@/lib/types/bid';
import type { BizProfile } from '@/lib/types/biz-profile';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import type { PgWorkspace } from '@/components/rfp/RfpStep3PgSelect';
// 타입 전용 import — useBidDraft는 'use client' 모듈이지만 type-only라 client-safe 유지.
import type { BidDraft } from '@/components/inbox/useBidDraft';
import type {
  DraftCustomPaymentMethod,
  PgWorkspaceItem,
  RfpMockFile,
} from '@/lib/stores/rfp-draft';

// useRfpDraftStore의 폼 필드(setField/reset 제외) 모양 — 스토어 타입은 export되지 않으므로
// 여기서 seed 용으로 좁게 재선언한다(드리프트는 useIsolatedRfpDraft.ts가 setState에 그대로
// 흘려보낼 때 타입체크로 잡힌다).
export type RfpDraftSeedFields = {
  title: string;
  websiteUrl: string;
  mainProducts: string;
  annualPgVolume: string;
  currentFeeRate: string;
  currentSettlementLimit: string;
  currentGuaranteeInsurance: string;
  currentSettlementCycle: string;
  deliveryServicePeriod: string;
  currentSolution: string;
  currentSolutionDetail: string;
  memo: string;
  rfpFiles: RfpMockFile[];
  allowedPgWorkspaceIds: PgWorkspaceItem[];
  requiredPaymentMethods: PaymentMethod[];
  customPaymentMethods: DraftCustomPaymentMethod[];
  deadline: string;
  boardVisible: boolean;
  currentFeeVisibleToPg: boolean;
  contractType: 'new' | 'renewal' | null;
  pgSelectionInitialized: boolean;
};

const TUTORIAL_BUYER_WS_ID = 'tutorial-buyer-ws';
export const tutorialBuyerName = '튜토리얼 쇼핑몰';

const NOW_MS = Date.now();
const DAY_MS = 86_400_000;
const TUTORIAL_DEADLINE = new Date(NOW_MS + 14 * DAY_MS).toISOString();
const TUTORIAL_CREATED_AT = new Date(NOW_MS - 1 * DAY_MS).toISOString();

export const TUTORIAL_PG_IDS = ['tutorial-pg-a', 'tutorial-pg-b', 'tutorial-pg-c'] as const;

/** pgWsId → 표시명 — 가상 3사. */
export const tutorialPgNames: Record<string, string> = {
  [TUTORIAL_PG_IDS[0]]: '튜토리얼페이 A',
  [TUTORIAL_PG_IDS[1]]: '튜토리얼페이 B',
  [TUTORIAL_PG_IDS[2]]: '튜토리얼페이 C',
};

/** pgWsId → 표시 신원 — 아바타를 그리는 화면은 이름 맵이 아니라 이 맵을 받는다. */
export const tutorialPgWsById: Record<string, WorkspaceDisplay> = Object.fromEntries(
  TUTORIAL_PG_IDS.map((id) => [
    id,
    { id, name: tutorialPgNames[id]!, type: 'pg' as const, logoUpdatedAt: null },
  ]),
);

/** 튜토리얼 구매사 신원 — RfpBriefPanel·BidWizard 가 통째로 받는다. */
export const tutorialBuyer: WorkspaceDisplay = {
  id: TUTORIAL_BUYER_WS_ID,
  name: tutorialBuyerName,
  type: 'buyer',
  logoUpdatedAt: null,
};

/** RfpCreateWizard의 pgList prop 타입 — Step3 PG 선택 화면용. */
export const tutorialPgList: PgWorkspace[] = TUTORIAL_PG_IDS.map((id) => ({
  id,
  name: tutorialPgNames[id],
  displayName: tutorialPgNames[id],
  logoUpdatedAt: null,
}));

/** RfpCreateWizard의 bizProfile prop 타입. */
export const tutorialBizProfile: Pick<BizProfile, 'bizNo' | 'taxType' | 'status'> = {
  bizNo: '123-45-67890',
  taxType: 'general',
  status: 'active',
};

function tierRates(rates: Record<MerchantTier, number>): TierRates {
  return rates;
}

export const tutorialBuyerRfp: RFP = {
  id: 'tutorial-rfp',
  code: 'TUTORIAL',
  buyerWsId: TUTORIAL_BUYER_WS_ID,
  title: '온라인 쇼핑몰 PG 견적 요청 (튜토리얼)',
  memo: '결제대행사 비교를 체험해보는 튜토리얼 견적 요청이에요.',
  mainProducts: '패션 의류 · 잡화',
  annualPgVolume: '1200000000',
  currentFeeRate: '2.8%',
  currentSettlementLimit: '30000000',
  currentGuaranteeInsurance: '없음',
  currentSettlementCycle: 'D+5',
  deliveryServicePeriod: '2~3일',
  currentSolution: undefined,
  currentSolutionDetail: undefined,
  rfpFiles: [],
  allowedPgWorkspaceIds: [...TUTORIAL_PG_IDS],
  deadline: TUTORIAL_DEADLINE,
  status: 'sent',
  createdBy: 'tutorial-buyer-user',
  createdAt: TUTORIAL_CREATED_AT,
  sentAt: TUTORIAL_CREATED_AT,
  requiredPaymentMethods: ['card', 'virtual_account', 'naver_pay'],
  customPaymentMethods: [],
  boardVisible: false,
  currentFeeVisibleToPg: true,
  contractType: null,
};

// 세 비더를 의도적으로 차별화 — 비교가 의미를 갖도록.
export const tutorialBids: Bid[] = [
  {
    id: 'tutorial-bid-a',
    rfpId: tutorialBuyerRfp.id,
    pgWsId: TUTORIAL_PG_IDS[0],
    invitationId: 'tutorial-inv-a',
    round: 1,
    settleCycle: 'D+2',
    settleLimit: 50_000_000,
    guaranteeInsurance: 5_000_000,
    signupFee: 0,
    paymentFees: {
      card: tierRates({ sole: 0.005, sme1: 0.008, sme2: 0.011, sme3: 0.013, general: 0.018 }),
      virtual_account: 300,
      naver_pay: 0.025,
    },
    customFees: {},
    proposalPdfs: [],
    memo: '카드 수수료가 가장 낮아요. 정산은 D+2예요.',
    status: 'submitted',
    submittedBy: 'tutorial-pg-a-user',
    submittedAt: TUTORIAL_CREATED_AT,
  },
  {
    id: 'tutorial-bid-b',
    rfpId: tutorialBuyerRfp.id,
    pgWsId: TUTORIAL_PG_IDS[1],
    invitationId: 'tutorial-inv-b',
    round: 1,
    settleCycle: 'D+1',
    settleLimit: 100_000_000,
    guaranteeInsurance: 3_000_000,
    signupFee: 300_000,
    paymentFees: {
      card: tierRates({ sole: 0.006, sme1: 0.009, sme2: 0.012, sme3: 0.015, general: 0.02 }),
      virtual_account: 250,
      naver_pay: 0.023,
    },
    customFees: {},
    proposalPdfs: [],
    memo: '정산이 D+1로 빠르고 한도가 높아요.',
    status: 'submitted',
    submittedBy: 'tutorial-pg-b-user',
    submittedAt: TUTORIAL_CREATED_AT,
  },
  {
    id: 'tutorial-bid-c',
    rfpId: tutorialBuyerRfp.id,
    pgWsId: TUTORIAL_PG_IDS[2],
    invitationId: 'tutorial-inv-c',
    round: 1,
    settleCycle: 'D+1',
    settleLimit: 80_000_000,
    guaranteeInsurance: 0,
    signupFee: 500_000,
    paymentFees: {
      card: tierRates({ sole: 0.007, sme1: 0.01, sme2: 0.013, sme3: 0.016, general: 0.022 }),
      virtual_account: 200,
      naver_pay: 0.019,
    },
    customFees: {},
    proposalPdfs: [],
    memo: '간편결제 수수료가 낮고 보증보험이 없어요.',
    status: 'submitted',
    submittedBy: 'tutorial-pg-c-user',
    submittedAt: TUTORIAL_CREATED_AT,
  },
];

/**
 * BidWizard(pg 튜토리얼) 프리필 시드 — tutorialBids[0](튜토리얼페이 A)와 동일 조건.
 * pg 튜토리얼도 입력 없이 클릭만으로 진행 가능하다(오픈 샌드박스 — 타이핑도 자유롭게 허용).
 * fees 키 규약: 구간제 수단(card·간편결제)은 "<method>:<tier>" percent 문자열,
 * 정액 수단(virtual_account)은 건당 원 정수 문자열.
 */
export const tutorialBidDraftSeed: BidDraft = {
  __v: 3,
  cycleUnit: 'D',
  cycleNum: '2',
  settleLimit: '50000000',
  guaranteeInsurance: '5000000',
  signupFee: '0',
  fees: {
    'card:sole': '0.5',
    'card:sme1': '0.8',
    'card:sme2': '1.1',
    'card:sme3': '1.3',
    'card:general': '1.8',
    'naver_pay:sole': '2.5',
    'naver_pay:sme1': '2.5',
    'naver_pay:sme2': '2.5',
    'naver_pay:sme3': '2.5',
    'naver_pay:general': '2.5',
    virtual_account: '300',
  },
  memo: '카드 수수료가 가장 낮아요. 정산은 D+2예요.',
};

const tutorialPgWorkspaceItems: PgWorkspaceItem[] = TUTORIAL_PG_IDS.map((id) => ({
  id,
  displayName: tutorialPgNames[id],
  logoUpdatedAt: null,
}));

/**
 * useRfpDraftStore 시드 — 모든 스텝을 프리필한다. 튜토리얼은 입력 없이
 * "여기를 눌러" 코치마크를 따라 클릭만으로 진행하는 가이드 투어다
 * (오픈 샌드박스 — 프리필 값은 자유롭게 타이핑으로 수정할 수 있다).
 */
export const tutorialRfpDraftSeed: RfpDraftSeedFields = {
  title: tutorialBuyerRfp.title,
  websiteUrl: 'https://tutorial-shop.example.com',
  mainProducts: '패션 의류 · 잡화',
  annualPgVolume: '1200000000',
  currentFeeRate: '2.8',
  currentSettlementLimit: '30000000',
  currentGuaranteeInsurance: '없음',
  currentSettlementCycle: 'D+5',
  deliveryServicePeriod: '2~3일',
  currentSolution: '',
  currentSolutionDetail: '',
  memo: '',
  rfpFiles: [],
  allowedPgWorkspaceIds: tutorialPgWorkspaceItems,
  requiredPaymentMethods: ['card', 'virtual_account', 'naver_pay'],
  customPaymentMethods: [],
  deadline: TUTORIAL_DEADLINE,
  boardVisible: false,
  currentFeeVisibleToPg: true,
  contractType: 'renewal',
  pgSelectionInitialized: true,
};
