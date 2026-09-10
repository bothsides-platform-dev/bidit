import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb, type PgliteDB } from '@/lib/db/client-pglite';
import {
  __resetForTest,
  __useDrizzleWithDbForTest,
  getNotificationRepo,
  getOutboxRepo,
} from '@/lib/server/repositories/factory';
import { notifications, outboxEntries } from '@/lib/db/schema';
import { seedUser, seedBuyerWorkspace } from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { notify } from '../notify';

let db: PgliteDB;

beforeEach(async () => {
  __resetForTest();
  db = await createPgliteDb();
  await __useDrizzleWithDbForTest(db);
});
afterEach(() => {
  __resetForTest();
  vi.restoreAllMocks();
});

describe('notify()', () => {
  it('호출자가 준 사건 시각을 인앱 알림에도 그대로 사용한다', async () => {
    const u = await seedUser(db, { email: 'event-time@x.com' });
    const createdAt = new Date('2026-09-05T12:00:00.000Z');

    const created = await db.transaction((tx) =>
      notify(tx, {
        recipients: [{ userId: u.id, workspaceId: null, email: u.email }],
        channels: ['inapp'],
        type: 'chat.message',
        title: 't',
        body: 'b',
        createdAt,
      }),
    );

    expect(created[0]?.createdAt).toBe(createdAt.toISOString());
    expect((await db.select().from(notifications))[0]?.createdAt.toISOString()).toBe(
      createdAt.toISOString(),
    );
  });

  it('channels:[inapp] → notifications row만, outbox 없음, 생성 알림 반환', async () => {
    const u = await seedUser(db, { email: 'a@x.com' });
    const created = await db.transaction((tx) =>
      notify(tx, {
        recipients: [{ userId: u.id, workspaceId: null, email: u.email }],
        channels: ['inapp'],
        type: 'rfp.awarded',
        title: 't',
        body: 'b',
        linkUrl: '/inbox/X',
      }),
    );
    const notifRows = await db.select().from(notifications);
    const outboxRows = await db.select().from(outboxEntries);
    expect(notifRows).toHaveLength(1);
    expect(notifRows[0].channel).toBe('in_app');
    expect(notifRows[0].userId).toBe(u.id);
    expect(notifRows[0].linkUrl).toBe('/inbox/X');
    expect(outboxRows).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0].channel).toBe('inapp');
  });

  it('channels:[email] → outbox 엔트리만, notifications 없음, 반환 빈 배열', async () => {
    const u = await seedUser(db, { email: 'b@x.com' });
    const created = await db.transaction((tx) =>
      notify(tx, {
        recipients: [{ userId: u.id, workspaceId: null, email: u.email }],
        channels: ['email'],
        type: 'bid.submitted',
        title: 't',
        body: 'b',
        email: {
          event: 'bid.submitted',
          subject: 's',
          html: '<p>h</p>',
          dedupeKey: (r) => `k:${r.email}`,
        },
      }),
    );
    const notifRows = await db.select().from(notifications);
    const outboxRows = await db.select().from(outboxEntries);
    expect(notifRows).toHaveLength(0);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].toAddr).toBe('b@x.com');
    expect(outboxRows[0].dedupeKey).toBe('k:b@x.com');
    expect(created).toHaveLength(0);
  });

  it('channels:[inapp,email] 다중 recipient → 각자 row+outbox, dedupeKey는 수신자별', async () => {
    const u1 = await seedUser(db, { email: 'c1@x.com' });
    const u2 = await seedUser(db, { email: 'c2@x.com' });
    const ws1 = await seedBuyerWorkspace(db);
    const created = await db.transaction((tx) =>
      notify(tx, {
        recipients: [
          { userId: u1.id, workspaceId: ws1.id, email: u1.email },
          { userId: u2.id, workspaceId: ws1.id, email: u2.email },
        ],
        channels: ['inapp', 'email'],
        type: 'rfp.awarded',
        title: 't',
        body: 'b',
        email: {
          event: 'rfp.awarded',
          subject: 's',
          html: '<p>h</p>',
          dedupeKey: (r) => `rfp:1:awarded:${r.email}`,
        },
      }),
    );
    const notifRows = await db.select().from(notifications);
    const outboxRows = await db.select().from(outboxEntries);
    expect(notifRows).toHaveLength(2);
    expect(outboxRows).toHaveLength(2);
    expect(created).toHaveLength(2);
    expect(outboxRows.map((r) => r.dedupeKey).sort()).toEqual([
      'rfp:1:awarded:c1@x.com',
      'rfp:1:awarded:c2@x.com',
    ]);
  });

  it('channels:[] → no-op (row·outbox 모두 없음, 빈 배열 반환)', async () => {
    const u = await seedUser(db, { email: 'd@x.com' });
    const created = await db.transaction((tx) =>
      notify(tx, {
        recipients: [{ userId: u.id, workspaceId: null, email: u.email }],
        channels: [],
        type: 't',
        title: 't',
        body: 'b',
      }),
    );
    expect(await db.select().from(notifications)).toHaveLength(0);
    expect(await db.select().from(outboxEntries)).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('email 채널인데 email 페이로드 없으면 throw', async () => {
    const u = await seedUser(db, { email: 'e@x.com' });
    await expect(
      db.transaction((tx) =>
        notify(tx, {
          recipients: [{ userId: u.id, workspaceId: null, email: u.email }],
          channels: ['email'],
          type: 't',
          title: 't',
          body: 'b',
        }),
      ),
    ).rejects.toThrow(/email/);
  });
});

