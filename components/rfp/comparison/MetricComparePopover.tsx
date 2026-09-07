'use client';

// 값 단위 hover 비교 — 한 지표로 전 PG 를 좋은 순으로 줄세운 팝오버. 부모가 미리 랭킹한
// rows 를 받는 순수 표현 컴포넌트(랭킹/포맷은 lib/utils/bid-compare + 부모 책임).
// 현재 조건이 있으면 기준선으로 표시. 다른 PG 행 클릭 시 onSelect 로 포커스 전환.
import { Popover } from '@base-ui/react/popover';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import type { Bid } from '@/lib/types/bid';

export type CompareRow = { bid: Bid; isBest: boolean; valueText: string };

export function MetricComparePopover({
  label,
  rows,
  activeBidId,
  pgWsById,
  baselineText,
  onSelect,
  children,
}: {
  label: string;
  rows: CompareRow[];
  activeBidId: string;
  pgWsById: Record<string, WorkspaceDisplay>;
  baselineText?: string | null;
  onSelect: (pgWsId: string) => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        data-testid="compare-trigger"
        openOnHover
        delay={120}
        closeDelay={80}
        onClick={(e) => e.stopPropagation()}
        className="cursor-help rounded-[2px] outline-none underline decoration-dotted decoration-[var(--md-sys-color-outline)] underline-offset-4 hover:decoration-[var(--md-sys-color-on-surface)] focus-visible:decoration-[var(--md-sys-color-on-surface)]"
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" sideOffset={6} className="isolate z-50">
          <Popover.Popup
            data-testid="compare-popup"
            className={cn(
              'z-50 min-w-[240px] origin-(--transform-origin) rounded-[var(--md-sys-shape-extra-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] p-2 shadow-md',
              'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            )}
          >
            <div className="px-2 pb-1.5 flex items-center justify-between gap-3">
              <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
                {label}
              </span>
              {baselineText ? (
                <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  현재 <span className="md-numeric">{baselineText}</span>
                </span>
              ) : null}
            </div>
            <ul className="space-y-0.5">
              {rows.map((row) => {
                const isActive = row.bid.id === activeBidId;
                const name = pgWsById[row.bid.pgWsId]?.name ?? row.bid.pgWsId;
                const inner = (
                  <>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate text-[13px] text-[var(--md-sys-color-on-surface)]">
                        {name}
                      </span>
                      {row.isBest && (
                        <span className="shrink-0 text-xs text-[var(--md-sys-color-tertiary)]">
                          최선
                        </span>
                      )}
                      {isActive && (
                        <span className="shrink-0 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                          이 견적
                        </span>
                      )}
                    </span>
                    <span className="md-numeric shrink-0 text-[13px] text-[var(--md-sys-color-on-surface)]">
                      {row.valueText}
                    </span>
                  </>
                );
                const rowClass =
                  'w-full flex items-center justify-between gap-3 rounded-[4px] px-2 py-1.5 text-left';
                return (
                  <li key={row.bid.id}>
                    {isActive ? (
                      <div
                        data-testid={`compare-row-${row.bid.pgWsId}`}
                        className={cn(rowClass, 'bg-[var(--md-sys-color-surface-container-high)]')}
                      >
                        {inner}
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`compare-row-${row.bid.pgWsId}`}
                        onClick={() => onSelect(row.bid.pgWsId)}
                        className={cn(
                          rowClass,
                          'outline-none transition-colors hover:bg-[var(--md-sys-color-surface-container-high)] focus-visible:bg-[var(--md-sys-color-surface-container-high)]',
                        )}
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
