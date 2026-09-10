import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { attachments, rfpTeamMessages, users } from '@/lib/db/schema';
import type { Attachment } from '@/lib/types/common';
import type {
  RfpTeamMessageRecord,
  RfpTeamMessageRepo,
  RfpTeamMessageWithAuthor,
  TeamThreadSummary,
  Tx,
} from '../types';

type AttRow = typeof attachments.$inferSelect;

function attRowToAttachment(row: AttRow): Attachment {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    mimeType: row.mimeType,
    // Same contract as every other read site — the authenticated route.
    url: `/api/files/${row.id}`,
  };
}

// Explicit column projection (BID_COLUMNS precedent) — guards against schema
// drift where select().from() would compile the full column list.
const TEAM_MESSAGE_COLUMNS = {
  id: rfpTeamMessages.id,
  rfpId: rfpTeamMessages.rfpId,
  workspaceId: rfpTeamMessages.workspaceId,
  authorUserId: rfpTeamMessages.authorUserId,
  body: rfpTeamMessages.body,
  createdAt: rfpTeamMessages.createdAt,
  authorName: users.name,
  authorAvatarUpdatedAt: users.avatarUpdatedAt,
} as const;

export class DrizzleRfpTeamMessageRepository implements RfpTeamMessageRepo {

  constructor(private readonly _db: Tx) {}

  private h(tx?: Tx): Tx {
    return tx ?? this._db;
  }

  async save(msg: RfpTeamMessageRecord, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db.insert(rfpTeamMessages).values({
      id: msg.id,
      rfpId: msg.rfpId,
      workspaceId: msg.workspaceId,
      authorUserId: msg.authorUserId,
      body: msg.body,
      createdAt: msg.createdAt,
    });
  }

  async listByScope(
    rfpId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<RfpTeamMessageWithAuthor[]> {
    const db = this.h(tx);
    const rows = (await db
      .select(TEAM_MESSAGE_COLUMNS)
      .from(rfpTeamMessages)
      .innerJoin(users, eq(users.id, rfpTeamMessages.authorUserId))
      .where(
        and(
          eq(rfpTeamMessages.rfpId, rfpId),
          eq(rfpTeamMessages.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(rfpTeamMessages.createdAt))) as Omit<
      RfpTeamMessageWithAuthor,
      'attachments'
    >[];

    if (rows.length === 0) return [];

    // Single batch fetch of attachments for all returned messages (exclusive-arc
    // C3): attachments.rfp_team_message_id ∈ {message ids} — bid-note pattern.
    const ids = rows.map((r) => r.id);
    const attRows: AttRow[] = await db
      .select()
      .from(attachments)
      .where(and(inArray(attachments.rfpTeamMessageId, ids), eq(attachments.status, 'ready')));

    const byMessage = new Map<string, Attachment[]>();
    for (const row of attRows) {
      if (!row.rfpTeamMessageId) continue;
      const list = byMessage.get(row.rfpTeamMessageId) ?? [];
      list.push(attRowToAttachment(row));
      byMessage.set(row.rfpTeamMessageId, list);
    }

    return rows.map((r) => ({ ...r, attachments: byMessage.get(r.id) ?? [] }));
  }

  async findOwner(
    messageId: string,
    tx?: Tx,
  ): Promise<{ workspaceId: string } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ workspaceId: rfpTeamMessages.workspaceId })
      .from(rfpTeamMessages)
      .where(eq(rfpTeamMessages.id, messageId))
      .limit(1);
    return row ?? undefined;
  }

  async findReadBoundary(
    messageId: string,
    tx?: Tx,
  ): Promise<{ rfpId: string; workspaceId: string; createdAt: Date } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({
        rfpId: rfpTeamMessages.rfpId,
        workspaceId: rfpTeamMessages.workspaceId,
        createdAt: rfpTeamMessages.createdAt,
      })
      .from(rfpTeamMessages)
      .where(eq(rfpTeamMessages.id, messageId))
      .limit(1);
    return row ?? undefined;
  }

  async listThreadsForWorkspace(workspaceId: string, tx?: Tx): Promise<TeamThreadSummary[]> {
    const db = this.h(tx);
    // rfp별 마지막 메시지: DISTINCT ON (rfp_id) + ORDER BY rfp_id, created_at DESC.
    const rows = (await db
      .selectDistinctOn([rfpTeamMessages.rfpId], {
        rfpId: rfpTeamMessages.rfpId,
        lastMessageAt: rfpTeamMessages.createdAt,
        lastBody: rfpTeamMessages.body,
        lastAuthorUserId: rfpTeamMessages.authorUserId,
      })
      .from(rfpTeamMessages)
      .where(eq(rfpTeamMessages.workspaceId, workspaceId))
      .orderBy(rfpTeamMessages.rfpId, desc(rfpTeamMessages.createdAt))) as TeamThreadSummary[];
    return rows;
  }
}
