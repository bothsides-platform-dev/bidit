// cancelWorkspaceInviteAction tests.
//
// Coverage:
//   - UNAUTHENTICATED when no session
//   - FORBIDDEN_NOT_ADMIN when caller's current DB role is not admin (getMembership check)
//   - INVITE_NOT_FOUND when no pending invitation exists for the email
//   - success: sets status='expired', leaves other workspaces' invitations untouched
//   - re-invitation possible after cancel (partial unique index released)
//   - accepted invitation is not cancellable (INVITE_NOT_FOUND — only pending targeted)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { type PgliteDB } from '@/lib/db/client-pglite';
import {
  seedPgWorkspace,
  seedUser,
  seedMembership,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { setupWorkspaceActionEnv, teardownWorkspaceActionEnv } from './_setup';
import { workspaceInvitations } from '@/lib/db/schema';
import { generateToken, hashToken } from '@/lib/server/token';
import { inviteWorkspaceMemberAction as rawInviteWorkspaceMemberAction } from '../inviteWorkspaceMemberAction';

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

import { cancelWorkspaceInviteAction as rawCancelWorkspaceInviteAction } from '../cancelWorkspaceInviteAction';

type InviteInput = Omit<Parameters<typeof rawInviteWorkspaceMemberAction>[0], 'workspaceId'>;
type CancelInput = Omit<Parameters<typeof rawCancelWorkspaceInviteAction>[0], 'workspaceId'>;

function inviteWorkspaceMemberAction(input: InviteInput) {
  return rawInviteWorkspaceMemberAction({
    ...input,
    workspaceId: sessionRef.value?.user.workspaceId ?? '',
  });
}

function cancelWorkspaceInviteAction(input: CancelInput) {
  return rawCancelWorkspaceInviteAction({
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

async function makeAdminSession(workspaceId: string): Promise<{ id: string; email: string }> {
  const admin = await seedUser(db, { email: 'admin@example.com' });
  await seedMembership(db, workspaceId, admin.id, 'admin');
  sessionRef.value = { user: { id: admin.id, workspaceId, role: 'admin' } };
  return admin;
}

async function seedPendingInvite(
  workspaceId: string,
  invitedByUserId: string,
  email: string,
  status: 'pending' | 'accepted' | 'expired' = 'pending',
) {
  await db.insert(workspaceInvitations).values({
    workspaceId,
    invitedEmail: email,
    invitedByUserId,
    tokenHash: hashToken(generateToken()),
    status,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

describe('cancelWorkspaceInviteAction', () => {
  it('returns UNAUTHENTICATED when there is no session', async () => {
    const r = await cancelWorkspaceInviteAction({ email: 'user@example.com' });
    expect(r).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when caller DB role is member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'member@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member');
    sessionRef.value = { user: { id: caller.id, workspaceId: ws.id, role: 'member' } };

    const r = await cancelWorkspaceInviteAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when JWT claims admin but DB role is member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'demoted@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member'); // DB says member
    // stale JWT still claims admin
    sessionRef.value = { user: { id: caller.id, workspaceId: ws.id, role: 'admin' } };

    const r = await cancelWorkspaceInviteAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns INVITE_NOT_FOUND when no pending invitation exists for the email', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await cancelWorkspaceInviteAction({ email: 'ghost@example.com' });
    expect(r).toEqual({ ok: false, error: 'INVITE_NOT_FOUND' });
  });

  it('sets status to expired and returns ok:true on success', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    await seedPendingInvite(ws.id, admin.id, 'target@example.com');

    const r = await cancelWorkspaceInviteAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: true });

    const rows = await db
      .select({ status: workspaceInvitations.status })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('expired');
  });

  it('does not affect invitations in other workspaces', async () => {
    const ws1 = await seedPgWorkspace(db, 'WS1');
    const ws2 = await seedPgWorkspace(db, 'WS2');
    const admin = await makeAdminSession(ws1.id);

    // Seed pending invite in ws1 (to cancel) and ws2 (should be untouched)
    const otherAdmin = await seedUser(db, { email: 'other-admin@example.com' });
    await seedMembership(db, ws2.id, otherAdmin.id, 'admin');
    await seedPendingInvite(ws1.id, admin.id, 'shared@example.com');
    await seedPendingInvite(ws2.id, otherAdmin.id, 'shared@example.com');

    await cancelWorkspaceInviteAction({ email: 'shared@example.com' });

    const ws2Rows = await db
      .select({ status: workspaceInvitations.status })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, ws2.id),
          eq(workspaceInvitations.invitedEmail, 'shared@example.com'),
        ),
      );
    expect(ws2Rows[0].status).toBe('pending');
  });

  it('allows re-inviting the same email after cancellation (unique index released)', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    await seedPendingInvite(ws.id, admin.id, 'comeback@example.com');

    // Cancel first
    const cancelResult = await cancelWorkspaceInviteAction({ email: 'comeback@example.com' });
    expect(cancelResult).toEqual({ ok: true });

    // Re-invite should succeed (partial unique index no longer blocks)
    const reinviteResult = await inviteWorkspaceMemberAction({ email: 'comeback@example.com' });
    expect(reinviteResult).toEqual({ ok: true });
  });

  it('returns INVITE_NOT_FOUND for an accepted invitation (only pending targeted)', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    await seedPendingInvite(ws.id, admin.id, 'accepted@example.com', 'accepted');

    const r = await cancelWorkspaceInviteAction({ email: 'accepted@example.com' });
    expect(r).toEqual({ ok: false, error: 'INVITE_NOT_FOUND' });
  });
});
