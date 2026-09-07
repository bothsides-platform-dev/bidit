import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaymentMethod } from '@/lib/types/bid';

vi.mock('../../RfpBriefPanel', () => ({
  RfpBriefPanel: () => <div data-testid="brief">brief</div>,
}));
vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));

import { BidContextStrip } from '../BidContextStrip';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
// 구매사 신원 fixture — 아바타를 그리는 화면은 이름 문자열이 아니라 이 객체를 받는다.
const buyerOf = (name: string): WorkspaceDisplay => ({
  id: 'ws-buyer',
  name,
  type: 'buyer',
  logoUpdatedAt: null,
});


afterEach(cleanup);

// 최소 rfp shape — strip은 buyerName/payment만 직접 쓰고 나머지는 RfpBriefPanel(mock)로 전달
const rfp = { requiredPaymentMethods: ['card', 'bank_transfer'] as PaymentMethod[] } as never;

describe('BidContextStrip', () => {
  it('구매사명을 항상 보여준다', () => {
    render(<BidContextStrip buyer={buyerOf('토스페이먼츠')} rfp={rfp} currentStep={1} feeInputMethods={['card', 'bank_transfer']} />);
    expect(screen.getByText(/토스페이먼츠/)).toBeInTheDocument();
  });

  it('2단계에서 요청 결제수단 라벨을 strip에 노출', () => {
    render(<BidContextStrip buyer={buyerOf('토스페이먼츠')} rfp={rfp} currentStep={2} feeInputMethods={['card', 'bank_transfer']} />);
    expect(screen.getByText(/카드/)).toBeInTheDocument();
    expect(screen.getByText(/계좌이체/)).toBeInTheDocument();
  });

  it("'요청 전문' 토글 전에는 RfpBriefPanel이 숨겨져 있다", async () => {
    const user = userEvent.setup();
    render(<BidContextStrip buyer={buyerOf('토스페이먼츠')} rfp={rfp} currentStep={1} feeInputMethods={['card']} />);
    expect(screen.queryByTestId('brief')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /요청 전문/ }));
    expect(screen.getByTestId('brief')).toBeInTheDocument();
  });
});
