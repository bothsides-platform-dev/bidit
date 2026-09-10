// rfp-detail-loader — 구매사/PG 상세 페이지·모달이 공유하는 auth-free 로더.
//   - loadBuyerRfpDetail: 소유 가드(null) + submitted bid만 + note Date→ISO 직렬화.
//   - loadPgRfpDetail: canAccess 가드(null) + markOpened 부수효과(accepted→opened, 멱등) + myBid.
// 컨벤션: buyer-kanban-loader.test.ts 와 동일 — pglite + seed, auth mock 없음.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { bids, bidNotes, columns, rfpAllowedPg, rfpInvitations, rfpPgRequests, rfpRequoteRequests, rfps, users, workspaces } from '@/lib/db/schema';
import { createPgliteDb } from '@/lib/db/client-pglite';
import {
  __resetForTest,
  __useDrizzleWithDbForTest,
  getBidQuoteTemplateRepo,
  getInvitationRepo,
  getWorkspaceRepo,
} from '@/lib/server/repositories/factory';
import {
  seedBizProfile,
  seedBuyerWorkspace,
  seedPgWorkspace,
  seedUser,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { generateToken, hashToken, addMinutes } from '@/lib/server/token';
import {
  loadBuyerRfpDetail,
  loadPgRfpDetail,
} from '../rfp-detail-loader';

let ctx: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const db = await createPgliteDb();
  await __useDrizzleWithDbForTest(db);

  const buyer = await seedUser(db, { email: 'buyer@buy.com', name: '구매 담당자' });
  const biz = await seedBizProfile(db);
  const buyerWs = await seedBuyerWorkspace(db, { name: '구매사', bizProfileId: biz.id });
  const otherWs = await seedBuyerWorkspace(db, { name: '남의구매사' });
  const toss = await seedPgWorkspace(db, 'toss.im');
  const inicis = await seedPgWorkspace(db, 'inicis.com');
  const pgUser = await seedUser(db, { email: 'pg@toss.im' });

  async function seedRfp(
    code: string,
    opts: {
      currentFeeRate?: string;
      currentFeeVisibleToPg?: boolean;
      hiddenFromPg?: string[];
    } = {},
  ) {
    const id = randomUUID();
    // Phase E: 읽기 단독 권위 = 문서. feeRate 는 current_terms 에 넣고, hidden_from_pg 는
    // 공개여부에서 파생(프로덕션 dual-write 미러). 개별 currentFeeRate 컬럼은 더 이상 읽지 않는다.
    const hidden =
      opts.hiddenFromPg ??
      (opts.currentFeeVisibleToPg === false ? ['currentTerms.feeRate'] : []);
    await db.insert(rfps).values({
      id,
      code,
      buyerWsId: buyerWs.id,
      bizProfileId: biz.id,
      title: code,
      memo: '',
      deadline: new Date(Date.now() + 86_400_000),
      status: 'sent',
      createdBy: buyer.id,
      sentAt: new Date(),
      currentTerms:
        opts.currentFeeRate != null ? { _v: 1, feeRate: opts.currentFeeRate } : { _v: 1 },
      hiddenFromPg: hidden,
    });
    return id;
  }
  async function seedInvitation(
    rfpId: string,
    pgWsId: string,
    status: 'pending' | 'accepted' | 'opened' = 'accepted',
  ) {
    const id = randomUUID();
    await db.insert(rfpInvitations).values({
      id,
      rfpId,
      pgWsId,
      acceptedByUserId: pgUser.id,
      tokenHash: hashToken(generateToken()),
      sentAt: new Date(),
      expiresAt: new Date(addMinutes(new Date(), 7 * 24 * 60)),
      status,
    });
    return id;
  }
  async function seedBid(
    rfpId: string,
    pgWsId: string,
    invitationId: string,
    status: 'submitted' | 'draft' = 'submitted',
    round = 1,
  ) {
    const id = randomUUID();
    await db.insert(bids).values({
      id,
      rfpId,
      pgWsId,
      invitationId,
      round,
      settleCycle: 'D+1',
      settleLimit: '0',
      guaranteeInsurance: '0',
      paymentFees: {},
      status,
      submittedBy: pgUser.id,
    });
    return id;
  }
  async function seedNote(bidId: string, body: string) {
    const id = randomUUID();
    await db.insert(bidNotes).values({ id, bidId, authorId: buyer.id, body });
    return id;
  }
  async function seedPgRequest(
    rfpId: string,
    pgWsId: string,
    message: string,
    status: 'pending' | 'accepted' | 'rejected' = 'pending',
  ) {
    const id = randomUUID();
    await db.insert(rfpPgRequests).values({
      id,
      rfpId,
      pgWsId,
      message,
      status,
      createdByUserId: pgUser.id,
    });
    return id;
  }

  return {
    db,
    buyerWsId: buyerWs.id,
    otherWsId: otherWs.id,
    tossId: toss.id,
    inicisId: inicis.id,
    buyerId: buyer.id,
    buyerName: buyer.name,
    pgUserId: pgUser.id,
    seedRfp,
    seedInvitation,
    seedBid,
    seedNote,
    seedPgRequest,
  };
}

