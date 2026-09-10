// Inbox + thread loaders — workspace-membership filtered.
//
// Contract under test (per impl-plan 2026-06-02, §Server Actions 인박스/스레드):
//   listConversationsForViewer():
//     - buyer viewer → conversations where buyer_ws_id = my workspace;
//       pg viewer → pg_ws_id = my workspace. Never leaks the other side.
//     - each row hydrates the counterparty workspace name/type, last message
//       preview, and an unread flag (last_message_at > my last_read_at).
//     - sorted by last_message_at desc.
//   loadConversationThread(conversationId):
//     - FORBIDDEN for a non-member; otherwise messages asc with a `self` flag
//       derived from author_ws_id === my workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema';

import {
  seedBuyerWorkspace,
  seedMembership,
  seedPgWorkspace,
  seedRfp,
  seedUser,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { setupRfpActionEnv, teardownRfpActionEnv } from '../../rfp/__tests__/_setup';
import {
  getBidRepo,
  getChatConversationRepo,
  getChatMessageRepo,
  getChatReadRepo,
  getRfpRepo,
  getWorkspaceRepo,
} from '@/lib/server/repositories/factory';
import type { PgliteDB } from '@/lib/db/client-pglite';
import { attachments, bids, rfpInvitations, rfps } from '@/lib/db/schema';
import {
  __setConversationReadStateForTest,
  type ConversationReadState,
} from '@/lib/chat/read-state/server';

type SessionUser = {
  id: string;
  email: string;
  workspaceId: string;
  workspaceType: 'buyer' | 'pg';
  role: 'admin' | 'member';
};
const sessionRef: { value: { user: SessionUser } | null } = { value: null };

vi.mock('@/lib/auth/session', () => ({
  requireSession: () =>
    sessionRef.value
      ? Promise.resolve(sessionRef.value)
      : Promise.reject(new Error('UNAUTHENTICATED')),
  requireBuyerSession: () =>
    sessionRef.value?.user.workspaceType === 'buyer'
      ? Promise.resolve(sessionRef.value)
      : Promise.reject(new Error('FORBIDDEN_BUYER')),
  requirePgSession: () =>
    sessionRef.value?.user.workspaceType === 'pg'
      ? Promise.resolve(sessionRef.value)
      : Promise.reject(new Error('FORBIDDEN_PG')),
}));

import { sendChatMessageAction } from '../sendChatMessageAction';
import { markConversationReadAction } from '../markConversationReadAction';
import {
  listConversationsForViewer,
  loadConversationThread,
} from '../conversationLoaders';

let db: PgliteDB;

async function seedPair() {
  const buyerUser = await seedUser(db, { email: 'buyer@b.com', name: '구매사담당' });
  const buyerWs = await seedBuyerWorkspace(db, { name: '구매사' });
  await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
  const pgUser = await seedUser(db, { email: 'sales@pg.com', name: 'PG영업' });
  const pgWs = await seedPgWorkspace(db, 'PG', { name: 'OO페이' });
  await seedMembership(db, pgWs.id, pgUser.id, 'admin');
  return { buyerUser, buyerWs, pgUser, pgWs };
}
function asBuyer(u: { id: string; email: string }, wsId: string) {
  sessionRef.value = {
    user: { id: u.id, email: u.email, workspaceId: wsId, workspaceType: 'buyer', role: 'admin' },
  };
}
function asPg(u: { id: string; email: string }, wsId: string) {
  sessionRef.value = {
    user: { id: u.id, email: u.email, workspaceId: wsId, workspaceType: 'pg', role: 'admin' },
  };
}

describe('listConversationsForViewer', () => {
  beforeEach(async () => {
    db = await setupRfpActionEnv();
  });
  afterEach(() => {
    teardownRfpActionEnv();
    sessionRef.value = null;
  });

  it('buyer sees the PG counterparty; the row hydrates name, type, preview, unread', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    // PG sends to buyer → unread for buyer.
    asPg(pgUser, pgWs.id);
    await sendChatMessageAction({ counterpartyWorkspaceId: buyerWs.id, body: '제안 보냅니다.' });

    asBuyer(buyerUser, buyerWs.id);
    const list = await listConversationsForViewer();
    expect(list).toHaveLength(1);
    expect(list[0].counterparty.name).toBe('OO페이');
    expect(list[0].counterparty.type).toBe('pg');
    expect(list[0].preview).toBe('제안 보냅니다.');
    expect(list[0].unread).toBe(true);
  });

  it('unread clears after markConversationRead', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    asPg(pgUser, pgWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: buyerWs.id,
      body: 'hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    asBuyer(buyerUser, buyerWs.id);
    await markConversationReadAction({
      conversationId: sent.conversationId,
      throughMessageId: sent.messageId,
    });
    const list = await listConversationsForViewer();
    expect(list[0].unread).toBe(false);
  });

  it('unread와 상대 workspace를 Conversation read state projection에서 받는다', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    asPg(pgUser, pgWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: buyerWs.id,
      body: '실제로는 unread',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const projectInbox = vi.fn().mockResolvedValue({
      ok: true,
      byConversationId: {
        [sent.conversationId]: {
          counterpartyWorkspaceId: pgWs.id,
          unread: false,
        },
      },
    });
    __setConversationReadStateForTest({
      projectInbox,
    } as unknown as ConversationReadState);

    asBuyer(buyerUser, buyerWs.id);
    const list = await listConversationsForViewer();

    expect(projectInbox).toHaveBeenCalledOnce();
    expect(list[0].counterparty.workspaceId).toBe(pgWs.id);
    expect(list[0].unread).toBe(false);
  });

  it('read-state projection이 workspace를 거부하면 빈 목록으로 fail-closed한다', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    asPg(pgUser, pgWs.id);
    await sendChatMessageAction({
      counterpartyWorkspaceId: buyerWs.id,
      body: 'projection 실패 시 숨겨질 대화',
    });
    __setConversationReadStateForTest({
      projectInbox: vi.fn().mockResolvedValue({ ok: false, error: 'FORBIDDEN' }),
    } as unknown as ConversationReadState);
    const lastByConversations = vi.spyOn(
      await getChatMessageRepo(),
      'lastByConversations',
    );

    asBuyer(buyerUser, buyerWs.id);

    expect(await listConversationsForViewer()).toEqual([]);
    expect(lastByConversations).not.toHaveBeenCalled();
  });

  it('does not leak the buyer side to a pg viewer of an unrelated workspace', async () => {
    const { buyerWs, pgUser, pgWs } = await seedPair();
    asPg(pgUser, pgWs.id);
    await sendChatMessageAction({ counterpartyWorkspaceId: buyerWs.id, body: 'x' });

    // an unrelated PG sees nothing
    const otherPgUser = await seedUser(db, { email: 'o@pg.com' });
    const otherPgWs = await seedPgWorkspace(db, 'PG2', { name: '다른PG' });
    await seedMembership(db, otherPgWs.id, otherPgUser.id, 'admin');
    asPg(otherPgUser, otherPgWs.id);
    expect(await listConversationsForViewer()).toEqual([]);
  });
});

