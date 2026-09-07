import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { FocusComparison } from '../FocusComparison';
import { DealRoomProvider } from '@/components/deal-room/DealRoomContext';
import type { Bid } from '@/lib/types/bid';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
// pgWsId → 표시 신원. 이름 맵과 로고 맵을 나누지 않는다 — 둘 중 하나만 배선되는 사고가
// 딜룸 로고 누락의 원인이었다.
const wsById = (
  names: Record<string, string>,
  logos: Record<string, string | null> = {},
): Record<string, WorkspaceDisplay> =>
  Object.fromEntries(
    Object.entries(names).map(([id, name]) => [
      id,
      { id, name, type: 'pg' as const, logoUpdatedAt: logos[id] ?? null },
    ]),
  );


// FocusComparison 은 DealRoomProvider 안에서 동작한다(포커스 PG publish).
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: DealRoomProvider });

vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));
const awardRfpAction = vi.fn();
vi.mock('@/lib/server/actions/rfp', () => ({ awardRfpAction: (...a: unknown[]) => awardRfpAction(...a) }));
vi.mock('@/components/rfp/comparison/AwardResult', () => ({
  AwardResult: ({ pgName }: { pgName: string }) => (
    <div data-testid="award-result">{pgName} 선정 완료</div>
  ),
}));

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollIntoView ??= () => {};
});

function bid(id: string, pgWsId: string): Bid {
  return {
    id, rfpId: 'r1', pgWsId, invitationId: 'i1', round: 1,
    settleCycle: 'D+1', settleLimit: 50000000, guaranteeInsurance: 0, signupFee: 0,
    paymentFees: { card: 0.018 }, customFees: {}, proposalPdfs: [],
    status: 'submitted', submittedBy: 'u1',
  };
}

const baseProps = {
  bids: [bid('b1', 'pgA'), bid('b2', 'pgB')],
  pgWsById: wsById({ pgA: '샘플페이 A', pgB: '샘플페이 B' }),
  current: {},
  awardedBidId: null,
  requiredPaymentMethods: ['card'] as const,
  customPaymentMethods: [],
  rfpId: 'r1',
  rfpCode: 'P-2606-0001',
};

describe('FocusComparison onSampleAward (가상 샘플 온보딩 — 가짜 선정)', () => {
  it('onSampleAward가 주어지면 선정 CTA가 활성화된다', () => {
    render(<FocusComparison {...baseProps} rfpStatus="sent" onSampleAward={vi.fn()} />);
    expect(screen.getByText('이 견적 선정하기 →')).toBeInTheDocument();
  });

  it('선정 CTA 클릭 시 실제 awardRfpAction 대신 onSampleAward(bidId)를 호출한다', async () => {
    const user = userEvent.setup();
    const onSampleAward = vi.fn();
    render(<FocusComparison {...baseProps} rfpStatus="sent" onSampleAward={onSampleAward} />);
    await user.click(screen.getByText('이 견적 선정하기 →'));
    expect(onSampleAward).toHaveBeenCalledWith('b1');
    expect(awardRfpAction).not.toHaveBeenCalled();
    // 실제 확인 다이얼로그(AwardConfirmDialog)는 열리지 않는다.
    expect(screen.queryByTestId('award-result')).not.toBeInTheDocument();
  });

  it('onSampleAward가 없으면 기존처럼 견적 재요청 버튼도 함께 보인다', () => {
    render(<FocusComparison {...baseProps} rfpStatus="sent" />);
    expect(screen.getByText('견적 재요청')).toBeInTheDocument();
  });

  it('onSampleAward가 있으면 견적 재요청 버튼은 숨긴다', () => {
    render(<FocusComparison {...baseProps} rfpStatus="sent" onSampleAward={vi.fn()} />);
    expect(screen.queryByText('견적 재요청')).not.toBeInTheDocument();
  });

  it('onSampleAward가 있으면 라이브 메시지 CTA를 노출하지 않는다 (fixture ID 실 액션 차단)', () => {
    render(<FocusComparison {...baseProps} rfpStatus="sent" onSampleAward={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /메시지/ })).not.toBeInTheDocument();
  });
});
