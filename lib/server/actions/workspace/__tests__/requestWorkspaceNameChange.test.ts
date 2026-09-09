import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PgliteDB } from '@/lib/db/client-pglite';
import { seedBuyerWorkspace, seedMembership, seedUser } from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { getAuditLogRepo, getWorkspaceRepo } from '@/lib/server/repositories/factory';
import { auditLogs, workspaces } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { setupWorkspaceActionEnv, teardownWorkspaceActionEnv } from './_setup';

const sessionRef: { value: { user: { id: string; email?: string; workspaceId: string | null; role: string | null } } | null } = { value: null };
vi.mock('@/lib/auth/session', () => ({
  requireSession: () => sessionRef.value ? Promise.resolve(sessionRef.value) : Promise.reject(new Error('UNAUTHENTICATED')),
}));

import { requestWorkspaceNameChangeAction } from '../requestWorkspaceNameChangeAction';

function requestNameChange(name: string) {
  return requestWorkspaceNameChangeAction({
    workspaceId: sessionRef.value?.user.workspaceId ?? 'missing-workspace',
    name,
  });
}

let db: PgliteDB;
beforeEach(async () => {
  db = await setupWorkspaceActionEnv();
  sessionRef.value = null;
});
afterEach(() => teardownWorkspaceActionEnv());

describe('requestWorkspaceNameChangeAction', () => {
  it('승인된 admin의 요청을 접수하지만 현재 이름은 바꾸지 않는다', async () => {
    const admin = await seedUser(db, { email: 'admin@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };

    expect(await requestNameChange('새 이름')).toEqual({ ok: true });
    const repo = await getWorkspaceRepo();
    expect(await repo.getName(ws.id)).toBe('기존 이름');
    expect(await repo.findLatestNameChangeRequest(ws.id)).toMatchObject({
      workspaceId: ws.id,
      requestedByUserId: admin.id,
      currentName: '기존 이름',
      requestedName: '새 이름',
      status: 'pending',
    });
    const [audit] = await db.select().from(auditLogs)
      .where(eq(auditLogs.action, 'workspace.name_change_request'));
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      actorWorkspaceId: ws.id,
      entityId: ws.id,
      metadata: {
        currentName: '기존 이름',
        requestedName: '새 이름',
        actorWasMaster: false,
      },
    });
  });

  it('세션 또는 워크스페이스가 없으면 요청을 거부한다', async () => {
    expect(await requestNameChange('새 이름')).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });

    const user = await seedUser(db, { email: 'no-workspace@rename.com' });
    sessionRef.value = { user: { id: user.id, workspaceId: null, role: 'admin' } };
    expect(await requestNameChange('새 이름')).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  it('화면을 연 뒤 다른 워크스페이스로 전환했으면 이름 변경 요청을 거부한다', async () => {
    const admin = await seedUser(db, { email: 'stale@rename.com' });
    const renderedWorkspace = await seedBuyerWorkspace(db, { name: '열어 둔 회사' });
    const activeWorkspace = await seedBuyerWorkspace(db, { name: '전환한 회사' });
    await seedMembership(db, activeWorkspace.id, admin.id, 'admin');
    sessionRef.value = {
      user: { id: admin.id, workspaceId: activeWorkspace.id, role: 'admin' },
    };

    expect(await requestWorkspaceNameChangeAction({
      workspaceId: renderedWorkspace.id,
      name: '탈취 이름',
    })).toEqual({ ok: false, error: 'WORKSPACE_CHANGED' });
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(renderedWorkspace.id)).toBeUndefined();
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(activeWorkspace.id)).toBeUndefined();
  });

  it('마스터 계정은 멤버십 row 없이도 변경 요청을 만들 수 있다', async () => {
    const previous = process.env.MASTER_ACCOUNT_EMAILS;
    process.env.MASTER_ACCOUNT_EMAILS = 'ops@support-b.com';
    try {
      const master = await seedUser(db, { email: 'ops@support-b.com' });
      const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
      sessionRef.value = {
        user: { id: master.id, email: 'ops@support-b.com', workspaceId: ws.id, role: 'admin' },
      };

      expect(await requestNameChange('새 이름')).toEqual({ ok: true });
      expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(ws.id)).toMatchObject({
        requestedByUserId: master.id,
        requestedName: '새 이름',
      });

      process.env.MASTER_ACCOUNT_EMAILS = '';
      const logs = await (await getAuditLogRepo()).listForWorkspace(ws.id, { limit: 50 });
      expect(logs).toContainEqual(expect.objectContaining({
        action: 'workspace.name_change_request',
        actorUserId: master.id,
        viaMaster: true,
      }));
    } finally {
      if (previous === undefined) delete process.env.MASTER_ACCOUNT_EMAILS;
      else process.env.MASTER_ACCOUNT_EMAILS = previous;
    }
  });

  it('입력 스키마가 빈 이름과 200자 초과 이름을 거부한다', async () => {
    const admin = await seedUser(db, { email: 'invalid@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };

    expect(await requestNameChange('   ')).toEqual({
      ok: false,
      error: 'INVALID_INPUT',
    });
    expect(await requestNameChange('가'.repeat(201))).toEqual({
      ok: false,
      error: 'INVALID_INPUT',
    });
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(ws.id)).toBeUndefined();
  });

  it('현재 이름과 같은 이름은 요청하지 않는다', async () => {
    const admin = await seedUser(db, { email: 'same@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '같은 이름' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };

    expect(await requestNameChange('같은 이름')).toEqual({
      ok: false,
      error: 'SAME_NAME',
    });
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(ws.id)).toBeUndefined();
  });

  it('감사 로그 저장이 실패하면 요청 행도 함께 롤백한다', async () => {
    const admin = await seedUser(db, { email: 'rollback@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };
    const auditRepo = await getAuditLogRepo();
    const insertSpy = vi.spyOn(auditRepo, 'insert').mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(requestNameChange('새 이름')).rejects.toThrow('audit unavailable');
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(ws.id)).toBeUndefined();
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    insertSpy.mockRestore();
  });

  it('대기 중인 요청이 있으면 두 번째 요청을 거부한다', async () => {
    const admin = await seedUser(db, { email: 'admin2@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };

    expect(await requestNameChange('첫 이름')).toEqual({ ok: true });
    expect(await requestNameChange('둘째 이름')).toEqual({ ok: false, error: 'ALREADY_PENDING' });
    expect(await (await getWorkspaceRepo()).getName(ws.id)).toBe('기존 이름');
  });

  it('일반 멤버의 요청은 거부한다', async () => {
    const member = await seedUser(db, { email: 'member@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
    await seedMembership(db, ws.id, member.id, 'member');
    sessionRef.value = { user: { id: member.id, workspaceId: ws.id, role: 'member' } };

    expect(await requestNameChange('탈취 이름')).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(ws.id)).toBeUndefined();
  });

  it('정지된 워크스페이스는 직접 호출해도 요청을 만들지 않는다', async () => {
    const admin = await seedUser(db, { email: 'suspended@rename.com' });
    const ws = await seedBuyerWorkspace(db, { name: '기존 이름' });
    await seedMembership(db, ws.id, admin.id, 'admin');
    await db.update(workspaces).set({ status: 'suspended' }).where(eq(workspaces.id, ws.id));
    sessionRef.value = { user: { id: admin.id, workspaceId: ws.id, role: 'admin' } };

    expect(await requestNameChange('새 이름')).toEqual({
      ok: false,
      error: 'WORKSPACE_INACTIVE',
    });
    expect(await (await getWorkspaceRepo()).findLatestNameChangeRequest(ws.id)).toBeUndefined();
  });
});
