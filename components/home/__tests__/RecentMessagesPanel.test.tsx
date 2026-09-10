import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { render, screen, cleanup } from '@testing-library/react';
import type { ConversationListItem } from '@/components/messages/types';
import type { InboxListItem } from '@/lib/server/actions/chat/inboxLoader';
import type { PresenceState } from '@/components/presence/WorkspacePresenceProvider';
import { unreadCountLabel } from '@/lib/types/notification';

// next/link renders as <a> in jsdom
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...(rest as object)}>
      {children}
    </a>
  ),
}));

// WorkspaceAvatar makes no assertions here; stub to keep render fast and pure.
vi.mock('@/components/primitives/WorkspaceAvatar', () => ({
  WorkspaceAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
}));

// useWorkspacePresence drives the online dot.
let workspacePresenceResult: PresenceState = { online: false, activity: 'offline' };
vi.mock('@/components/presence/WorkspacePresenceProvider', () => ({
  useWorkspacePresence: () => workspacePresenceResult,
}));

afterEach(() => {
  cleanup();
  workspacePresenceResult = { online: false, activity: 'offline' };
});

import { RecentMessagesPanel } from '../RecentMessagesPanel';

function makeConv(overrides?: Partial<ConversationListItem>): InboxListItem {
  const c: ConversationListItem = {
    conversationId: 'conv-abc',
    counterparty: { workspaceId: 'ws-pg', name: 'NICE페이', type: 'pg', logoUpdatedAt: null },
    rfpId: null,
    rfpCode: null,
    rfpTitle: null,
    rfpStatus: null,
    rfpDeadline: null,
    preview: '검토 부탁드립니다.',
    lastMessageAt: '2026-06-06T01:00:00.000Z',
    unread: false,
    closedAfterAward: false,
    ...overrides,
  };
  return { kind: 'counterparty', key: `c:${c.conversationId}`, ...c };
}

/** 배지 — 숫자를 별도 span 으로 떼어도 찾을 수 있게 전체 텍스트로 매칭한다
 *  (getByText 기본 매처는 자기 직계 텍스트 노드만 본다). */
function unreadBadge(count: number): HTMLElement {
  return screen.getByText(
    (_, el) => el?.tagName === 'SPAN' && el.textContent === unreadCountLabel(count),
  );
}

describe('RecentMessagesPanel', () => {
  it('renders a conversation row with a deep-link to /messages?c=<id>', () => {
    render(<RecentMessagesPanel items={[makeConv({ conversationId: 'conv-xyz' })]} unreadCount={0} />);
    const link = screen.getByRole('link', { name: /NICE페이/ });
    expect(link).toHaveAttribute('href', '/messages?c=conv-xyz');
  });

  it('renders a team thread row deep-linking to /messages?t=<rfpId>', () => {
    render(
      <RecentMessagesPanel
        items={[
          {
            kind: 'team',
            key: 't:r1',
            rfpId: 'r1',
            rfpCode: 'P-1',
            rfpTitle: '제목',
            preview: '메모',
            lastMessageAt: '2026-06-14T01:00:00Z',
            unread: true,
          },
        ]}
        unreadCount={1}
      />,
    );
    const link = screen.getByRole('link', { name: /제목|메모|팀|P-1/ });
    expect(link).toHaveAttribute('href', '/messages?t=r1');
  });

  it('shows at most 4 rows (HOME_RECENT_MESSAGES cap)', () => {
    const convs = Array.from({ length: 5 }, (_, i) =>
      makeConv({
        conversationId: `conv-${i}`,
        counterparty: { workspaceId: `ws-${i}`, name: `회사 ${i}`, type: 'pg', logoUpdatedAt: null },
      }),
    );
    render(<RecentMessagesPanel items={convs} unreadCount={0} />);
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/messages?c='));
    expect(links).toHaveLength(4);
  });

  it('shows an unread badge when unreadCount > 0', () => {
    render(<RecentMessagesPanel items={[makeConv()]} unreadCount={3} />);
    expect(unreadBadge(3)).toBeInTheDocument();
  });

  it('does not show an unread badge when unreadCount is 0', () => {
    render(<RecentMessagesPanel items={[makeConv()]} unreadCount={0} />);
    expect(screen.queryByText(unreadCountLabel(0))).not.toBeInTheDocument();
  });

  it('keeps the label in the UI font and puts only the count in .md-numeric', () => {
    // .md-numeric 은 수치 전용이다(DESIGN.md §3) — 한국어 라벨까지 모노로 찍으면 안 된다.
    render(<RecentMessagesPanel items={[makeConv()]} unreadCount={3} />);
    const badge = unreadBadge(3);
    expect(badge).not.toHaveClass('md-numeric');
    const numeric = badge.querySelectorAll('.md-numeric');
    expect(numeric).toHaveLength(1);
    expect(numeric[0].textContent).toBe('3');
  });

  it('renders the empty state when items is empty', () => {
    render(<RecentMessagesPanel items={[]} unreadCount={0} />);
    expect(screen.getByText('아직 주고받은 메시지가 없어요')).toBeInTheDocument();
  });

  it('renders a "메시지 전체 보기" link to /messages', () => {
    render(<RecentMessagesPanel items={[]} unreadCount={0} />);
    expect(screen.getByRole('link', { name: '메시지 전체 보기' })).toHaveAttribute(
      'href',
      '/messages',
    );
  });

  it('shows an unread dot on a row when item.unread is true', () => {
    render(
      <RecentMessagesPanel
        items={[makeConv({ unread: true })]}
        unreadCount={1}
      />,
    );
    expect(screen.getByLabelText('안 읽음')).toBeInTheDocument();
  });

  it('counterparty 항목에서 상대방이 온라인이면 프레즌스 점을 렌더한다', () => {
    workspacePresenceResult = { online: true, activity: 'active' };
    render(<RecentMessagesPanel items={[makeConv()]} unreadCount={0} />);
    expect(screen.getByLabelText('온라인')).toBeInTheDocument();
  });

  it('counterparty 항목에서 상대방이 오프라인이면 프레즌스 점을 렌더하지 않는다', () => {
    workspacePresenceResult = { online: false, activity: 'offline' };
    render(<RecentMessagesPanel items={[makeConv()]} unreadCount={0} />);
    expect(screen.queryByLabelText('온라인')).not.toBeInTheDocument();
  });

  // BuyerHome/PgHome server-render this panel from a fresh DB read each
  // request; the last-message timestamp is live data that can tick forward
  // between the SSR pass and the client hydrate pass (slow connection, dev
  // Fast Refresh, etc). That drift must not blow away the whole tree.
  it('does not raise a hydration error when lastMessageAt ticks forward between server render and client hydrate', () => {
    const serverItem = [makeConv({ lastMessageAt: '2026-07-02T07:12:18.159Z' })];
    const clientItem = [makeConv({ lastMessageAt: '2026-07-02T07:22:43.441Z' })];
    const html = renderToString(<RecentMessagesPanel items={serverItem} unreadCount={0} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const recoverableErrors: unknown[] = [];
    act(() => {
      hydrateRoot(container, <RecentMessagesPanel items={clientItem} unreadCount={0} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(recoverableErrors).toEqual([]);
    container.remove();
  });
});
