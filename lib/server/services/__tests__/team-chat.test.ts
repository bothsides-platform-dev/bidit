// TeamChatService — RFP-scoped internal team thread (v1).
//
// ACL contract:
//   buyer actor → allowed iff rfp.buyerWsId === actor.workspaceId
//   pg actor    → allowed iff invRepo.canAccess(rfpId, actor.workspaceId)
//                 (the same gate as the PG inbox detail loader)
// Scope: messages live in (rfpId, workspaceId) — a PG team thread and the
// buyer team thread on the same RFP must never mix (sealed-bid invariant).

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgliteDb } from '@/lib/db/client-pglite';
import {
  __resetForTest,
  __useDrizzleWithDbForTest,
  getAttachmentRepo,
  getInvitationRepo,
  getNotificationRepo,
  getRfpRepo,
  getRfpTeamMessageRepo,
  getRfpTeamMessageReadRepo,
  getUserRepo,
  getWorkspaceRepo,
} from '@/lib/server/repositories/factory';
import {
  seedBuyerWorkspace,
  seedMembership,
  seedPgWorkspace,
  seedRfp,
  seedUser,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { attachments, notifications, outboxEntries, rfpInvitations } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { TeamChatService, type TeamChatActor } from '../team-chat';
import type { PgliteDB } from '@/lib/db/client-pglite';

let db: PgliteDB;
let service: TeamChatService;

async function buildService(): Promise<TeamChatService> {
  const [rfpRepo, invRepo, userRepo, msgRepo, readRepo, wsRepo, notifRepo, attRepo] = await Promise.all([
    getRfpRepo(),
    getInvitationRepo(),
    getUserRepo(),
    getRfpTeamMessageRepo(),
    getRfpTeamMessageReadRepo(),
    getWorkspaceRepo(),
    getNotificationRepo(),
    getAttachmentRepo(),
  ]);
  return new TeamChatService(db, rfpRepo, invRepo, userRepo, msgRepo, readRepo, wsRepo, notifRepo, attRepo);
}

// Draft attachment — all owner FKs null (valid: num_nonnulls <= 1).
async function seedDraftAttachment(uploaderId: string, name = 'team.pdf') {
  const id = randomUUID();
  await db.insert(attachments).values({
    id,
    name,
    size: 2048,
    mimeType: 'application/pdf',
    uploadedBy: uploaderId,
  });
  return id;
}

async function seedScene() {
  const buyerUser = await seedUser(db, { name: '김구매' });
  const buyerWs = await seedBuyerWorkspace(db);
  await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
  const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });

  const pgUser = await seedUser(db, { name: '박피지' });
  const pgWs = await seedPgWorkspace(db, 'OO페이');
  await seedMembership(db, pgWs.id, pgUser.id, 'admin');
  // Invited PG — canAccess requires status in (pending|opened|accepted).
  await db.insert(rfpInvitations).values({
    id: randomUUID(),
    rfpId: rfp.id,
    pgWsId: pgWs.id,
    tokenHash: `hash-${randomUUID()}`,
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    status: 'pending',
  });

  const buyerActor: TeamChatActor = {
    userId: buyerUser.id,
    workspaceId: buyerWs.id,
    workspaceType: 'buyer',
  };
  const pgActor: TeamChatActor = {
    userId: pgUser.id,
    workspaceId: pgWs.id,
    workspaceType: 'pg',
  };
  return { buyerUser, buyerWs, pgUser, pgWs, rfp, buyerActor, pgActor };
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

