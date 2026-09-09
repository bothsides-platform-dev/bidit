import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

// Must be hoisted before workspace.ts is imported so the static import in
// workspace.ts resolves to the mock, not the real Centrifugo client.
vi.mock('@/lib/server/realtime/centrifugo', () => ({
  disconnectCentrifugoUser: vi.fn().mockResolvedValue(undefined),
}));

import { createPgliteDb } from '@/lib/db/client-pglite';
import {
  __resetForTest,
  __useDrizzleWithDbForTest,
  getBizProfileRepo,
  getOutboxRepo,
  getAuditLogRepo,
  getWorkspaceRepo,
  getUserRepo,
} from '@/lib/server/repositories/factory';
import {
  seedBizProfile,
  seedBuyerWorkspace,
  seedMembership,
  seedUser,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { randomUUID } from 'node:crypto';
import { auditLogs, bizProfiles, users, workspaceInvitations, workspaceMembers } from '@/lib/db/schema';
import { WorkspaceService } from '../workspace';
import { disconnectCentrifugoUser } from '@/lib/server/realtime/centrifugo';
import type { PgliteDB } from '@/lib/db/client-pglite';

let db: PgliteDB;
let service: WorkspaceService;

async function buildService(): Promise<WorkspaceService> {
  const outboxRepo = await getOutboxRepo();
  const auditRepo = await getAuditLogRepo();
  const workspaceRepo = await getWorkspaceRepo();
  const userRepo = await getUserRepo();
  const bizProfileRepo = await getBizProfileRepo();
  return new WorkspaceService(db, outboxRepo, auditRepo, workspaceRepo, userRepo, bizProfileRepo);
}

beforeEach(async () => {
  __resetForTest();
  db = await createPgliteDb();
  await __useDrizzleWithDbForTest(db);
  service = await buildService();
});

afterEach(() => {
  __resetForTest();
});

async function withConfiguredMaster(run: () => Promise<void>): Promise<void> {
  const previous = process.env.MASTER_ACCOUNT_EMAILS;
  process.env.MASTER_ACCOUNT_EMAILS = 'ops@support-b.com';
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.MASTER_ACCOUNT_EMAILS;
    else process.env.MASTER_ACCOUNT_EMAILS = previous;
  }
}

// ─── createWorkspace ─────────────────────────────────────────────────────────

