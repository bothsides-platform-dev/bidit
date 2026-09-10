import type {
  ChatConversationRepo,
  ChatMessageRepo,
  ChatReadRepo,
  WorkspaceRepo,
} from '@/lib/server/repositories/types';
import { publishChatEvent } from '@/lib/server/realtime/centrifugo';
import { defineAsyncSingleton } from '@/lib/server/_singleton';
import type { ServiceResult } from '@/lib/server/services/types';

export type ConversationReadViewer = {
  userId: string;
  activeWorkspaceId: string;
};

export type ConversationReadFacts = {
  id: string;
  buyerWorkspaceId: string;
  pgWorkspaceId: string;
};

export type ConversationReadMessageFacts = {
  id: string;
  conversationId: string;
  authorWorkspaceId: string;
  createdAt: Date;
};

type ConversationReadMessageSource =
  | ConversationReadMessageFacts[]
  | (() => Promise<ConversationReadMessageFacts[]>);

export type ConversationDigestReadProjection =
  | {
      disposition: 'send';
      recipientWorkspaceId: string;
      counterpartyWorkspaceId: string;
      unreadCount: number;
      latestUnreadMessageId: string;
    }
  | {
      disposition: 'cancel';
      reason: 'INVALID_RECIPIENT' | 'NOTHING_UNREAD';
    };

type ConversationSide = {
  viewerWorkspaceId: string;
  counterpartyWorkspaceId: string;
};

function resolveSide(
  conversation: ConversationReadFacts,
  activeWorkspaceId: string,
): ConversationSide | undefined {
  const matchesBuyer = conversation.buyerWorkspaceId === activeWorkspaceId;
  const matchesPg = conversation.pgWorkspaceId === activeWorkspaceId;
  if (matchesBuyer === matchesPg) return undefined;
  return {
    viewerWorkspaceId: activeWorkspaceId,
    counterpartyWorkspaceId: matchesBuyer
      ? conversation.pgWorkspaceId
      : conversation.buyerWorkspaceId,
  };
}

export interface ConversationReadState {
  markRead(input: {
    conversationId: string;
    throughMessageId: string;
    viewer: ConversationReadViewer;
  }): Promise<ServiceResult<{ readAt: string }>>;
  projectInbox(input: {
    viewer: ConversationReadViewer;
    conversations: ConversationReadFacts[];
    latestMessages: ConversationReadMessageSource;
  }): Promise<
    ServiceResult<{
      byConversationId: Record<
        string,
        { counterpartyWorkspaceId: string; unread: boolean }
      >;
    }>
  >;
  projectThread(input: {
    viewer: ConversationReadViewer;
    conversation: ConversationReadFacts;
    messages: ConversationReadMessageFacts[];
  }): Promise<
    ServiceResult<{
      counterpartyWorkspaceId: string;
      readByCounterpartyMessageIds: string[];
    }>
  >;
  projectDigest(input: {
    recipient: { userId: string; workspaceId?: string };
    conversation: ConversationReadFacts;
    messages: ConversationReadMessageFacts[];
  }): Promise<ConversationDigestReadProjection>;
}

class DefaultConversationReadState implements ConversationReadState {
  constructor(
    private readonly conversationRepo: ChatConversationRepo,
    private readonly messageRepo: ChatMessageRepo,
    private readonly readRepo: ChatReadRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly clock: () => Date,
  ) {}

  async markRead(input: {
    conversationId: string;
    throughMessageId: string;
    viewer: ConversationReadViewer;
  }): Promise<ServiceResult<{ readAt: string }>> {
    const conversation = await this.conversationRepo.findById(input.conversationId);
    if (!conversation) return { ok: false, error: 'CONVERSATION_NOT_FOUND' };
    const matchesBuyer = conversation.buyerWsId === input.viewer.activeWorkspaceId;
    const matchesPg = conversation.pgWsId === input.viewer.activeWorkspaceId;
    if (matchesBuyer === matchesPg) return { ok: false, error: 'FORBIDDEN' };

    const boundary = await this.messageRepo.findReadBoundary(input.throughMessageId);
    if (!boundary || boundary.conversationId !== conversation.id) {
      return { ok: false, error: 'INVALID_READ_BOUNDARY' };
    }
    // DB 시각이 비정상적으로 미래여도 서버 현재보다 앞선 cursor는 쓰지 않는다.
    const now = this.clock();
    const attemptedReadAt = new Date(Math.min(boundary.createdAt.getTime(), now.getTime()));
    const persistedReadAt = await this.readRepo.upsert(
      conversation.id,
      input.viewer.activeWorkspaceId,
      input.viewer.userId,
      attemptedReadAt,
    );
    const readAt = persistedReadAt.toISOString();

    try {
      await publishChatEvent(conversation.id, {
        type: 'read',
        userId: input.viewer.userId,
        workspaceId: input.viewer.activeWorkspaceId,
        readAt,
      });
    } catch (error) {
      // Postgres is authoritative. Live delivery is best-effort and converges
      // from the next loader snapshot.
      console.warn('[chat-read-state] publish failed', error);
    }

    return { ok: true, readAt };
  }