// 선정 시나리오: 승자 PG=toss, 패자 PG=inicis. PG 담당자(pgUser)에 이름·전화를 부여하고
// 구매사 담당자(buyer)는 전화 없음(기본). opts.awarded 면 rfp 를 awarded 로 전이한다.
async function seedAwardScenario(opts: { awarded: boolean }): Promise<{ code: string }> {
  await ctx.db
    .update(users)
    .set({ name: '토스 담당자', phone: '010-9999-0000' })
    .where(eq(users.id, ctx.pgUserId));

  const rfpId = await ctx.seedRfp('AWARD-1');
  const winnerInv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
  const winnerBid = await ctx.seedBid(rfpId, ctx.tossId, winnerInv, 'submitted');
  const loserInv = await ctx.seedInvitation(rfpId, ctx.inicisId, 'accepted');
  await ctx.seedBid(rfpId, ctx.inicisId, loserInv, 'submitted');

  if (opts.awarded) {
    await ctx.db
      .update(rfps)
      .set({ status: 'awarded', awardedBidId: winnerBid })
      .where(eq(rfps.id, rfpId));
  }
  return { code: 'AWARD-1' };
}

beforeEach(async () => {
  __resetForTest();
  ctx = await setup();
});

afterEach(() => {
  __resetForTest();
});

