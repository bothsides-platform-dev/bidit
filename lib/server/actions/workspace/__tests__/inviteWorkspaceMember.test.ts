// inviteWorkspaceMemberAction tests.
//
// Coverage:
//   - UNAUTHENTICATED when no session
//   - FORBIDDEN_NOT_ADMIN when caller is not an admin
//   - INVALID_INPUT for malformed email
//   - ALREADY_INVITED for a duplicate pending invitation
//   - success: workspace_invitations row inserted, outbox entry enqueued
//   - allows re-inviting the same email after their invitation was accepted
//     (requires partial unique index — RED until Bug 3 is fixed)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { type PgliteDB } from '@/lib/db/client-pglite';
import {
  seedPgWorkspace,
  seedUser,
  seedMembership,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { setupWorkspaceActionEnv, teardownWorkspaceActionEnv } from './_setup';
import { workspaceInvitations, outboxEntries, notifications } from '@/lib/db/schema';
import { generateToken, hashToken } from '@/lib/server/token';

vi.mock('@/lib/server/outbox/templates/workspaceInvited', () => ({
  renderWorkspaceInvited: async () => '<p>invited</p>',
}));

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

import { inviteWorkspaceMemberAction as rawInviteWorkspaceMemberAction } from '../inviteWorkspaceMemberAction';

type InviteInput = Omit<Parameters<typeof rawInviteWorkspaceMemberAction>[0], 'workspaceId'>;

function inviteWorkspaceMemberAction(input: InviteInput) {
  return rawInviteWorkspaceMemberAction({
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

async function makeAdminSession(
  workspaceId: string,
): Promise<{ id: string; email: string }> {
  const admin = await seedUser(db, { email: 'admin@example.com' });
  await seedMembership(db, workspaceId, admin.id, 'admin');
  sessionRef.value = {
    user: { id: admin.id, workspaceId, role: 'admin' },
  };
  return admin;
}

describe('inviteWorkspaceMemberAction', () => {
  it('stale 화면의 워크스페이스가 현재 세션과 다르면 아무 곳에도 초대하지 않는다', async () => {
    const staleWorkspace = await seedPgWorkspace(db, '오래된 화면');
    const activeWorkspace = await seedPgWorkspace(db, '현재 화면');
    await makeAdminSession(activeWorkspace.id);

    const r = await rawInviteWorkspaceMemberAction({
      workspaceId: staleWorkspace.id,
      email: 'wrong-workspace@example.com',
    });

    expect(r).toEqual({ ok: false, error: 'WORKSPACE_CHANGED' });
    expect(await db.select().from(workspaceInvitations)).toHaveLength(0);
  });

  it('returns UNAUTHENTICATED when there is no session', async () => {
    const r = await inviteWorkspaceMemberAction({ email: 'user@example.com' });
    expect(r).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when the caller is not an admin', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const u = await seedUser(db, { email: 'member@example.com' });
    await seedMembership(db, ws.id, u.id, 'member');
    sessionRef.value = { user: { id: u.id, workspaceId: ws.id, role: 'member' } };

    const r = await inviteWorkspaceMemberAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when JWT claims admin but DB role is member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'demoted@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member'); // DB says member
    // stale JWT still claims admin
    sessionRef.value = { user: { id: caller.id, workspaceId: ws.id, role: 'admin' } };

    const r = await inviteWorkspaceMemberAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });

    const invites = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(invites).toHaveLength(0);
  });

  it('returns INVALID_INPUT for a malformed email', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await inviteWorkspaceMemberAction({ email: 'not-an-email' });
    expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('returns ALREADY_INVITED when a pending invitation exists for the same email', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);

    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      invitedEmail: 'target@example.com',
      invitedByUserId: admin.id,
      tokenHash: hashToken(generateToken()),
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const r = await inviteWorkspaceMemberAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'ALREADY_INVITED' });
  });

  it('inserts an invitation row and enqueues an outbox email on success', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await inviteWorkspaceMemberAction({ email: 'newmember@example.com' });
    expect(r).toEqual({ ok: true });

    const invites = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(invites).toHaveLength(1);
    expect(invites[0].invitedEmail).toBe('newmember@example.com');
    expect(invites[0].status).toBe('pending');
    expect(invites[0].tokenHash).toBeTruthy();

    const outbox = await db.select().from(outboxEntries);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].toAddr).toBe('newmember@example.com');
    expect(outbox[0].event).toBe('workspace.invited');
  });

  it('stores the requested role on the invitation row', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await inviteWorkspaceMemberAction({
      email: 'newadmin@example.com',
      role: 'admin',
    });
    expect(r).toEqual({ ok: true });

    const [inv] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(inv.role).toBe('admin');
  });

  it('defaults the invitation role to member when none is given', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await inviteWorkspaceMemberAction({ email: 'plain@example.com' });
    expect(r).toEqual({ ok: true });

    const [inv] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(inv.role).toBe('member');
  });

  it('allows re-inviting the same email after their previous invitation was accepted', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);

    // Seed an already-accepted invitation for the same email
    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      invitedEmail: 'returning@example.com',
      invitedByUserId: admin.id,
      tokenHash: hashToken(generateToken()),
      status: 'accepted',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Re-inviting should succeed (partial unique index: only pending rows constrained)
    const r = await inviteWorkspaceMemberAction({ email: 'returning@example.com' });
    expect(r).toEqual({ ok: true });
  });

  it('allows re-inviting the same email after their previous invitation expired', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);

    // Seed an expired invitation
    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      invitedEmail: 'lapsed@example.com',
      invitedByUserId: admin.id,
      tokenHash: hashToken(generateToken()),
      status: 'expired',
      expiresAt: new Date(Date.now() - 1000),
    });

    const r = await inviteWorkspaceMemberAction({ email: 'lapsed@example.com' });
    expect(r).toEqual({ ok: true });
  });

  it('creates a user-level in-app notification when inviting an existing user', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);
    const invitee = await seedUser(db, { email: 'existing@example.com' });

    const r = await inviteWorkspaceMemberAction({ email: 'existing@example.com' });
    expect(r).toEqual({ ok: true });

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, invitee.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].workspaceId).toBeNull(); // user-level
    expect(notifs[0].type).toBe('workspace.invited');
    expect(notifs[0].channel).toBe('in_app');
  });

  it('does not create an in-app notification when inviting an unregistered email', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await inviteWorkspaceMemberAction({ email: 'ghost@example.com' });
    expect(r).toEqual({ ok: true });

    const notifs = await db.select().from(notifications);
    expect(notifs).toHaveLength(0);

    // email invite still enqueued
    const outbox = await db.select().from(outboxEntries);
    expect(outbox).toHaveLength(1);
  });
});
