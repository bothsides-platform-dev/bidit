// PG 파트너 임베디드 데모용 고정 데이터. 실제 타입으로 선언해 제품 타입이 바뀌면 빌드가
// 깨지게 한다(단일소스 가드). 딜룸 RFP 는 buyer 데모의 demoRfps[0] 를 재사용한다.
import type { Dashboard } from '@/lib/server/dashboard/buildDashboard';
import type { InboxListItem } from '@/lib/server/actions/chat/inboxLoader';
import type { InboxRow } from '@/components/inbox/InboxList';
import type { RFP } from '@/lib/types/rfp';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import { demoRfps } from '../demo-app-fixtures';

const now = Date.now();
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();

export const demoPgWorkspaceName = '파트너 PG사';
export const demoPgBuyerName = '브링콘파트너스';
/** 데모 구매사 신원 — RfpBriefPanel·BidWizard 가 통째로 받는다(데모는 로고 없음). */
export const demoPgBuyer: WorkspaceDisplay = {
  id: 'demo-buyer-ws',
  name: demoPgBuyerName,
  type: 'buyer',
  logoUpdatedAt: null,
};

// ── 받은 견적 요청 목록(InboxList rows) ────────────────────────────
export const demoPgInboxRows: InboxRow[] = [
  {
    invitationId: 'pg-inv-1',
    stage: 'received',
    rfpId: 'P-2606-0042',
    rfpTitle: '2026 결제 인프라 견적 요청',
    rfpDeadline: iso(3),
    grade: '일반',
    contractType: 'new',
  },
  {
    invitationId: 'pg-inv-2',
    stage: 'submitted',
    bidId: 'pg-bid-2',
    rfpId: 'P-2606-0039',
    rfpTitle: '정기결제(빌링) 전환 견적',
    rfpDeadline: iso(5),
    grade: '중소',
  },
  {
    invitationId: 'pg-inv-3',
    stage: 'won',
    bidId: 'pg-bid-3',
    rfpId: 'P-2606-0031',
    rfpTitle: '해외카드 수수료 재협상',
    rfpDeadline: iso(-2),
    grade: '대형',
  },
];

// 딜룸(요청 상세 + 견적 작성)용 RFP — received 행(P-2606-0042)에 대응. buyer 데모 RFP 재사용.
export const demoPgDealRfp: RFP = demoRfps[0];

// ── PG 홈 대시보드 ─────────────────────────────────────────────
export const demoPgDashboard: Dashboard = {
  kpis: [
    { id: 'received', label: '받은 요청', value: 3, href: '/inbox' },
    { id: 'due', label: '마감 임박', value: 1, href: '/inbox' },
    { id: 'submitted', label: '견적 보냄', value: 2, href: '/inbox' },
    { id: 'won', label: '선정됨', value: 4, href: '/inbox' },
  ],
  groups: [
    {
      id: 'received',
      label: '새로 받은 견적 요청',
      items: [
        { id: 'g1', href: '/inbox/P-2606-0042', title: '2026 결제 인프라 견적 요청', badge: 'D-3' },
        { id: 'g2', href: '/inbox/P-2606-0039', title: '정기결제(빌링) 전환 견적', badge: 'D-5' },
      ],
    },
  ],
};

export const demoPgInboxItems: InboxListItem[] = [
  {
    kind: 'team',
    key: 't:pg-1',
    rfpId: 'demo-rfp-1',
    rfpCode: 'P-2606-0042',
    rfpTitle: '2026 결제 인프라 견적 요청',
    preview: '브링콘파트너스: 정산주기 조건 한 번만 확인 부탁드려요.',
    lastMessageAt: new Date(now - 3 * 3_600_000).toISOString(),
    unread: true,
  },
];

export const demoPgUnread = 1;
