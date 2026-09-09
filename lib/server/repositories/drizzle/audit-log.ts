import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { auditLogs, users } from '@/lib/db/schema';
import { isMasterEmail } from '@/lib/auth/master-allowlist';
import type { AuditLogCursor, AuditLogRecord, AuditLogRepo, NewAuditLog, Tx } from '../types';

export class DrizzleAuditLogRepository implements AuditLogRepo {

  constructor(private readonly _db: Tx) {}

  private h(tx?: Tx): Tx {
    return tx ?? this._db;
  }

  async insert(entry: NewAuditLog, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db.insert(auditLogs).values({
      actorUserId: entry.actorUserId,
      actorWorkspaceId: entry.actorWorkspaceId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
    });
  }

  async listForWorkspace(
    workspaceId: string,
    opts: { limit: number; before?: AuditLogCursor },
  ): Promise<AuditLogRecord[]> {
    const cursor = opts.before
      ? or(
          lt(auditLogs.createdAt, new Date(opts.before.createdAt)),
          and(
            eq(auditLogs.createdAt, new Date(opts.before.createdAt)),
            // id 타이브레이크 — 같은 타임스탬프 행도 누락 없이 순회.
            sql`${auditLogs.id} < ${opts.before.id}`,
          ),
        )
      : undefined;

    const rows = await this._db
      .select({
        id: auditLogs.id,
        actorUserId: auditLogs.actorUserId,
        actorWorkspaceId: auditLogs.actorWorkspaceId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      // 탈퇴 사용자의 과거 행위도 보여야 하므로 leftJoin (이름은 null 허용).
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.actorWorkspaceId, workspaceId), cursor))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(opts.limit);

    return rows.map((r) => {
      // 신규 행은 사건 당시 권한 출처를 metadata에 스냅샷으로 남긴다. 레거시 행만
      // 현재 이메일 allowlist로 폴백하며, actorEmail 자체는 결과에서 제외한다.
      const { actorEmail, ...rest } = r;
      const actorWasMaster =
        r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
          ? (r.metadata as Record<string, unknown>).actorWasMaster
          : undefined;
      return {
        ...rest,
        metadata: r.metadata ?? null,
        createdAt: (r.createdAt as Date).toISOString(),
        viaMaster:
          typeof actorWasMaster === 'boolean' ? actorWasMaster : isMasterEmail(actorEmail),
      };
    }) as AuditLogRecord[];
  }
}
