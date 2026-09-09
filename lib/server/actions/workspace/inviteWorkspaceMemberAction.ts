'use server';

import { requireSession } from '@/lib/auth/session';
import { getWorkspaceService } from '@/lib/server/services/workspace';
import type { ActionResult } from '@/lib/server/actions/_result';

export type InviteWorkspaceMemberResult = ActionResult;

/**
 * Admin-only: invite an external user to the current workspace by email.
 */
export async function inviteWorkspaceMemberAction(input: {
  workspaceId: string;
  email: string;
  role?: 'admin' | 'member';
}): Promise<InviteWorkspaceMemberResult> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: 'UNAUTHENTICATED' };
  }

  if (!session.user.workspaceId) return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
  if (input.workspaceId !== session.user.workspaceId) {
    return { ok: false, error: 'WORKSPACE_CHANGED' };
  }

  const actor = { userId: session.user.id, workspaceId: session.user.workspaceId };
  const service = await getWorkspaceService();
  return service.inviteMember({ email: input.email, role: input.role ?? 'member' }, actor);
}
