import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetricComparePopover, type CompareRow } from '../MetricComparePopover';
import type { Bid } from '@/lib/types/bid';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
// pgWsId → 표시 신원. 이름 맵과 로고 맵을 나누지 않는다 — 둘 중 하나만 배선되는 사고가
// 딜룸 로고 누락의 원인이었다.
const wsById = (
  names: Record<string, string>,
  logos: Record<string, string | null> = {},
): Record<string, WorkspaceDisplay> =>
  Object.fromEntries(
    Object.entries(names).map(([id, name]) => [
      id,
      { id, name, type: 'pg' as const, logoUpdatedAt: logos[id] ?? null },
    ]),
  );


beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function makeBid(id: string, pgWsId: string): Bid {
  return {
    id,
    rfpId: 'r1',
    pgWsId,
    invitationId: 'i1',
    settleCycle: 'D+1',
    settleLimit: 0,
    guaranteeInsurance: 0,
    signupFee: 0,
    paymentFees: {},
    customFees: {},
    proposalPdfs: [],
    status: 'submitted',
    submittedBy: 'u1',
    round: 1,
  };
}

const rows: CompareRow[] = [
  { bid: makeBid('b-toss', 'pg-toss'), isBest: true, valueText: '2.20%' },
  { bid: makeBid('b-kg', 'pg-kg'), isBest: false, valueText: '2.50%' },
  { bid: makeBid('b-nice', 'pg-nice'), isBest: false, valueText: '2.80%' },
];

const pgWsById = wsById({ 'pg-toss': '토스페이먼츠', 'pg-kg': 'KG이니시스', 'pg-nice': '나이스페이' });

afterEach(cleanup);

describe('MetricComparePopover', () => {
  it('lists every PG with its value in the given order when opened', async () => {
    const user = userEvent.setup();
    render(
      <MetricComparePopover
        label="카드 수수료"
        rows={rows}
        activeBidId="b-kg"
        pgWsById={pgWsById}
        onSelect={vi.fn()}
      >
        <span>2.50%</span>
      </MetricComparePopover>,
    );
    await user.click(screen.getByTestId('compare-trigger'));

    const dialog = within(await screen.findByTestId('compare-popup'));
    expect(dialog.getByText('토스페이먼츠')).toBeInTheDocument();
    expect(dialog.getByText('2.20%')).toBeInTheDocument();
    expect(dialog.getByText('KG이니시스')).toBeInTheDocument();
    expect(dialog.getByText('나이스페이')).toBeInTheDocument();
  });

  it('marks the active bid as "이 견적" and the best row as "최선"', async () => {
    const user = userEvent.setup();
    render(
      <MetricComparePopover
        label="카드 수수료"
        rows={rows}
        activeBidId="b-kg"
        pgWsById={pgWsById}
        onSelect={vi.fn()}
      >
        <span>2.50%</span>
      </MetricComparePopover>,
    );
    await user.click(screen.getByTestId('compare-trigger'));

    const tossRow = within(await screen.findByTestId('compare-row-pg-toss'));
    expect(tossRow.getByText('최선')).toBeInTheDocument();
    const kgRow = within(screen.getByTestId('compare-row-pg-kg'));
    expect(kgRow.getByText('이 견적')).toBeInTheDocument();
  });

  it('shows the current-condition baseline when provided', async () => {
    const user = userEvent.setup();
    render(
      <MetricComparePopover
        label="카드 수수료"
        rows={rows}
        activeBidId="b-kg"
        pgWsById={pgWsById}
        baselineText="2.8%"
        onSelect={vi.fn()}
      >
        <span>2.50%</span>
      </MetricComparePopover>,
    );
    await user.click(screen.getByTestId('compare-trigger'));
    const dialog = within(await screen.findByTestId('compare-popup'));
    expect(dialog.getByText(/현재/)).toBeInTheDocument();
    expect(dialog.getByText('2.8%')).toBeInTheDocument();
  });

  it('calls onSelect with the PG workspace id when another PG row is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <MetricComparePopover
        label="카드 수수료"
        rows={rows}
        activeBidId="b-kg"
        pgWsById={pgWsById}
        onSelect={onSelect}
      >
        <span>2.50%</span>
      </MetricComparePopover>,
    );
    await user.click(screen.getByTestId('compare-trigger'));
    await user.click(await screen.findByTestId('compare-row-pg-toss'));
    expect(onSelect).toHaveBeenCalledWith('pg-toss');
  });
});
