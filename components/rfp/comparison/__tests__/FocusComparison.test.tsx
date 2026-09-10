import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactElement, type ReactNode } from 'react';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const cardSpy = vi.hoisted(() => ({
  lastCounterparty: null as
    | null
    | { name: string; workspaceId?: string; logoUpdatedAt?: string | null },
}));
vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({
    counterparty,
  }: {
    counterparty: { name: string; workspaceId?: string; logoUpdatedAt?: string | null };
  }) => {
    cardSpy.lastCounterparty = counterparty;
    return <span>{counterparty.name}</span>;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));
const awardRfpAction = vi.fn();
vi.mock('@/lib/server/actions/rfp', () => ({
  awardRfpAction: (...a: unknown[]) => awardRfpAction(...a),
}));
// 결과 오버레이는 표시 여부만 검증한다(내부는 Task 2가 커버).
vi.mock('@/components/rfp/comparison/AwardResult', () => ({
  AwardResult: ({ pgName }: { pgName: string }) => (
    <div data-testid="award-result">{pgName} 선정 완료</div>
  ),
}));

// RequoteDialog 내부는 RequoteDialog.test.tsx가 커버하므로 stub 처리.
vi.mock('@/components/rfp/comparison/RequoteDialog', () => ({
  RequoteDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="requote-dialog">requote dialog</div> : null,
}));
vi.mock('@/lib/server/actions/rfp/requestRequoteAction', () => ({ requestRequoteAction: vi.fn() }));

import { FocusComparison } from '../FocusComparison';
import { DealRoomProvider, useDealRoom } from '@/components/deal-room/DealRoomContext';
import type { Bid } from '@/lib/types/bid';
import { wsById } from '@/lib/types/__tests__/_workspace-fixtures';


// FocusComparison 은 이제 DealRoomProvider 안에서 포커스 PG 를 publish 한다. 기본 render 를
// 프로바이더로 감싸고, Probe 가 컨텍스트의 counterparty 를 캡처해 publish 를 검증한다.
let captured: ReturnType<typeof useDealRoom>['counterparty'] = null;
function CounterpartyProbe() {
  const cp = useDealRoom().counterparty;
  useEffect(() => {
    captured = cp;
  }, [cp]);
  return null;
}
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DealRoomProvider>
      <CounterpartyProbe />
      {children}
    </DealRoomProvider>
  );
}
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: Wrapper });

function makeBid(over: Partial<Bid>): Bid {
  return {
    id: 'b',
    rfpId: 'r1',
    pgWsId: 'pg',
    invitationId: 'i1',
    settleCycle: 'D+1',
    settleLimit: 700_000_000,
    guaranteeInsurance: 1_000_000,
    signupFee: 0,
    paymentFees: { card: 0.022 },
    customFees: {},
    proposalPdfs: [],
    status: 'submitted',
    submittedBy: 'u1',
    round: 1,
    ...over,
  };
}

const toss = makeBid({ id: 'b-toss', pgWsId: 'pg-toss', paymentFees: { card: 0.022, bank_transfer: 0.015 } });
const kg = makeBid({ id: 'b-kg', pgWsId: 'pg-kg', settleCycle: 'D+2', settleLimit: 500_000_000, paymentFees: { card: 0.028 } });

const baseProps = {
  bids: [kg, toss], // intentionally not pre-sorted
  pgWsById: wsById({ 'pg-toss': '토스페이먼츠', 'pg-kg': 'KG이니시스' }),
  current: { feeRate: '2.8%' },
  rfpStatus: 'sent',
  awardedBidId: null,
  requiredPaymentMethods: ['card', 'bank_transfer'] as const,
  customPaymentMethods: [],
  rfpId: 'rfp-uuid-1',
  rfpCode: 'P-2605-0042',
};

beforeEach(() => awardRfpAction.mockReset());
afterEach(cleanup);