describe('TeamChatService.sendMessage', () => {
  it('lets a member of the owning buyer workspace send, and returns authorName', async () => {
    const { rfp, buyerActor } = await seedScene();
    const result = await service.sendMessage({ rfpId: rfp.id, body: '내부 메모' }, buyerActor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageId).toBeTruthy();
      expect(result.authorName).toBe('김구매');
      expect(new Date(result.createdAt).getTime()).not.toBeNaN();
    }
  });

  it('lets an invited PG workspace send into its own scope', async () => {
    const { rfp, pgActor } = await seedScene();
    const result = await service.sendMessage({ rfpId: rfp.id, body: 'PG 내부 메모' }, pgActor);
    expect(result.ok).toBe(true);
  });

  it('rejects a buyer workspace that does not own the RFP', async () => {
    const { rfp } = await seedScene();
    const otherUser = await seedUser(db);
    const otherBuyer = await seedBuyerWorkspace(db);
    await seedMembership(db, otherBuyer.id, otherUser.id);
    const result = await service.sendMessage(
      { rfpId: rfp.id, body: 'x' },
      { userId: otherUser.id, workspaceId: otherBuyer.id, workspaceType: 'buyer' },
    );
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('rejects an uninvited PG workspace', async () => {
    const { rfp } = await seedScene();
    const strangerUser = await seedUser(db);
    const strangerPg = await seedPgWorkspace(db, '낯선페이');
    await seedMembership(db, strangerPg.id, strangerUser.id);
    const result = await service.sendMessage(
      { rfpId: rfp.id, body: 'x' },
      { userId: strangerUser.id, workspaceId: strangerPg.id, workspaceType: 'pg' },
    );
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('rejects an unknown rfp', async () => {
    const { buyerActor } = await seedScene();
    const result = await service.sendMessage(
      { rfpId: randomUUID(), body: 'x' },
      buyerActor,
    );
    expect(result).toEqual({ ok: false, error: 'RFP_NOT_FOUND' });
  });

  it('rejects an empty (whitespace-only) body', async () => {
    const { rfp, buyerActor } = await seedScene();
    const result = await service.sendMessage({ rfpId: rfp.id, body: '   ' }, buyerActor);
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('rejects a body over 4000 chars at the service layer (defense-in-depth)', async () => {
    const { rfp, buyerActor } = await seedScene();
    const result = await service.sendMessage(
      { rfpId: rfp.id, body: 'x'.repeat(4001) },
      buyerActor,
    );
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });
});

describe('TeamChatService.sendMessage — attachments', () => {
  it('re-parents draft attachments to the new message and returns them in order', async () => {
    const { rfp, buyerActor, buyerUser } = await seedScene();
    const a1 = await seedDraftAttachment(buyerUser.id, 'first.pdf');
    const a2 = await seedDraftAttachment(buyerUser.id, 'second.pdf');

    const result = await service.sendMessage(
      { rfpId: rfp.id, body: '첨부 메모', attachmentIds: [a1, a2] },
      buyerActor,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachments.map((a) => a.id)).toEqual([a1, a2]);
    expect(result.attachments.map((a) => a.name)).toEqual(['first.pdf', 'second.pdf']);
    expect(result.attachments[0].url).toBe(`/api/files/${a1}`);

    // Both attachment rows now point at the new message (exclusive-arc).
    for (const id of [a1, a2]) {
      const [row] = await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, id))
        .limit(1);
      expect(row.rfpTeamMessageId).toBe(result.messageId);
      expect(row.rfpId).toBeNull();
      expect(row.bidId).toBeNull();
      expect(row.bidNoteId).toBeNull();
      expect(row.chatMessageId).toBeNull();
    }
  });

  it('allows an attachment-only message (empty body)', async () => {
    const { rfp, buyerActor, buyerUser } = await seedScene();
    const a1 = await seedDraftAttachment(buyerUser.id);
    const result = await service.sendMessage(
      { rfpId: rfp.id, body: '', attachmentIds: [a1] },
      buyerActor,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachments).toHaveLength(1);
    }
  });

  it('rejects an empty message with no attachments', async () => {
    const { rfp, buyerActor } = await seedScene();
    const result = await service.sendMessage(
      { rfpId: rfp.id, body: '', attachmentIds: [] },
      buyerActor,
    );
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('rejects an attachment not uploaded by the actor', async () => {
    const { rfp, buyerActor } = await seedScene();
    const stranger = await seedUser(db);
    const foreign = await seedDraftAttachment(stranger.id);
    const result = await service.sendMessage(
      { rfpId: rfp.id, body: '메모', attachmentIds: [foreign] },
      buyerActor,
    );
    expect(result).toEqual({ ok: false, error: 'INVALID_ATTACHMENT' });
  });

  it('rejects an attachment that is already linked to another owner', async () => {
    const { rfp, buyerActor, buyerUser } = await seedScene();
    const a1 = await seedDraftAttachment(buyerUser.id);
    // First send claims it.
    const first = await service.sendMessage(
      { rfpId: rfp.id, body: '1', attachmentIds: [a1] },
      buyerActor,
    );
    expect(first.ok).toBe(true);
    // Second send re-using the same (now-linked) attachment must fail.
    const second = await service.sendMessage(
      { rfpId: rfp.id, body: '2', attachmentIds: [a1] },
      buyerActor,
    );
    expect(second).toEqual({ ok: false, error: 'INVALID_ATTACHMENT' });
  });

  it('첨부 검증 뒤 claim이 실패하면 팀 메시지 생성을 롤백한다', async () => {
    const { rfp, buyerActor, buyerUser } = await seedScene();
    const attachmentId = await seedDraftAttachment(buyerUser.id);
    const attRepo = await getAttachmentRepo();
    vi.spyOn(attRepo, 'claim').mockResolvedValueOnce([]);

    const result = await service.sendMessage(
      { rfpId: rfp.id, body: 'race', attachmentIds: [attachmentId] },
      buyerActor,
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_ATTACHMENT' });
    expect(await service.listMessages(rfp.id, buyerActor)).toEqual({ ok: true, messages: [] });
  });
});

describe('TeamChatService.listMessages', () => {
  it('returns own-scope messages asc and never the other workspace thread', async () => {
    const { rfp, buyerActor, pgActor } = await seedScene();
    await service.sendMessage({ rfpId: rfp.id, body: 'buyer 1' }, buyerActor);
    await service.sendMessage({ rfpId: rfp.id, body: 'pg 1' }, pgActor);
    await service.sendMessage({ rfpId: rfp.id, body: 'buyer 2' }, buyerActor);

    const buyerList = await service.listMessages(rfp.id, buyerActor);
    expect(buyerList.ok).toBe(true);
    if (buyerList.ok) {
      expect(buyerList.messages.map((m) => m.body)).toEqual(['buyer 1', 'buyer 2']);
      expect(buyerList.messages[0].authorName).toBe('김구매');
    }

    const pgList = await service.listMessages(rfp.id, pgActor);
    expect(pgList.ok).toBe(true);
    if (pgList.ok) {
      expect(pgList.messages.map((m) => m.body)).toEqual(['pg 1']);
    }
  });

  it('hydrates attachments on each message', async () => {
    const { rfp, buyerActor, buyerUser } = await seedScene();
    const a1 = await seedDraftAttachment(buyerUser.id, 'memo.pdf');
    await service.sendMessage(
      { rfpId: rfp.id, body: '첨부 메모', attachmentIds: [a1] },
      buyerActor,
    );
    await service.sendMessage({ rfpId: rfp.id, body: '텍스트만' }, buyerActor);

    const list = await service.listMessages(rfp.id, buyerActor);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.messages).toHaveLength(2);
      expect(list.messages[0].attachments.map((a) => a.id)).toEqual([a1]);
      expect(list.messages[0].attachments[0].url).toBe(`/api/files/${a1}`);
      // The text-only message has an empty attachments array, not undefined.
      expect(list.messages[1].attachments).toEqual([]);
    }
  });

  it('applies the same ACL as send (uninvited PG forbidden)', async () => {
    const { rfp } = await seedScene();
    const strangerUser = await seedUser(db);
    const strangerPg = await seedPgWorkspace(db, '낯선페이2');
    await seedMembership(db, strangerPg.id, strangerUser.id);
    const result = await service.listMessages(rfp.id, {
      userId: strangerUser.id,
      workspaceId: strangerPg.id,
      workspaceType: 'pg',
    });
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });
});

describe('TeamChatService.markRead + listThreads', () => {
  it('화면에 실제로 도착한 팀 메시지 시각까지만 cursor를 전진시킨다', async () => {
    const me = await seedUser(db, { email: 'boundary-me@b.com', name: '나' });
    const mate = await seedUser(db, { email: 'boundary-mate@b.com', name: '동료' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, me.id, 'admin');
    await seedMembership(db, ws.id, mate.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: me.id });
    const svc = await buildService();
    const sent = await svc.sendMessage(
      { rfpId: rfp.id, body: '화면에 도착한 메시지' },
      { userId: mate.id, workspaceId: ws.id, workspaceType: 'buyer' },
    );
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const mark = await svc.markRead(
      rfp.id,
      { userId: me.id, workspaceId: ws.id, workspaceType: 'buyer' },
      sent.messageId,
    );

    expect(mark).toEqual({ ok: true, readAt: sent.createdAt });
    const stored = await (await getRfpTeamMessageReadRepo()).getFor(rfp.id, ws.id, me.id);
    expect(stored?.lastReadAt.toISOString()).toBe(sent.createdAt);
  });

  it('markRead then listThreads clears unread for own read; teammate message raises unread', async () => {
    const me = await seedUser(db, { email: 'me@b.com', name: '나' });
    const mate = await seedUser(db, { email: 'mate@b.com', name: '동료' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, me.id, 'admin');
    await seedMembership(db, ws.id, mate.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: me.id });
    const svc = await buildService();
    const actorMe: TeamChatActor = { userId: me.id, workspaceId: ws.id, workspaceType: 'buyer' };

    // mate posts a team message
    const sent = await svc.sendMessage({ rfpId: rfp.id, body: '동료 메모' }, { userId: mate.id, workspaceId: ws.id, workspaceType: 'buyer' });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    let r = await svc.listThreads(actorMe);
    expect(r.ok && r.threads.find((t) => t.rfpId === rfp.id)?.unread).toBe(true);

    const mark = await svc.markRead(rfp.id, actorMe, sent.messageId);
    expect(mark.ok).toBe(true);

    r = await svc.listThreads(actorMe);
    expect(r.ok && r.threads.find((t) => t.rfpId === rfp.id)?.unread).toBe(false);
  });
});

describe('TeamChatService.sendMessage — notification fan-out', () => {
  it('fans out one inapp notification to teammates (not author) on send, deduped within window', async () => {
    const me = await seedUser(db, { email: 'me@b.com', name: '나' }); // author
    const mate = await seedUser(db, { email: 'mate@b.com', name: '동료' }); // recipient
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, me.id, 'admin');
    await seedMembership(db, ws.id, mate.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: me.id });
    const svc = await buildService();
    const actorMe: TeamChatActor = { userId: me.id, workspaceId: ws.id, workspaceType: 'buyer' };

    await svc.sendMessage({ rfpId: rfp.id, body: '메모1' }, actorMe);
    await svc.sendMessage({ rfpId: rfp.id, body: '메모2' }, actorMe);

    const mateNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, mate.id), eq(notifications.type, 'team_chat.message')));
    expect(mateNotifs).toHaveLength(1); // deduped within the window

    const meNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, me.id), eq(notifications.type, 'team_chat.message')));
    expect(meNotifs).toHaveLength(0); // author excluded
  });

  it('숨겨진 master 멤버(isSystemAccount)에게도 team_chat 인앱 알림을 보낸다', async () => {
    const me = await seedUser(db, { email: 'me-tc@b.com', name: '나' });
    // 화면 roster 엔 숨겨지지만 실제 사람인 master/ops 계정 — 본인 팀 알림은 받아야 한다.
    const master = await seedUser(db, { email: 'ops-tc@b.com', name: '운영자', isSystemAccount: true });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, me.id, 'admin');
    await seedMembership(db, ws.id, master.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: me.id });
    const svc = await buildService();
    const actorMe: TeamChatActor = { userId: me.id, workspaceId: ws.id, workspaceType: 'buyer' };

    await svc.sendMessage({ rfpId: rfp.id, body: '팀 메모' }, actorMe);

    const masterNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, master.id), eq(notifications.type, 'team_chat.message')));
    expect(masterNotifs).toHaveLength(1);
  });

  it('승인 대기(pending_approval) 멤버에게는 인앱/이메일 알림 모두 보내지 않는다', async () => {
    const me = await seedUser(db, { email: 'me-pending-tc@b.com', name: '나' });
    const pending = await seedUser(db, { email: 'pending-tc@b.com', name: '대기중' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, me.id, 'admin');
    await seedMembership(db, ws.id, pending.id, 'member', { approvalStatus: 'pending_approval' });
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: me.id });
    const svc = await buildService();
    const actorMe: TeamChatActor = { userId: me.id, workspaceId: ws.id, workspaceType: 'buyer' };

    await svc.sendMessage({ rfpId: rfp.id, body: '팀 메모' }, actorMe);

    const pendingNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, pending.id), eq(notifications.type, 'team_chat.message')));
    expect(pendingNotifs).toHaveLength(0);

    const pendingEmails = await db
      .select()
      .from(outboxEntries)
      .where(eq(outboxEntries.toAddr, 'pending-tc@b.com'));
    expect(pendingEmails).toHaveLength(0);
  });

  it('enqueues a coalesced team_chat.message email digest row to teammates on send', async () => {
    const me = await seedUser(db, { email: 'me@b.com', name: '나' }); // author
    const mate = await seedUser(db, { email: 'mate@b.com', name: '동료' }); // recipient
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, me.id, 'admin');
    await seedMembership(db, ws.id, mate.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: me.id });
    const svc = await buildService();
    const actorMe: TeamChatActor = { userId: me.id, workspaceId: ws.id, workspaceType: 'buyer' };

    await svc.sendMessage({ rfpId: rfp.id, body: '메모1' }, actorMe);

    const rows = await db
      .select()
      .from(outboxEntries)
      .where(eq(outboxEntries.event, 'team_chat.message'));
    // One coalesced row per non-author teammate (author excluded).
    expect(rows.length).toBe(1);
    expect(rows[0].toAddr).toBe('mate@b.com');
  });
});

