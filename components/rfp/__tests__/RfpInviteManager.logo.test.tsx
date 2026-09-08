// 초대 PG 목록이 워크스페이스 로고를 실제로 그리는지 — CounterpartyProfileCard 를 mock 하지
// 않고 <img> 까지 확인한다. 이 경로는 로고 버전을 아예 전달하지 않아 실제 로고 유무와 무관하게
// 항상 이니셜로 폴백하던 회귀의 재현 테스트다.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const { useLazyPgWorkspacesMock } = vi.hoisted(() => ({ useLazyPgWorkspacesMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/hooks/useLazyPgWorkspaces', () => ({
  useLazyPgWorkspaces: () => useLazyPgWorkspacesMock(),
}));
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/server/actions/rfp', () => ({
  addPgWorkspacesToRfpAction: vi.fn(),
  removeDraftPgWorkspaceAction: vi.fn(),
  sendDraftInvitationsAction: vi.fn(),
}));

import { RfpInviteManager } from '../RfpInviteManager';

const LOGO_AT = '2026-01-02T03:04:05.000Z';

beforeEach(() => {
  useLazyPgWorkspacesMock.mockReturnValue({ pgList: [], loading: false, error: null, load: vi.fn() });
});
afterEach(cleanup);

describe('RfpInviteManager — 초대 PG 로고', () => {
  it('로고가 있는 초대 PG는 이니셜이 아니라 로고 이미지를 그린다', () => {
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[
          {
            ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: LOGO_AT },
            status: 'sent',
          },
        ]}
        canEdit={false}
      />,
    );
    const src = `/api/workspace/pg-a/avatar?v=${Date.parse(LOGO_AT)}`;
    expect(document.querySelector(`img[src="${src}"]`)).not.toBeNull();
  });

  it('로고가 없는 초대 PG는 로고 이미지를 그리지 않는다', () => {
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[
          { ws: { id: 'pg-b', name: 'NHN KCP', type: 'pg', logoUpdatedAt: null }, status: 'sent' },
        ]}
        canEdit={false}
      />,
    );
    expect(document.querySelector('img[src*="/api/workspace/"]')).toBeNull();
  });
});
