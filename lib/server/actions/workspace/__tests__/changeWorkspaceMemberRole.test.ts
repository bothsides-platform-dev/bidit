// changeWorkspaceMemberRoleAction tests.
//
// Coverage:
//   - UNAUTHENTICATED when no session
//   - FORBIDDEN_NOT_ADMIN when caller's current DB role is not admin
//   - INVALID_INPUT for an unknown role value
//   - MEMBER_NOT_FOUND when target is not a member
//   - promote: member -> admin
//   - demote: admin -> member when another admin remains
//   - self-demote allowed when another admin remains
//   - LAST_ADMIN when demoting the only admin
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

import { changeWorkspaceMemberRoleAction as rawChangeWorkspaceMemberRoleAction } from '../changeWorkspaceMemberRoleAction';

type ChangeRoleInput = Omit<
  Parameters<typeof rawChangeWorkspaceMemberRoleAction>[0],
  'workspaceId'
>;

function changeWorkspaceMemberRoleAction(input: ChangeRoleInput) {
  return rawChangeWorkspaceMemberRoleAction({
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

async function roleOf(wsId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, wsId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  return row?.role ?? null;
}

describe('changeWorkspaceMemberRoleAction', () => {
  it('returns UNAUTHENTICATED when there is no session', async () => {
    const r = await changeWorkspaceMemberRoleAction({
      userId: randomUUID(),
      role: 'admin',
    });
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

    const r = await changeWorkspaceMemberRoleAction({
      userId: target.id,
      role: 'admin',
    });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns INVALID_INPUT for an unknown role', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    const target = await seedUser(db, { email: 'target@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, target.id, 'member');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await changeWorkspaceMemberRoleAction({
      userId: target.id,
      // @ts-expect-error testing runtime guard against bad role
      role: 'superadmin',
    });
    expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('returns MEMBER_NOT_FOUND when the target is not in the workspace', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await changeWorkspaceMemberRoleAction({
      userId: randomUUID(),
      role: 'admin',
    });
    expect(r).toEqual({ ok: false, error: 'MEMBER_NOT_FOUND' });
  });

  it('promotes a member to admin', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    const member = await seedUser(db, { email: 'member@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await changeWorkspaceMemberRoleAction({
      userId: member.id,
      role: 'admin',
    });
    expect(r).toEqual({ ok: true });
    expect(await roleOf(ws.id, member.id)).toBe('admin');
  });

  it('demotes an admin to member when another admin remains', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const adminA = await seedUser(db, { email: 'a@example.com' });
    const adminB = await seedUser(db, { email: 'b@example.com' });
    await seedMembership(db, ws.id, adminA.id, 'admin');
    await seedMembership(db, ws.id, adminB.id, 'admin');
    sessionRef.value = {
      user: { id: adminA.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await changeWorkspaceMemberRoleAction({
      userId: adminB.id,
      role: 'member',
    });
    expect(r).toEqual({ ok: true });
    expect(await roleOf(ws.id, adminB.id)).toBe('member');
  });

  it('allows self-demotion when another admin remains', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const adminA = await seedUser(db, { email: 'a@example.com' });
    const adminB = await seedUser(db, { email: 'b@example.com' });
    await seedMembership(db, ws.id, adminA.id, 'admin');
    await seedMembership(db, ws.id, adminB.id, 'admin');
    sessionRef.value = {
      user: { id: adminA.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await changeWorkspaceMemberRoleAction({
      userId: adminA.id,
      role: 'member',
    });
    expect(r).toEqual({ ok: true });
    expect(await roleOf(ws.id, adminA.id)).toBe('member');
  });

  it('returns LAST_ADMIN when demoting the only admin', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await seedUser(db, { email: 'admin@example.com' });
    const member = await seedUser(db, { email: 'member@example.com' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: ws.id, role: 'admin' },
    };

    const r = await changeWorkspaceMemberRoleAction({
      userId: admin.id,
      role: 'member',
    });
    expect(r).toEqual({ ok: false, error: 'LAST_ADMIN' });
    expect(await roleOf(ws.id, admin.id)).toBe('admin');
  });
});
