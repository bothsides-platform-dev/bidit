// 참여 요청(콜드 피치) 목록이 PG 로고를 실제로 그리는지 — CounterpartyProfileCard 를 mock 하지
// 않고 <img> 까지 확인한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/server/actions/rfp', () => ({
  acceptPgRequestAction: vi.fn(),
  rejectPgRequestAction: vi.fn(),
}));

import { RfpPendingRequests } from '../RfpPendingRequests';

const LOGO_AT = '2026-02-03T04:05:06.000Z';

afterEach(cleanup);

describe('RfpPendingRequests — PG 로고', () => {
  it('로고가 있는 요청 PG는 로고 이미지를 그린다', () => {
    render(
      <RfpPendingRequests
        canEdit
        requests={[
          {
            id: 'req-1',
            pgWs: { id: 'ws-toss', name: '토스페이먼츠', type: 'pg', logoUpdatedAt: LOGO_AT },
            message: '제안 드리고 싶어요',
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    const src = `/api/workspace/ws-toss/avatar?v=${Date.parse(LOGO_AT)}`;
    expect(document.querySelector(`img[src="${src}"]`)).not.toBeNull();
  });

  it('로고가 없는 요청 PG는 로고 이미지를 그리지 않는다', () => {
    render(
      <RfpPendingRequests
        canEdit
        requests={[
          {
            id: 'req-1',
            pgWs: { id: 'ws-toss', name: '토스페이먼츠', type: 'pg', logoUpdatedAt: null },
            message: '제안 드리고 싶어요',
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(document.querySelector('img[src*="/api/workspace/"]')).toBeNull();
  });
});
