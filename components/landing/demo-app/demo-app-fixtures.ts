// 임베디드 대시보드 데모용 고정 데이터. 모두 실제 타입으로 선언해 제품 타입이 바뀌면
// 빌드가 깨지게 한다(단일소스 가드). 서버 모듈은 type-only import만 사용한다.
import type { RFP } from '@/lib/types/rfp';
import type { Bid, MerchantTier, PaymentMethod } from '@/lib/types/bid';
import type { Dashboard } from '@/lib/server/dashboard/buildDashboard';
import type { InboxListItem } from '@/lib/server/actions/chat/inboxLoader';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import { fixtureCurrent } from '@/components/landing/demo-fixtures';

const now = Date.now();
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();

// ── 견적 요청 목록 ─────────────────────────────────────────────
export const demoRfps: RFP[] = [
  rfp({ id: 'demo-rfp-1', code: 'P-2606-0042', title: '2026 결제 인프라 견적 요청', deadline: iso(5), pgCount: 3 }),
  rfp({ id: 'demo-rfp-2', code: 'P-2606-0039', title: '정기결제(빌링) 전환 견적', deadline: iso(2), pgCount: 4 }),
  rfp({ id: 'demo-rfp-3', code: 'P-2606-0031', title: '해외카드 수수료 재협상', deadline: iso(12), pgCount: 2 }),
];

function rfp(o: { id: string; code: string; title: string; deadline: string; pgCount: number }): RFP {
  return {
    id: o.id,
    code: o.code,
    buyerWsId: 'demo-buyer-ws',
    title: o.title,
    memo: '',
    rfpFiles: [],
    allowedPgWorkspaceIds: Array.from({ length: o.pgCount }, (_, i) => `demo-pg-${i + 1}`),
    deadline: o.deadline,
    status: 'sent',
    createdBy: 'demo-user-1',
    createdAt: iso(-3),
    requiredPaymentMethods: ['card'],
    customPaymentMethods: [],
  };
}

// ── 딜룸 비교(FocusComparison)용 견적들 ───────────────────────────
// 카드 구간 요율(소수) — sample-rfp.ts SAMPLE_BIDS의 차별화 패턴을 본떴다.
function cardTier(general: number): Partial<Record<MerchantTier, number>> {
  return { sole: general - 0.004, sme1: general - 0.003, sme2: general - 0.002, sme3: general - 0.001, general };
}

const demoPgNames: Record<string, string> = {
  'demo-pg-7': '토스페이먼츠',
  'demo-pg-1': 'KG이니시스',
  'demo-pg-2': 'NHN KCP',
};
export const demoPgNameMap = demoPgNames;

/** pgWsId → 표시 신원(데모는 로고 없음) — 비교 화면이 이름 맵 대신 이 맵을 받는다. */
export const demoPgWsById: Record<string, WorkspaceDisplay> = Object.fromEntries(
  Object.entries(demoPgNames).map(([id, name]) => [
    id,
    { id, name, type: 'pg' as const, logoUpdatedAt: null },
  ]),
);

function bid(o: {
  id: string; pgWsId: string; card: number; settleCycle: string; settleLimit: number;
  guarantee: number; va: number; naver: number; memo: string;
}): Bid {
  const fees: Partial<Record<PaymentMethod, number | Partial<Record<MerchantTier, number>>>> = {
    card: cardTier(o.card),
    virtual_account: o.va,
    naver_pay: o.naver,
  };
  return {
    id: o.id,
    rfpId: 'demo-rfp-1',
    pgWsId: o.pgWsId,
    invitationId: `inv-${o.id}`,
    settleCycle: o.settleCycle,
    settleLimit: o.settleLimit,
    guaranteeInsurance: o.guarantee,
    signupFee: 0,
    paymentFees: fees,
    customFees: {},
    proposalPdfs: [],
    status: 'submitted',
    submittedBy: 'demo-user-1',
    round: 1,
    memo: o.memo,
  };
}

export const demoCompareBids: Bid[] = [
  bid({ id: 'demo-bid-1', pgWsId: 'demo-pg-7', card: 0.022, settleCycle: 'D+1', settleLimit: 1_000_000_000, guarantee: 0, va: 200, naver: 0.029, memo: '정산 주기 D+1, 보증보험 면제 조건이에요.' }),
  bid({ id: 'demo-bid-2', pgWsId: 'demo-pg-1', card: 0.025, settleCycle: 'D+1', settleLimit: 800_000_000, guarantee: 3_000_000, va: 250, naver: 0.030, memo: '대량 거래 시 추가 협의가 가능해요.' }),
  bid({ id: 'demo-bid-3', pgWsId: 'demo-pg-2', card: 0.028, settleCycle: 'D+2', settleLimit: 500_000_000, guarantee: 5_000_000, va: 300, naver: 0.031, memo: '안정적인 정산과 전담 지원을 제공해요.' }),
];

export const demoCompareCurrent = fixtureCurrent;
export const demoBuyerGrade: MerchantTier = 'sme2';

// ── 홈 대시보드 ────────────────────────────────────────────────
export const demoDashboard: Dashboard = {
  kpis: [
    { id: 'active', label: '진행 중', value: 3, href: '/rfp?status=active' },
    { id: 'due', label: '마감 임박', value: 1, href: '/rfp?status=active' },
    { id: 'review', label: '견적 검토 대기', value: 2, href: '/rfp?status=review' },
    { id: 'awarded', label: '선정 완료', value: 5, href: '/rfp?status=awarded' },
  ],
  groups: [
    {
      id: 'review',
      label: '검토를 기다리는 견적',
      items: [
        { id: 'a1', href: '/rfp/P-2606-0042', title: '2026 결제 인프라 견적 요청', badge: '견적 3건' },
        { id: 'a2', href: '/rfp/P-2606-0039', title: '정기결제(빌링) 전환 견적', badge: '견적 4건' },
      ],
    },
    {
      id: 'due',
      label: '마감이 다가와요',
      items: [{ id: 'a3', href: '/rfp/P-2606-0039', title: '정기결제(빌링) 전환 견적', badge: 'D-2' }],
    },
  ],
};

export const demoInboxItems: InboxListItem[] = [
  { kind: 'team', key: 't:demo-rfp-1', rfpId: 'demo-rfp-1', rfpCode: 'P-2606-0042', rfpTitle: '2026 결제 인프라 견적 요청', preview: '담당자: 견적 조건 확인 부탁드려요.', lastMessageAt: new Date(now - 2 * 3_600_000).toISOString(), unread: true },
  { kind: 'team', key: 't:demo-rfp-2', rfpId: 'demo-rfp-2', rfpCode: 'P-2606-0039', rfpTitle: '정기결제(빌링) 전환 견적', preview: '토스페이먼츠: 제안서 보내드렸습니다.', lastMessageAt: new Date(now - 26 * 3_600_000).toISOString(), unread: false },
];

export const demoUnreadCount = 1;
