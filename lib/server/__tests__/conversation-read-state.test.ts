import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgliteDb, type PgliteDB } from '@/lib/db/client-pglite';
import {
  __resetForTest,
  __useDrizzleWithDbForTest,
  getChatConversationRepo,
  getChatMessageRepo,
  getChatReadRepo,
} from '@/lib/server/repositories/factory';
import {
  seedBuyerWorkspace,
  seedMembership,
  seedPgWorkspace,
  seedUser,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { getConversationReadState } from '@/lib/chat/read-state/server';

const publishChatEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/server/realtime/centrifugo', () => ({
  publishChatEvent: (...args: unknown[]) => publishChatEvent(...args),
}));

let db: PgliteDB;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T12:34:56.000Z'));
  __resetForTest();
  db = await createPgliteDb();
  await __useDrizzleWithDbForTest(db);
  publishChatEvent.mockClear();
});

afterEach(() => {
  __resetForTest();
  vi.useRealTimers();
});

async function seedConversation() {
  const buyerUser = await seedUser(db, { email: 'buyer@read.test' });
  const buyerWorkspace = await seedBuyerWorkspace(db, { name: '구매사' });
  await seedMembership(db, buyerWorkspace.id, buyerUser.id, 'admin');
  const pgWorkspace = await seedPgWorkspace(db, 'READ', { name: 'PG사' });
  const conversation = await (
    await getChatConversationRepo()
  ).findOrCreatePair(buyerWorkspace.id, pgWorkspace.id);
  return { buyerUser, buyerWorkspace, pgWorkspace, conversation };
}

async function seedReadBoundary(
  scene: Awaited<ReturnType<typeof seedConversation>>,
  createdAt = new Date('2026-09-05T12:34:56.000Z'),
): Promise<string> {
  const id = '00000000-0000-4000-8000-000000000098';
  await (await getChatMessageRepo()).save({
    id,
    conversationId: scene.conversation.id,
    authorUserId: scene.buyerUser.id,
    authorWsId: scene.buyerWorkspace.id,
    body: '읽음 상한',
    rfpId: null,
    createdAt,
  });
  return id;
}

