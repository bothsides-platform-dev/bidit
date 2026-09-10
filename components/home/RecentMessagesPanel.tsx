import Link from 'next/link';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/primitives/EmptyState';
import { EnvelopeIcon } from '@/components/icons';
import { AvatarWithPresence } from '@/components/presence/AvatarWithPresence';
import { UNREAD_COUNT_SUFFIX, UNREAD_LABEL } from '@/lib/types/notification';
import { conversationThreadLink, teamThreadLink } from '@/lib/chat/thread-link';
import type { InboxListItem } from '@/lib/server/actions/chat/inboxLoader';

/** Max items previewed in the home widget; the rest are in /messages. */
const HOME_RECENT_MESSAGES = 4;

// Formats as "오전 10:00" in Asia/Seoul regardless of runner TZ — matches
// ConversationList's formatting rule to stay consistent.
function formatLastMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Home screen right-sidebar widget. Shows the most recent inbox items
 * (counterparty conversations + team threads) as a server snapshot (no realtime
 * subscription). Each row deep-links to /messages?c=<id> or /messages?t=<rfpId>
 * so the /messages page can pre-select the conversation or team thread.
 */
export function RecentMessagesPanel({
  items,
  unreadCount,
}: {
  items: InboxListItem[];
  unreadCount: number;
}) {
  const recent = items.slice(0, HOME_RECENT_MESSAGES);

  return (
    <aside
      aria-label="메시지"
      className="flex h-full min-h-[320px] flex-col rounded-[var(--md-sys-shape-medium)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--md-sys-color-outline-variant)] px-4 py-3 text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
        메시지
        {unreadCount > 0 && (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center whitespace-nowrap rounded-[var(--md-sys-shape-full)] bg-[var(--md-sys-color-primary)] px-1.5 text-xs font-medium text-[var(--md-sys-color-on-primary)]"
          >
            {/* 숫자만 모노 — 라벨까지 .md-numeric 이면 한국어가 JetBrains Mono 로 찍힌다. */}
            {UNREAD_LABEL}{' '}
            <span className="md-numeric">{unreadCount}</span>
            {UNREAD_COUNT_SUFFIX}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {recent.length === 0 ? (
          <EmptyState
            icon={<EnvelopeIcon />}
            title="아직 주고받은 메시지가 없어요"
            description="구매사·PG와 나눈 대화가 여기에 표시돼요."
          />
        ) : (
          <ul className="flex flex-col">
            {recent.map((item) => (
              <li key={item.key}>
                <Link
                  href={
                    item.kind === 'team'
                      ? teamThreadLink(item.rfpId)
                      : conversationThreadLink(item.conversationId)
                  }
                  className="flex w-full items-start gap-2.5 border-b border-[var(--md-sys-color-outline-variant)] px-3 py-3 transition-colors hover:bg-[var(--md-sys-color-surface-container)]"
                >
                  {item.kind === 'team' ? (
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-[var(--md-sys-shape-full)] bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]"
                    >
                      <Users size={18} strokeWidth={1.5} />
                    </span>
                  ) : (
                    <AvatarWithPresence
                      name={item.counterparty.name}
                      workspaceId={item.counterparty.workspaceId}
                      logoUpdatedAt={item.counterparty.logoUpdatedAt}
                      size="md"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      {item.kind === 'team' ? (
                        <span className="truncate text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
                          팀 · <span className="md-numeric">{item.rfpCode}</span> {item.rfpTitle}
                        </span>
                      ) : (
                        <span className="truncate text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
                          {item.counterparty.name}
                        </span>
                      )}
                      {item.lastMessageAt && (
                        <time
                          dateTime={item.lastMessageAt}
                          suppressHydrationWarning
                          className="md-numeric shrink-0 text-xs text-[var(--md-sys-color-on-surface-variant)]"
                        >
                          {formatLastMessageTime(item.lastMessageAt)}
                        </time>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
                        {item.preview}
                      </p>
                      {item.unread && (
                        <span
                          aria-label={UNREAD_LABEL}
                          className="size-2 shrink-0 rounded-full bg-[var(--md-sys-color-primary)]"
                        />
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--md-sys-color-outline-variant)] p-3">
        <Link
          href="/messages"
          className="block w-full rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] py-2 text-center text-[13px] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-surface-container)]"
        >
          메시지 전체 보기
        </Link>
      </div>
    </aside>
  );
}
