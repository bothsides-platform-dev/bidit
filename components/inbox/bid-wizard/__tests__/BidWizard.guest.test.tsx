import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaymentMethod } from '@/lib/types/bid';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('use http client')));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const submitBidMock = vi.fn(async (_i: unknown) => ({ ok: true as const, bidId: 'b1' }));
vi.mock('@/lib/server/actions/bid', () => ({
  submitBidAction: (i: unknown) => submitBidMock(i),
}));

vi.mock('@/lib/server/actions/quote-template/saveQuoteTemplateAction', () => ({
  saveQuoteTemplateAction: vi.fn(async () => ({ ok: true as const, templateId: 't1' })),
}));
vi.mock('../../RfpBriefPanel', () => ({ RfpBriefPanel: () => <div /> }));
vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));
const { fireMock } = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), { reset: vi.fn() });
  return { fireMock: fn };
});
vi.mock('canvas-confetti', () => ({
  default: Object.assign(vi.fn(), { create: vi.fn(() => fireMock), reset: vi.fn() }),
}));
vi.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, style, className }: Record<string, unknown>) => (
          <div style={style as React.CSSProperties} className={className as string}>
            {children as React.ReactNode}
          </div>
        ),
    },
  ),
}));

import { BidWizard } from '../BidWizard';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
// 구매사 신원 fixture — 아바타를 그리는 화면은 이름 문자열이 아니라 이 객체를 받는다.
const buyerOf = (name: string): WorkspaceDisplay => ({
  id: 'ws-buyer',
  name,
  type: 'buyer',
  logoUpdatedAt: null,
});


const rfp = {
  id: 'rfp-uuid',
  code: 'P-2606-0001',
  requiredPaymentMethods: ['card'] as PaymentMethod[],
  customPaymentMethods: [],
} as never;

beforeEach(() => {
  localStorage.clear();
  submitBidMock.mockClear();
});
afterEach(cleanup);

async function driveToSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(screen.getByPlaceholderText('1'));
  await user.type(screen.getByPlaceholderText('1'), '1');
  await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
  await user.click(screen.getByRole('button', { name: '수수료' }));
  await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
  await user.click(screen.getByRole('button', { name: '견적서' }));
  await user.click(screen.getByRole('button', { name: '검토·발송' }));
  await user.click(screen.getByRole('button', { name: '견적 보내기' }));
  await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));
}

describe('BidWizard 게스트(랜딩 데모) 제출', () => {
  it('onGuestSubmit 이 있으면 서버 제출 액션 대신 콜백을 호출한다', async () => {
    const onGuest = vi.fn();
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('데모 쇼핑몰')} onGuestSubmit={onGuest} />);
    await driveToSubmit(user);

    await waitFor(() => expect(onGuest).toHaveBeenCalledTimes(1));
    expect(submitBidMock).not.toHaveBeenCalled();
  });
});