describe('listConversationsForViewer closedAfterAward', () => {
  beforeEach(async () => {
    db = await setupRfpActionEnv();
  });
  afterEach(() => {
    teardownRfpActionEnv();
    sessionRef.value = null;
  });

  // RFP 에 초대된 PG 가 (메시지에 rfpId 가 붙으려면 접근권 필요) 구매사와 대화를
  // 갖는 선정 시나리오. 승자·패자 모두 accepted 초대를 받은 뒤 메시지를 보낸다.
  async function seedInvitation(rfpId: string, pgWsId: string) {
    const invId = randomUUID();
    await db.insert(rfpInvitations).values({
      id: invId,
      rfpId,
      pgWsId,
      tokenHash: randomUUID(),
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      status: 'accepted',
    });
    return invId;
  }

  async function seedAwardScenario() {
    const buyerUser = await seedUser(db, { email: 'buyer@b.com', name: '구매사담당' });
    const buyerWs = await seedBuyerWorkspace(db, { name: '구매사' });
    await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');

    const winUser = await seedUser(db, { email: 'win@pg.com', name: '승자영업' });
    const winWs = await seedPgWorkspace(db, 'WIN', { name: '승자페이' });
    await seedMembership(db, winWs.id, winUser.id, 'admin');

    const loseUser = await seedUser(db, { email: 'lose@pg.com', name: '패자영업' });
    const loseWs = await seedPgWorkspace(db, 'LOSE', { name: '패자페이' });
    await seedMembership(db, loseWs.id, loseUser.id, 'admin');

    const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });
    const winInv = await seedInvitation(rfp.id, winWs.id);
    await seedInvitation(rfp.id, loseWs.id);

    // 두 PG 모두 이 RFP 를 마지막 메시지로 갖는 대화 생성(초대됐으므로 rfpId 보존).
    asPg(winUser, winWs.id);
    await sendChatMessageAction({ counterpartyWorkspaceId: buyerWs.id, body: '승자 제안', rfpId: rfp.id });
    asPg(loseUser, loseWs.id);
    await sendChatMessageAction({ counterpartyWorkspaceId: buyerWs.id, body: '패자 제안', rfpId: rfp.id });

    return { buyerUser, buyerWs, winUser, winWs, loseUser, loseWs, rfp, winInv };
  }

  // 승자 PG 의 submitted bid 를 만들고(초대 재사용) RFP 를 그 bid 로 선정.
  async function awardTo(rfpId: string, winnerPgWsId: string, winnerInvId: string, submittedBy: string) {
    const bidId = randomUUID();
    await db.insert(bids).values({
      id: bidId,
      rfpId,
      pgWsId: winnerPgWsId,
      invitationId: winnerInvId,
      settleCycle: 'D+1',
      submittedBy,
      status: 'submitted',
    });
    await db.update(rfps).set({ status: 'awarded', awardedBidId: bidId }).where(eq(rfps.id, rfpId));
    return bidId;
  }

  function rowFor(
    list: Awaited<ReturnType<typeof listConversationsForViewer>>,
    counterpartyWsId: string,
  ) {
    return list.find((c) => c.counterparty.workspaceId === counterpartyWsId);
  }

  it('buyer 뷰어: 미선정 PG 대화는 closedAfterAward=true, 승자 PG 대화는 false', async () => {
    const { buyerUser, buyerWs, winWs, winInv, loseWs, rfp } = await seedAwardScenario();
    await awardTo(rfp.id, winWs.id, winInv, buyerUser.id);

    asBuyer(buyerUser, buyerWs.id);
    const list = await listConversationsForViewer();
    expect(rowFor(list, winWs.id)?.closedAfterAward).toBe(false);
    expect(rowFor(list, loseWs.id)?.closedAfterAward).toBe(true);
  });

  it('미선정 PG 뷰어: 자기 대화가 closedAfterAward=true', async () => {
    const { buyerUser, winWs, winInv, loseUser, loseWs, rfp } = await seedAwardScenario();
    await awardTo(rfp.id, winWs.id, winInv, buyerUser.id);

    asPg(loseUser, loseWs.id);
    const list = await listConversationsForViewer();
    expect(list[0].closedAfterAward).toBe(true);
  });

  it('승자 PG 뷰어: 자기 대화는 closedAfterAward=false', async () => {
    const { buyerUser, winUser, winWs, winInv, rfp } = await seedAwardScenario();
    await awardTo(rfp.id, winWs.id, winInv, buyerUser.id);

    asPg(winUser, winWs.id);
    const list = await listConversationsForViewer();
    expect(list[0].closedAfterAward).toBe(false);
  });

  it('선정 전(sent)에는 어떤 대화도 닫지 않는다', async () => {
    const { buyerUser, buyerWs } = await seedAwardScenario();
    asBuyer(buyerUser, buyerWs.id);
    const list = await listConversationsForViewer();
    expect(list.every((c) => c.closedAfterAward === false)).toBe(true);
  });

  it('승자 신원은 클라이언트로 새지 않는다 — closedAfterAward 불리언만', async () => {
    const { buyerUser, buyerWs, winWs, winInv, loseWs, rfp } = await seedAwardScenario();
    await awardTo(rfp.id, winWs.id, winInv, buyerUser.id);

    asBuyer(buyerUser, buyerWs.id);
    const loseRow = rowFor(await listConversationsForViewer(), loseWs.id);
    expect(loseRow).not.toHaveProperty('awardedBidId');
    expect(loseRow).not.toHaveProperty('winnerPgWsId');
    expect(loseRow?.closedAfterAward).toBe(true);
  });
});

