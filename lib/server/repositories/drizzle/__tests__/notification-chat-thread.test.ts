// 대화 단위 인앱 알림 정리·중복억제 — pglite-backed.
//
// notifications 행에는 대화 컬럼이 없다(userId + workspaceId + type + linkUrl 뿐).
// 그래서 "이 대화" 를 가리키는 유일한 식별자는 linkUrl 이며, 팀 채팅이 이미
// `/messages?t=<rfpId>` 로 같은 방식을 쓰고 있다. 여기서는 두 가지를 고정한다:
//   1) markChatThreadRead — 그 링크의 queued 인앱 알림만 read 로 내린다.
//   2) hasPendingChatNotification — dedupe 범위가 워크스페이스 전체가 아니라
//      그 링크(=대화) 단위다. 전체였을 때는 구매사가 PG 여럿과 대화 중이면
//      한 대화의 queued 알림이 **다른 대화의 새 알림을 통째로 삼켰다**.

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createPgliteDb } from '@/lib/db/client-pglite';
import { notifications } from '@/lib/db/schema';
import { teamThreadLink } from '@/lib/chat/thread-link';
import { DrizzleNotificationRepository, MARK_READ_LOOKBACK_DAYS } from '../notification';
import { seedBuyerWorkspace, seedMembership, seedUser } from './_seed';
import type { Notification } from '@/lib/types/notification';

async function setup() {
  const db = await createPgliteDb();
  const repo = new DrizzleNotificationRepository(db);
  const user = await seedUser(db);
  const other = await seedUser(db);
  const ws = await seedBuyerWorkspace(db);
  await seedMembership(db, ws.id, user.id);
  await seedMembership(db, ws.id, other.id);
  return { db, repo, user, other, ws };
}

function chatNotification(overrides: {
  userId: string;
  workspaceId: string;
  linkUrl: string;
  status?: Notification['status'];
  type?: string;
}): Notification {
  return {
    id: randomUUID(),
    userId: overrides.userId,
    workspaceId: overrides.workspaceId,
    type: overrides.type ?? 'chat.message',
    title: '새 메시지',
    body: '안녕하세요',
    channel: 'inapp',
    status: overrides.status ?? 'pending',
    linkUrl: overrides.linkUrl,
    createdAt: new Date().toISOString(),
  };
}

const CONV_A = '/messages?c=11111111-1111-4111-8111-111111111111';
const CONV_B = '/messages?c=22222222-2222-4222-8222-222222222222';
const READ_THROUGH = new Date('2100-01-01T00:00:00.000Z');

