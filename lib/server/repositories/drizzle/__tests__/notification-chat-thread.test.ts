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
import { DrizzleNotificationRepository } from '../notification';
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

describe('DrizzleNotificationRepository.markChatThreadRead', () => {
  it('marks queued in-app rows for that thread link as read', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));

    await repo.markChatThreadRead(user.id, ws.id, CONV_A);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('read');
      expect(row.readAt).toBeDefined();
    }
  });

  it('leaves other conversations untouched', async () => {
    const { repo, user, ws } = await setup();
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_A }));
    await repo.save(chatNotification({ userId: user.id, workspaceId: ws.id, linkUrl: CONV_B }));

    await repo.markChatThreadRead(user.id, ws.id, CONV_A);

    const rows = await repo.findRecentForUser(user.id, ws.id, 10);
    const byLink = new Map(rows.map((r) => [r.linkUrl, r.status]));
    expect(byLink.get(CONV_A)).toBe('read');
    expect(byLink.get(CONV_B)).toBe('pending');
  });

  it("leaves another member's rows untouched", async () => {
    const { repo, user, other, ws } = await setup();
    await repo.save(chatNotification({ userId: other.id, workspaceId: ws.id, linkUrl: CONV_A }));

    await repo.markChatThreadRead(user.id, ws.id, CONV_A);

    const rows = await repo.findRecentForUser(other.id, ws.id, 10);
    expect(rows[0].status).toBe('pending');
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
    await repo.markChatThreadRead(user.id, ws.id, CONV_A);

    expect(
      await repo.hasPendingChatNotification(user.id, ws.id, CONV_A, windowStart),
    ).toBe(false);
  });
});