describe('Conversation read state — markRead', () => {
  it('active workspace의 cursor를 저장한 뒤 그 watermark를 전달한다', async () => {
    const scene = await seedConversation();
    const { buyerUser, buyerWorkspace, conversation } = scene;
    const throughMessageId = await seedReadBoundary(scene);
    const readState = await getConversationReadState();

    const result = await readState.markRead({
      conversationId: conversation.id,
      throughMessageId,
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
    });

    expect(result).toEqual({ ok: true, readAt: '2026-09-05T12:34:56.000Z' });
    const stored = await (
      await getChatReadRepo()
    ).getFor(conversation.id, buyerWorkspace.id, buyerUser.id);
    expect(stored?.lastReadAt.toISOString()).toBe('2026-09-05T12:34:56.000Z');
    expect(publishChatEvent).toHaveBeenCalledWith(conversation.id, {
      type: 'read',
      userId: buyerUser.id,
      workspaceId: buyerWorkspace.id,
      readAt: '2026-09-05T12:34:56.000Z',
    });
  });

  it('화면에 실제로 도착한 메시지 시각까지만 cursor를 전진시킨다', async () => {
    const { buyerUser, buyerWorkspace, conversation } = await seedConversation();
    const messageId = '00000000-0000-4000-8000-000000000099';
    const visibleAt = new Date('2026-09-05T12:00:00.000Z');
    await (await getChatMessageRepo()).save({
      id: messageId,
      conversationId: conversation.id,
      authorUserId: buyerUser.id,
      authorWsId: buyerWorkspace.id,
      body: '화면에 도착한 메시지',
      rfpId: null,
      createdAt: visibleAt,
    });

    const result = await (await getConversationReadState()).markRead({
      conversationId: conversation.id,
      throughMessageId: messageId,
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
    });

    expect(result).toEqual({ ok: true, readAt: visibleAt.toISOString() });
    const stored = await (await getChatReadRepo()).getFor(
      conversation.id,
      buyerWorkspace.id,
      buyerUser.id,
    );
    expect(stored?.lastReadAt.toISOString()).toBe(visibleAt.toISOString());
  });

  it('존재하지 않는 대화는 CONVERSATION_NOT_FOUND로 거부한다', async () => {
    const readState = await getConversationReadState();

    const result = await readState.markRead({
      conversationId: '00000000-0000-0000-0000-000000000000',
      throughMessageId: '00000000-0000-4000-8000-000000000097',
      viewer: {
        userId: '00000000-0000-0000-0000-000000000001',
        activeWorkspaceId: '00000000-0000-0000-0000-000000000002',
      },
    });

    expect(result).toEqual({ ok: false, error: 'CONVERSATION_NOT_FOUND' });
    expect(publishChatEvent).not.toHaveBeenCalled();
  });

  it('대화 양쪽이 아닌 active workspace는 FORBIDDEN으로 거부한다', async () => {
    const { conversation } = await seedConversation();
    const outsider = await seedUser(db, { email: 'outsider@read.test' });
    const otherWorkspace = await seedBuyerWorkspace(db, { name: '다른 구매사' });
    await seedMembership(db, otherWorkspace.id, outsider.id, 'admin');
    const readState = await getConversationReadState();

    const result = await readState.markRead({
      conversationId: conversation.id,
      throughMessageId: '00000000-0000-4000-8000-000000000097',
      viewer: {
        userId: outsider.id,
        activeWorkspaceId: otherWorkspace.id,
      },
    });

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(publishChatEvent).not.toHaveBeenCalled();
  });

  it('늦게 도착한 오래된 요청은 저장된 최신 watermark를 반환하고 전달한다', async () => {
    const scene = await seedConversation();
    const { buyerUser, buyerWorkspace, conversation } = scene;
    const throughMessageId = await seedReadBoundary(scene);
    const later = new Date('2026-09-05T15:00:00.000Z');
    await (
      await getChatReadRepo()
    ).upsert(conversation.id, buyerWorkspace.id, buyerUser.id, later);
    const readState = await getConversationReadState();

    const result = await readState.markRead({
      conversationId: conversation.id,
      throughMessageId,
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
    });

    expect(result).toEqual({ ok: true, readAt: later.toISOString() });
    expect(publishChatEvent).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ readAt: later.toISOString() }),
    );
  });

  it('Centrifugo 전달 실패 뒤에도 저장 결과를 성공으로 반환한다', async () => {
    const scene = await seedConversation();
    const { buyerUser, buyerWorkspace, conversation } = scene;
    const throughMessageId = await seedReadBoundary(scene);
    publishChatEvent.mockRejectedValueOnce(new Error('CENTRIFUGO_DOWN'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readState = await getConversationReadState();

    const result = await readState.markRead({
      conversationId: conversation.id,
      throughMessageId,
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
    });

    expect(result).toEqual({ ok: true, readAt: '2026-09-05T12:34:56.000Z' });
    const stored = await (
      await getChatReadRepo()
    ).getFor(conversation.id, buyerWorkspace.id, buyerUser.id);
    expect(stored?.lastReadAt.toISOString()).toBe('2026-09-05T12:34:56.000Z');
    expect(warn).toHaveBeenCalledWith(
      '[chat-read-state] publish failed',
      expect.any(Error),
    );
  });

  it('cursor 저장이 실패하면 읽음 이벤트를 먼저 전달하지 않는다', async () => {
    const scene = await seedConversation();
    const { buyerUser, buyerWorkspace, conversation } = scene;
    const throughMessageId = await seedReadBoundary(scene);
    const readRepo = await getChatReadRepo();
    vi.spyOn(readRepo, 'upsert').mockRejectedValueOnce(new Error('DB_DOWN'));
    const readState = await getConversationReadState();

    await expect(
      readState.markRead({
        conversationId: conversation.id,
        throughMessageId,
        viewer: {
          userId: buyerUser.id,
          activeWorkspaceId: buyerWorkspace.id,
        },
      }),
    ).rejects.toThrow('DB_DOWN');
    expect(publishChatEvent).not.toHaveBeenCalled();
  });
});

