'use server';

import { requireSession } from '@/lib/auth/session';
import { getWorkspaceService } from '@/lib/server/services/workspace';
import type { ActionResult } from '@/lib/server/actions/_result';

export type CancelWorkspaceInviteResult = ActionResult;

/**
 * Approved workspace admins and configured operators can cancel a pending invitation.
 * Sets the invitation status to 'expired' (preserving audit trail).
 */
export async function cancelWorkspaceInviteAction(input: {
  workspaceId: string;
  email: string;
}): Promise<CancelWorkspaceInviteResult> {
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
  return service.cancelInvite({ email: input.email }, actor);
}
