'use server';

import { requireSession } from '@/lib/auth/session';
import { getWorkspaceService } from '@/lib/server/services/workspace';
import type { ActionResult } from '@/lib/server/actions/_result';

export type ChangeWorkspaceMemberRoleResult = ActionResult;

const ROLES = ['admin', 'member'] as const;

/**
 * Approved workspace admins and configured operators can change an existing member's role.
 * Authorization uses the caller's live DB membership or DB email plus the server allowlist.
 */
export async function changeWorkspaceMemberRoleAction(input: {
  workspaceId: string;
  userId: string;
  role: 'admin' | 'member';
}): Promise<ChangeWorkspaceMemberRoleResult> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: 'UNAUTHENTICATED' };
  }

  const workspaceId = session.user.workspaceId;
  if (!workspaceId) return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
  if (input.workspaceId !== workspaceId) return { ok: false, error: 'WORKSPACE_CHANGED' };

  if (!ROLES.includes(input.role)) return { ok: false, error: 'INVALID_INPUT' };

  const actor = { userId: session.user.id, workspaceId };
  const service = await getWorkspaceService();
  return service.changeMemberRole({ targetUserId: input.userId, role: input.role }, actor);
}