describe('TeamChatService.listTeamMembers', () => {
  it('owning buyer 액터에게 팀 로스터를 반환한다', async () => {
    const { rfp, buyerActor, buyerUser } = await seedScene();
    const result = await service.listTeamMembers(rfp.id, buyerActor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.members.map((m) => m.userId)).toContain(buyerUser.id);
      expect(result.members.find((m) => m.userId === buyerUser.id)?.name).toBe('김구매');
    }
  });

  it('권한 없는 buyer 는 FORBIDDEN', async () => {
    const { rfp } = await seedScene();
    const otherWs = await seedBuyerWorkspace(db);
    const otherUser = await seedUser(db);
    await seedMembership(db, otherWs.id, otherUser.id, 'admin');
    const result = await service.listTeamMembers(rfp.id, {
      userId: otherUser.id, workspaceId: otherWs.id, workspaceType: 'buyer',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FORBIDDEN');
  });

  it('승인 대기(pending_approval) 멤버는 멘션 피커 로스터에 노출되지 않는다', async () => {
    const { rfp, buyerActor, buyerWs } = await seedScene();
    const pending = await seedUser(db, { name: '대기멤버' });
    await seedMembership(db, buyerWs.id, pending.id, 'member', { approvalStatus: 'pending_approval' });

    const result = await service.listTeamMembers(rfp.id, buyerActor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.members.map((m) => m.userId)).not.toContain(pending.id);
    }
  });
});

