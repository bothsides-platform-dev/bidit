// RfpBriefPanel — PG 딜룸 좌측 브리프. 구매사 아바타가 로고를 실제로 그리는지
// CounterpartyProfileCard 를 mock 하지 않고 <img> 까지 확인한다. 이 화면은 구매사 신원을
// 이름 문자열로만 받아 로고를 통째로 흘리고 있었다.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/components/attachments/AttachmentPreviewList', () => ({
  AttachmentPreviewList: () => null,
}));

import { RfpBriefPanel } from '../RfpBriefPanel';
import type { RFP } from '@/lib/types/rfp';

const rfp: RFP = {
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

const LOGO_AT = '2026-03-04T05:06:07.000Z';

afterEach(cleanup);

describe('RfpBriefPanel — 구매사 로고', () => {
  it('구매사에 로고가 있으면 로고 이미지를 그린다', () => {
    render(
      <RfpBriefPanel
        rfp={rfp}
        buyer={{ id: 'ws-buyer', name: '(주)진짜상사', type: 'buyer', logoUpdatedAt: LOGO_AT }}
      />,
    );
    const src = `/api/workspace/ws-buyer/avatar?v=${Date.parse(LOGO_AT)}`;
    expect(document.querySelector(`img[src="${src}"]`)).not.toBeNull();
  });

  it('구매사에 로고가 없으면 로고 이미지를 그리지 않는다', () => {
    render(
      <RfpBriefPanel
        rfp={rfp}
        buyer={{ id: 'ws-buyer', name: '(주)진짜상사', type: 'buyer', logoUpdatedAt: null }}
      />,
    );
    expect(document.querySelector('img[src*="/api/workspace/"]')).toBeNull();
  });
});
