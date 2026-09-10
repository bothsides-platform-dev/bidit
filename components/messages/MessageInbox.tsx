'use client';

import { Suspense, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tabs } from '@/components/primitives/Tabs';
import { EmptyState } from '@/components/primitives/EmptyState';
import { EnvelopeIcon } from '@/components/icons';
import { ConversationList } from './ConversationList';
import { ContextPanel } from './ContextPanel';
import { NewConversationSheet } from './NewConversationSheet';
import { ThreadPane } from './ThreadPane';
import { TeamThreadPane } from './TeamThreadPane';
import { ThreadSkeleton } from './ThreadSkeleton';
import { useIsXlUp } from '@/lib/hooks/useIsXlUp';
import type { InboxListItem } from './types';

type Filter = 'all' | 'counterparty' | 'team';

type Props = {
  items: InboxListItem[];
  /** Pre-select an item on mount (e.g. from ?c=/?t= deep-link). Ignored if key not in list. */
  initialSelectedKey?: string | null;
  className?: string;
};

const FILTER_TABS = [
  { id: 'all', label: '전체' },
  { id: 'counterparty', label: '상대방' },
  { id: 'team', label: '팀' },
];

export function MessageInbox({ items, initialSelectedKey = null, className }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelectedKey);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const isXl = useIsXlUp();

  const visible = items.filter((i) => {
    if (filter !== 'all' && i.kind !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    if (i.kind === 'team') {
      return (
        i.rfpCode.toLowerCase().includes(q) ||
        i.rfpTitle.toLowerCase().includes(q) ||
        i.preview.toLowerCase().includes(q)
      );
    }
    return (
      i.counterparty.name.toLowerCase().includes(q) ||
      (i.rfpCode?.toLowerCase() ?? '').includes(q) ||
      i.preview.toLowerCase().includes(q)
    );
  });

  const selected = selectedKey != null ? items.find((i) => i.key === selectedKey) ?? null : null;

  const rfpContext =
    selected?.kind === 'counterparty' && selected.rfpCode
      ? {
          code: selected.rfpCode,
          title: selected.rfpTitle ?? '',
          status: selected.rfpStatus ?? undefined,
          deadline: selected.rfpDeadline,
        }
      : selected?.kind === 'team'
        ? { code: selected.rfpCode, title: selected.rfpTitle }
        : undefined;

  return (
    <div className={cn('flex min-h-0 flex-1', className)}>
      {/* 목록 패널 */}
      <div
        data-pane="list"
        className={cn(
          'w-full shrink-0 flex-col border-r border-[var(--md-sys-color-outline-variant)] md:w-80 md:flex',
          selected ? 'hidden' : 'flex',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--md-sys-color-outline-variant)] px-3 py-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="대화 검색"
            aria-label="대화 검색"
            className="flex-1 rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] px-2.5 py-1 text-[12px] text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)] focus-visible:border-[var(--md-sys-color-primary)]"
          />
          <NewConversationSheet />
        </div>
        <Tabs
          tabs={FILTER_TABS}
          active={filter}
          onChange={(id) => setFilter(id as Filter)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList
            items={visible}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </div>
      </div>

      {/* 스레드 패널 */}
      <div
        data-pane="thread"
        className={cn('flex min-h-0 min-w-0 flex-1 flex-col md:flex', selected ? 'flex' : 'hidden')}
      >
        {selected?.kind === 'team' ? (
          // TeamThreadPane 은 useEffect 로더 패턴으로 로딩을 자체 관리 — Suspense 불필요.
          <TeamThreadPane rfpId={selected.rfpId} onBack={() => setSelectedKey(null)} />
        ) : selected?.kind === 'counterparty' ? (
          // key={selected.key} resets the Suspense boundary when conversation changes,
          // showing the skeleton again for the newly selected conversation.
          <Suspense key={selected.key} fallback={<ThreadSkeleton />}>
            <ThreadPane
              conversationId={selected.conversationId}
              counterpartyFallback={selected.counterparty}
              onBack={() => setSelectedKey(null)}
              variant={isXl ? 'page' : 'tabs'}
              rfpContext={rfpContext}
              // 선정 종료된 미선정 대화는 입력 비활성(딜룸과 동일, /messages 갭 차단).
              sendDisabledReason={selected.closedAfterAward ? 'closed' : null}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<EnvelopeIcon />}
              title="대화를 선택하세요"
              description="좌측 목록에서 대화를 열어 메시지를 확인하세요."
            />
          </div>
        )}
      </div>

      {/* xl 컨텍스트 패널 — 1280px 이상에서만 표시 */}
      {isXl && selected && (
        <div
          data-pane="context"
          className="hidden w-64 shrink-0 flex-col border-l border-[var(--md-sys-color-outline-variant)] xl:flex"
        >
          <div className="flex h-[44px] shrink-0 items-center border-b border-[var(--md-sys-color-outline-variant)] px-3 text-xs font-medium uppercase tracking-wide text-[var(--md-sys-color-on-surface-variant)]">
            대화 정보
          </div>
          <ContextPanel
            conversationId={selected.kind === 'counterparty' ? selected.conversationId : selected.rfpId}
            rfpContext={rfpContext}
          />
        </div>
      )}
    </div>
  );
}