describe('TeamChatService.sendMessage — 멘션', () => {
  async function buyerSceneWithTwoMembers() {
    const author = await seedUser(db, { name: '김구매' });
    const mate = await seedUser(db, { name: '이동료' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, author.id, 'admin');
    await seedMembership(db, ws.id, mate.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: author.id });
    const actor: TeamChatActor = { userId: author.id, workspaceId: ws.id, workspaceType: 'buyer' };
    return { author, mate, ws, rfp, actor };
  }

  async function notifsFor(userId: string) {
    return db.select().from(notifications).where(eq(notifications.userId, userId));
  }

  it('멘션된 멤버는 team_chat.mention, 작성자는 알림 없음', async () => {
    const { mate, rfp, actor, author } = await buyerSceneWithTwoMembers();
    const r = await service.sendMessage({ rfpId: rfp.id, body: `<@${mate.id}> 확인해줘` }, actor);
    expect(r.ok).toBe(true);

    const mateNotifs = await notifsFor(mate.id);
    expect(mateNotifs).toHaveLength(1);
    expect(mateNotifs[0].type).toBe('team_chat.mention');
    // 미리보기는 토큰이 아니라 평문 @이름.
    expect(mateNotifs[0].body).toContain('@이동료');

    const authorNotifs = await notifsFor(author.id);
    expect(authorNotifs).toHaveLength(0);
  });

  it('멘션 안 된 멤버는 기존 team_chat.message 알림', async () => {
    const { mate, rfp, actor } = await buyerSceneWithTwoMembers();
    await service.sendMessage({ rfpId: rfp.id, body: '그냥 메모' }, actor);
    const mateNotifs = await notifsFor(mate.id);
    expect(mateNotifs).toHaveLength(1);
    expect(mateNotifs[0].type).toBe('team_chat.message');
  });

  it('비멤버 uuid 토큰은 무시 — 알림/누출 없음', async () => {
    const { mate, rfp, actor } = await buyerSceneWithTwoMembers();
    const stranger = '99999999-9999-4999-8999-999999999999';
    await service.sendMessage({ rfpId: rfp.id, body: `<@${stranger}> 안녕` }, actor);
    // 멤버 mate 는 멘션되지 않았으므로 일반 알림.
    const mateNotifs = await notifsFor(mate.id);
    expect(mateNotifs).toHaveLength(1);
    expect(mateNotifs[0].type).toBe('team_chat.message');
    // stranger 에게는 어떤 알림도 생성되지 않는다.
    const strangerNotifs = await notifsFor(stranger);
    expect(strangerNotifs).toHaveLength(0);
  });

  it('승인 대기(pending_approval) 멤버 토큰은 roster 검증에서 드롭 — 미리보기는 fallback 렌더', async () => {
    const { mate, rfp, actor } = await buyerSceneWithTwoMembers();
    const pending = await seedUser(db, { name: '대기멤버' });
    await seedMembership(db, actor.workspaceId, pending.id, 'member', { approvalStatus: 'pending_approval' });

    await service.sendMessage({ rfpId: rfp.id, body: `<@${pending.id}> 확인해줘` }, actor);

    // 대기 멤버에게는 어떤 알림도 생성되지 않는다.
    expect(await notifsFor(pending.id)).toHaveLength(0);
    // roster 에 없는 토큰이므로 동료의 미리보기는 이름이 아닌 fallback 으로 렌더된다.
    const mateNotifs = await notifsFor(mate.id);
    expect(mateNotifs).toHaveLength(1);
    expect(mateNotifs[0].type).toBe('team_chat.message');
    expect(mateNotifs[0].body).toContain('@(알 수 없음)');
    expect(mateNotifs[0].body).not.toContain('대기멤버');
  });

  it('@all 은 작성자 제외 전원에게 team_chat.mention', async () => {
    const { mate, rfp, actor, author } = await buyerSceneWithTwoMembers();
    const r = await service.sendMessage({ rfpId: rfp.id, body: '<@all> 공지' }, actor);
    expect(r.ok).toBe(true);
    const mateNotifs = await notifsFor(mate.id);
    expect(mateNotifs).toHaveLength(1);
    expect(mateNotifs[0].type).toBe('team_chat.mention');
    expect(await notifsFor(author.id)).toHaveLength(0);
  });
});

describe('TeamChatService.listThreads — 미리보기 평문화', () => {
  it('마지막 메시지의 멘션 토큰을 @이름 평문으로 보여준다', async () => {
    const author = await seedUser(db, { name: '김구매' });
    const mate = await seedUser(db, { name: '이동료' });
    const ws = await seedBuyerWorkspace(db);
    await seedMembership(db, ws.id, author.id, 'admin');
    await seedMembership(db, ws.id, mate.id, 'member');
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: author.id });
    const actor: TeamChatActor = { userId: author.id, workspaceId: ws.id, workspaceType: 'buyer' };

    await service.sendMessage({ rfpId: rfp.id, body: `<@${mate.id}> 확인` }, actor);
    const r = await service.listThreads(actor);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = r.threads.find((x) => x.rfpId === rfp.id)!;
      expect(t.preview).toBe('@이동료 확인');
    }
  });
});
