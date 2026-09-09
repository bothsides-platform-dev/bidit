'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string };

const DEADLINE_OPTIONS: Option[] = [
  { value: 'd7', label: '마감임박' },
  { value: 'month', label: '이번달' },
  { value: 'overdue', label: '지난마감' },
];

export function BoardFilterBar({
  statusOptions,
  gradeOptions,
}: {
  statusOptions: Option[];
  gradeOptions: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = (key: string) => searchParams.get(key) ?? '';

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex items-center gap-3 flex-wrap" role="group" aria-label="필터">
      <ChipGroup
        param="status"
        label="상태"
        options={statusOptions}
        current={current('status')}
        onSelect={setParam}
      />
      <ChipGroup
        param="deadline"
        label="마감일"
        options={DEADLINE_OPTIONS}
        current={current('deadline')}
        onSelect={setParam}
      />
      <select
        aria-label="가맹점 등급"
        value={current('grade')}
        onChange={(e) => setParam('grade', e.target.value)}
        className="h-7 rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-2 text-[13px] text-[var(--md-sys-color-on-surface)]"
      >
        <option value="">등급 전체</option>
        {gradeOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChipGroup({
  param,
  label,
  options,
  current,
  onSelect,
}: {
  param: string;
  label: string;
  options: Option[];
  current: string;
  onSelect: (key: string, value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(param, active ? '' : o.value)}
            className={cn(
              'h-7 cursor-pointer px-2.5 rounded-[var(--md-sys-shape-small)] border text-[13px] transition-colors duration-[var(--md-sys-motion-duration-short-4)]',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--md-sys-color-primary)]/50',
              active
                ? 'border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-primary)]'
                : 'border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