describe('loadConversationThread', () => {
  beforeEach(async () => {
    db = await setupRfpActionEnv();
  });
  afterEach(() => {
    teardownRfpActionEnv();
    sessionRef.value = null;
  });

  it('returns messages asc with self derived from the viewer workspace', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'buyer says hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    asPg(pgUser, pgWs.id);
    await sendChatMessageAction({ conversationId: sent.conversationId, body: 'pg replies' });

    asBuyer(buyerUser, buyerWs.id);
    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.messages.map((m) => m.body)).toEqual(['buyer says hi', 'pg replies']);
    expect(thread.messages.map((m) => m.sender)).toEqual(['self', 'other']);
  });

  it('상대 읽음 영수증을 Conversation read state projection에서 받는다', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: '아직 상대가 읽지 않은 메시지',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const projectThread = vi.fn().mockResolvedValue({
      ok: true,
      counterpartyWorkspaceId: pgWs.id,
      readByCounterpartyMessageIds: [sent.messageId],
    });
    __setConversationReadStateForTest({
      projectThread,
    } as unknown as ConversationReadState);

    const thread = await loadConversationThread(sent.conversationId);

    expect(projectThread).toHaveBeenCalledOnce();
    expect(thread.ok && thread.messages[0]?.readByCounterparty).toBe(true);
  });

  it('read-state projection이 workspace를 거부하면 thread도 fail-closed한다', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'projection 실패 시 반환하지 않을 메시지',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    __setConversationReadStateForTest({
      projectThread: vi.fn().mockResolvedValue({ ok: false, error: 'FORBIDDEN' }),
    } as unknown as ConversationReadState);

    const result = await loadConversationThread(sent.conversationId);

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('FORBIDDEN for a non-member viewer', async () => {
    const { buyerWs, pgUser, pgWs } = await seedPair();
    asPg(pgUser, pgWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: buyerWs.id,
      body: 'hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const outsider = await seedUser(db, { email: 'out@pg.com' });
    const outsiderWs = await seedPgWorkspace(db, 'OUT', { name: '외부PG' });
    await seedMembership(db, outsiderWs.id, outsider.id, 'admin');
    asPg(outsider, outsiderWs.id);
    const thread = await loadConversationThread(sent.conversationId);
    expect(thread).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('readByCounterparty is true for my message once the counterparty has read it', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    // buyer sends, then pg reads → pg's last_read_at >= the message.
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'buyer says hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    asPg(pgUser, pgWs.id);
    await markConversationReadAction({
      conversationId: sent.conversationId,
      throughMessageId: sent.messageId,
    });

    asBuyer(buyerUser, buyerWs.id);
    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].sender).toBe('self');
    expect(thread.messages[0].readByCounterparty).toBe(true);
  });

  it('readByCounterparty is false for my message the counterparty has not yet read', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    // buyer sends; pg never reads.
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'buyer says hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.messages[0].readByCounterparty).toBe(false);
  });

  it("readByCounterparty is false for a message the counterparty sent (it's the viewer's own read, not the counterparty's)", async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    // pg sends to buyer; buyer reads it. The pg-authored message is `other`,
    // so readByCounterparty must stay false — the viewer's own read doesn't count.
    asPg(pgUser, pgWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: buyerWs.id,
      body: 'pg says hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    asBuyer(buyerUser, buyerWs.id);
    await markConversationReadAction({
      conversationId: sent.conversationId,
      throughMessageId: sent.messageId,
    });
    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.messages[0].sender).toBe('other');
    expect(thread.messages[0].readByCounterparty).toBe(false);
  });

  it('messages without attachments have attachments: []', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'no attachments here',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.messages[0].attachments).toEqual([]);
  });

  it('messages with attachments include attachment data', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);

    // Insert a draft attachment (uploaded by the session user, no chatMessageId).
    const attId = randomUUID();
    await db.insert(attachments).values({
      id: attId,
      name: 'spec.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      uploadedBy: buyerUser.id,
    });

    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'with attachment',
      attachmentIds: [attId],
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    const msg = thread.messages[0];
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].name).toBe('spec.pdf');
    expect(msg.attachments[0].url).toBe(`/api/files/${attId}`);
  });

  it('attaches author identity to both sides and returns the viewer', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'buyer says hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    asPg(pgUser, pgWs.id);
    await sendChatMessageAction({ conversationId: sent.conversationId, body: 'pg replies' });

    asBuyer(buyerUser, buyerWs.id);
    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;

    expect(thread.messages.map((m) => m.authorUserId)).toEqual([buyerUser.id, pgUser.id]);
    expect(thread.messages.map((m) => m.authorName)).toEqual(['구매사담당', 'PG영업']);
    expect(thread.messages.map((m) => m.authorEmail)).toEqual(['buyer@b.com', 'sales@pg.com']);
    expect(thread.viewer).toMatchObject({ userId: buyerUser.id, name: '구매사담당' });
  });

  it('loadConversationThread returns rfpById map for rfpIds present in the thread', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    // Seed an RFP owned by the buyer workspace.
    const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'RFP 관련 메시지',
      rfpId: rfp.id,
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.rfpById[rfp.id]).toEqual({ code: rfp.code, title: 'RFP' });
  });

  it('counterparty includes logoUpdatedAt field (null when no logo set)', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'logo field test',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.counterparty).toHaveProperty('logoUpdatedAt');
    // No logo seeded → null
    expect(thread.counterparty.logoUpdatedAt).toBeNull();
  });

  it('ThreadMessage carries authorAvatarUpdatedAt from the users join', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'avatar test',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    // Set the sender's avatar_updated_at.
    await db.update(users).set({ avatarUpdatedAt: new Date('2026-06-21T00:00:00.000Z') }).where(eq(users.id, buyerUser.id));

    const res = await loadConversationThread(sent.conversationId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0].authorAvatarUpdatedAt).toBe('2026-06-21T00:00:00.000Z');
    expect(res.viewer).toHaveProperty('avatarUpdatedAt');
  });

  it('a co-member of the viewer workspace reading does NOT flip readByCounterparty (only the counterparty workspace counts)', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    // Second buyer member joins the viewer's OWN workspace.
    const buyerUser2 = await seedUser(db, { email: 'buyer2@b.com', name: '구매사담당2' });
    await seedMembership(db, buyerWs.id, buyerUser2.id, 'member');

    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'buyer says hi',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    // The OTHER buyer member reads — but the PG side never has.
    asBuyer(buyerUser2, buyerWs.id);
    await markConversationReadAction({
      conversationId: sent.conversationId,
      throughMessageId: sent.messageId,
    });

    asBuyer(buyerUser, buyerWs.id);
    const thread = await loadConversationThread(sent.conversationId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(thread.messages[0].readByCounterparty).toBe(false);
  });

  it('does not reinterpret a dual-member user read from the viewer workspace as a counterparty read', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    const dualMember = await seedUser(db, {
      email: 'dual@both.com',
      name: '양쪽 담당자',
    });
    await seedMembership(db, buyerWs.id, dualMember.id, 'member');
    await seedMembership(db, pgWs.id, dualMember.id, 'member');

    asBuyer(buyerUser, buyerWs.id);
    const sent = await sendChatMessageAction({
      counterpartyWorkspaceId: pgWs.id,
      body: 'workspace-scoped receipt',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    asBuyer(dualMember, buyerWs.id);
    await markConversationReadAction({
      conversationId: sent.conversationId,
      throughMessageId: sent.messageId,
    });

    asBuyer(buyerUser, buyerWs.id);
    const beforeCounterpartyRead = await loadConversationThread(sent.conversationId);
    expect(beforeCounterpartyRead.ok).toBe(true);
    if (!beforeCounterpartyRead.ok) return;
    expect(beforeCounterpartyRead.messages[0].readByCounterparty).toBe(false);

    asPg(dualMember, pgWs.id);
    await markConversationReadAction({
      conversationId: sent.conversationId,
      throughMessageId: sent.messageId,
    });

    asBuyer(buyerUser, buyerWs.id);
    const afterCounterpartyRead = await loadConversationThread(sent.conversationId);
    expect(afterCounterpartyRead.ok).toBe(true);
    if (!afterCounterpartyRead.ok) return;
    expect(afterCounterpartyRead.messages[0].readByCounterparty).toBe(true);
  });
});