describe('notify() — 팬아웃 배치화', () => {
  async function threeRecipients() {
    const ws = await seedBuyerWorkspace(db);
    const users = await Promise.all([
      seedUser(db, { email: 'r1@x.com' }),
      seedUser(db, { email: 'r2@x.com' }),
      seedUser(db, { email: 'r3@x.com' }),
    ]);
    return {
      ws,
      users,
      recipients: users.map((u) => ({ userId: u.id, workspaceId: ws.id, email: u.email })),
    };
  }

  it('수신자가 몇 명이든 insert 는 채널당 한 번씩만 나간다', async () => {
    const { recipients } = await threeRecipients();
    const [notifRepo, outboxRepo] = await Promise.all([getNotificationRepo(), getOutboxRepo()]);
    const saveMany = vi.spyOn(notifRepo, 'saveMany');
    const save = vi.spyOn(notifRepo, 'save');
    const enqueueMany = vi.spyOn(outboxRepo, 'enqueueMany');
    const enqueue = vi.spyOn(outboxRepo, 'enqueue');

    await db.transaction((tx) =>
      notify(tx, {
        recipients,
        channels: ['inapp', 'email'],
        type: 'rfp.awarded',
        title: 't',
        body: 'b',
        email: { event: 'rfp.awarded', subject: 's', html: '<p>x</p>' },
      }),
    );

    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(enqueueMany).toHaveBeenCalledTimes(1);
    // 수신자당 단건 insert 로 되돌아가면 여기서 잡힌다.
    expect(save).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await db.select().from(notifications)).toHaveLength(3);
    expect(await db.select().from(outboxEntries)).toHaveLength(3);
  });

  // dedupeKey 가 recipient 를 받게 된 핵심 이유. 예전 시그니처는 (email)=>string
  // 이라 userId 기반 키를 쓰려면 호출-불변 `() => ...` 클로저로 루프를 돌아야
  // 했고, 그 클로저를 그대로 다중 수신자에 넘기면 전원이 같은 키를 내 outbox
  // UNIQUE 에 걸려 **1건만 남고 나머지 메일이 조용히 사라진다**.
  it('dedupeKey 가 수신자별로 갈리면 수신자 수만큼 outbox 행이 남는다', async () => {
    const { recipients } = await threeRecipients();

    await db.transaction((tx) =>
      notify(tx, {
        recipients,
        channels: ['email'],
        type: 'bid.submitted',
        title: 't',
        body: 'b',
        email: {
          event: 'bid.submitted',
          subject: 's',
          html: '<p>x</p>',
          dedupeKey: (r) => `bid:rfp-1:ws-1:${r.userId}`,
        },
      }),
    );

    const rows = await db.select().from(outboxEntries);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(3);
  });

  it('dedupeKey 가 상수면 예전처럼 1건으로 collapse 된다 (중복 억제는 그대로)', async () => {
    const { recipients } = await threeRecipients();

    await db.transaction((tx) =>
      notify(tx, {
        recipients,
        channels: ['email'],
        type: 'bid.submitted',
        title: 't',
        body: 'b',
        email: {
          event: 'bid.submitted',
          subject: 's',
          html: '<p>x</p>',
          dedupeKey: () => 'same-for-everyone',
        },
      }),
    );

    expect(await db.select().from(outboxEntries)).toHaveLength(1);
  });

  // contract-signing 이 수신자마다 루프를 돌던 두 번째 이유 — 구매사는
  // /rfp/{code}, PG 는 /inbox/{code} 로 링크가 갈린다.
  it('linkUrl 을 함수로 주면 수신자별 링크가 각 알림에 들어간다', async () => {
    const { ws, users, recipients } = await threeRecipients();

    await db.transaction((tx) =>
      notify(tx, {
        recipients,
        channels: ['inapp'],
        type: 'signing.sent',
        title: 't',
        body: 'b',
        linkUrl: (r) => `/deal/${r.userId}`,
      }),
    );

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(3);
    const byUser = new Map(rows.map((r) => [r.userId, r.linkUrl]));
    for (const u of users) expect(byUser.get(u.id)).toBe(`/deal/${u.id}`);
    expect(rows.every((r) => r.workspaceId === ws.id)).toBe(true);
  });

  it('linkUrl 문자열은 종전대로 전원 동일하게 적용된다', async () => {
    const { recipients } = await threeRecipients();

    await db.transaction((tx) =>
      notify(tx, {
        recipients,
        channels: ['inapp'],
        type: 'rfp.sent',
        title: 't',
        body: 'b',
        linkUrl: '/rfp/P-1',
      }),
    );

    const rows = await db.select().from(notifications);
    expect(rows.every((r) => r.linkUrl === '/rfp/P-1')).toBe(true);
  });

  // dedupeKey 가 (email)=>string 에서 (recipient)=>string 으로 넓어지면서 생긴
  // 함정: `(email) => \`k:${email}\`` 같은 옛 호출부는 **타입 체크를 통과한다**
  // (파라미터 이름은 타입이 아니다). 그런데 이제 객체가 들어와 키가
  // `k:[object Object]` 로 굳고, 전원이 같은 키를 내 outbox dedupe 에 걸려
  // 첫 1명 말고는 메일이 조용히 사라진다. 컴파일러가 못 잡으니 런타임에서 막는다.
  it('dedupeKey 가 수신자 객체를 그대로 문자열에 넣으면 즉시 throw', async () => {
    const { recipients } = await threeRecipients();

    await expect(
      db.transaction((tx) =>
        notify(tx, {
          recipients,
          channels: ['email'],
          type: 'rfp.awarded',
          title: 't',
          body: 'b',
          email: {
            event: 'rfp.awarded',
            subject: 's',
            html: '<p>x</p>',
            // 옛 시그니처 그대로 둔 호출부를 흉내낸다.
            dedupeKey: ((email: unknown) => `k:${email}`) as never,
          },
        }),
      ),
    ).rejects.toThrow(/dedupeKey/);
  });

  it('수신자 0명이면 insert 자체가 나가지 않는다', async () => {
    const [notifRepo, outboxRepo] = await Promise.all([getNotificationRepo(), getOutboxRepo()]);
    const saveMany = vi.spyOn(notifRepo, 'saveMany');
    const enqueueMany = vi.spyOn(outboxRepo, 'enqueueMany');

    const created = await db.transaction((tx) =>
      notify(tx, {
        recipients: [],
        channels: ['inapp', 'email'],
        type: 't',
        title: 't',
        body: 'b',
        email: { event: 'rfp.awarded', subject: 's', html: '<p>x</p>' },
      }),
    );

    expect(created).toEqual([]);
    expect(saveMany).not.toHaveBeenCalled();
    expect(enqueueMany).not.toHaveBeenCalled();
  });
});
