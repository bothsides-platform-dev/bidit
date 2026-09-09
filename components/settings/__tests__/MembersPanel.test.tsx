import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@/lib/types/user';

const toast = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: (...a: unknown[]) => toast(...a) }));

// MemberRow avatars now render as UserProfileCard triggers — pulls in (at import)
// getUserProfileAction + MessageComposeSheet's 'use server' chain (next-auth/DB,
// jsdom-unsafe) and useUserPresence. Mock them all so the panel collects/renders.
vi.mock('@/lib/server/actions/user/getUserProfileAction', () => ({
  getUserProfileAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/chat/sendChatMessageAction', () => ({
  sendChatMessageAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/chat/listTemplatesAction', () => ({
  listTemplatesAction: vi.fn().mockResolvedValue({ ok: true, templates: [] }),
}));
vi.mock('@/lib/server/actions/chat/saveTemplateAction', () => ({
  saveTemplateAction: vi.fn(),
}));
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));
vi.mock('@/components/presence/WorkspacePresenceProvider', () => ({
  useUserPresence: () => false,
}));

const inviteWorkspaceMemberAction = vi.fn();
vi.mock('@/lib/server/actions/workspace/inviteWorkspaceMemberAction', () => ({
  inviteWorkspaceMemberAction: (...a: unknown[]) =>
    inviteWorkspaceMemberAction(...a),
}));

const removeWorkspaceMemberAction = vi.fn();
vi.mock('@/lib/server/actions/workspace/removeWorkspaceMemberAction', () => ({
  removeWorkspaceMemberAction: (...a: unknown[]) =>
    removeWorkspaceMemberAction(...a),
}));

const changeWorkspaceMemberRoleAction = vi.fn();
vi.mock(
  '@/lib/server/actions/workspace/changeWorkspaceMemberRoleAction',
  () => ({
    changeWorkspaceMemberRoleAction: (...a: unknown[]) =>
      changeWorkspaceMemberRoleAction(...a),
  }),
);

const cancelWorkspaceInviteAction = vi.fn();
vi.mock('@/lib/server/actions/workspace/cancelWorkspaceInviteAction', () => ({
  cancelWorkspaceInviteAction: (...a: unknown[]) =>
    cancelWorkspaceInviteAction(...a),
}));

const resendWorkspaceInviteAction = vi.fn();
vi.mock('@/lib/server/actions/workspace/resendWorkspaceInviteAction', () => ({
  resendWorkspaceInviteAction: (...a: unknown[]) =>
    resendWorkspaceInviteAction(...a),
}));

import { MembersPanel } from '../MembersPanel';

const ADMIN: User = {
  id: 'u-admin',
  name: '관리자',
  email: 'admin@example.com',
  avatarColor: 'ink',
  avatarUpdatedAt: null,
  role: 'admin',
  status: 'active',
  emailVerified: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
};
const MEMBER: User = {
  id: 'u-member',
  name: '멤버',
  email: 'member@example.com',
  avatarColor: 'ink',
  avatarUpdatedAt: null,
  role: 'member',
  status: 'active',
  emailVerified: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
};

const baseProps = {
  workspaceId: 'workspace-1',
  workspaceName: '서포터 B 페이',
  initialMembers: [ADMIN, MEMBER],
  initialPendingInvites: [],
  currentUserId: ADMIN.id,
};

beforeEach(() => {
  toast.mockReset();
  inviteWorkspaceMemberAction.mockReset();
  removeWorkspaceMemberAction.mockReset();
  changeWorkspaceMemberRoleAction.mockReset();
});

describe('MembersPanel', () => {
  it('never renders the public share link section', () => {
    render(<MembersPanel {...baseProps} userRole="admin" />);
    expect(
      screen.queryByRole('button', { name: '재발급' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '복사' })).not.toBeInTheDocument();
  });

  it('admin: invite sends the selected role', async () => {
    inviteWorkspaceMemberAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);

    await user.type(
      screen.getByPlaceholderText('member@company.com'),
      'new@example.com',
    );
    // 역할 select — Label이 span으로 렌더되므로 role=combobox 로 찾는다
    await user.selectOptions(screen.getByRole('combobox'), 'admin');
    await user.click(screen.getByRole('button', { name: '초대 보내기' }));

    await waitFor(() =>
      expect(inviteWorkspaceMemberAction).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        email: 'new@example.com',
        role: 'admin',
      }),
    );
  });

  it('워크스페이스가 전환된 뒤 초대하면 새로고침 안내를 보여준다', async () => {
    inviteWorkspaceMemberAction.mockResolvedValue({
      ok: false,
      error: 'WORKSPACE_CHANGED',
    });
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);

    await user.type(screen.getByPlaceholderText('member@company.com'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: '초대 보내기' }));

    expect(
      await screen.findByText('다른 워크스페이스로 전환됐어요. 새로고침 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
  });

  it('admin: kicks a member via dropdown and drops the row', async () => {
    removeWorkspaceMemberAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);

    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    // 멤버 관리 드롭다운 트리거
    await user.click(screen.getByRole('button', { name: '멤버 관리' }));
    // 메뉴 항목 '내보내기' 클릭 → ConfirmDialog 열림
    await user.click(await screen.findByRole('menuitem', { name: '내보내기' }));
    // ConfirmDialog 확인 버튼
    await user.click(await screen.findByRole('button', { name: '내보내기' }));

    await waitFor(() =>
      expect(removeWorkspaceMemberAction).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        userId: MEMBER.id,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('member@example.com')).not.toBeInTheDocument(),
    );
  });

  it('admin: 자신에 대한 내보내기/역할변경 메뉴 항목은 disabled', async () => {
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);
    // 트리거 자체는 enabled (isMutating=false), 항목만 disabled
    await user.click(screen.getByRole('button', { name: '관리자 관리' }));
    const kickItem = await screen.findByRole('menuitem', { name: '내보내기' });
    expect(kickItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('admin: changing a role via dropdown calls the action', async () => {
    changeWorkspaceMemberRoleAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);

    // 멤버 관리 드롭다운 트리거 클릭 → 역할 변경 메뉴 항목 클릭
    await user.click(screen.getByRole('button', { name: '멤버 관리' }));
    await user.click(await screen.findByRole('menuitem', { name: /관리자.*변경/ }));

    await waitFor(() =>
      expect(changeWorkspaceMemberRoleAction).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        userId: MEMBER.id,
        role: 'admin',
      }),
    );
  });

  it('member: shows no kick buttons or role controls', () => {
    render(<MembersPanel {...baseProps} userRole="member" />);
    expect(screen.queryByRole('button', { name: /강퇴/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('멤버 역할 변경')).not.toBeInTheDocument();
  });

  it('admin: 역할 변경 드롭다운 메뉴 항목에 괄호 없는 조사가 표시된다', async () => {
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);

    await user.click(screen.getByRole('button', { name: '멤버 관리' }));
    const menuItem = await screen.findByRole('menuitem', { name: '관리자로 변경' });
    expect(menuItem).toBeInTheDocument();
    // 괄호 표기 미사용 검증
    expect(screen.queryByText(/관리자\(으로\)/)).not.toBeInTheDocument();
  });

  it('admin: 역할 변경 성공 시 toast에 괄호 없는 조사가 사용된다', async () => {
    changeWorkspaceMemberRoleAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MembersPanel {...baseProps} userRole="admin" />);

    await user.click(screen.getByRole('button', { name: '멤버 관리' }));
    await user.click(await screen.findByRole('menuitem', { name: /관리자.*변경/ }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('관리자로 변경했어요'),
      ),
    );
  });
});
