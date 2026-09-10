import { asc, desc, eq, inArray } from 'drizzle-orm';
import { chatMessages, users } from '@/lib/db/schema';
import type {
  ChatMessageRecord,
  ChatMessageRepo,
  ChatMessageWithAuthor,
  Tx,
} from '../types';

// Explicit column projection (BID_COLUMNS precedent) — guards against schema
// drift where select().from() would compile the full column list.
const MESSAGE_COLUMNS = {
  id: chatMessages.id,
  conversationId: chatMessages.conversationId,
  authorUserId: chatMessages.authorUserId,
  authorWsId: chatMessages.authorWsId,
  body: chatMessages.body,
  rfpId: chatMessages.rfpId,
  createdAt: chatMessages.createdAt,
} as const;

export class DrizzleChatMessageRepository implements ChatMessageRepo {

  constructor(private readonly _db: Tx) {}

  private h(tx?: Tx): Tx {
    return tx ?? this._db;
  }

  async save(msg: ChatMessageRecord, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db.insert(chatMessages).values({
      id: msg.id,
      conversationId: msg.conversationId,
      authorUserId: msg.authorUserId,
      authorWsId: msg.authorWsId,
      body: msg.body,
      rfpId: msg.rfpId,
      createdAt: msg.createdAt,
    });
  }

  async findConversationId(
    messageId: string,
    tx?: Tx,
  ): Promise<{ conversationId: string } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ conversationId: chatMessages.conversationId })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .limit(1);
    return row ?? undefined;
  }

  async findReadBoundary(
    messageId: string,
    tx?: Tx,
  ): Promise<{ conversationId: string; createdAt: Date } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({
        conversationId: chatMessages.conversationId,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .limit(1);
    return row ?? undefined;
  }

  async lastByConversations(
    conversationIds: string[],
    tx?: Tx,
  ): Promise<ChatMessageRecord[]> {
    if (conversationIds.length === 0) return [];
    const db = this.h(tx);
    // DISTINCT ON keeps the first row of each conversation_id group, so the
    // ORDER BY must lead with conversation_id and then sort the group the way
    // we want the survivor picked (newest first). `id` breaks created_at ties
    // deterministically — without it two messages sharing a timestamp would
    // make the preview flip between page loads.
    return (await db
      .selectDistinctOn([chatMessages.conversationId], MESSAGE_COLUMNS)
      .from(chatMessages)
      .where(inArray(chatMessages.conversationId, conversationIds))
      .orderBy(
        chatMessages.conversationId,
        desc(chatMessages.createdAt),
        desc(chatMessages.id),
      )) as ChatMessageRecord[];
  }

  async listByConversation(
    conversationId: string,
    tx?: Tx,
  ): Promise<ChatMessageRecord[]> {
    const db = this.h(tx);
    return (await db
      .select(MESSAGE_COLUMNS)
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt))) as ChatMessageRecord[];
  }

  async listByConversationWithAuthor(
    conversationId: string,
    tx?: Tx,
  ): Promise<ChatMessageWithAuthor[]> {
    const db = this.h(tx);
    return (await db
      .select({
        ...MESSAGE_COLUMNS,
        authorName: users.name,
        authorEmail: users.email,
        authorAvatarUpdatedAt: users.avatarUpdatedAt,
      })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorUserId))
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt))) as ChatMessageWithAuthor[];
  }
}