  async projectInbox(input: {
    viewer: ConversationReadViewer;
    conversations: ConversationReadFacts[];
    latestMessages: ConversationReadMessageSource;
  }): Promise<
    ServiceResult<{
      byConversationId: Record<
        string,
        { counterpartyWorkspaceId: string; unread: boolean }
      >;
    }>
  > {
    const sides = new Map<string, ConversationSide>();
    for (const conversation of input.conversations) {
      const side = resolveSide(conversation, input.viewer.activeWorkspaceId);
      if (!side) return { ok: false, error: 'FORBIDDEN' };
      sides.set(conversation.id, side);
    }

    const latestMessages =
      typeof input.latestMessages === 'function'
        ? input.latestMessages()
        : input.latestMessages;
    const [reads, resolvedLatestMessages] = await Promise.all([
      this.readRepo.getForMany(
        input.conversations.map((conversation) => conversation.id),
        input.viewer.activeWorkspaceId,
        input.viewer.userId,
      ),
      latestMessages,
    ]);
    const readByConversationId = new Map(
      reads.map((read) => [read.conversationId, read]),
    );
    const latestByConversationId = new Map(
      resolvedLatestMessages.map((message) => [message.conversationId, message]),
    );
    const byConversationId: Record<
      string,
      { counterpartyWorkspaceId: string; unread: boolean }
    > = {};

    for (const conversation of input.conversations) {
      const side = sides.get(conversation.id)!;
      const latest = latestByConversationId.get(conversation.id);
      const read = readByConversationId.get(conversation.id);
      byConversationId[conversation.id] = {
        counterpartyWorkspaceId: side.counterpartyWorkspaceId,
        unread:
          latest !== undefined &&
          latest.authorWorkspaceId === side.counterpartyWorkspaceId &&
          (read === undefined || latest.createdAt > read.lastReadAt),
      };
    }

    return { ok: true, byConversationId };
  }

  async projectThread(input: {
    viewer: ConversationReadViewer;
    conversation: ConversationReadFacts;
    messages: ConversationReadMessageFacts[];
  }): Promise<
    ServiceResult<{
      counterpartyWorkspaceId: string;
      readByCounterpartyMessageIds: string[];
    }>
  > {
    const side = resolveSide(
      input.conversation,
      input.viewer.activeWorkspaceId,
    );
    if (!side) return { ok: false, error: 'FORBIDDEN' };

    const counterpartyReadAt = await this.readRepo.maxLastReadAt(
      input.conversation.id,
      side.counterpartyWorkspaceId,
    );
    const readByCounterpartyMessageIds =
      counterpartyReadAt === undefined
        ? []
        : input.messages
            .filter(
              (message) =>
                message.conversationId === input.conversation.id &&
                message.authorWorkspaceId === side.viewerWorkspaceId &&
                message.createdAt <= counterpartyReadAt,
            )
            .map((message) => message.id);

    return {
      ok: true,
      counterpartyWorkspaceId: side.counterpartyWorkspaceId,
      readByCounterpartyMessageIds,
    };
  }

  async projectDigest(input: {
    recipient: { userId: string; workspaceId?: string };
    conversation: ConversationReadFacts;
    messages: ConversationReadMessageFacts[];
  }): Promise<ConversationDigestReadProjection> {
    const hasExplicitWorkspace = input.recipient.workspaceId !== undefined;
    let recipientWorkspaceId = input.recipient.workspaceId;
    if (recipientWorkspaceId === undefined) {
      const [buyerMember, pgMember] = await Promise.all([
        this.workspaceRepo.isMember(
          input.recipient.userId,
          input.conversation.buyerWorkspaceId,
        ),
        this.workspaceRepo.isMember(
          input.recipient.userId,
          input.conversation.pgWorkspaceId,
        ),
      ]);
      if (buyerMember === pgMember) {
        return { disposition: 'cancel', reason: 'INVALID_RECIPIENT' };
      }
      recipientWorkspaceId = buyerMember
        ? input.conversation.buyerWorkspaceId
        : input.conversation.pgWorkspaceId;
    }
    const side = resolveSide(input.conversation, recipientWorkspaceId);
    if (!side) {
      return { disposition: 'cancel', reason: 'INVALID_RECIPIENT' };
    }
    if (
      hasExplicitWorkspace &&
      !(await this.workspaceRepo.isMember(
        input.recipient.userId,
        recipientWorkspaceId,
      ))
    ) {
      return { disposition: 'cancel', reason: 'INVALID_RECIPIENT' };
    }
    const read = await this.readRepo.getFor(
      input.conversation.id,
      recipientWorkspaceId,
      input.recipient.userId,
    );
    const unread = input.messages.filter(
      (message) =>
        message.conversationId === input.conversation.id &&
        message.authorWorkspaceId === side.counterpartyWorkspaceId &&
        (read === undefined || message.createdAt > read.lastReadAt),
    );
    if (unread.length === 0) {
      return { disposition: 'cancel', reason: 'NOTHING_UNREAD' };
    }
    const latest = unread.reduce((current, message) =>
      message.createdAt > current.createdAt ? message : current,
    );
    return {
      disposition: 'send',
      recipientWorkspaceId,
      counterpartyWorkspaceId: side.counterpartyWorkspaceId,
      unreadCount: unread.length,
      latestUnreadMessageId: latest.id,
    };
  }
}

export const {
  get: getConversationReadState,
  set: __setConversationReadStateForTest,
  reset: __resetConversationReadStateForTest,
} = defineAsyncSingleton<ConversationReadState>(
  'conversation_read_state',
  'service',
  async () => {
    const {
      getChatConversationRepo,
      getChatMessageRepo,
      getChatReadRepo,
      getWorkspaceRepo,
    } = await import(
      '@/lib/server/repositories/factory'
    );
    const [conversationRepo, messageRepo, readRepo, workspaceRepo] = await Promise.all([
      getChatConversationRepo(),
      getChatMessageRepo(),
      getChatReadRepo(),
      getWorkspaceRepo(),
    ]);
    return new DefaultConversationReadState(
      conversationRepo,
      messageRepo,
      readRepo,
      workspaceRepo,
      () => new Date(),
    );
  },
);