describe('WorkspaceService.createWorkspace', () => {
  it('creates a workspace with admin membership and verification application', async () => {
    const user = await seedUser(db, { email: 'creator@test.com' });

    const result = await service.createWorkspace(
      { type: 'buyer', name: '테스트 구매사', userId: user.id },
      { userId: user.id, workspaceId: '' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ws = await db.query.workspaces.findFirst({
      where: (t, { eq }) => eq(t.id, result.workspaceId),
    });
    expect(ws).toBeDefined();
    expect(ws?.name).toBe('테스트 구매사');
    expect(ws?.type).toBe('buyer');

    const membership = await db.query.workspaceMembers.findFirst({
      where: (t, { and, eq }) => and(eq(t.workspaceId, result.workspaceId), eq(t.userId, user.id)),
    });
    expect(membership?.role).toBe('admin');
  });
});

// ─── changeMemberRole ─────────────────────────────────────────────────────────

describe('WorkspaceService.changeMemberRole', () => {
  it('allows a configured master without a workspace membership to change a member role', async () => {
    await withConfiguredMaster(async () => {
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const member = await seedUser(db, { email: 'member@test.com' });
      const ws = await seedBuyerWorkspace(db);
      await seedMembership(db, ws.id, member.id, 'member');

      const result = await service.changeMemberRole(
        { targetUserId: member.id, role: 'admin' },
        { userId: master.id, workspaceId: ws.id },
      );

      expect(result.ok).toBe(true);
      const [row] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, member.id)));
      expect(row.role).toBe('admin');
    });
  });

  it('promotes a member to admin', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const member = await seedUser(db, { email: 'member@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');

    const result = await service.changeMemberRole(
      { targetUserId: member.id, role: 'admin' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, member.id)));
    expect(row.role).toBe('admin');
  });

  it('returns LAST_ADMIN when demoting the only admin', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    const result = await service.changeMemberRole(
      { targetUserId: admin.id, role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'LAST_ADMIN' });

    // 가드가 트랜잭션 안으로 들어갔으므로, 거절 시 역할·감사로그 모두 쓰이지 않아야 한다.
    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, admin.id)));
    expect(row.role).toBe('admin');
    expect(await db.select({ id: auditLogs.id }).from(auditLogs)).toHaveLength(0);
  });

  // 미승인 admin 은 잔여 admin 으로 쳐주지 않는다 — 가드가 느슨해지지 않았음을 못박는다.
  it('still returns LAST_ADMIN for the sole approved admin when a pending decoy admin exists', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const decoy = await seedUser(db, { email: 'decoy@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, decoy.id, 'admin', { approvalStatus: 'pending_approval' });

    const result = await service.changeMemberRole(
      { targetUserId: admin.id, role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'LAST_ADMIN' });
  });

  it('demotes an approved admin when another approved admin remains', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const coAdmin = await seedUser(db, { email: 'coadmin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, coAdmin.id, 'admin');

    const result = await service.changeMemberRole(
      { targetUserId: coAdmin.id, role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, coAdmin.id)));
    expect(row.role).toBe('member');
  });

  // 미승인 admin 은 countAdmins 집계 대상이 아니므로 강등해도 마지막 admin 이 사라지지 않는다.
  it('demotes a pending_approval admin without LAST_ADMIN', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const pending = await seedUser(db, { email: 'pending@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, pending.id, 'admin', {
      approvalStatus: 'pending_approval',
    });

    const result = await service.changeMemberRole(
      { targetUserId: pending.id, role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, pending.id)));
    expect(row.role).toBe('member');
  });

  // 가드는 'approved' 인지로 판정한다 — 'pending_approval 이 아님' 이 아니라.
  it('demotes a rejected admin without LAST_ADMIN', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const rejected = await seedUser(db, { email: 'rejected@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, rejected.id, 'admin', { approvalStatus: 'rejected' });

    const result = await service.changeMemberRole(
      { targetUserId: rejected.id, role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, rejected.id)));
    expect(row.role).toBe('member');
  });

  it('returns FORBIDDEN_NOT_ADMIN when caller is not admin', async () => {
    const member = await seedUser(db, { email: 'member@test.com' });
    const target = await seedUser(db, { email: 'target@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, member.id, 'member');
    await seedMembership(db, ws.id, target.id, 'member');

    const result = await service.changeMemberRole(
      { targetUserId: target.id, role: 'admin' },
      { userId: member.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('returns MEMBER_NOT_FOUND when target is not in workspace', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const stranger = await seedUser(db, { email: 'stranger@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    const result = await service.changeMemberRole(
      { targetUserId: stranger.id, role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'MEMBER_NOT_FOUND' });
  });
});

// ─── removeMember ─────────────────────────────────────────────────────────────

describe('WorkspaceService.removeMember', () => {
  it('allows a configured master without a workspace membership to remove a member', async () => {
    await withConfiguredMaster(async () => {
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const member = await seedUser(db, { email: 'member@test.com' });
      const ws = await seedBuyerWorkspace(db);
      await seedMembership(db, ws.id, member.id, 'member');

      const result = await service.removeMember(
        { targetUserId: member.id },
        { userId: master.id, workspaceId: ws.id },
      );

      expect(result.ok).toBe(true);
      const rows = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, member.id)));
      expect(rows).toHaveLength(0);
    });
  });

  it('keeps the last approved admin when a configured master tries to remove them', async () => {
    await withConfiguredMaster(async () => {
      vi.mocked(disconnectCentrifugoUser).mockClear();
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const onlyAdmin = await seedUser(db, { email: 'admin@test.com' });
      const ws = await seedBuyerWorkspace(db);
      await seedMembership(db, ws.id, onlyAdmin.id, 'admin');

      const result = await service.removeMember(
        { targetUserId: onlyAdmin.id },
        { userId: master.id, workspaceId: ws.id },
      );

      expect(result).toEqual({ ok: false, error: 'LAST_ADMIN' });
      const rows = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, onlyAdmin.id)));
      expect(rows).toHaveLength(1);
      expect(await db.select({ id: auditLogs.id }).from(auditLogs)).toHaveLength(0);
      expect(disconnectCentrifugoUser).not.toHaveBeenCalled();
    });
  });

  it('removes a member from the workspace', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const member = await seedUser(db, { email: 'member@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');

    const result = await service.removeMember(
      { targetUserId: member.id },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, member.id)));
    expect(rows).toHaveLength(0);
  });

  it('bumps sessionVersion of removed member and calls disconnectCentrifugoUser', async () => {
    vi.mocked(disconnectCentrifugoUser).mockClear();

    const admin = await seedUser(db, { email: 'admin@test.com' });
    const member = await seedUser(db, { email: 'member@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');

    const [before] = await db.select({ sv: users.sessionVersion }).from(users).where(eq(users.id, member.id));

    await service.removeMember(
      { targetUserId: member.id },
      { userId: admin.id, workspaceId: ws.id },
    );

    const [after] = await db.select({ sv: users.sessionVersion }).from(users).where(eq(users.id, member.id));
    expect(after.sv).toBe(before.sv + 1);
    expect(disconnectCentrifugoUser).toHaveBeenCalledWith(member.id);
    expect(disconnectCentrifugoUser).toHaveBeenCalledTimes(1);
  });

  it('returns SELF_REMOVAL when trying to remove yourself', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    const result = await service.removeMember(
      { targetUserId: admin.id },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'SELF_REMOVAL' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when caller is not admin', async () => {
    const member = await seedUser(db, { email: 'member@test.com' });
    const target = await seedUser(db, { email: 'target@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, member.id, 'member');
    await seedMembership(db, ws.id, target.id, 'member');

    const result = await service.removeMember(
      { targetUserId: target.id },
      { userId: member.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });
});

// ─── pending_approval admin has NO admin authority ─────────────────────────────
// Canonical-PG joiners are role='admin' but approvalStatus='pending_approval'
// until vetted. The shell only gates RSC renders, not server actions, so the
// service gates MUST treat an unapproved admin as a non-admin.

describe('WorkspaceService — pending_approval admin is not an effective admin', () => {
  it('changeMemberRole returns FORBIDDEN_NOT_ADMIN for a pending admin actor', async () => {
    const pending = await seedUser(db, { email: 'pending@test.com' });
    const target = await seedUser(db, { email: 'target@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, pending.id, 'admin', { approvalStatus: 'pending_approval' });
    await seedMembership(db, ws.id, target.id, 'member');

    const result = await service.changeMemberRole(
      { targetUserId: target.id, role: 'admin' },
      { userId: pending.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('removeMember returns FORBIDDEN_NOT_ADMIN for a pending admin actor', async () => {
    const pending = await seedUser(db, { email: 'pending@test.com' });
    const victim = await seedUser(db, { email: 'victim@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, pending.id, 'admin', { approvalStatus: 'pending_approval' });
    await seedMembership(db, ws.id, victim.id, 'admin');

    const result = await service.removeMember(
      { targetUserId: victim.id },
      { userId: pending.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });

    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, victim.id)));
    expect(rows).toHaveLength(1);
  });

  it('inviteMember returns FORBIDDEN_NOT_ADMIN for a pending admin actor', async () => {
    const pending = await seedUser(db, { email: 'pending@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, pending.id, 'admin', { approvalStatus: 'pending_approval' });

    const result = await service.inviteMember(
      { email: 'confederate@test.com', role: 'admin' },
      { userId: pending.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });
});

// ─── inviteMember ─────────────────────────────────────────────────────────────

describe('WorkspaceService.inviteMember', () => {
  it('allows a configured master without a workspace membership to invite a member', async () => {
    await withConfiguredMaster(async () => {
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const ws = await seedBuyerWorkspace(db, { name: '운영 대상사' });

      const result = await service.inviteMember(
        { email: 'newmember@test.com', role: 'member' },
        { userId: master.id, workspaceId: ws.id },
      );

      expect(result.ok).toBe(true);
      const invites = await db.select().from(workspaceInvitations);
      expect(invites).toHaveLength(1);
      expect(invites[0]).toMatchObject({
        workspaceId: ws.id,
        invitedEmail: 'newmember@test.com',
        invitedByUserId: master.id,
        status: 'pending',
      });
    });
  });

  it('creates an invitation and enqueues an outbox email', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db, { name: '초대 테스트사' });
    await seedMembership(db, ws.id, admin.id, 'admin');

    const result = await service.inviteMember(
      { email: 'newmember@test.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const invites = await db.select().from(workspaceInvitations);
    expect(invites).toHaveLength(1);
    expect(invites[0].invitedEmail).toBe('newmember@test.com');
    expect(invites[0].status).toBe('pending');
  });

  it('returns ALREADY_INVITED when duplicate invitation exists', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    await service.inviteMember(
      { email: 'dup@test.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    const result = await service.inviteMember(
      { email: 'dup@test.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'ALREADY_INVITED' });
  });

  it('returns FORBIDDEN_NOT_ADMIN when caller is not admin', async () => {
    const member = await seedUser(db, { email: 'member@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, member.id, 'member');

    const result = await service.inviteMember(
      { email: 'newguy@test.com', role: 'member' },
      { userId: member.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });
});

describe('WorkspaceService.resendInvite', () => {
  it('allows a configured master without a workspace membership to resend an invite', async () => {
    await withConfiguredMaster(async () => {
      const admin = await seedUser(db, { email: 'admin@test.com' });
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const ws = await seedBuyerWorkspace(db, { name: '운영 대상사' });
      await seedMembership(db, ws.id, admin.id, 'admin');
      await service.inviteMember(
        { email: 'pending@test.com', role: 'member' },
        { userId: admin.id, workspaceId: ws.id },
      );

      const result = await service.resendInvite(
        { email: 'pending@test.com' },
        { userId: master.id, workspaceId: ws.id },
      );

      expect(result.ok).toBe(true);
      process.env.MASTER_ACCOUNT_EMAILS = '';
      const logs = await (await getAuditLogRepo()).listForWorkspace(ws.id, { limit: 50 });
      expect(logs.find((row) => row.action === 'workspace.member_invite_resend')).toMatchObject({
        actorUserId: master.id,
        actorWorkspaceId: ws.id,
        viaMaster: true,
      });
      process.env.MASTER_ACCOUNT_EMAILS = 'ops@support-b.com';
    });
  });
});

// ─── cancelInvite ─────────────────────────────────────────────────────────────

describe('WorkspaceService.cancelInvite', () => {
  it('allows a configured master without a workspace membership to cancel an invite', async () => {
    await withConfiguredMaster(async () => {
      const admin = await seedUser(db, { email: 'admin@test.com' });
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const ws = await seedBuyerWorkspace(db);
      await seedMembership(db, ws.id, admin.id, 'admin');
      await service.inviteMember(
        { email: 'pending@test.com', role: 'member' },
        { userId: admin.id, workspaceId: ws.id },
      );

      const result = await service.cancelInvite(
        { email: 'pending@test.com' },
        { userId: master.id, workspaceId: ws.id },
      );

      expect(result.ok).toBe(true);
      const [invite] = await db.select().from(workspaceInvitations);
      expect(invite.status).toBe('expired');
      const logs = await (await getAuditLogRepo()).listForWorkspace(ws.id, { limit: 50 });
      expect(logs.find((row) => row.action === 'workspace.member_invite_cancel')).toMatchObject({
        actorUserId: master.id,
        actorWorkspaceId: ws.id,
        viaMaster: true,
      });
    });
  });

  it('marks a pending invitation as expired', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    await service.inviteMember(
      { email: 'invited@test.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    const result = await service.cancelInvite(
      { email: 'invited@test.com' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result.ok).toBe(true);

    const [inv] = await db.select().from(workspaceInvitations);
    expect(inv.status).toBe('expired');
  });

  it('returns INVITE_NOT_FOUND when no pending invitation exists', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    const result = await service.cancelInvite(
      { email: 'nobody@test.com' },
      { userId: admin.id, workspaceId: ws.id },
    );

    expect(result).toEqual({ ok: false, error: 'INVITE_NOT_FOUND' });
  });
});

// ─── acceptInvite ─────────────────────────────────────────────────────────────

describe('WorkspaceService.acceptInvite', () => {
  it('claims a valid invitation and adds the user to the workspace', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db, { name: '수락 테스트사' });
    await seedMembership(db, ws.id, admin.id, 'admin');

    // Create an invitation directly in DB for test
    const invitedUser = await seedUser(db, { email: 'invited@test.com' });
    const { generateToken, hashToken } = await import('@/lib/server/token');
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      invitedEmail: 'invited@test.com',
      invitedByUserId: admin.id,
      role: 'member',
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'pending',
    });

    const result = await service.acceptInvite(rawToken, {
      userId: invitedUser.id,
      userEmail: 'invited@test.com',
      workspaceId: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspaceId).toBe(ws.id);

    const membership = await db.query.workspaceMembers.findFirst({
      where: (t, { and, eq }) => and(eq(t.workspaceId, ws.id), eq(t.userId, invitedUser.id)),
    });
    expect(membership).toBeDefined();
  });

  it('returns INVITE_INVALID for an unknown token', async () => {
    const user = await seedUser(db, { email: 'user@test.com' });
    const ws = await seedBuyerWorkspace(db);

    const result = await service.acceptInvite('totally-fake-token-that-does-not-exist', {
      userId: user.id,
      userEmail: 'user@test.com',
      workspaceId: ws.id,
    });

    expect(result).toEqual({ ok: false, error: 'INVITE_INVALID' });
  });

  it('returns INVITE_EMAIL_MISMATCH when user email differs from invited email', async () => {
    const admin = await seedUser(db, { email: 'admin@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    const otherUser = await seedUser(db, { email: 'other@test.com' });
    const { generateToken, hashToken } = await import('@/lib/server/token');
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      invitedEmail: 'right@test.com',
      invitedByUserId: admin.id,
      role: 'member',
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'pending',
    });

    const result = await service.acceptInvite(rawToken, {
      userId: otherUser.id,
      userEmail: 'other@test.com',
      workspaceId: ws.id,
    });

    expect(result).toEqual({ ok: false, error: 'INVITE_EMAIL_MISMATCH' });
  });
});

// ─── 감사 로그 (C5) ───────────────────────────────────────────────────────────

describe('WorkspaceService — 감사 로그 기록', () => {
  async function rowsFor(action: string) {
    return db.select().from(auditLogs).where(eq(auditLogs.action, action));
  }

  it('createWorkspace 성공 시 workspace.create 감사 행을 남긴다', async () => {
    const user = await seedUser(db, { email: 'creator@audit.com' });
    const r = await service.createWorkspace(
      { type: 'buyer', name: '감사 구매사', userId: user.id },
      { userId: user.id, workspaceId: '' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = await rowsFor('workspace.create');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: user.id,
      actorWorkspaceId: r.workspaceId,
      entityType: 'workspace',
      entityId: r.workspaceId,
    });
  });

  it('inviteMember 성공 시 workspace.member_invite 감사 행을 남긴다', async () => {
    const admin = await seedUser(db, { email: 'admin@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');

    const r = await service.inviteMember(
      { email: 'newbie@audit.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );
    expect(r.ok).toBe(true);

    const rows = await rowsFor('workspace.member_invite');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: admin.id, actorWorkspaceId: ws.id });
    expect(rows[0]!.metadata).toMatchObject({ email: 'newbie@audit.com', role: 'member' });
  });

  it('resendInvite 성공 시 workspace.member_invite_resend 감사 행을 남긴다', async () => {
    const admin = await seedUser(db, { email: 'admin@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await service.inviteMember(
      { email: 'resend@audit.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    const r = await service.resendInvite(
      { email: 'resend@audit.com' },
      { userId: admin.id, workspaceId: ws.id },
    );
    expect(r.ok).toBe(true);

    const rows = await rowsFor('workspace.member_invite_resend');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: admin.id, actorWorkspaceId: ws.id });
    expect(rows[0]!.metadata).toMatchObject({ email: 'resend@audit.com' });
  });

  it('cancelInvite 성공 시 workspace.member_invite_cancel 감사 행을 남긴다', async () => {
    const admin = await seedUser(db, { email: 'admin@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await service.inviteMember(
      { email: 'cancel@audit.com', role: 'member' },
      { userId: admin.id, workspaceId: ws.id },
    );

    const r = await service.cancelInvite(
      { email: 'cancel@audit.com' },
      { userId: admin.id, workspaceId: ws.id },
    );
    expect(r.ok).toBe(true);

    const rows = await rowsFor('workspace.member_invite_cancel');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: admin.id, actorWorkspaceId: ws.id });
    expect(rows[0]!.metadata).toMatchObject({ email: 'cancel@audit.com' });
  });

  it('acceptInvite 성공 시 workspace.invite_accept 감사 행을 남긴다', async () => {
    const admin = await seedUser(db, { email: 'admin@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    const invited = await seedUser(db, { email: 'joiner@audit.com' });
    const { generateToken, hashToken } = await import('@/lib/server/token');
    const rawToken = generateToken();
    await db.insert(workspaceInvitations).values({
      workspaceId: ws.id,
      invitedEmail: 'joiner@audit.com',
      invitedByUserId: admin.id,
      role: 'member',
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'pending',
    });

    const r = await service.acceptInvite(rawToken, {
      userId: invited.id,
      userEmail: 'joiner@audit.com',
      workspaceId: '',
    });
    expect(r.ok).toBe(true);

    const rows = await rowsFor('workspace.invite_accept');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: invited.id, actorWorkspaceId: ws.id });
  });

  it('changeMemberRole 성공 시 workspace.member_role_change 감사 행을 남긴다', async () => {
    const admin = await seedUser(db, { email: 'admin@audit.com' });
    const member = await seedUser(db, { email: 'member@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');

    const r = await service.changeMemberRole(
      { targetUserId: member.id, role: 'admin' },
      { userId: admin.id, workspaceId: ws.id },
    );
    expect(r.ok).toBe(true);

    const rows = await rowsFor('workspace.member_role_change');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: admin.id, actorWorkspaceId: ws.id });
    expect(rows[0]!.metadata).toMatchObject({ targetUserId: member.id, role: 'admin' });
  });

  it('removeMember 성공 시 workspace.member_remove 감사 행을 남긴다', async () => {
    const admin = await seedUser(db, { email: 'admin@audit.com' });
    const member = await seedUser(db, { email: 'member@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, admin.id, 'admin');
    await seedMembership(db, ws.id, member.id, 'member');

    const r = await service.removeMember(
      { targetUserId: member.id },
      { userId: admin.id, workspaceId: ws.id },
    );
    expect(r.ok).toBe(true);

    const rows = await rowsFor('workspace.member_remove');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: admin.id, actorWorkspaceId: ws.id });
    expect(rows[0]!.metadata).toMatchObject({ targetUserId: member.id });
  });
});

// ─── replaceBizProfile ───────────────────────────────────────────────────────
// updateWorkspaceBizProfileAction 이 actionDb() 로 직접 열던 트랜잭션을 서비스로.
// 액션은 admin 게이트·국세청 재조회까지만 하고, 검증된 패치를 여기에 넘긴다.

describe('WorkspaceService.replaceBizProfile', () => {
  it('refuses when the workspace has no profile yet and no bizProfile patch is given', async () => {
    const user = await seedUser(db, { email: 'nobiz@test.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, user.id, 'admin');

    const r = await service.replaceBizProfile({ userId: user.id, workspaceId: ws.id }, { grade: 'general' });

    expect(r).toEqual({ ok: false, error: 'BIZ_PROFILE_REQUIRED' });
  });

  it('writes a new immutable row from the current one plus the patch and repoints the workspace', async () => {
    const user = await seedUser(db, { email: 'grade@test.com' });
    const current = await seedBizProfile(db, { bizNo: '1112223333' });
    const ws = await seedBuyerWorkspace(db, { bizProfileId: current.id });
    await seedMembership(db, ws.id, user.id, 'admin');

    const r = await service.replaceBizProfile({ userId: user.id, workspaceId: ws.id }, { grade: 'sole' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bizProfileId).not.toBe(current.id);
    const wsRepo = await getWorkspaceRepo();
    expect(await wsRepo.getBizProfileId(ws.id)).toBe(r.bizProfileId);
    const bizRepo = await getBizProfileRepo();
    const row = await bizRepo.findById(r.bizProfileId);
    expect(row).toMatchObject({
      bizNo: '1112223333',
      taxType: 'general',
      status: 'active',
      grade: 'sole',
      gradeSource: 'user_overridden',
      gradeConfirmedBy: user.id,
    });
    // 이전 row 는 불변 — 그대로 남는다.
    expect(await bizRepo.findById(current.id)).toMatchObject({ bizNo: '1112223333', grade: 'general' });
  });

  it('a bizProfile patch replaces the number/tax/status and keeps the grade unless given', async () => {
    const user = await seedUser(db, { email: 'bizno@test.com' });
    const current = await seedBizProfile(db, { bizNo: '1112223333' });
    const ws = await seedBuyerWorkspace(db, { bizProfileId: current.id });
    await seedMembership(db, ws.id, user.id, 'admin');

    const r = await service.replaceBizProfile(
      { userId: user.id, workspaceId: ws.id },
      { bizProfile: { bizNo: '9998887777', taxType: 'simple', status: 'active' } },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bizRepo = await getBizProfileRepo();
    expect(await bizRepo.findById(r.bizProfileId)).toMatchObject({
      bizNo: '9998887777',
      taxType: 'simple',
      status: 'active',
      grade: 'general',
      gradeSource: 'user_overridden',
    });
  });
});

describe('WorkspaceService.replaceBizProfile — 첫 생성 · 등급 없는 베이스', () => {
  it('creates the first profile for a workspace with no pointer when a bizProfile patch is given', async () => {
    const user = await seedUser(db, { email: 'first@test.com' });
    const ws = await seedBuyerWorkspace(db); // biz_profile_id NULL
    await seedMembership(db, ws.id, user.id, 'admin');

    const r = await service.replaceBizProfile(
      { userId: user.id, workspaceId: ws.id },
      { bizProfile: { bizNo: '9998887777', taxType: 'simple', status: 'active' } },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const wsRepo = await getWorkspaceRepo();
    expect(await wsRepo.getBizProfileId(ws.id)).toBe(r.bizProfileId);
    const row = await (await getBizProfileRepo()).findById(r.bizProfileId);
    expect(row).toMatchObject({ bizNo: '9998887777', taxType: 'simple', status: 'active', gradeSource: 'user_overridden' });
    expect(row?.grade ?? null).toBeNull(); // 등급은 아무도 정하지 않았다
  });

  // 특성화: 베이스에도 패치에도 등급이 없으면 NULL 등급 위에 'user_overridden' 이 찍힌다 —
  // 옛 액션과 같은 동작이며, 의도인지는 별도 판단(등급이 없는 상태를 "사용자가 덮어썼다"고
  // 표시하는 셈). 바뀌면 이 테스트가 먼저 알린다.
  it('carries a NULL grade through when neither base nor patch has one (characterization)', async () => {
    const user = await seedUser(db, { email: 'nograde@test.com' });
    const baseId = randomUUID();
    await db.insert(bizProfiles).values({
      id: baseId,
      bizNo: '1112223333',
      taxType: 'general',
      status: 'active',
      gradeSource: 'unset',
    });
    const ws = await seedBuyerWorkspace(db, { bizProfileId: baseId });
    await seedMembership(db, ws.id, user.id, 'admin');

    const r = await service.replaceBizProfile(
      { userId: user.id, workspaceId: ws.id },
      { bizProfile: { bizNo: '4445556666', taxType: 'general', status: 'active' } },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await (await getBizProfileRepo()).findById(r.bizProfileId);
    expect(row?.grade ?? null).toBeNull();
    expect(row?.gradeSource).toBe('user_overridden');
  });
});