describe('Conversation read state — projectInbox', () => {
  it('latest message 로드가 끝나기 전에 cursor 조회를 시작한다', async () => {
    const { buyerUser, buyerWorkspace, conversation } = await seedConversation();
    const readRepo = await getChatReadRepo();
    const getForMany = vi.spyOn(readRepo, 'getForMany');
    let resolveLatestMessages!: (messages: []) => void;
    const latestMessages = new Promise<[]>((resolve) => {
      resolveLatestMessages = resolve;
    });
    const readState = await getConversationReadState();

    const resultPromise = readState.projectInbox({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversations: [
        {
          id: conversation.id,
          buyerWorkspaceId: conversation.buyerWsId,
          pgWorkspaceId: conversation.pgWsId,
        },
      ],
      latestMessages: () => latestMessages,
    });

    expect(getForMany).toHaveBeenCalledOnce();
    resolveLatestMessages([]);
    await expect(resultPromise).resolves.toMatchObject({ ok: true });
  });

  it('대화가 없으면 빈 projection을 반환한다', async () => {
    const { buyerUser, buyerWorkspace } = await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectInbox({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversations: [],
      latestMessages: [],
    });

    expect(result).toEqual({ ok: true, byConversationId: {} });
  });

  it('상대 workspace의 최신 메시지만 개인 cursor 기준으로 unread 처리한다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectInbox({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversations: [
        {
          id: conversation.id,
          buyerWorkspaceId: conversation.buyerWsId,
          pgWorkspaceId: conversation.pgWsId,
        },
      ],
      latestMessages: [
        {
          id: 'message-1',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      byConversationId: {
        [conversation.id]: {
          counterpartyWorkspaceId: pgWorkspace.id,
          unread: true,
        },
      },
    });
  });

  it('같은 workspace 구성원의 최신 메시지는 unread가 아니다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectInbox({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversations: [
        {
          id: conversation.id,
          buyerWorkspaceId: conversation.buyerWsId,
          pgWorkspaceId: conversation.pgWsId,
        },
      ],
      latestMessages: [
        {
          id: 'message-1',
          conversationId: conversation.id,
          authorWorkspaceId: buyerWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      byConversationId: {
        [conversation.id]: {
          counterpartyWorkspaceId: pgWorkspace.id,
          unread: false,
        },
      },
    });
  });

  it('개인 cursor 이전의 상대 메시지는 unread가 아니다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    await (
      await getChatReadRepo()
    ).upsert(
      conversation.id,
      buyerWorkspace.id,
      buyerUser.id,
      new Date('2026-09-05T13:00:00.000Z'),
    );
    const readState = await getConversationReadState();

    const result = await readState.projectInbox({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversations: [
        {
          id: conversation.id,
          buyerWorkspaceId: conversation.buyerWsId,
          pgWorkspaceId: conversation.pgWsId,
        },
      ],
      latestMessages: [
        {
          id: 'message-1',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result.ok && result.byConversationId[conversation.id]?.unread).toBe(false);
  });

  it('active workspace가 참여하지 않은 대화가 하나라도 섞이면 전체를 거부한다', async () => {
    const { buyerUser, buyerWorkspace, conversation } = await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectInbox({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversations: [
        {
          id: conversation.id,
          buyerWorkspaceId: conversation.buyerWsId,
          pgWorkspaceId: conversation.pgWsId,
        },
        {
          id: '00000000-0000-0000-0000-000000000010',
          buyerWorkspaceId: '00000000-0000-0000-0000-000000000011',
          pgWorkspaceId: '00000000-0000-0000-0000-000000000012',
        },
      ],
      latestMessages: [],
    });

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });
});

