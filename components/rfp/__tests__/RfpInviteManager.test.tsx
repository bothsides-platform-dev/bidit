import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// hoisted 핸들 — vi.mock 팩토리에서 안전하게 참조하려면 vi.hoisted 사용.
const { useLazyPgWorkspacesMock, addPgWorkspacesToRfpActionMock, removeDraftPgWorkspaceActionMock, sendDraftInvitationsActionMock, toastMock } = vi.hoisted(() => ({
  useLazyPgWorkspacesMock: vi.fn(),
  addPgWorkspacesToRfpActionMock: vi.fn(),
  removeDraftPgWorkspaceActionMock: vi.fn(),
  sendDraftInvitationsActionMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/hooks/useLazyPgWorkspaces', () => ({
  useLazyPgWorkspaces: () => useLazyPgWorkspacesMock(),
}));
vi.mock('@/lib/toast', () => ({ toast: toastMock }));
vi.mock('@/lib/server/actions/rfp', () => ({
  addPgWorkspacesToRfpAction: addPgWorkspacesToRfpActionMock,
  removeDraftPgWorkspaceAction: removeDraftPgWorkspaceActionMock,
  sendDraftInvitationsAction: sendDraftInvitationsActionMock,
}));

import { RfpInviteManager } from '../RfpInviteManager';

const PG_A = { id: 'pg-a', name: 'KG이니시스', displayName: 'KG이니시스', logoUpdatedAt: null };
const PG_B = { id: 'pg-b', name: 'NHN KCP', displayName: 'NHN KCP', logoUpdatedAt: null };

function mockHook(over: Partial<{ pgList: typeof PG_A[]; loading: boolean; error: string | null }> = {}) {
  useLazyPgWorkspacesMock.mockReturnValue({
    pgList: over.pgList ?? [],
    loading: over.loading ?? false,
    error: over.error ?? null,
    load: vi.fn(),
  });
}

beforeEach(() => {
  useLazyPgWorkspacesMock.mockReset();
  addPgWorkspacesToRfpActionMock.mockReset();
  removeDraftPgWorkspaceActionMock.mockReset();
  sendDraftInvitationsActionMock.mockReset();
  toastMock.mockReset();
  addPgWorkspacesToRfpActionMock.mockResolvedValue({ ok: true });
  removeDraftPgWorkspaceActionMock.mockResolvedValue({ ok: true });
  sendDraftInvitationsActionMock.mockResolvedValue({ ok: true, sentCount: 1 });
});
afterEach(cleanup);

describe('RfpInviteManager — 인라인 칩 추가', () => {
  it('공유 링크 섹션은 노출되지 않는다', () => {
    mockHook({ pgList: [PG_A, PG_B] });
    render(<RfpInviteManager rfpId="rfp-1" invitations={[]} canEdit />);
    expect(screen.queryByText('공유 링크')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '복사' })).not.toBeInTheDocument();
  });

  it('추가 가능한 PG를 칩 버튼으로 렌더한다', () => {
    mockHook({ pgList: [PG_A, PG_B] });
    render(<RfpInviteManager rfpId="rfp-1" invitations={[]} canEdit />);
    expect(screen.getByRole('button', { name: 'KG이니시스' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NHN KCP' })).toBeInTheDocument();
  });

  it('이미 초대된 PG는 칩 버튼으로 렌더하지 않는다', () => {
    mockHook({ pgList: [PG_A, PG_B] });
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[{ ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: null }, status: 'draft' }]}
        canEdit
      />,
    );
    expect(screen.queryByRole('button', { name: 'KG이니시스' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NHN KCP' })).toBeInTheDocument();
  });

  it('칩 클릭 시 addPgWorkspacesToRfpAction을 해당 wsId로 호출한다', async () => {
    mockHook({ pgList: [PG_A, PG_B] });
    render(<RfpInviteManager rfpId="rfp-1" invitations={[]} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'NHN KCP' }));
    await waitFor(() =>
      expect(addPgWorkspacesToRfpActionMock).toHaveBeenCalledWith({
        rfpId: 'rfp-1',
        workspaceIds: ['pg-b'],
      }),
    );
  });

  it('목록이 비어있으면 불러오는 중 안내를 보여준다', () => {
    mockHook({ pgList: [], loading: true });
    render(<RfpInviteManager rfpId="rfp-1" invitations={[]} canEdit />);
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
  });

  it('모든 PG가 이미 초대되면 빈 안내를 보여준다', () => {
    mockHook({ pgList: [PG_A] });
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[{ ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: null }, status: 'draft' }]}
        canEdit
      />,
    );
    expect(screen.getByText('모든 PG를 이미 추가했어요.')).toBeInTheDocument();
  });

  it('에러 시 에러 문구를 보여준다', () => {
    mockHook({ error: '불러오기 실패. 다시 시도해주세요.' });
    render(<RfpInviteManager rfpId="rfp-1" invitations={[]} canEdit />);
    expect(screen.getByText('불러오기 실패. 다시 시도해주세요.')).toBeInTheDocument();
  });

  it('대기중 PG에만 선택 취소 버튼을 보여준다', () => {
    mockHook({ pgList: [PG_A, PG_B] });
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[
          { ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: null }, status: 'draft' },
          { ws: { id: 'pg-b', name: 'NHN KCP', type: 'pg', logoUpdatedAt: null }, status: 'sent' },
        ]}
        canEdit
      />,
    );
    expect(screen.getByRole('button', { name: 'KG이니시스 선택 취소' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NHN KCP 선택 취소' })).not.toBeInTheDocument();
  });

  it('선택 취소 버튼은 draft PG를 제거하는 액션을 호출한다', async () => {
    mockHook({ pgList: [PG_A] });
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[{ ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: null }, status: 'draft' }]}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'KG이니시스 선택 취소' }));
    await waitFor(() =>
      expect(removeDraftPgWorkspaceActionMock).toHaveBeenCalledWith({
        rfpId: 'rfp-1',
        workspaceId: 'pg-a',
      }),
    );
  });

  it('canEdit=false면 추가 영역을 렌더하지 않는다', () => {
    mockHook({ pgList: [PG_A, PG_B] });
    render(<RfpInviteManager rfpId="rfp-1" invitations={[]} canEdit={false} />);
    expect(screen.queryByText('PG 워크스페이스 추가')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'KG이니시스' })).not.toBeInTheDocument();
  });

  it('발송 액션이 예외를 던져도 발송 버튼이 계속 잠기지 않는다', async () => {
    mockHook({ pgList: [PG_A] });
    sendDraftInvitationsActionMock.mockRejectedValueOnce(new Error('network'));
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[{ ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: null }, status: 'draft' }]}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '1개 PG에 초대 보내기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '1개 PG에 초대 보내기' })).toBeEnabled());
  });

  it('선택 취소 액션이 실패하면 오류 토스트를 보여준다', async () => {
    mockHook({ pgList: [PG_A] });
    removeDraftPgWorkspaceActionMock.mockResolvedValueOnce({ ok: false, error: 'INVITATION_NOT_DRAFT' });
    render(
      <RfpInviteManager
        rfpId="rfp-1"
        invitations={[{ ws: { id: 'pg-a', name: 'KG이니시스', type: 'pg', logoUpdatedAt: null }, status: 'draft' }]}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'KG이니시스 선택 취소' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      '선택을 취소하지 못했어요 — INVITATION_NOT_DRAFT',
      { type: 'error' },
    ));
  });
});