describe('FocusComparison', () => {
  it('renders a tab per PG and focuses the lowest card-fee bid by default', () => {
    render(<FocusComparison {...baseProps} />);
    expect(screen.getByRole('tab', { name: /토스페이먼츠/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /KG이니시스/ })).toBeInTheDocument();
    // 토스 (2.20%) is the lowest card fee → focused; its proposed value shows
    expect(screen.getByText('2.20%')).toBeInTheDocument();
  });

  it('switches the focused bid when another tab is clicked', async () => {
    const user = userEvent.setup();
    render(<FocusComparison {...baseProps} />);
    await user.click(screen.getByRole('tab', { name: /KG이니시스/ }));
    expect(screen.getByText('2.80%')).toBeInTheDocument();
  });

  it('renders the two detail accordions (no per-bid 내 메모 — moved to 팀 채팅)', () => {
    render(<FocusComparison {...baseProps} />);
    expect(screen.getByText(/전체 결제수단 요율/)).toBeInTheDocument();
    expect(screen.getByText(/PG 메모/)).toBeInTheDocument();
    expect(screen.queryByText('내 메모')).not.toBeInTheDocument();
  });

  it('opens the award confirm dialog from the CTA when the RFP is open', async () => {
    const user = userEvent.setup();
    render(<FocusComparison {...baseProps} />);
    await user.click(screen.getByRole('button', { name: /이 견적 선정하기/ }));
    expect(
      await screen.findByRole('heading', { name: /토스페이먼츠의 견적을 선정할까요/ }),
    ).toBeInTheDocument();
  });

  it('hides the CTA and marks the winner when the RFP is awarded', () => {
    render(
      <FocusComparison {...baseProps} rfpStatus="awarded" awardedBidId="b-toss" />,
    );
    expect(screen.queryByRole('button', { name: /이 견적 선정하기/ })).not.toBeInTheDocument();
    expect(screen.getByText('선정됨')).toBeInTheDocument();
  });

  it('shows an empty state when no bids have arrived', () => {
    render(<FocusComparison {...baseProps} bids={[]} />);
    expect(screen.getByText('아직 도착한 견적이 없어요')).toBeInTheDocument();
  });

  it('견적이 없으면 초대 현황과 마감을 보여주고 PG 관리로 이동할 수 있다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T03:00:00+09:00'));
    const onManageInvitations = vi.fn();

    try {
      render(
        <FocusComparison
          {...baseProps}
          bids={[]}
          invitedPgCount={3}
          deadline="2026-09-14T23:59:59+09:00"
          onManageInvitations={onManageInvitations}
        />,
      );

      expect(screen.getByText('아직 도착한 견적이 없어요')).toBeInTheDocument();
      expect(screen.getByText(/PG사/, { selector: 'p' })).toHaveTextContent(
        'PG사 3곳에 요청했어요',
      );
      expect(screen.getByText('D-5')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '초대 현황 보기' }));
      expect(onManageInvitations).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('편집할 수 없고 초대도 없으면 PG사를 추가할 수 있다고 안내하지 않는다', () => {
    render(
      <FocusComparison
        {...baseProps}
        bids={[]}
        invitedPgCount={0}
        canEditInvitations={false}
        onManageInvitations={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'PG 관리 보기' })).toBeInTheDocument();
    expect(screen.queryByText(/PG사를 추가하면/)).not.toBeInTheDocument();
  });

  it('발송 대기 PG만 있으면 요청 완료가 아니라 초대 발송이 필요하다고 안내한다', () => {
    render(
      <FocusComparison
        {...baseProps}
        bids={[]}
        invitedPgCount={0}
        draftPgCount={2}
        onManageInvitations={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent === 'PG사 2곳을 추가했어요. 초대를 보내면 견적을 받을 수 있어요.',
      ),
    ).toHaveTextContent(
      'PG사 2곳을 추가했어요. 초대를 보내면 견적을 받을 수 있어요.',
    );
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'SPAN' && element.textContent === '발송 대기 2곳',
      ),
    ).toHaveTextContent('발송 대기 2곳');
    expect(screen.queryByText(/요청했어요/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '초대 현황 보기' })).toBeInTheDocument();
  });

  it('마감이 지난 빈 견적 화면은 마감 상태를 한 번만 표시한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T03:00:00+09:00'));

    try {
      render(
        <FocusComparison
          {...baseProps}
          bids={[]}
          deadline="2026-09-08T23:59:59+09:00"
          onManageInvitations={vi.fn()}
        />,
      );

      expect(screen.getAllByText('마감', { selector: 'span' })).toHaveLength(1);
      expect(screen.getByText('마감일까지 도착한 견적이 없어요.')).toBeInTheDocument();
      expect(screen.queryByText(/견적이 도착하면/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('구간 셀렉터를 바꾸면 카드 요율 표시가 그 구간 값으로 바뀐다', () => {
    const bids = [
      makeBid({ id: 'a', pgWsId: 'pgA', paymentFees: { card: { sole: 0.005, general: 0.018 } } }),
    ];
    render(<FocusComparison {...baseProps} bids={bids} requiredPaymentMethods={['card']} />);
    // 기본 일반 → 1.80%
    expect(screen.getAllByText('1.80%').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '영세' }));
    expect(screen.getAllByText('0.50%').length).toBeGreaterThan(0);
  });

  it('구매사 등급이 주어지면 해당 구간 탭을 기본 선택해 그 요율을 먼저 보여준다', () => {
    const bids = [
      makeBid({ id: 'a', pgWsId: 'pgA', paymentFees: { card: { sole: 0.005, sme1: 0.01, general: 0.018 } } }),
    ];
    render(
      <FocusComparison {...baseProps} bids={bids} requiredPaymentMethods={['card']} buyerGrade="sme1" />,
    );
    expect(screen.getByRole('button', { name: '중소1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('1.00%').length).toBeGreaterThan(0);
    // 일반 탭은 기본 선택이 아니다
    expect(screen.getByRole('button', { name: '일반' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('구매사 등급이 없으면 일반 구간을 기본 선택한다', () => {
    const bids = [
      makeBid({ id: 'a', pgWsId: 'pgA', paymentFees: { card: { sole: 0.005, general: 0.018 } } }),
    ];
    render(<FocusComparison {...baseProps} bids={bids} requiredPaymentMethods={['card']} />);
    expect(screen.getByRole('button', { name: '일반' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('구버전 number bid는 구간 무관 동일 값', () => {
    const bids = [makeBid({ id: 'a', pgWsId: 'pgA', paymentFees: { card: 0.012 } })];
    render(<FocusComparison {...baseProps} bids={bids} requiredPaymentMethods={['card']} />);
    fireEvent.click(screen.getByRole('button', { name: '영세' }));
    expect(screen.getAllByText('1.20%').length).toBeGreaterThan(0);
  });

  it('상세 매트릭스에 활성 견적의 전 구간 카드 요율이 보인다', () => {
    const bids = [makeBid({ id: 'a', pgWsId: 'pgA', paymentFees: { card: { sole: 0.005, sme1: 0.01, sme2: 0.0125, sme3: 0.0145, general: 0.018 } } })];
    render(<FocusComparison {...baseProps} bids={bids} requiredPaymentMethods={['card']} />);
    // accordion panel은 keepMounted=false(기본)이므로 닫힌 상태에서 DOM에 없음 — 트리거 클릭으로 펼친다
    fireEvent.click(screen.getByText(/전체 결제수단 요율/));
    const matrix = screen.getByTestId('tiered-matrix-card');
    expect(matrix).toHaveTextContent('0.50%');
    expect(matrix).toHaveTextContent('1.80%');
  });
});

describe('FocusComparison · award result overlay', () => {
  beforeEach(() => {
    awardRfpAction.mockResolvedValue({ ok: true });
  });

  it('이미 선정된 RFP를 처음 열면 결과 오버레이를 띄우지 않는다', () => {
    render(
      <FocusComparison {...baseProps} rfpStatus="awarded" awardedBidId="b-toss" />,
    );
    expect(screen.queryByTestId('award-result')).not.toBeInTheDocument();
  });

  it('선정을 확정하면 결과 오버레이를 띄운다', async () => {
    const user = userEvent.setup();
    render(<FocusComparison {...baseProps} rfpStatus="sent" awardedBidId={null} />);

    await user.click(screen.getByRole('button', { name: /이 견적 선정하기/ }));
    await user.click(screen.getByRole('button', { name: '선정할게요' }));

    // 활성(기본 선정) 견적인 토스페이먼츠를 축하해야 한다 — 잘못된 bid 배선 회귀 방지.
    expect(await screen.findByText('토스페이먼츠 선정 완료')).toBeInTheDocument();
  });

  it('선정이 실패하면 결과 오버레이를 띄우지 않는다', async () => {
    const user = userEvent.setup();
    awardRfpAction.mockResolvedValue({ ok: false, error: 'ALREADY_AWARDED' });
    render(<FocusComparison {...baseProps} rfpStatus="sent" awardedBidId={null} />);

    await user.click(screen.getByRole('button', { name: /이 견적 선정하기/ }));
    await user.click(screen.getByRole('button', { name: '선정할게요' }));

    // 실패 시 인라인 에러만, 축하 오버레이는 없어야 한다.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('award-result')).not.toBeInTheDocument();
  });
});

describe('FocusComparison — requote CTA + status chips', () => {
  it('shows requote status chip and a 견적 재요청 button while sent', () => {
    const bid = makeBid({ id: 'b-oo', pgWsId: 'pg-1', round: 2, paymentFees: { card: 0.019 } });
    render(
      <FocusComparison
        bids={[bid]}
        pgWsById={wsById({ 'pg-1': 'OO페이' })}
        current={{ feeRate: null, settlementCycle: null, settlementLimit: null, guaranteeInsurance: null }}
        rfpStatus="sent"
        awardedBidId={null}
        requiredPaymentMethods={[]}
        customPaymentMethods={[]}
        rfpId="11111111-1111-1111-1111-111111111111"
        rfpCode="P-2606-0021"
        requoteByPg={{ 'pg-1': { status: 'pending', round: 2, deadline: new Date().toISOString() } }}
      />,
    );
    expect(screen.getByText(/재요청함/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /견적 재요청/ })).toBeInTheDocument();
  });

  it('shows 재제출됨 chip when status is responded', () => {
    const bid = makeBid({ id: 'b-oo', pgWsId: 'pg-1', round: 2, paymentFees: { card: 0.019 } });
    render(
      <FocusComparison
        bids={[bid]}
        pgWsById={wsById({ 'pg-1': 'OO페이' })}
        current={{ feeRate: null, settlementCycle: null, settlementLimit: null, guaranteeInsurance: null }}
        rfpStatus="sent"
        awardedBidId={null}
        requiredPaymentMethods={[]}
        customPaymentMethods={[]}
        rfpId="11111111-1111-1111-1111-111111111111"
        rfpCode="P-2606-0021"
        requoteByPg={{ 'pg-1': { status: 'responded', round: 2, deadline: new Date().toISOString() } }}
      />,
    );
    expect(screen.getByText('재제출됨')).toBeInTheDocument();
  });

  it('shows N차 chip when bid.round > 1', () => {
    const bid = makeBid({ id: 'b-oo', pgWsId: 'pg-1', round: 3, paymentFees: { card: 0.019 } });
    render(
      <FocusComparison
        bids={[bid]}
        pgWsById={wsById({ 'pg-1': 'OO페이' })}
        current={{ feeRate: null }}
        rfpStatus="sent"
        awardedBidId={null}
        requiredPaymentMethods={[]}
        customPaymentMethods={[]}
        rfpId="11111111-1111-1111-1111-111111111111"
        rfpCode="P-2606-0021"
      />,
    );
    expect(screen.getByText('3차')).toBeInTheDocument();
  });
});

// 채팅 레일 연동 — 포커스된 PG 를 chat-rail 스토어에 publish 해, 우측 레일의
// '상대방 채팅' 탭이 탭 전환을 추종하게 한다 (RSC 경계로 콜백 전달 불가).
describe('FocusComparison — 채팅 레일 상대 publish', () => {
  beforeEach(() => {
    captured = null;
  });

  it('마운트 시 기본 포커스 PG(최저 카드 수수료)를 publish 한다', () => {
    render(<FocusComparison {...baseProps} />);
    expect(captured).toEqual({
      workspaceId: 'pg-toss',
      name: '토스페이먼츠',
      type: 'pg',
      logoUpdatedAt: null,
    });
  });

  it('탭 전환 시 해당 PG 로 갱신한다', async () => {
    const user = userEvent.setup();
    render(<FocusComparison {...baseProps} />);

    await user.click(screen.getByRole('tab', { name: /KG이니시스/ }));

    expect(captured).toEqual({
      workspaceId: 'pg-kg',
      name: 'KG이니시스',
      type: 'pg',
      logoUpdatedAt: null,
    });
  });

  it('견적이 없으면 publish 하지 않는다', () => {
    render(<FocusComparison {...baseProps} bids={[]} />);
    expect(captured).toBeNull();
  });
});

describe('FocusComparison — pgWsById → BidTabStrip 로고 전달', () => {
  it('pgWsById에 값이 있으면 BidTabStrip이 WorkspaceAvatar 이미지를 렌더한다', () => {
    const logoTs = '2026-01-01T00:00:00.000Z';
    render(
      <FocusComparison
        {...baseProps}
        pgWsById={wsById({ 'pg-toss': '토스페이먼츠', 'pg-kg': 'KG이니시스' }, { 'pg-toss': logoTs })}
      />,
    );
    const expectedSrc = `/api/workspace/pg-toss/avatar?v=${Date.parse(logoTs)}`;
    const img = document.querySelector(`img[src="${expectedSrc}"]`);
    expect(img).not.toBeNull();
  });

  it('pgWsById에 로고 버전이 없으면 로고 이미지가 렌더되지 않는다', () => {
    render(<FocusComparison {...baseProps} pgWsById={wsById({ 'pg-toss': '토스페이먼츠', 'pg-kg': 'KG이니시스' })} />);
    expect(document.querySelector('img[src*="/api/workspace/"]')).toBeNull();
  });
});

describe('FocusComparison — pgWsById → CounterpartyProfileCard 로고 전달', () => {
  beforeEach(() => {
    cardSpy.lastCounterparty = null;
  });

  it('활성 PG의 logoUpdatedAt을 CounterpartyProfileCard에 전달한다', () => {
    const logoTs = '2026-01-01T00:00:00.000Z';
    render(
      <FocusComparison {...baseProps} pgWsById={wsById({ 'pg-toss': '토스페이먼츠', 'pg-kg': 'KG이니시스' }, { 'pg-toss': logoTs })} />,
    );
    // 기본 활성 = 최저 카드수수료(토스, pg-toss)
    expect(cardSpy.lastCounterparty).toMatchObject({
      workspaceId: 'pg-toss',
      logoUpdatedAt: logoTs,
    });
  });

  it('로고가 없는 활성 PG에는 logoUpdatedAt=null을 전달한다', () => {
    render(<FocusComparison {...baseProps} pgWsById={wsById({ 'pg-toss': '토스페이먼츠', 'pg-kg': 'KG이니시스' })} />);
    expect(cardSpy.lastCounterparty).toMatchObject({
      workspaceId: 'pg-toss',
      logoUpdatedAt: null,
    });
  });
});