// N+1 regression guard.
//
// The list loader used to issue ~4 queries PER conversation (counterparty
// workspace, the conversation's entire message history, my read row, the
// rfp — plus a bid lookup per distinct awarded rfp). Behavioural tests cannot
// see that: the output is identical either way, only the query count differs.
// So we count repo calls directly and assert the total does not grow with the
// number of conversations. Without this, the N+1 silently comes back.
describe('listConversationsForViewer — query count does not scale with conversation count', () => {
  beforeEach(async () => {
    db = await setupRfpActionEnv();
  });
  afterEach(() => {
    teardownRfpActionEnv();
    sessionRef.value = null;
    vi.restoreAllMocks();
  });

  /** Seeds one buyer with `n` PG counterparties, each with a message. */
  async function seedNConversations(n: number) {
    const buyerUser = await seedUser(db, { email: 'buyer@b.com', name: '구매사담당' });
    const buyerWs = await seedBuyerWorkspace(db, { name: '구매사' });
    await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
    for (let i = 0; i < n; i++) {
      const pgUser = await seedUser(db, { email: `pg${i}@pg.com`, name: `PG영업${i}` });
      const pgWs = await seedPgWorkspace(db, `PG${i}`, { name: `페이${i}` });
      await seedMembership(db, pgWs.id, pgUser.id, 'admin');
      asPg(pgUser, pgWs.id);
      await sendChatMessageAction({ counterpartyWorkspaceId: buyerWs.id, body: `msg ${i}` });
    }
    return { buyerUser, buyerWs };
  }

  /**
   * Counts calls to every repo method the list loader can reach. Spies are
   * installed AFTER seeding so only the loader's own traffic is counted.
   */
  async function countLoaderRepoCalls(): Promise<number> {
    const [convRepo, msgRepo, readRepo, wsRepo, rfpRepo, bidRepo] = await Promise.all([
      getChatConversationRepo(),
      getChatMessageRepo(),
      getChatReadRepo(),
      getWorkspaceRepo(),
      getRfpRepo(),
      getBidRepo(),
    ]);
    let calls = 0;
    const track = <T extends object>(obj: T, keys: (keyof T)[]) => {
      for (const k of keys) {
        if (typeof obj[k] !== 'function') continue;
        vi.spyOn(obj, k as never).mockImplementation(((
          ...args: unknown[]
        ) => {
          calls += 1;
          return (
            Object.getPrototypeOf(obj) as Record<string, (...a: unknown[]) => unknown>
          )[k as string].apply(obj, args);
        }) as never);
      }
    };
    track(convRepo, ['listForWorkspace']);
    track(msgRepo, ['listByConversation', 'lastByConversations']);
    track(readRepo, ['getFor', 'getForMany']);
    track(wsRepo, ['findById', 'getDisplayInfo', 'findDisplayInfoByIds']);
    track(rfpRepo, ['findById', 'findByIds']);
    track(bidRepo, ['findById', 'findPgWsIdsByIds']);
    return await (async () => {
      await listConversationsForViewer();
      return calls;
    })();
  }

  it('issues the same number of repo calls for 2 conversations as for 8', async () => {
    const small = await seedNConversations(2);
    asBuyer(small.buyerUser, small.buyerWs.id);
    const callsForTwo = await countLoaderRepoCalls();

    vi.restoreAllMocks();
    teardownRfpActionEnv();
    db = await setupRfpActionEnv();

    const big = await seedNConversations(8);
    asBuyer(big.buyerUser, big.buyerWs.id);
    const callsForEight = await countLoaderRepoCalls();

    expect(callsForTwo).toBeGreaterThan(0);
    expect(callsForEight).toBe(callsForTwo);
  });

  it('never asks for a conversation\'s full message history', async () => {
    const { buyerUser, buyerWs } = await seedNConversations(3);
    asBuyer(buyerUser, buyerWs.id);
    const msgRepo = await getChatMessageRepo();
    const listAll = vi.spyOn(msgRepo, 'listByConversation');

    await listConversationsForViewer();

    // Only the tail of each conversation is needed for the list; pulling every
    // message to read `at(-1)` is the amplifier that made this O(messages).
    expect(listAll).not.toHaveBeenCalled();
  });
});
