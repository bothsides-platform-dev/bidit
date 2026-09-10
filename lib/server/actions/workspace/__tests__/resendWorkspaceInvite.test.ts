// resendWorkspaceInviteAction tests.
//
// Coverage:
//   - UNAUTHENTICATED when no session
//   - FORBIDDEN_NOT_ADMIN when caller's current DB role is not admin (getMembership check)
//   - INVITE_NOT_FOUND when no pending invitation exists for the email
//   - success: returns ok:true, outbox row enqueued, invitation row status stays 'pending'
//   - token rotation: tokenHash and expiresAt change on resend
//   - dedupe lock: consecutive resends produce separate outbox rows (tokenHash-based dedupeKey)
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

import { resendWorkspaceInviteAction as rawResendWorkspaceInviteAction } from '../resendWorkspaceInviteAction';

type ResendInput = Omit<Parameters<typeof rawResendWorkspaceInviteAction>[0], 'workspaceId'>;

function resendWorkspaceInviteAction(input: ResendInput) {
  return rawResendWorkspaceInviteAction({
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
): Promise<{ tokenHash: string; expiresAt: Date }> {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(workspaceInvitations).values({
    workspaceId,
    invitedEmail: email,
    invitedByUserId,
    tokenHash,
    status: 'pending',
    expiresAt,
  });
  return { tokenHash, expiresAt };
}

describe('resendWorkspaceInviteAction', () => {
  it('returns UNAUTHENTICATED when there is no session', async () => {
    const r = await resendWorkspaceInviteAction({ email: 'user@example.com' });
    expect(r).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when caller DB role is member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'member@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member');
    sessionRef.value = { user: { id: caller.id, workspaceId: ws.id, role: 'member' } };

    const r = await resendWorkspaceInviteAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when JWT claims admin but DB role is member', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const caller = await seedUser(db, { email: 'demoted@example.com' });
    await seedMembership(db, ws.id, caller.id, 'member'); // DB says member
    // stale JWT still claims admin
    sessionRef.value = { user: { id: caller.id, workspaceId: ws.id, role: 'admin' } };

    const r = await resendWorkspaceInviteAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns INVITE_NOT_FOUND when no pending invitation exists', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    await makeAdminSession(ws.id);

    const r = await resendWorkspaceInviteAction({ email: 'ghost@example.com' });
    expect(r).toEqual({ ok: false, error: 'INVITE_NOT_FOUND' });
  });

  it('returns ok:true and enqueues an outbox row on success', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    await seedPendingInvite(ws.id, admin.id, 'target@example.com');

    const r = await resendWorkspaceInviteAction({ email: 'target@example.com' });
    expect(r).toEqual({ ok: true });

    const outbox = await db.select().from(outboxEntries);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].toAddr).toBe('target@example.com');
    expect(outbox[0].event).toBe('workspace.invited');
  });

  it('keeps invitation status as pending after resend', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    await seedPendingInvite(ws.id, admin.id, 'target@example.com');

    await resendWorkspaceInviteAction({ email: 'target@example.com' });

    const rows = await db
      .select({ status: workspaceInvitations.status })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(rows[0].status).toBe('pending');
  });

  it('rotates the tokenHash and extends expiresAt on resend', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    const { tokenHash: oldHash, expiresAt: oldExpiry } =
      await seedPendingInvite(ws.id, admin.id, 'target@example.com');

    await resendWorkspaceInviteAction({ email: 'target@example.com' });

    const [row] = await db
      .select({ tokenHash: workspaceInvitations.tokenHash, expiresAt: workspaceInvitations.expiresAt })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, ws.id));
    expect(row.tokenHash).not.toBe(oldHash);
    expect(row.expiresAt.getTime()).toBeGreaterThan(oldExpiry.getTime());
  });

  it('★ dedupe lock: two consecutive resends produce two separate outbox rows', async () => {
    // CRITICAL: If dedupeKey were bucket15Min-based, the second enqueue would
    // hit onConflictDoNothing and produce only 1 outbox row — the test would fail.
    // With tokenHash-based dedupeKey, each resend rotates the token → unique key → 2 rows.
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    await seedPendingInvite(ws.id, admin.id, 'target@example.com');

    await resendWorkspaceInviteAction({ email: 'target@example.com' });
    await resendWorkspaceInviteAction({ email: 'target@example.com' });

    const outbox = await db.select().from(outboxEntries);
    expect(outbox).toHaveLength(2);
  });

  it('creates a user-level in-app notification when resending to an existing user', async () => {
    const ws = await seedPgWorkspace(db, 'WS');
    const admin = await makeAdminSession(ws.id);
    const invitee = await seedUser(db, { email: 'existing@example.com' });
    await seedPendingInvite(ws.id, admin.id, 'existing@example.com');

    const r = await resendWorkspaceInviteAction({ email: 'existing@example.com' });
    expect(r).toEqual({ ok: true });

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, invitee.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].workspaceId).toBeNull();
    expect(notifs[0].type).toBe('workspace.invited');
    expect(notifs[0].channel).toBe('in_app');
  });
});
