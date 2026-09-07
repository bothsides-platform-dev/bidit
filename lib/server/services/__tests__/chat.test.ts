import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createPgliteDb } from '@/lib/db/client-pglite';
import {
  __resetForTest,
  __useDrizzleWithDbForTest,
  getAttachmentRepo,
  getChatConversationRepo,
  getChatMessageRepo,
  getInvitationRepo,
  getNotificationRepo,
  getRfpRepo,
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
import { attachments, chatMessages, notifications, outboxEntries } from '@/lib/db/schema';
import { ChatService } from '../chat';
import type { PgliteDB } from '@/lib/db/client-pglite';

// Best-effort centrifugo calls must not block tests.
vi.mock('@/lib/server/realtime/centrifugo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../realtime/centrifugo')>();
  return {
    ...actual,
    publishChatEvent: vi.fn().mockResolvedValue(undefined),
    isUserPresentInConversation: vi.fn().mockResolvedValue(false),
    presentUserIdsInConversation: vi.fn().mockResolvedValue(new Set<string>()),
  };
});

let db: PgliteDB;
let service: ChatService;

async function buildService(): Promise<ChatService> {
  const [convRepo, wsRepo, userRepo, attRepo, msgRepo, notifRepo, rfpRepo, invRepo] =
    await Promise.all([
      getChatConversationRepo(),
      getWorkspaceRepo(),
      getUserRepo(),
      getAttachmentRepo(),
      getChatMessageRepo(),
      getNotificationRepo(),
      getRfpRepo(),
      getInvitationRepo(),
    ]);
  return new ChatService(db, convRepo, wsRepo, userRepo, attRepo, msgRepo, notifRepo, rfpRepo, invRepo);
}

async function seedPair() {
  const buyerUser = await seedUser(db, { email: 'buyer@chat.com', name: '구매사담당' });
  const buyerWs = await seedBuyerWorkspace(db, { name: '구매사' });
  await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');

  const pgUser = await seedUser(db, { email: 'pg@chat.com', name: 'PG영업' });
  const pgWs = await seedPgWorkspace(db, 'PG', { name: 'OO페이' });
  await seedMembership(db, pgWs.id, pgUser.id, 'admin');

  return { buyerUser, buyerWs, pgUser, pgWs };
}

beforeEach(async () => {
  __resetForTest();
  db = await createPgliteDb();
  await __useDrizzleWithDbForTest(db);
  service = await buildService();
});

afterEach(() => {
  __resetForTest();
  vi.clearAllMocks();
});

