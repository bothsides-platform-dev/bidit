// listAuditLogsAction tests — 설정 > 활동 기록 (C5 조회).
//
// Coverage:
//   - UNAUTHENTICATED when no session
//   - FORBIDDEN_NOT_ADMIN when caller is a member (DB 멤버십 재검증 — JWT role 신뢰 안 함)
//   - success: own-workspace rows only, newest first, actorName hydrated
//   - cursor pagination: before → older rows + nextCursor null at the end
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PgliteDB } from '@/lib/db/client-pglite';
import {
  seedBuyerWorkspace,
  seedUser,
  seedMembership,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { setupWorkspaceActionEnv, teardownWorkspaceActionEnv } from './_setup';
import { getAuditLogRepo } from '@/lib/server/repositories/factory';

const sessionRef: {
  value: {
    user: { id: string; email?: string; workspaceId: string | null; role: string | null };
  } | null;
} = { value: null };
vi.mock('@/lib/auth/session', () => ({
  requireSession: () =>
    sessionRef.value
      ? Promise.resolve(sessionRef.value)
      : Promise.reject(new Error('UNAUTHENTICATED')),
}));

import { listAuditLogsAction } from '../listAuditLogsAction';

let db: PgliteDB;

beforeEach(async () => {
  db = await setupWorkspaceActionEnv();
  sessionRef.value = null;
});

afterEach(() => {
  teardownWorkspaceActionEnv();
});

async function seedEnv() {
  const admin = await seedUser(db, { name: '관리자', email: 'admin@audit.com' });
  const member = await seedUser(db, { email: 'member@audit.com' });
  const ws = await seedBuyerWorkspace(db);
  await seedMembership(db, ws.id, admin.id, 'admin');
  await seedMembership(db, ws.id, member.id, 'member');
  return { admin, member, ws };
}

describe('listAuditLogsAction', () => {
  it('비로그인 → UNAUTHENTICATED', async () => {
    const r = await listAuditLogsAction({});
    expect(r).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('미승인(pending_approval) admin 은 거부한다 (서버액션 권한 차단)', async () => {
    const pending = await seedUser(db, { email: 'pending@audit.com' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, pending.id, 'admin', { approvalStatus: 'pending_approval' });
    sessionRef.value = { user: { id: pending.id, workspaceId: ws.id, role: 'admin' } };

    const r = await listAuditLogsAction({});
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('member 역할은 거부한다 (DB 멤버십 기준)', async () => {
    const { member, ws } = await seedEnv();
    sessionRef.value = { user: { id: member.id, workspaceId: ws.id, role: 'member' } };
    const r = await listAuditLogsAction({});
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('JWT role 이 admin 이어도 DB 멤버십이 member 면 거부한다 (stale JWT 방어)', async () => {
    const { member, ws } = await seedEnv();
    sessionRef.value = { user: { id: member.id, workspaceId: ws.id, role: 'admin' } };
    const r = await listAuditLogsAction({});
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_NOT_ADMIN' });
  });

  it('운영계정은 멤버십 행 없이 현재 워크스페이스의 활동 기록을 조회한다', async () => {
    const previous = process.env.MASTER_ACCOUNT_EMAILS;
    process.env.MASTER_ACCOUNT_EMAILS = 'ops@support-b.com';
    try {
      const master = await seedUser(db, { name: '운영자', email: 'ops@support-b.com' });
      const ws = await seedBuyerWorkspace(db);
      await (await getAuditLogRepo()).insert({
        actorUserId: master.id,
        actorWorkspaceId: ws.id,
        action: 'workspace.member_invite',
      });
      sessionRef.value = {
        user: {
          id: master.id,
          email: 'ops@support-b.com',
          workspaceId: ws.id,
          role: 'admin',
        },
      };

      const result = await listAuditLogsAction({});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toMatchObject({
        action: 'workspace.member_invite',
        actorUserId: master.id,
        viaMaster: true,
      });
    } finally {
      if (previous === undefined) delete process.env.MASTER_ACCOUNT_EMAILS;
      else process.env.MASTER_ACCOUNT_EMAILS = previous;
    }
  });

  it('admin 은 자기 워크스페이스 로그만 최신순으로 받는다 (행위자 이름 포함)', async () => {
    const { admin, ws } = await seedEnv();
    const otherWs = await seedBuyerWorkspace(db);
    const repo = await getAuditLogRepo();
    await repo.insert({
      actorUserId: admin.id,
      actorWorkspaceId: ws.id,
      action: 'rfp.award',
      entityType: 'rfp',
      entityId: 'P-2605-0001',
    });
    await repo.insert({
      actorUserId: admin.id,
      actorWorkspaceId: otherWs.id,
      action: 'rfp.create',
    });

    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };
    const r = await listAuditLogsAction({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toMatchObject({
      action: 'rfp.award',
      entityId: 'P-2605-0001',
      actorName: '관리자',
    });
    expect(r.nextCursor).toBeNull();
  });

  it('createdAt 이 ISO datetime 이 아닌 커서는 INVALID_INPUT 으로 거부한다 (Invalid Date 쿼리 방지)', async () => {
    const { admin, ws } = await seedEnv();
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };
    const r = await listAuditLogsAction({
      before: { createdAt: 'not-a-date', id: '00000000-0000-4000-8000-000000000000' },
    });
    expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('limit 를 채우면 nextCursor 를 반환하고, 커서로 이어서 받을 수 있다', async () => {
    const { admin, ws } = await seedEnv();
    const repo = await getAuditLogRepo();
    for (let i = 0; i < 3; i++) {
      await repo.insert({
        actorUserId: admin.id,
        actorWorkspaceId: ws.id,
        action: 'rfp.create',
        entityId: `P-2605-000${i}`,
      });
    }

    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };
    const first = await listAuditLogsAction({ limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.logs).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAuditLogsAction({ limit: 2, before: first.nextCursor! });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.logs).toHaveLength(1);
    const ids = [...first.logs, ...second.logs].map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
  });
});
