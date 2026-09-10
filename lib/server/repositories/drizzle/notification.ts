import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { notifications } from '@/lib/db/schema';
import { teamThreadLink } from '@/lib/chat/thread-link';
import type {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from '@/lib/types/notification';
import type { NotificationRepo, Tx } from '../types';

type NotifRow = typeof notifications.$inferSelect;

function dbChannel(c: NotifRow['channel']): NotificationChannel {
  return c === 'in_app' ? 'inapp' : 'email';
}
function uiChannel(c: NotificationChannel): NotifRow['channel'] {
  return c === 'inapp' ? 'in_app' : 'email';
}
function dbStatus(s: NotifRow['status']): NotificationStatus {
  return s === 'queued' ? 'pending' : (s as NotificationStatus);
}
function uiStatus(s: NotificationStatus): NotifRow['status'] {
  return s === 'pending' ? 'queued' : (s as NotifRow['status']);
}

function rowToNotification(row: NotifRow): Notification {
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    type: row.type,
    title: row.title,
    body: row.body,
    channel: dbChannel(row.channel),
    status: dbStatus(row.status),
    linkUrl: row.linkUrl ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : undefined,
    readAt: row.readAt ? new Date(row.readAt).toISOString() : undefined,
  };
}

/**
 * `markChatThreadRead` 가 거슬러 올라가는 최대 기간.
 *
 * `notifications` 는 `created_at` 으로 RANGE 파티션된 테이블이다(위 스키마 주석).
 * 하한이 없으면 이 UPDATE 는 파티션을 하나도 쳐내지 못하고 월별 자식 테이블을
 * 전부 연다 — 그리고 이 쿼리는 이제 스레드를 열 때 1회가 아니라 **보이는 동안
 * 도착하는 메시지마다** 도는 핫패스다(useMarkReadWhileVisible).
 *
 * 대가는 명시적이다: 이 기간보다 오래된 안 읽은 알림은 스레드를 열어도 여기서
 * 걷히지 않는다. 사용자는 알림함에서 직접 지울 수 있고(`markAllRead` 에는 하한이
 * 없다), 3개월 넘게 안 읽은 채팅 알림은 실사용에서 사실상 없다.
 */
export const MARK_READ_LOOKBACK_DAYS = 90;

