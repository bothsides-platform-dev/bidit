import { beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb, type PgliteDB } from '@/lib/db/client-pglite';
import { seedUser, seedBuyerWorkspace, seedRfp } from './_seed';
import { DrizzleRfpTeamMessageReadRepository } from '../rfp-team-message-read';

let db: PgliteDB;
beforeEach(async () => { db = await createPgliteDb(); });

describe('DrizzleRfpTeamMessageReadRepository', () => {
  it('upsert inserts then updates monotonically; getFor reads back', async () => {
    const u = await seedUser(db, { email: 'm@b.com', name: '멤버' });
    const ws = await seedBuyerWorkspace(db);
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: u.id });
    const repo = new DrizzleRfpTeamMessageReadRepository(db);

    expect(await repo.getFor(rfp.id, ws.id, u.id)).toBeUndefined();

    const t1 = new Date('2026-06-14T00:00:00Z');
    await repo.upsert(rfp.id, ws.id, u.id, t1);
    expect((await repo.getFor(rfp.id, ws.id, u.id))?.lastReadAt.toISOString()).toBe(t1.toISOString());

    const t2 = new Date('2026-06-14T01:00:00Z');
    await repo.upsert(rfp.id, ws.id, u.id, t2);
    expect((await repo.getFor(rfp.id, ws.id, u.id))?.lastReadAt.toISOString()).toBe(t2.toISOString());

    await repo.upsert(rfp.id, ws.id, u.id, t1);
    expect((await repo.getFor(rfp.id, ws.id, u.id))?.lastReadAt.toISOString()).toBe(t2.toISOString());
  });

  it('isolates read state per (rfp, workspace, user)', async () => {
    const a = await seedUser(db, { email: 'a@b.com', name: 'A' });
    const b = await seedUser(db, { email: 'b@b.com', name: 'B' });
    const ws = await seedBuyerWorkspace(db);
    const rfp = await seedRfp(db, { buyerWsId: ws.id, createdBy: a.id });
    const repo = new DrizzleRfpTeamMessageReadRepository(db);
    await repo.upsert(rfp.id, ws.id, a.id, new Date());
    expect(await repo.getFor(rfp.id, ws.id, b.id)).toBeUndefined();
  });
});