describe('Conversation read state — projectThread', () => {
  it('active workspace가 대화 어느 쪽도 아니면 영수증 projection을 거부한다', async () => {
    const { buyerUser, conversation } = await seedConversation();
    const otherWorkspace = await seedBuyerWorkspace(db, { name: '다른 구매사' });
    const readState = await getConversationReadState();

    const result = await readState.projectThread({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: otherWorkspace.id,
      },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [],
    });

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('상대 workspace 최대 cursor 이전에 보낸 메시지 ID만 영수증으로 projection한다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    const pgReader = await seedUser(db, { email: 'reader@pg.test' });
    await (
      await getChatReadRepo()
    ).upsert(
      conversation.id,
      pgWorkspace.id,
      pgReader.id,
      new Date('2026-09-05T11:00:00.000Z'),
    );
    const readState = await getConversationReadState();

    const result = await readState.projectThread({
      viewer: {
        userId: buyerUser.id,
        activeWorkspaceId: buyerWorkspace.id,
      },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [
        {
          id: 'sent-before',
          conversationId: conversation.id,
          authorWorkspaceId: buyerWorkspace.id,
          createdAt: new Date('2026-09-05T10:00:00.000Z'),
        },
        {
          id: 'sent-after',
          conversationId: conversation.id,
          authorWorkspaceId: buyerWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      counterpartyWorkspaceId: pgWorkspace.id,
      readByCounterpartyMessageIds: ['sent-before'],
    });
  });
});

describe('Conversation read state — projectDigest', () => {
  it('명시된 수신 workspace가 대화 어느 쪽도 아니면 취소한다', async () => {
    const { buyerUser, conversation } = await seedConversation();
    const otherWorkspace = await seedBuyerWorkspace(db, { name: '다른 구매사' });
    await seedMembership(db, otherWorkspace.id, buyerUser.id, 'member');
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: buyerUser.id, workspaceId: otherWorkspace.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [],
    });

    expect(result).toEqual({ disposition: 'cancel', reason: 'INVALID_RECIPIENT' });
  });

  it('명시된 수신 workspace의 개인 cursor 뒤 상대 메시지만 발송 대상으로 projection한다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: {
        userId: buyerUser.id,
        workspaceId: buyerWorkspace.id,
      },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [
        {
          id: 'self-message',
          conversationId: conversation.id,
          authorWorkspaceId: buyerWorkspace.id,
          createdAt: new Date('2026-09-05T11:00:00.000Z'),
        },
        {
          id: 'counterparty-message',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({
      disposition: 'send',
      recipientWorkspaceId: buyerWorkspace.id,
      counterpartyWorkspaceId: pgWorkspace.id,
      unreadCount: 1,
      latestUnreadMessageId: 'counterparty-message',
    });
  });

  it('읽지 않은 상대 메시지가 없으면 digest를 취소한다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    await (
      await getChatReadRepo()
    ).upsert(
      conversation.id,
      buyerWorkspace.id,
      buyerUser.id,
      new Date('2026-09-05T13:00:00.000Z'),
    );
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: buyerUser.id, workspaceId: buyerWorkspace.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [
        {
          id: 'already-read',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({ disposition: 'cancel', reason: 'NOTHING_UNREAD' });
  });

  it('입력 배열 순서와 무관하게 가장 최신 unread 메시지를 고른다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: buyerUser.id, workspaceId: buyerWorkspace.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [
        {
          id: 'latest',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T13:00:00.000Z'),
        },
        {
          id: 'older',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
        {
          id: 'other-conversation',
          conversationId: '00000000-0000-4000-8000-000000000099',
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T14:00:00.000Z'),
        },
      ],
    });

    expect(result).toMatchObject({
      disposition: 'send',
      unreadCount: 2,
      latestUnreadMessageId: 'latest',
    });
  });

  it('legacy digest는 수신자가 속한 유일한 대화 workspace를 추론한다', async () => {
    const { buyerUser, buyerWorkspace, pgWorkspace, conversation } =
      await seedConversation();
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: buyerUser.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [
        {
          id: 'legacy-unread',
          conversationId: conversation.id,
          authorWorkspaceId: pgWorkspace.id,
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({
      disposition: 'send',
      recipientWorkspaceId: buyerWorkspace.id,
      counterpartyWorkspaceId: pgWorkspace.id,
      unreadCount: 1,
      latestUnreadMessageId: 'legacy-unread',
    });
  });

  it('legacy 수신자가 대화 양쪽 workspace에 속하면 모호하므로 취소한다', async () => {
    const { buyerUser, pgWorkspace, conversation } = await seedConversation();
    await seedMembership(db, pgWorkspace.id, buyerUser.id, 'member');
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: buyerUser.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [],
    });

    expect(result).toEqual({ disposition: 'cancel', reason: 'INVALID_RECIPIENT' });
  });

  it('legacy 수신자가 대화 어느 workspace에도 속하지 않으면 취소한다', async () => {
    const { conversation } = await seedConversation();
    const outsider = await seedUser(db, { email: 'legacy-outsider@read.test' });
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: outsider.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [],
    });

    expect(result).toEqual({ disposition: 'cancel', reason: 'INVALID_RECIPIENT' });
  });

  it('명시된 수신 workspace의 구성원이 아니면 취소한다', async () => {
    const { buyerWorkspace, conversation } = await seedConversation();
    const outsider = await seedUser(db, { email: 'current-outsider@read.test' });
    const readState = await getConversationReadState();

    const result = await readState.projectDigest({
      recipient: { userId: outsider.id, workspaceId: buyerWorkspace.id },
      conversation: {
        id: conversation.id,
        buyerWorkspaceId: conversation.buyerWsId,
        pgWorkspaceId: conversation.pgWsId,
      },
      messages: [],
    });

    expect(result).toEqual({ disposition: 'cancel', reason: 'INVALID_RECIPIENT' });
  });
});
