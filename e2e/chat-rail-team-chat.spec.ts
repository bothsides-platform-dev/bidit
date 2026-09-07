/**
 * 채팅 레일 + 팀 채팅 여정 — 유닛이 모킹으로 못 잡는 배선을 핀한다:
 * 딜룸 셸(DealRoomFull) → 채팅 aside(상시 노출 lg+) → ChatPanel → teamThreadLoader →
 * sendTeamMessageAction → DB 영속 → 재로드 렌더.
 *
 * sealed-bid 불변식의 여정 레벨 검증 포함: 같은 RFP 라도 구매사 팀 메모는
 * PG 팀 채팅에 절대 보이지 않는다 (스코프 = rfpId × workspaceId).
 *
 * 시드 `P-2604-0001` 사용 — buyer 소유, toss 초대 보유(인박스 접근 가능).
 * Centrifugo 미설정 환경이므로 라이브는 no-op, 정적 로더 경로만 검증한다.
 */
import { test, expect } from 'playwright/test';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { loginAs, rfpUuidFromCode } from './_helpers';

process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://supporter_b:supporter_b@localhost:5433/supporter_b_test';

const RFP_CODE = 'P-2604-0001';
const BUYER_MEMO = '구매사 전용 팀 메모 — e2e';
const PG_MEMO = 'PG 전용 팀 메모 — e2e';

test.describe.serial('chat rail — 팀 채팅 왕복 + sealed-bid 격리', () => {
  test.beforeAll(async () => {
    // 멱등 재실행 — 이전 로컬 런의 팀 메모를 걷어낸다.
    const rfpUuid = await rfpUuidFromCode(RFP_CODE);
    await db.execute(
      sql`DELETE FROM rfp_team_messages WHERE rfp_id=${rfpUuid}`,
    );
  });

  test('buyer: 레일 토글 → 팀 메모 전송 → 재로드에도 유지', async ({ page }) => {
    await loginAs(page, 'buyer');
    await page.goto(`/rfp/${RFP_CODE}`);

    // 딜룸 셸은 채팅 aside 를 lg+ 에서 상시 노출(토글 없음 — 기본 뷰포트 1280px).
    await expect(page.getByRole('tab', { name: '상대방 채팅' })).toBeVisible();

    // 팀 채팅 탭 → 메모 전송 → 즉시 렌더.
    await page.getByRole('tab', { name: '팀 채팅' }).click();
    const composer = page.getByPlaceholder('우리 팀에게만 보이는 메모를 남겨보세요…');
    await composer.fill(BUYER_MEMO);
    await page.getByRole('button', { name: '보내기' }).click();
    // Wait for the server-confirmed bubble.
    const buyerBubble = page.locator('[data-message-row][data-sender="self"]', { hasText: BUYER_MEMO });
    await expect(buyerBubble).toBeVisible();
    await expect(buyerBubble.getByLabel('전송 중')).toHaveCount(0);

    // 재로드 후에도 영속 — 로더 경로 검증.
    await page.reload();
    await page.getByRole('tab', { name: '팀 채팅' }).click();
    await expect(page.getByText(BUYER_MEMO)).toBeVisible();
  });

  test('pg(toss): 같은 RFP 의 팀 채팅에 구매사 메모가 보이지 않는다', async ({
    page,
  }) => {
    await loginAs(page, 'pg-toss');
    await page.goto(`/inbox/${RFP_CODE}`);

    await page.getByRole('tab', { name: '팀 채팅' }).click();

    // sealed-bid: 구매사 팀 메모는 어떤 형태로도 노출되지 않는다.
    const composer = page.getByPlaceholder('우리 팀에게만 보이는 메모를 남겨보세요…');
    await expect(composer).toBeVisible();
    await expect(page.getByText(BUYER_MEMO)).toHaveCount(0);

    // PG 자체 메모는 정상 동작.
    await composer.fill(PG_MEMO);
    await page.getByRole('button', { name: '보내기' }).click();
    const pgBubble = page.locator('[data-message-row][data-sender="self"]', { hasText: PG_MEMO });
    await expect(pgBubble).toBeVisible();
    await expect(pgBubble.getByLabel('전송 중')).toHaveCount(0);
  });

  test('buyer: PG 팀 메모도 구매사 팀 채팅에 보이지 않는다 (역방향)', async ({
    page,
  }) => {
    await loginAs(page, 'buyer');
    await page.goto(`/rfp/${RFP_CODE}`);
    await page.getByRole('tab', { name: '팀 채팅' }).click();

    await expect(page.getByText(BUYER_MEMO)).toBeVisible();
    await expect(page.getByText(PG_MEMO)).toHaveCount(0);
  });
});