describe('ChatService.sendMessage', () => {
  it('persists a message and creates a conversation for a buyer→PG pair', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();

    const result = await service.sendMessage(
      {
        counterpartyWorkspaceId: pgWs.id,
        body: '안녕하세요, 견적 문의드립니다.',
        attachmentIds: [],
      },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const messages = await db.select().from(chatMessages);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('안녕하세요, 견적 문의드립니다.');
    expect(messages[0].authorUserId).toBe(buyerUser.id);
    expect(messages[0].conversationId).toBe(result.conversationId);
  });

  it('dispatches an in-app notification to the counterparty member', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();

    const result = await service.sendMessage(
      {
        counterpartyWorkspaceId: pgWs.id,
        body: '테스트 메시지',
        attachmentIds: [],
      },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const notifs = await db.select().from(notifications);
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0].type).toBe('chat.message');
    // 대화 식별자를 링크에 싣는다 — 알림 행에 대화 컬럼이 없어서 이 링크가
    // 읽음 정리·토스트 억제·dedupe 의 유일한 대화 키다(딥링크도 겸한다).
    expect(notifs[0].linkUrl).toBe(`/messages?c=${result.conversationId}`);
  });

  it('does not let another conversation’s queued notification suppress this one (regression)', async () => {
    const { pgUser, pgWs } = await seedPair();

    // 같은 PG 담당자와 대화하는 구매사 둘. 예전 dedupe 는 (user, workspace) 범위라
    // 먼저 온 대화의 queued 알림이 나중 대화의 알림을 통째로 삼켰다.
    const buyerAUser = await seedUser(db, { email: 'a@chat.com', name: 'A담당' });
    const buyerAWs = await seedBuyerWorkspace(db, { name: 'A상사' });
    await seedMembership(db, buyerAWs.id, buyerAUser.id, 'admin');
    const buyerBUser = await seedUser(db, { email: 'b@chat.com', name: 'B담당' });
    const buyerBWs = await seedBuyerWorkspace(db, { name: 'B상사' });
    await seedMembership(db, buyerBWs.id, buyerBUser.id, 'admin');

    const first = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: 'A 입니다', attachmentIds: [] },
      { userId: buyerAUser.id, workspaceId: buyerAWs.id, workspaceType: 'buyer' },
    );
    const second = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: 'B 입니다', attachmentIds: [] },
      { userId: buyerBUser.id, workspaceId: buyerBWs.id, workspaceType: 'buyer' },
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, pgUser.id));
    expect(new Set(notifs.map((n) => n.linkUrl))).toEqual(
      new Set([`/messages?c=${first.conversationId}`, `/messages?c=${second.conversationId}`]),
    );
  });

  it('still dedupes a second message within the same conversation window', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();

    for (const body of ['첫 메시지', '둘째 메시지']) {
      await service.sendMessage(
        { counterpartyWorkspaceId: pgWs.id, body, attachmentIds: [] },
        { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
      );
    }

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, pgUser.id));
    expect(notifs).toHaveLength(1);
  });

  it('enqueues a windowed-digest outbox row for the offline counterparty', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();

    await service.sendMessage(
      {
        counterpartyWorkspaceId: pgWs.id,
        body: '이메일 아웃박스 테스트',
        attachmentIds: [],
      },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    const outbox = await db.select().from(outboxEntries);
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox[0].event).toBe('chat.message');
  });

  it('does not notify a pending-approval counterparty member (in-app or email)', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    const pendingMember = await seedUser(db, { email: 'pending@chat.com', name: '대기' });
    await seedMembership(db, pgWs.id, pendingMember.id, 'member', { approvalStatus: 'pending_approval' });

    const result = await service.sendMessage(
      {
        counterpartyWorkspaceId: pgWs.id,
        body: '대기 멤버 제외 테스트',
        attachmentIds: [],
      },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result.ok).toBe(true);
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, pendingMember.id));
    expect(notifs).toHaveLength(0);

    const outbox = await db
      .select()
      .from(outboxEntries)
      .where(eq(outboxEntries.toAddr, 'pending@chat.com'));
    expect(outbox).toHaveLength(0);
  });

  it('reuses an existing conversation for the same buyer↔PG pair', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    const actor = { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' as const };

    const r1 = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '첫 번째', attachmentIds: [] },
      actor,
    );
    const r2 = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '두 번째', attachmentIds: [] },
      actor,
    );

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.conversationId).toBe(r2.conversationId);

    const messages = await db.select().from(chatMessages);
    expect(messages).toHaveLength(2);
  });

  it('returns CONVERSATION_NOT_FOUND for an unknown conversationId', async () => {
    const { buyerUser, buyerWs } = await seedPair();

    const result = await service.sendMessage(
      {
        conversationId: '00000000-0000-0000-0000-000000000000',
        body: '없는 대화',
        attachmentIds: [],
      },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result).toEqual({ ok: false, error: 'CONVERSATION_NOT_FOUND' });
  });

  it('returns FORBIDDEN when session workspace is not a member of the conversation', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();

    // Create a conversation as buyer
    const r = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '초기', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );
    if (!r.ok) throw new Error('setup failed');

    // Another buyer workspace tries to use this conversation
    const otherBuyerUser = await seedUser(db, { email: 'other@buyer.com' });
    const otherBuyerWs = await seedBuyerWorkspace(db, { name: '다른구매사' });
    await seedMembership(db, otherBuyerWs.id, otherBuyerUser.id, 'admin');

    const result = await service.sendMessage(
      { conversationId: r.conversationId, body: '침입', attachmentIds: [] },
      { userId: otherBuyerUser.id, workspaceId: otherBuyerWs.id, workspaceType: 'buyer' },
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('returns INVALID_COUNTERPARTY when same workspace type tries to message each other', async () => {
    const pgUser = await seedUser(db, { email: 'pg1@test.com' });
    const pgWs1 = await seedPgWorkspace(db, 'pg1');
    await seedMembership(db, pgWs1.id, pgUser.id, 'admin');

    const pgUser2 = await seedUser(db, { email: 'pg2@test.com' });
    const pgWs2 = await seedPgWorkspace(db, 'pg2');
    await seedMembership(db, pgWs2.id, pgUser2.id, 'admin');

    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs2.id, body: 'PG끼리', attachmentIds: [] },
      { userId: pgUser.id, workspaceId: pgWs1.id, workspaceType: 'pg' },
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_COUNTERPARTY' });
  });

  it('returns INVALID_INPUT when body is empty and no attachments', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();

    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '   ', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('첨부 검증 뒤 claim이 실패하면 메시지 생성을 롤백한다', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    const attachmentId = randomUUID();
    await db.insert(attachments).values({
      id: attachmentId,
      name: 'chat.pdf',
      size: 10,
      mimeType: 'application/pdf',
      uploadedBy: buyerUser.id,
    });
    const attRepo = await getAttachmentRepo();
    vi.spyOn(attRepo, 'claim').mockResolvedValueOnce([]);

    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: 'race', attachmentIds: [attachmentId] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_ATTACHMENT' });
    expect(await db.select().from(chatMessages)).toEqual([]);
  });

  it('persists rfpId tag when the actor has access to that RFP', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });

    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '견적 문의', rfpId: rfp.id, attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(result.ok).toBe(true);
    const [msg] = await db.select().from(chatMessages);
    expect(msg.rfpId).toBe(rfp.id);
  });

  it('drops rfpId tag (saves null) when actor cannot access that RFP', async () => {
    const { buyerWs, pgUser, pgWs } = await seedPair();
    // Create an RFP owned by a DIFFERENT buyer — pgUser cannot access it
    const otherBuyerWs = await seedBuyerWorkspace(db, { name: '다른구매사' });
    const otherBuyerUser = await seedUser(db, { email: 'other@test.com' });
    await seedMembership(db, otherBuyerWs.id, otherBuyerUser.id, 'admin');
    const alienRfp = await seedRfp(db, { buyerWsId: otherBuyerWs.id, createdBy: otherBuyerUser.id });

    const result = await service.sendMessage(
      {
        counterpartyWorkspaceId: buyerWs.id,
        body: '교차 테넌트 태그 시도',
        rfpId: alienRfp.id,
        attachmentIds: [],
      },
      { userId: pgUser.id, workspaceId: pgWs.id, workspaceType: 'pg' },
    );

    // Message should succeed — only the rfpId tag is dropped
    expect(result.ok).toBe(true);
    const [msg] = await db.select().from(chatMessages);
    expect(msg.rfpId).toBeNull();
  });
});

