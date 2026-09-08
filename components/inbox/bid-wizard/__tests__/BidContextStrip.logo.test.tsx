// BidContextStrip — 견적 작성 위저드 상단 띠. 구매사 아바타가 로고를 실제로 그리는지
// CounterpartyProfileCard 를 mock 하지 않고 <img> 까지 확인한다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { PaymentMethod } from '@/lib/types/bid';

vi.mock('../../RfpBriefPanel', () => ({
  RfpBriefPanel: () => <div data-testid="brief">brief</div>,
}));

import { BidContextStrip } from '../BidContextStrip';

afterEach(cleanup);

const rfp = { buyerWsId: 'ws-buyer', requiredPaymentMethods: ['card'] as PaymentMethod[] } as never;
const LOGO_AT = '2026-04-05T06:07:08.000Z';

describe('BidContextStrip — 구매사 로고', () => {
  it('구매사에 로고가 있으면 로고 이미지를 그린다', () => {
    render(
      <BidContextStrip
        buyer={{ id: 'ws-buyer', name: '토스페이먼츠', type: 'buyer', logoUpdatedAt: LOGO_AT }}
        rfp={rfp}
        currentStep={1}
        feeInputMethods={['card']}
      />,
    );
    const src = `/api/workspace/ws-buyer/avatar?v=${Date.parse(LOGO_AT)}`;
    expect(document.querySelector(`img[src="${src}"]`)).not.toBeNull();
  });

  it('구매사에 로고가 없으면 로고 이미지를 그리지 않는다', () => {
    render(
      <BidContextStrip
        buyer={{ id: 'ws-buyer', name: '토스페이먼츠', type: 'buyer', logoUpdatedAt: null }}
        rfp={rfp}
        currentStep={1}
        feeInputMethods={['card']}
      />,
    );
    expect(document.querySelector('img[src*="/api/workspace/"]')).toBeNull();
  });
});