describe('DrizzleNotificationRepository.markChatThreadRead', () => {
  it('marks queued in-app rows for that thread link as read', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));

    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('read');
      expect(row.readAt).toBeDefined();
    }
  });

  it('does not clear a notification created after the read cursor advanced', async () => {
    const { db, repo, user, ws } = await setup();
    const readThrough = new Date('2026-09-10T12:00:00.000Z');
    await db.insert(notifications).values([
      {
        id: randomUUID(),
        userId: user.id,
        workspaceId: ws.id,
        type: 'chat.message',
        title: '이미 본 메시지',
        body: '',
        channel: 'in_app',
        status: 'queued',
        linkUrl: CONV_A,
        createdAt: new Date('2026-09-10T11:59:59.000Z'),
      },
      {
        id: randomUUID(),
        userId: user.id,
        workspaceId: ws.id,
        type: 'chat.message',
        title: '아직 못 본 메시지',
        body: '',
        channel: 'in_app',
        status: 'queued',
        linkUrl: CONV_A,
        createdAt: new Date('2026-09-10T12:00:01.000Z'),
      },
    ]);

    await repo.markChatThreadRead(user.id, ws.id, CONV_A, readThrough);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    const byTitle = new Map(rows.map((row) => [row.title, row.status]));
    expect(byTitle.get('이미 본 메시지')).toBe('read');
    expect(byTitle.get('아직 못 본 메시지')).toBe('pending');
  });

  it('leaves other conversations untouched', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_B }));

    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    const byLink = new Map(rows.map((r) => [r.linkUrl, r.status]));
    expect(byLink.get(CONV_A)).toBe('read');
    expect(byLink.get(CONV_B)).toBe('pending');
  });

  it('clears every type sharing that thread link, not just chat.message', async () => {
    // 판정은 링크 하나이고 type 을 보지 않는다(types.ts 의 markChatThreadRead 주석).
    // 팀 스레드에서는 메시지 알림과 멘션 알림이 같은 링크를 달고 오므로, 여기서
    // type 을 좁히면(= hasPendingChatNotification 을 흉내내면) 멘션 배지가 조용히
    // 안 걷힌다. 그 '합리적인 조이기'를 이 테스트가 막는다.
    const { repo, user, ws } = await setup();
    const link = teamThreadLink('11111111-1111-4111-8111-1111111111aa');
    await repo.save(
      chatNotification({
        userId: user.id,
        workspaceId: ws.id,
        linkUrl: link,
        type: 'team_chat.message',
      }),
    );
    await repo.save(
      chatNotification({
        userId: user.id,
        workspaceId: ws.id,
        linkUrl: link,
        type: 'team_chat.mention',
      }),
    );

    await repo.markChatThreadRead(user.id, ws.id, link, READ_THROUGH);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'read')).toBe(true);
  });

  it("leaves another member's rows untouched", async () => {
    const { repo, user, other, ws } = await setup();
    await repo.save(chatNotification({ userId: other.id, workspaceId: ws.id, linkUrl: CONV_A }));

    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    const rows = await repo.findRecentForUser(other.id, ws.id, 10);
    expect(rows[0].status).toBe('pending');
  });

  it('leaves the same user’s rows in a DIFFERENT workspace untouched', async () => {
    // 워크스페이스 경계 — 한 사람이 구매사와 PG 워크스페이스를 함께 가질 수 있고,
    // 링크만으로 지우면 지금 보고 있지 않은 쪽 배지까지 걷힌다. 픽스처가 전부 한
    // 워크스페이스를 쓰면 `eq(workspaceId)` 를 지워도 테스트가 통과한다.
    const { db, repo, user, ws } = await setup();
    const otherWs = await seedBuyerWorkspace(db);
    await seedMembership(db, otherWs.id, user.id);
    await repo.save(
      chatNotification({ userId: user.id, workspaceId: otherWs.id, linkUrl: CONV_A }),
    );

    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    const rows = await repo.findRecentForUser(user.id, otherWs.id, 10);
    expect(rows[0].status).toBe('pending');
  });

  it('only reaches back MARK_READ_LOOKBACK_DAYS (파티션 프루닝 하한)', async () => {
    // notifications 는 created_at 으로 RANGE 파티션된다. 하한이 없으면 이 UPDATE
    // 가 모든 월별 자식 테이블을 열고, 이 쿼리는 이제 '마운트 1회'가 아니라
    // 메시지마다 도는 핫패스다.
    //
    // 대가는 명시적이다 — 하한보다 오래된 안 읽은 알림은 여기서 안 걷힌다.
    // 사용자는 알림함에서 직접 지울 수 있다(markAllRead 는 하한이 없다).
    const { db, repo, user, ws } = await setup();
    const stale = new Date(Date.now() - (MARK_READ_LOOKBACK_DAYS + 1) * 24 * 60 * 60 * 1000);
    const fresh = chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A });
    await repo.save(fresh);
    await db.insert(notifications).values({
      id: randomUUID(),
      userId: user.id,
      workspaceId: ws.id,
      type: 'chat.message',
      title: '오래된 알림',
      body: '',
      channel: 'in_app',
      status: 'queued',
      linkUrl: CONV_A,
      createdAt: stale,
    });

    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    const byTitle = new Map(rows.map((r) => [r.title, r.status]));
    expect(byTitle.get('새 메시지')).toBe('read');
    expect(byTitle.get('오래된 알림')).toBe('pending');
  });

  it('does not move readAt on a row that was already read', async () => {
    // `isNull(readAt)` 가드가 없으면 다시 열 때마다 readAt 이 앞으로 밀려
    // "언제 읽었나"가 마지막 열람 시각으로 덮인다.
    const { db, repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));
    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);
    const firstReadAt = (await repo.findRecentForUser(user.id, ws.id, 10))[0].readAt;
    expect(firstReadAt).toBeDefined();

    await new Promise((r) => setTimeout(r, 5));
    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    const after = (await repo.findRecentForUser(user.id, ws.id, 10))[0];
    expect(after.readAt).toBe(firstReadAt);
    void db;
  });
});

describe('DrizzleNotificationRepository.hasPendingChatNotification', () => {
  const windowStart = new Date(Date.now() - 60_000);

  it('is true when a queued row for the same thread exists in the window', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));

    expect(
      await repo.hasPendingChatNotification(user.id, ws.id, CONV_A, windowStart),
    ).toBe(true);
  });

  it('is false when the only queued row belongs to a different conversation (regression)', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_B }));

    expect(
      await repo.hasPendingChatNotification(user.id, ws.id, CONV_A, windowStart),
    ).toBe(false);
  });

  it('is false once the thread has been read', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));
    await repo.markChatThreadRead(user.id, ws.id, CONV_A, READ_THROUGH);

    expect(
      await repo.hasPendingChatNotification(user.id, ws.id, CONV_A, windowStart),
    ).toBe(false);
  });
});
