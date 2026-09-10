import { and, eq, sql } from 'drizzle-orm';
import { rfpTeamMessageReads } from '@/lib/db/schema';
import type { RfpTeamMessageRead, RfpTeamMessageReadRepo, Tx } from '../types';

const READ_COLUMNS = {
  rfpId: rfpTeamMessageReads.rfpId,
  workspaceId: rfpTeamMessageReads.workspaceId,
  userId: rfpTeamMessageReads.userId,
  lastReadAt: rfpTeamMessageReads.lastReadAt,
} as const;

export class DrizzleRfpTeamMessageReadRepository implements RfpTeamMessageReadRepo {

  constructor(private readonly _db: Tx) {}

  private h(tx?: Tx): Tx { return tx ?? this._db; }

  async upsert(rfpId: string, workspaceId: string, userId: string, at: Date, tx?: Tx): Promise<Date> {
    const db = this.h(tx);
    const [row] = await db
      .insert(rfpTeamMessageReads)
      .values({ rfpId, workspaceId, userId, lastReadAt: at })
      .onConflictDoUpdate({
        target: [rfpTeamMessageReads.rfpId, rfpTeamMessageReads.workspaceId, rfpTeamMessageReads.userId],
        set: {
          lastReadAt: sql`greatest(${rfpTeamMessageReads.lastReadAt}, excluded.last_read_at)`,
        },
      })
      .returning({ lastReadAt: rfpTeamMessageReads.lastReadAt });
    return new Date(row.lastReadAt);
  }

  async getFor(rfpId: string, workspaceId: string, userId: string, tx?: Tx): Promise<RfpTeamMessageRead | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select(READ_COLUMNS)
      .from(rfpTeamMessageReads)
      .where(and(
        eq(rfpTeamMessageReads.rfpId, rfpId),
        eq(rfpTeamMessageReads.workspaceId, workspaceId),
        eq(rfpTeamMessageReads.userId, userId),
      ))
      .limit(1);
    return row ?? undefined;
  }
}
