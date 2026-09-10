// BuyerDealRoomBody — open-board kill switch 회귀 테스트
//
// OPEN_BOARD_ENABLED=false(실제 플래그값) 일 때 "PG 관리" 탭에
// "오픈 게시판 노출" 라벨 행이 DOM 에 노출되지 않아야 한다.
//
// 주의: @/lib/features/open-board 를 mock 하지 않음 — 실제 플래그를 사용.
// 플래그를 true 로 re-enable 할 때는 이 파일을 삭제하고,
// BuyerDealRoomBody.test.tsx 의 vi.mock('.../open-board', …) 행도 제거한다.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock('@/components/rfp/comparison/FocusComparison', () => ({
  FocusComparison: () => <div data-testid="focus-comparison" />,
}));
vi.mock('@/components/rfp/RequestConditionsView', () => ({
  RequestConditionsView: () => <div data-testid="request-conditions" />,
}));
vi.mock('@/components/rfp/RfpInviteManager', () => ({
  RfpInviteManager: () => <div data-testid="invite-manager" />,
}));
vi.mock('@/components/rfp/RfpBoardVisibilityStatus', () => ({
  RfpBoardVisibilityStatus: () => null,
}));
vi.mock('@/components/rfp/RfpPendingRequests', () => ({
  RfpPendingRequests: () => <div data-testid="pending-requests" />,
}));
vi.mock('@/components/attachments/AttachmentPreviewList', () => ({
  AttachmentPreviewList: () => <div data-testid="attachments" />,
}));
vi.mock('@/components/rfp/comparison/AwardConfirmDialog', () => ({
  AwardConfirmDialog: () => null,
}));
vi.mock('@/components/rfp/comparison/RequoteDialog', () => ({
  RequoteDialog: () => null,
}));
vi.mock('@/lib/server/actions/rfp', () => ({
  closeRfpAction: vi.fn(),
  cancelRfpAction: vi.fn(),
}));

vi.mock('@/lib/hooks/useIsLgUp', () => ({ useIsLgUp: () => true }));

import { BuyerDealRoomBody } from '../BuyerDealRoomBody';
import { DealRoomProvider } from '@/components/deal-room/DealRoomContext';
import type { BuyerRfpDetailData } from '@/lib/server/rfp-detail-loader';
import type { RFP } from '@/lib/types/rfp';
import type { Bid } from '@/lib/types/bid';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: DealRoomProvider });

const baseRfp: RFP = {
  id: 'rfp-1',
  code: 'P-2605-0042',
  buyerWsId: 'ws-buyer',
  title: '결제대행 RFP',
  memo: '',
  rfpFiles: [],
  allowedPgWorkspaceIds: [],
  requiredPaymentMethods: [],
  customPaymentMethods: [],
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'sent',
  createdBy: 'u1',
  createdAt: new Date().toISOString(),
};

const aBid: Bid = {
  id: 'bid-1',
  rfpId: 'rfp-1',
  pgWsId: 'ws-toss',
  invitationId: 'inv-1',
  settleCycle: 'D+1',
  settleLimit: 0,
  guaranteeInsurance: 0,
  signupFee: 0,
  paymentFees: {},
  customFees: {},
  proposalPdfs: [],
  status: 'submitted',
  submittedBy: 'pg-user',
  round: 1,
};

function buildData(over?: Partial<BuyerRfpDetailData>): BuyerRfpDetailData {
  return {
    rfp: baseRfp,
    bids: [aBid],
    rfpFiles: [],
    companyName: '구매사',
    inviteList: [],
    pgWsById: {},
    pendingRequests: [],
    canEdit: true,
    authorId: 'u1',
    authorName: '담당자',
    requoteByPg: {},
    priorBidByPg: {},
    awardedPgContact: null,
    signing: null,
    ...over,
  };
}

afterEach(cleanup);

describe('BuyerDealRoomBody — open-board kill switch', () => {
  it('OPEN_BOARD_ENABLED=false 일 때 "PG 관리" 탭에 "오픈 게시판 노출" 라벨이 없다', () => {
    render(<BuyerDealRoomBody data={buildData()} />);
    // "PG 관리" 탭으로 전환
    fireEvent.click(screen.getByRole('tab', { name: 'PG 관리' }));
    // OPEN_BOARD_ENABLED=false → 라벨 행이 게이트되어 DOM 에 없어야 한다
    expect(screen.queryByText('오픈 게시판 노출')).not.toBeInTheDocument();
  });
});