describe('loadBuyerRfpDetail', () => {
  it('존재하지 않는 code → null', async () => {
    const res = await loadBuyerRfpDetail({
      code: 'P-9999-9999',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });
    expect(res).toBeNull();
  });

  it('다른 워크스페이스 소유 RFP → null', async () => {
    await ctx.seedRfp('P-2605-0001');
    const res = await loadBuyerRfpDetail({
      code: 'P-2605-0001',
      workspaceId: ctx.otherWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });
    expect(res).toBeNull();
  });

  it('소유 RFP → submitted bid만 반환', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0002');
    const invToss = await ctx.seedInvitation(rfpId, ctx.tossId);
    const invInicis = await ctx.seedInvitation(rfpId, ctx.inicisId);
    const submitted = await ctx.seedBid(rfpId, ctx.tossId, invToss, 'submitted');
    await ctx.seedBid(rfpId, ctx.inicisId, invInicis, 'draft');

    const res = await loadBuyerRfpDetail({
      code: 'P-2605-0002',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    expect(res).not.toBeNull();
    expect(res!.rfp.code).toBe('P-2605-0002');
    // draft 제외, submitted 1건만.
    expect(res!.bids).toHaveLength(1);
    expect(res!.bids[0].id).toBe(submitted);
    expect(res!.authorId).toBe(ctx.buyerId);
  });

  it('multi-round: PG별 최신 라운드 bid만 반환하고 requoteByPg·priorBidByPg를 노출', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0030');
    const inv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    // round 1 + round 2 제출.
    await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted', 1);
    const bid2Id = await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted', 2);
    // requote 레코드 (round 2, responded).
    await ctx.db.insert(rfpRequoteRequests).values({
      id: randomUUID(),
      rfpId,
      pgWsId: ctx.tossId,
      round: 2,
      message: '낮춰주세요',
      deadline: new Date(Date.now() + 86_400_000),
      status: 'responded',
      createdByUserId: ctx.buyerId,
      createdAt: new Date(),
      respondedAt: new Date(),
    });

    const res = await loadBuyerRfpDetail({
      code: 'P-2606-0030',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    expect(res).not.toBeNull();
    // bids 는 최신 라운드 1건만.
    const forToss = res!.bids.filter((b) => b.pgWsId === ctx.tossId);
    expect(forToss).toHaveLength(1);
    expect(forToss[0]!.id).toBe(bid2Id);
    expect(forToss[0]!.round).toBe(2);
    // requoteByPg.
    expect(res!.requoteByPg[ctx.tossId]?.status).toBe('responded');
    expect(res!.requoteByPg[ctx.tossId]?.round).toBe(2);
    // priorBidByPg — round 1이 직전.
    expect(res!.priorBidByPg[ctx.tossId]).toBeDefined();
    expect(res!.priorBidByPg[ctx.tossId]!.round).toBe(1);
  });

  it('pgWsById — invited PG 의 wsId 를 키로, 신원(로고 버전 null 포함)을 값으로 반환', async () => {
    const rfpId = await ctx.seedRfp('P-2606-LOGO1');
    const invToss = await ctx.seedInvitation(rfpId, ctx.tossId);
    await ctx.seedBid(rfpId, ctx.tossId, invToss, 'submitted');

    const res = await loadBuyerRfpDetail({
      code: 'P-2606-LOGO1',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    expect(res).not.toBeNull();
    // 반환 객체에 pgWsById 필드가 존재해야 한다.
    expect(res).toHaveProperty('pgWsById');
    expect(res!.pgWsById[ctx.tossId]?.name).toBe('toss.im');
    // 시드된 PG 워크스페이스에 로고가 없으므로 null.
    expect(res!.pgWsById[ctx.tossId]?.logoUpdatedAt).toBeNull();
  });

  // 워크스페이스 신원(이름 + 로고 버전)은 항상 한 덩어리로 옮긴다 — 이름만 담고 로고를
  // 흘리는 것이 딜룸 PG 관리 탭에서 로고가 사라진 원인이었다.
  it('inviteList 항목이 워크스페이스 신원(로고 버전 포함)을 함께 담는다', async () => {
    const logoAt = new Date('2026-01-02T03:04:05.000Z');
    await ctx.db.update(workspaces).set({ logoUpdatedAt: logoAt }).where(eq(workspaces.id, ctx.tossId));
    const rfpId = await ctx.seedRfp('P-2606-LOGO2');
    await ctx.seedInvitation(rfpId, ctx.tossId);
    // inviteList 의 소스는 allowlist(rfp_allowed_pg)다 — invitation row 만으로는 뜨지 않는다.
    await ctx.db.insert(rfpAllowedPg).values({ rfpId, pgWsId: ctx.tossId });

    const res = await loadBuyerRfpDetail({
      code: 'P-2606-LOGO2',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    const entry = res!.inviteList.find((i) => i.ws.id === ctx.tossId)!;
    expect(entry.ws.name).toBe('toss.im');
    expect(entry.ws.logoUpdatedAt).toBe(logoAt.toISOString());
  });

  it('findDisplayInfoByIds 가 누락한 초대 PG는 unknownPgWorkspace 자리표시자(이름=id, 로고=null)로 대체한다', async () => {
    // FK(rfp_allowed_pg.pg_ws_id → workspaces.id, cascade)상 실제로 워크스페이스가 사라지면
    // allowlist 행도 함께 지워져 이 상태를 시딩으로 재현할 수 없다 — 배치 조회가 일부 id를
    // 빠뜨리는 경합(레플리카 지연 등)을 findDisplayInfoByIds 를 스텁해 흉내낸다. 예전 코드는
    // `pgWsNameMap[wsId] ?? wsId` 로 이름 대신 id를 노출했는데, 그 폴백이 신원 객체로 옮겨간
    // 뒤에도 여전히 동작하는지 여기서 고정한다.
    const rfpId = await ctx.seedRfp('P-2606-LOGO4');
    await ctx.seedInvitation(rfpId, ctx.tossId);
    await ctx.db.insert(rfpAllowedPg).values({ rfpId, pgWsId: ctx.tossId });

    const wsRepo = await getWorkspaceRepo();
    const real = wsRepo.findDisplayInfoByIds.bind(wsRepo);
    // 매 호출에서 toss만 걷어낸다 — 호출 순서(pgWsById용/pendingRequests용)에 의존하지 않는다.
    const spy = vi
      .spyOn(wsRepo, 'findDisplayInfoByIds')
      .mockImplementation(async (ids, tx) => (await real(ids, tx)).filter((w) => w.id !== ctx.tossId));

    const res = await loadBuyerRfpDetail({
      code: 'P-2606-LOGO4',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    spy.mockRestore();

    const entry = res!.inviteList.find((i) => i.ws.id === ctx.tossId)!;
    expect(entry.ws.name).toBe(ctx.tossId);
    expect(entry.ws.type).toBe('pg');
    expect(entry.ws.logoUpdatedAt).toBeNull();
  });

  it('pendingRequests 항목이 워크스페이스 신원(로고 버전 포함)을 함께 담는다', async () => {
    const logoAt = new Date('2026-02-03T04:05:06.000Z');
    await ctx.db.update(workspaces).set({ logoUpdatedAt: logoAt }).where(eq(workspaces.id, ctx.tossId));
    const rfpId = await ctx.seedRfp('P-2606-LOGO3');
    await ctx.seedPgRequest(rfpId, ctx.tossId, '제안 드리고 싶어요', 'pending');

    const res = await loadBuyerRfpDetail({
      code: 'P-2606-LOGO3',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    const req = res!.pendingRequests[0]!;
    expect(req.pgWs.id).toBe(ctx.tossId);
    expect(req.pgWs.name).toBe('toss.im');
    expect(req.pgWs.logoUpdatedAt).toBe(logoAt.toISOString());
  });

  it('findDisplayInfoByIds 가 누락한 요청 PG도 unknownPgWorkspace 자리표시자로 대체한다', async () => {
    // 위 inviteList 케이스와 같은 경합을 pendingRequests 경로(reqWsById)에서 재현 — 두 목록이
    // 같은 헬퍼(unknownPgWorkspace)를 공유하는지, 아니면 한쪽만 폴백이 빠졌는지를 가른다.
    const rfpId = await ctx.seedRfp('P-2606-LOGO5');
    await ctx.seedPgRequest(rfpId, ctx.tossId, '제안 드리고 싶어요', 'pending');

    const wsRepo = await getWorkspaceRepo();
    const real = wsRepo.findDisplayInfoByIds.bind(wsRepo);
    const spy = vi
      .spyOn(wsRepo, 'findDisplayInfoByIds')
      .mockImplementation(async (ids, tx) => (await real(ids, tx)).filter((w) => w.id !== ctx.tossId));

    const res = await loadBuyerRfpDetail({
      code: 'P-2606-LOGO5',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    spy.mockRestore();

    const req = res!.pendingRequests[0]!;
    expect(req.pgWs.id).toBe(ctx.tossId);
    expect(req.pgWs.name).toBe(ctx.tossId);
    expect(req.pgWs.logoUpdatedAt).toBeNull();
  });

  it('pendingRequests에 pending 콜드 피치만 PG명+메시지와 함께 반환', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0003');
    await ctx.seedPgRequest(rfpId, ctx.tossId, '제안 드리고 싶어요', 'pending');
    await ctx.seedPgRequest(rfpId, ctx.inicisId, '이미 거절됨', 'rejected');

    const res = await loadBuyerRfpDetail({
      code: 'P-2605-0003',
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });

    expect(res).not.toBeNull();
    expect(res!.pendingRequests).toHaveLength(1);
    const req = res!.pendingRequests[0];
    expect(req.pgWs.id).toBe(ctx.tossId);
    expect(req.pgWs.name).toBe('toss.im');
    expect(req.message).toBe('제안 드리고 싶어요');
    expect(typeof req.id).toBe('string');
  });
});

describe('loadPgRfpDetail', () => {
  it('초대받지 않은 PG → null', async () => {
    await ctx.seedRfp('P-2605-0010');
    const res = await loadPgRfpDetail({
      code: 'P-2605-0010',
      workspaceId: ctx.tossId,
    });
    expect(res).toBeNull();
  });

  it('초대된 PG → accepted invitation을 opened로 전이(markOpened)하고 멱등', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0011');
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2605-0011', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.myBid).toBeUndefined();

    const invRepo = await getInvitationRepo();
    const after = (await invRepo.findByRfp(rfpId)).find((i) => i.pgWsId === ctx.tossId)!;
    expect(after.status).toBe('opened');

    // 두 번째 진입은 멱등 — 여전히 opened, throw 없음.
    const res2 = await loadPgRfpDetail({ code: 'P-2605-0011', workspaceId: ctx.tossId });
    expect(res2).not.toBeNull();
    const after2 = (await invRepo.findByRfp(rfpId)).find((i) => i.pgWsId === ctx.tossId)!;
    expect(after2.status).toBe('opened');
  });

  it('이미 제출한 bid가 있으면 myBid 반환', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0012');
    const inv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    const bidId = await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted');

    const res = await loadPgRfpDetail({ code: 'P-2605-0012', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.myBid?.id).toBe(bidId);
  });

  it('buyer.name 에 구매사 워크스페이스 name을 반환', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0013');
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2605-0013', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.buyer.name).toBe('구매사');
  });

  it('buyer.logoUpdatedAt 을 반환한다 (로고 없으면 null)', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0015');
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2605-0015', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    // 시드 워크스페이스는 logoUpdatedAt을 설정하지 않으므로 null.
    expect(res!.buyer.logoUpdatedAt).toBeNull();
  });

  it('buyer 에 구매사 신원(이름 + 로고 버전)을 함께 반환한다', async () => {
    const logoAt = new Date('2026-03-04T05:06:07.000Z');
    await ctx.db.update(workspaces).set({ logoUpdatedAt: logoAt }).where(eq(workspaces.id, ctx.buyerWsId));
    const rfpId = await ctx.seedRfp('P-2605-0016');
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2605-0016', workspaceId: ctx.tossId });
    expect(res!.buyer.id).toBe(ctx.buyerWsId);
    expect(res!.buyer.name).toBe('구매사');
    expect(res!.buyer.logoUpdatedAt).toBe(logoAt.toISOString());
  });

  it('getDisplayInfo가 구매사를 못 찾으면 buyer가 이름 "—"/타입 buyer/로고 null인 자리표시자로 대체된다', async () => {
    // rfp.buyer_ws_id 는 FK(NOT NULL, references workspaces.id)라 시딩으로 진짜 "사라진
    // 구매사"를 만들 수 없다 — 예전 코드의 `buyerWs?.name ?? '—'` 폴백이 실제로 발동하는 건
    // findById/getDisplayInfo 조회가 실패하는 경합(레플리카 지연 등)뿐이다. 그 폴백이
    // WorkspaceDisplay 객체로 옮겨간 뒤에도 이름·타입·로고가 전부 안전한 기본값인지 고정한다.
    const rfpId = await ctx.seedRfp('P-2605-0017');
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const wsRepo = await getWorkspaceRepo();
    const spy = vi.spyOn(wsRepo, 'getDisplayInfo').mockResolvedValueOnce(undefined);

    const res = await loadPgRfpDetail({ code: 'P-2605-0017', workspaceId: ctx.tossId });

    spy.mockRestore();

    expect(res!.buyer.id).toBe(ctx.buyerWsId);
    expect(res!.buyer.name).toBe('—');
    expect(res!.buyer.type).toBe('buyer');
    expect(res!.buyer.logoUpdatedAt).toBeNull();
  });

  it('pending 재요청이 있으면 pendingRequote 반환; 없으면 null', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0050');
    const inv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted', 1);
    await ctx.db.insert(rfpRequoteRequests).values({
      id: randomUUID(),
      rfpId,
      pgWsId: ctx.tossId,
      round: 2,
      message: '수수료 낮춰주세요',
      deadline: new Date(Date.now() + 86_400_000),
      status: 'pending',
      createdByUserId: ctx.buyerId,
      createdAt: new Date(),
    });

    const res = await loadPgRfpDetail({ code: 'P-2606-0050', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.pendingRequote).not.toBeNull();
    expect(res!.pendingRequote!.round).toBe(2);
    expect(res!.pendingRequote!.message).toBe('수수료 낮춰주세요');
  });

  it('currentFeeVisibleToPg=false면 currentFeeRate를 서버에서 제거하고 PG에게 반환한다(payload 누출 차단)', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0060', {
      currentFeeRate: '3.4%',
      currentFeeVisibleToPg: false,
    });
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2606-0060', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    // 봉인입찰: 비공개 수수료는 PG 페이로드에 절대 담기지 않는다.
    expect(res!.rfp.currentFeeRate).toBeUndefined();
  });

  it('currentFeeVisibleToPg=true면 currentFeeRate를 그대로 PG에게 반환한다', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0061', {
      currentFeeRate: '3.4%',
      currentFeeVisibleToPg: true,
    });
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2606-0061', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.rfp.currentFeeRate).toBe('3.4%');
  });

  it('hidden_from_pg가 currentTerms.feeRate를 포함하면 currentFeeRate를 제거한다(일반화된 경계)', async () => {
    // boolean 은 건드리지 않고 일반화된 숨김 목록만으로 strip 되는지 — Phase D 핵심.
    const rfpId = await ctx.seedRfp('P-2606-0062', {
      currentFeeRate: '3.4%',
      hiddenFromPg: ['currentTerms.feeRate'],
    });
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2606-0062', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.rfp.currentFeeRate).toBeUndefined();
  });

  it('해당 PG 워크스페이스의 견적 템플릿만 quoteTemplates로 반환(타 워크스페이스 격리)', async () => {
    const rfpId = await ctx.seedRfp('P-2605-0014');
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const repo = await getBidQuoteTemplateRepo();
    await repo.create({
      pgWsId: ctx.tossId,
      name: '표준 요율',
      settleCycle: 'M+1',
      settleLimit: 5_000_000,
      guaranteeInsurance: 0,
      signupFee: 0,
      paymentFees: { card: 0.0125 },
      createdBy: ctx.buyerId,
    });
    await repo.create({
      pgWsId: ctx.inicisId,
      name: '남의 요율',
      settleCycle: 'D+1',
      settleLimit: 0,
      guaranteeInsurance: 0,
      signupFee: 0,
      paymentFees: {},
      createdBy: ctx.buyerId,
    });

    const res = await loadPgRfpDetail({ code: 'P-2605-0014', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.quoteTemplates).toEqual([
      {
        id: expect.any(String),
        name: '표준 요율',
        settleCycle: 'M+1',
        settleLimit: 5_000_000,
        guaranteeInsurance: 0,
        signupFee: 0,
        paymentFees: { card: 0.0125 },
      },
    ]);
  });

  it('PG 페이로드는 allowedPgWorkspaceIds(경쟁사 로스터)를 비운다 — 봉인입찰', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0070');
    // 허용목록에 toss + inicis 둘 다. toss 는 inicis 가 초대된 사실(경쟁사 신원·수)을 알아선 안 된다.
    await ctx.db.insert(rfpAllowedPg).values([
      { rfpId, pgWsId: ctx.tossId },
      { rfpId, pgWsId: ctx.inicisId },
    ]);
    await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');

    const res = await loadPgRfpDetail({ code: 'P-2606-0070', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    // 봉인입찰: 경쟁사 로스터는 PG 페이로드(RSC)에 절대 담기지 않는다.
    expect(res!.rfp.allowedPgWorkspaceIds).toEqual([]);
  });

  it('PG 페이로드에서 buyer-only 메타·감사 필드를 제거한다', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0071');
    const inv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    // 낙찰 입찰 + 커스텀 칸반 컬럼 — 승자 id·내부 보드 상태가 PG 페이로드로 새지 않는지.
    const colId = randomUUID();
    await ctx.db.insert(columns).values({
      id: colId,
      workspaceId: ctx.buyerWsId,
      kind: 'pipeline',
      title: '진행중',
      position: 'a0',
    });
    const bidId = await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted');
    await ctx.db
      .update(rfps)
      .set({ status: 'awarded', awardedBidId: bidId, boardColumnId: colId })
      .where(eq(rfps.id, rfpId));

    const res = await loadPgRfpDetail({ code: 'P-2606-0071', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.rfp.createdBy).toBe('');
    expect(res!.rfp.awardedBidId).toBeUndefined();
    expect(res!.rfp.boardColumnId).toBeNull();
    expect(res!.rfp.boardVisible).toBeUndefined();
    expect(res!.rfp.currentFeeVisibleToPg).toBeUndefined();
    // bizProfile 은 bizNo·grade 만 노출, 세무·감사 필드 제거.
    expect(res!.rfp.bizProfile).toEqual({ bizNo: '1234567890', grade: 'general', gradeSource: 'unset' });
  });

  it('내 입찰이 선정되면 awardedToMe=true (승자 id 는 여전히 노출 안 함)', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0072');
    const inv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    const bidId = await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted');
    await ctx.db
      .update(rfps)
      .set({ status: 'awarded', awardedBidId: bidId })
      .where(eq(rfps.id, rfpId));

    const res = await loadPgRfpDetail({ code: 'P-2606-0072', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.awardedToMe).toBe(true);
    expect(res!.rfp.awardedBidId).toBeUndefined();
  });

  it('다른 PG 가 선정되면 awardedToMe=false (승자 신원 비노출)', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0073');
    const invToss = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    const invInicis = await ctx.seedInvitation(rfpId, ctx.inicisId, 'accepted');
    await ctx.seedBid(rfpId, ctx.tossId, invToss, 'submitted');
    const winnerBidId = await ctx.seedBid(rfpId, ctx.inicisId, invInicis, 'submitted');
    await ctx.db
      .update(rfps)
      .set({ status: 'awarded', awardedBidId: winnerBidId })
      .where(eq(rfps.id, rfpId));

    // 미선정 PG(toss) 시점에서 로드
    const res = await loadPgRfpDetail({ code: 'P-2606-0073', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.awardedToMe).toBe(false);
    expect(res!.rfp.awardedBidId).toBeUndefined();
  });

  it('선정 전이면 awardedToMe=false', async () => {
    const rfpId = await ctx.seedRfp('P-2606-0074');
    const inv = await ctx.seedInvitation(rfpId, ctx.tossId, 'accepted');
    await ctx.seedBid(rfpId, ctx.tossId, inv, 'submitted');

    const res = await loadPgRfpDetail({ code: 'P-2606-0074', workspaceId: ctx.tossId });
    expect(res).not.toBeNull();
    expect(res!.awardedToMe).toBe(false);
  });
});

describe('연락처 교환 (awarded)', () => {
  it('구매사 로더: awarded 면 선정 PG 담당자 연락처를 부착한다', async () => {
    const { code } = await seedAwardScenario({ awarded: true });
    const data = await loadBuyerRfpDetail({
      code,
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });
    expect(data?.awardedPgContact).toEqual({
      workspaceName: 'toss.im',
      name: '토스 담당자',
      email: 'pg@toss.im',
      phone: '010-9999-0000',
    });
  });

  it('구매사 로더: sent(미선정) 면 awardedPgContact 가 null', async () => {
    const { code } = await seedAwardScenario({ awarded: false });
    const data = await loadBuyerRfpDetail({
      code,
      workspaceId: ctx.buyerWsId,
      userId: ctx.buyerId,
      userName: ctx.buyerName,
    });
    expect(data?.awardedPgContact).toBeNull();
  });

  it('PG 로더: awardedToMe(승자=toss) 면 구매사 담당자 연락처를 부착한다', async () => {
    const { code } = await seedAwardScenario({ awarded: true });
    const data = await loadPgRfpDetail({ code, workspaceId: ctx.tossId });
    expect(data?.awardedToMe).toBe(true);
    expect(data?.buyerContact).toEqual({
      workspaceName: '구매사',
      name: '구매 담당자',
      email: 'buyer@buy.com',
      phone: null,
    });
  });

  it('PG 로더(경계): 미선정 PG(inicis) 페이로드엔 구매사 연락처가 없다', async () => {
    const { code } = await seedAwardScenario({ awarded: true });
    const data = await loadPgRfpDetail({ code, workspaceId: ctx.inicisId });
    expect(data?.awardedToMe).toBe(false);
    expect(data?.buyerContact).toBeNull();
    // 누출 회귀: 미선정 PG 페이로드에 구매사 이메일도, 어떤 전화번호도(승자 PG 전화 포함)
    // 새지 않아야 한다. 시드된 승자 PG 전화 전체('010-9999-0000')로 검사한다 —
    // 느슨한 '010-' 접두만 보면 무작위 UUID 세그먼트('…-4010-…')에 충돌해 거짓 실패한다.
    expect(JSON.stringify(data)).not.toContain('buyer@buy.com');
    expect(JSON.stringify(data)).not.toContain('010-9999-0000');
  });
});
