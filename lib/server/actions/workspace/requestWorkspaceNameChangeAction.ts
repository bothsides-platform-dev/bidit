'use server';

import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { getWorkspaceService } from '@/lib/server/services/workspace';
import type { ActionResult } from '@/lib/server/actions/_result';

const Input = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export type RequestWorkspaceNameChangeResult = ActionResult;

export async function requestWorkspaceNameChangeAction(input: { name: string }): Promise<RequestWorkspaceNameChangeResult> {
  const session = await requireSession().catch(() => null);
  if (!session?.user?.workspaceId) return { ok: false, error: 'FORBIDDEN' };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };
  const result = await (await getWorkspaceService()).requestNameChange(
    { userId: session.user.id, workspaceId: session.user.workspaceId },
    parsed.data.name,
  );
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error: result.error === 'FORBIDDEN_NOT_ADMIN' ? 'FORBIDDEN' : result.error,
  };
}