// Presence is a Centrifugo HTTP round-trip. It used to run per recipient
// INSIDE the open transaction, so a slow or unreachable realtime server
// stretched the transaction (and held one of the pool's 10 connections)
// proportionally to team size — on the path that fires for every message.
// It is only used to decide "also send email?", which needs no transactional
// consistency, so it belongs before the transaction opens.
describe('ChatService.sendMessage — presence lookup stays out of the transaction', () => {
  it('resolves presence before the first write of the transaction', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    // A second PG member so presence would be asked more than once.
    const pgUser2 = await seedUser(db, { email: 'pg2@chat.com', name: 'PG영업2' });
    await seedMembership(db, pgWs.id, pgUser2.id, 'member');
    void pgUser;

    const order: string[] = [];
    const { presentUserIdsInConversation } = await import('@/lib/server/realtime/centrifugo');
    vi.mocked(presentUserIdsInConversation).mockImplementation(async () => {
      order.push('presence');
      return new Set<string>();
    });
    const msgRepo = await getChatMessageRepo();
    const save = msgRepo.save.bind(msgRepo);
    vi.spyOn(msgRepo, 'save').mockImplementation(async (...args) => {
      order.push('tx-write');
      return save(...args);
    });

    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '안녕하세요', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );
    expect(result.ok).toBe(true);

    // Every presence call must precede the first in-transaction write.
    const firstWrite = order.indexOf('tx-write');
    expect(firstWrite).toBeGreaterThanOrEqual(0);
    expect(order.slice(firstWrite)).not.toContain('presence');
  });

  it('still suppresses the email channel for a recipient who is present', async () => {
    const { buyerUser, buyerWs, pgUser, pgWs } = await seedPair();
    const { presentUserIdsInConversation } = await import('@/lib/server/realtime/centrifugo');
    vi.mocked(presentUserIdsInConversation).mockResolvedValue(new Set<string>());

    // Establish the conversation first. Presence is only meaningful once the
    // channel exists — on the very first message the id is minted inside the
    // transaction, so no client can be subscribed to it yet.
    const first = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '첫 메시지', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );
    expect(first.ok).toBe(true);
    await db.delete(outboxEntries);

    // Now the PG member is watching the thread → their email is suppressed.
    vi.mocked(presentUserIdsInConversation).mockResolvedValue(new Set([pgUser.id]));

    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '두번째 메시지', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );
    expect(result.ok).toBe(true);

    expect(await db.select().from(outboxEntries)).toHaveLength(0);
    // The in-app notification is unaffected by presence.
    const notifs = await db.select().from(notifications);
    expect(notifs.some((n) => n.userId === pgUser.id)).toBe(true);
  });

  // Presence is a CHANNEL-level fact: the Centrifugo `presence` call returns
  // every client in `chatChannel(conversationId)`. Asking it once per recipient
  // fetches the identical payload N times and discards all but one bit of it.
  it('asks the realtime server once per conversation, not once per recipient', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    // Three PG members → three recipients on one channel.
    for (const email of ['p2@chat.com', 'p3@chat.com']) {
      const u = await seedUser(db, { email });
      await seedMembership(db, pgWs.id, u.id, 'member');
    }
    const { presentUserIdsInConversation } = await import('@/lib/server/realtime/centrifugo');
    vi.mocked(presentUserIdsInConversation).mockResolvedValue(new Set<string>());

    // Establish the conversation so presence is actually consulted.
    await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '첫 메시지', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );
    vi.mocked(presentUserIdsInConversation).mockClear();

    await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '두번째', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );

    expect(vi.mocked(presentUserIdsInConversation)).toHaveBeenCalledTimes(1);
  });

  it('treats everyone as absent for a brand-new conversation without asking the realtime server', async () => {
    const { buyerUser, buyerWs, pgWs } = await seedPair();
    const { presentUserIdsInConversation } = await import('@/lib/server/realtime/centrifugo');
    vi.mocked(presentUserIdsInConversation).mockResolvedValue(new Set<string>());

    // First message for this pair — the conversation does not exist yet, so
    // nobody can be subscribed to it and the HTTP call is pure waste.
    const result = await service.sendMessage(
      { counterpartyWorkspaceId: pgWs.id, body: '첫 메시지', attachmentIds: [] },
      { userId: buyerUser.id, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    );
    expect(result.ok).toBe(true);

    expect(vi.mocked(presentUserIdsInConversation)).not.toHaveBeenCalled();
    // …and the email still goes out, because absent means notify by email.
    expect((await db.select().from(outboxEntries)).length).toBeGreaterThan(0);
  });
});
