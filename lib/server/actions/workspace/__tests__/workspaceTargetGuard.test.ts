import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionRef, getWorkspaceService } = vi.hoisted(() => ({
  sessionRef: {
    value: {
      user: {
        id: 'operator-1',
        workspaceId: 'active-workspace',
      },
    },
  },
  getWorkspaceService: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: () => Promise.resolve(sessionRef.value),
}));
vi.mock('@/lib/server/services/workspace', () => ({ getWorkspaceService }));

import { cancelWorkspaceInviteAction } from '../cancelWorkspaceInviteAction';
import { changeWorkspaceMemberRoleAction } from '../changeWorkspaceMemberRoleAction';
import { inviteWorkspaceMemberAction } from '../inviteWorkspaceMemberAction';
import { removeWorkspaceMemberAction } from '../removeWorkspaceMemberAction';
import { resendWorkspaceInviteAction } from '../resendWorkspaceInviteAction';

const staleWorkspaceCases = [
  {
    name: 'invite',
    run: () =>
      inviteWorkspaceMemberAction({
        workspaceId: 'stale-workspace',
        email: 'invitee@example.com',
      }),
  },
  {
    name: 'resend',
    run: () =>
      resendWorkspaceInviteAction({
        workspaceId: 'stale-workspace',
        email: 'invitee@example.com',
      }),
  },
  {
    name: 'cancel',
    run: () =>
      cancelWorkspaceInviteAction({
        workspaceId: 'stale-workspace',
        email: 'invitee@example.com',
      }),
  },
  {
    name: 'change role',
    run: () =>
      changeWorkspaceMemberRoleAction({
        workspaceId: 'stale-workspace',
        userId: 'member-1',
        role: 'admin',
      }),
  },
  {
    name: 'remove',
    run: () =>
      removeWorkspaceMemberAction({
        workspaceId: 'stale-workspace',
        userId: 'member-1',
      }),
  },
] as const;

describe('workspace member action target guard', () => {
  beforeEach(() => {
    getWorkspaceService.mockReset();
  });

  it.each(staleWorkspaceCases)('$name rejects a stale workspace before loading the service', async ({ run }) => {
    await expect(run()).resolves.toEqual({ ok: false, error: 'WORKSPACE_CHANGED' });
    expect(getWorkspaceService).not.toHaveBeenCalled();
  });
});