function markReadCutoff(): Date {
  return new Date(Date.now() - MARK_READ_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

export class DrizzleNotificationRepository implements NotificationRepo {

  constructor(private readonly _db: Tx) {}

  private h(tx?: Tx): Tx {
    return tx ?? this._db;
  }

  async save(n: Notification, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    // 알림은 append-only(생성 시 고유 uuid). 파티션 테이블은 id 단독 UNIQUE 가
    // 불가하므로 onConflict(id) 불가 — 평범한 insert. 상태 변경은 markRead 경유.
    await db.insert(notifications).values({
      id: n.id,
      userId: n.userId,
      workspaceId: n.workspaceId,
      type: n.type,
      title: n.title,
      body: n.body,
      channel: uiChannel(n.channel),
      status: uiStatus(n.status),
      linkUrl: n.linkUrl ?? null,
      createdAt: new Date(n.createdAt),
      sentAt: n.sentAt ? new Date(n.sentAt) : null,
      readAt: n.readAt ? new Date(n.readAt) : null,
    });
  }

  async saveMany(ns: Notification[], tx?: Tx): Promise<void> {
    if (ns.length === 0) return;
    const db = this.h(tx);
    // save() 와 같은 이유로 onConflict 없음 — 파티션 테이블이라 id 단독 UNIQUE 가
    // 없고, 알림은 append-only 라 충돌할 일이 없다.
    await db.insert(notifications).values(
      ns.map((n) => ({
        id: n.id,
        userId: n.userId,
        workspaceId: n.workspaceId,
        type: n.type,
        title: n.title,
        body: n.body,
        channel: uiChannel(n.channel),
        status: uiStatus(n.status),
        linkUrl: n.linkUrl ?? null,
        createdAt: new Date(n.createdAt),
        sentAt: n.sentAt ? new Date(n.sentAt) : null,
        readAt: n.readAt ? new Date(n.readAt) : null,
      })),
    );
  }

  async findRecentForUser(
    userId: string,
    workspaceId: string,
    limit: number,
    channel?: NotificationChannel,
    tx?: Tx,
  ): Promise<Notification[]> {
    const db = this.h(tx);
    // 현재 워크스페이스 알림 ∪ user-level(workspace_id IS NULL) 알림.
    // null 알림은 어느 ws를 보든 표시되고, non-null 알림은 그 ws에만 격리된다.
    const base = and(
      eq(notifications.userId, userId),
      or(
        eq(notifications.workspaceId, workspaceId),
        isNull(notifications.workspaceId),
      ),
    );
    const where = channel ? and(base, eq(notifications.channel, uiChannel(channel))) : base;
    const rows = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return rows.map(rowToNotification);
  }

  async markRead(id: string, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db
      .update(notifications)
      .set({ status: 'read', readAt: sql`now()` })
      .where(eq(notifications.id, id));
  }

  async markAllRead(userId: string, workspaceId: string, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db
      .update(notifications)
      .set({ status: 'read', readAt: sql`now()` })
      .where(
        and(
          eq(notifications.userId, userId),
          // 현재 ws 알림 + user-level(null) 알림을 함께 읽음 처리 — null 알림은
          // 어느 ws 피드에서 보든 같은 행이므로 그 피드에서 지울 수 있어야 한다.
          or(
            eq(notifications.workspaceId, workspaceId),
            isNull(notifications.workspaceId),
          ),
          isNull(notifications.readAt),
        ),
      );
  }

  async hasPendingChatNotification(
    userId: string,
    workspaceId: string,
    threadLinkUrl: string,
    windowStart: Date,
    tx?: Tx,
  ): Promise<boolean> {
    const db = this.h(tx);
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.type, 'chat.message'),
          eq(notifications.status, 'queued'),
          // 대화 컬럼이 없어 linkUrl 이 곧 대화 식별자다(팀 채팅과 같은 방식).
          eq(notifications.linkUrl, threadLinkUrl),
          gte(notifications.createdAt, windowStart),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async markChatThreadRead(
    userId: string,
    workspaceId: string,
    threadLinkUrl: string,
    readThrough: Date,
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db
      .update(notifications)
      .set({ status: 'read', readAt: sql`now()` })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.linkUrl, threadLinkUrl),
          // 파티션 프루닝 하한 — MARK_READ_LOOKBACK_DAYS 주석 참조.
          gte(notifications.createdAt, markReadCutoff()),
          // cursor 를 기록한 뒤 이 UPDATE 사이에 새 메시지가 도착할 수 있다.
          // 그 알림까지 지우면 사용자가 아직 못 본 메시지를 읽었다고 거짓말한다.
          lte(notifications.createdAt, readThrough),
          // 이미 읽은 행은 건드리지 않는다 — readAt 이 뒤로 밀리면 안 된다.
          isNull(notifications.readAt),
        ),
      );
  }

  async hasPendingTeamNotification(
    userId: string,
    rfpId: string,
    windowStart: Date,
    tx?: Tx,
  ): Promise<boolean> {
    const db = this.h(tx);
    // notifications 에는 rfp 컬럼이 없어 dedupe 키는 linkUrl(`/messages?t=<rfpId>`).
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, 'team_chat.message'),
          eq(notifications.linkUrl, teamThreadLink(rfpId)),
          eq(notifications.status, 'queued'),
          gte(notifications.createdAt, windowStart),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async findOwnedById(
    notificationId: string,
    userId: string,
    tx?: Tx,
  ): Promise<{ id: string; type: string } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ id: notifications.id, type: notifications.type })
      .from(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .limit(1);
    return row ? { id: row.id, type: row.type } : undefined;
  }

  async hasPendingTeamMentionNotification(
    userId: string,
    rfpId: string,
    windowStart: Date,
    tx?: Tx,
  ): Promise<boolean> {
    const db = this.h(tx);
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, 'team_chat.mention'),
          eq(notifications.linkUrl, teamThreadLink(rfpId)),
          eq(notifications.status, 'queued'),
          gte(notifications.createdAt, windowStart),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
