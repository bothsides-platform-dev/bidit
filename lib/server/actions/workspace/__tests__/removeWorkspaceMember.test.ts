// removeWorkspaceMemberAction tests.
//
// Coverage:
//   - UNAUTHENTICATED when no session
//   - FORBIDDEN_NOT_ADMIN when caller's current DB role is not admin
//   - FORBIDDEN_NOT_ADMIN when JWT says admin but DB role is member (stale token)
//   - SELF_REMOVAL when an admin targets themselves
//   - MEMBER_NOT_FOUND when target is not a member of the workspace
//   - success: removes a plain member
//   - success: an admin can remove another admin (workspace keeps an admin)
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { type PgliteDB } from '@/lib/db/client-pglite';
import {
  seedPgWorkspace,
  seedUser,
  seedMembership,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { setupWorkspaceActionEnv, teardownWorkspaceActionEnv } from './_setup';
import { workspaceMembers } from '@/lib/db/schema';

const sessionRef: {
  value: {
    user: { id: string; workspaceId: string | null; role: string | null };
  } | null;
} = { value: null };
vi.mock('@/lib/auth/session', () => ({
  requireSession: () =>
    sessionRef.value
      ? Promise.resolve(sessionRef.value)
      : Promise.reject(new Error('UNAUTHENTICATED')),
}));

import { removeWorkspaceMemberAction as rawRemoveWorkspaceMemberAction } from '../removeWorkspaceMemberAction';

type RemoveInput = Omit<Parameters<typeof rawRemoveWorkspaceMemberAction>[0], 'workspaceId'>;

function removeWorkspaceMemberAction(input: RemoveInput) {
  return rawRemoveWorkspaceMemberAction({
    ...input,
    workspaceId: sessionRef.value?.user.workspaceId ?? '',
  });
}

let db: PgliteDB;

beforeEach(async () => {
  db = await setupWorkspaceActionEnv();
  sessionRef.value = null;
});

afterEach(() => {
  teardownWorkspaceActionEnv();
});

async function isMember(wsId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, wsId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  return rows.length > 0;
}

describe('removeWorkspaceMemberAction', () => {
  it('returns UNAUTHENTICATED when there is no session', async () => {
    const r = await removeWorkspaceMemberAction({ userId: 'whoever' });
    expect(r).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when the caller is not an admin', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'member@example.com' });
    const target = await seedUser(db, { email: 'target@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member');
    await seedMembership(db, ws.id, target.id, 'member');
    sessionRef.value = {
      user: { id: caller.id, workspaceId: ws.id, role: 'member' },
    };

    const r = await removeWorkspaceMemberAction({ userId: target.id });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when JWT claims admin but DB role is member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'demoted@example.com' });
    const target = await seedUser(db, { email: 'target@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member'); // DB says member
    await seedMembership(db, ws.id, target.id, 'member');
    // stale JWT still claims admin
    sessionRef.value = {
      user: { id: caller.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await removeWorkspaceMemberAction({ userId: target.id });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
    expect(await isMember(ws.id, target.id)).toBe(true);
  });

  it('returns SELF_REMOVAL when an admin targets themselves', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await removeWorkspaceMemberAction({ userId: admin.id });
    expect(r).toEqual({ ok: false, error: 'SELF_REMOVAL' });
    expect(await isMember(ws.id, admin.id)).toBe(true);
  });

  it('returns MEMBER_NOT_FOUND when the target is not in the workspace', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await removeWorkspaceMemberAction({ userId: randomUUID() });
    expect(r).toEqual({ ok: false, error: 'MEMBER_NOT_FOUND' });
  });

  it('removes a plain member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    const member = await seedUser(db, { email: 'member@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await removeWorkspaceMemberAction({ userId: member.id });
    expect(r).toEqual({ ok: true });
    expect(await isMember(ws.id, member.id)).toBe(false);
    expect(await isMember(ws.id, admin.id)).toBe(true);
  });

  it('allows an admin to remove another admin', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const adminA = await seedUser(db, { email: 'a@example.com' });
    const adminB = await seedUser(db, { email: 'b@example.com' });
    await seedMembership(db, ws.id, adminA.id, 'admin');
    await seedMembership(db, ws.id, adminB.id, 'admin');
    sessionRef.value = {
      user: { id: adminA.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await removeWorkspaceMemberAction({ userId: adminB.id });
    expect(r).toEqual({ ok: true });
    expect(await isMember(ws.id, adminB.id)).toBe(false);
    expect(await isMember(ws.id, adminA.id)).toBe(true);
  });
});
