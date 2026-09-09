'use server';

import { requireSession } from '@/lib/auth/session';
import { getWorkspaceService } from '@/lib/server/services/workspace';
import type { ActionResult } from '@/lib/server/actions/_result';

export type ResendWorkspaceInviteResult = ActionResult;

/**
 * Approved workspace admins and configured operators can resend a pending invitation.
 * Rotates the invitation token (old link is immediately invalidated).
 */
export async function resendWorkspaceInviteAction(input: {
  workspaceId: string;
  email: string;
}): Promise<ResendWorkspaceInviteResult> {
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
  return service.resendInvite({ email: input.email }, actor);
}
