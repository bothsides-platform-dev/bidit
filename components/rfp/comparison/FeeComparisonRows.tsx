'use client';

// 활성 견적의 결제수단 요율 행 목록 — 각 행 hover 시 MetricComparePopover 로 전 PG 를
// 좋은 순으로 줄세운다. 표현 전용; 랭킹은 rankByMetric, 행 구성은 buildFeeRows.
// memo 로 감싸 무관 상태 변화에서 재렌더를 줄인다.
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { MetricComparePopover, type CompareRow } from './MetricComparePopover';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import { rankByMetric } from '@/lib/utils/bid-compare';
import { formatPct, formatKRW } from '@/lib/utils/format';
import type { Bid, MerchantTier } from '@/lib/types/bid';
import type { FeeRow } from './focus-comparison-model';

function FeeComparisonRowsImpl({
  feeRows,
  sortedBids,
  active,
  tier,
  pgWsById,
  onSelect,
  flash,
}: {
  feeRows: FeeRow[];
  sortedBids: Bid[];
  active: Bid;
  tier: MerchantTier;
  pgWsById: Record<string, WorkspaceDisplay>;
  onSelect: (pgWsId: string) => void;
  flash?: boolean;
}) {
  let flashIndex = 0;
  return (
    <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-t border-[var(--md-sys-color-outline-variant)]">
      {feeRows.map((row) => {
        const ranked = rankByMetric(sortedBids, (b) => row.getValue(b, tier), 'lower');
        // 정액(건당) 행은 원, 정률 행은 % 로 표기.
        const fmtFee = (v: number) => (row.unit === 'flat' ? formatKRW(v) : formatPct(v));
        const rows: CompareRow[] = ranked.map((r) => ({
          bid: r.bid,
          isBest: r.isBest,
          valueText: r.value !== null ? fmtFee(r.value) : '—',
        }));
        const activeValue = row.getValue(active, tier);
        const shouldFlash = flash && row.isTiered;
        const delay = shouldFlash ? flashIndex++ * 40 : 0;
        return (
          <div key={row.key} className="py-2 flex items-center justify-between">
            <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
              {row.label}
            </span>
            <MetricComparePopover
              label={row.label}
              rows={rows}
              activeBidId={active.id}
              pgWsById={pgWsById}
              baselineText={row.baseline}
              onSelect={onSelect}
            >
              <span
                data-testid={`fee-value-${row.key}`}
                className={cn(
                  'md-numeric text-[13px] font-[600] text-[var(--md-sys-color-on-surface)]',
                  shouldFlash && 'tier-flash',
                )}
                style={shouldFlash ? { animationDelay: `${delay}ms` } : undefined}
              >
                {activeValue !== null ? fmtFee(activeValue) : '—'}
              </span>
            </MetricComparePopover>
          </div>
        );
      })}
    </div>
  );
}

export const FeeComparisonRows = memo(FeeComparisonRowsImpl);
