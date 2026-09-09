import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// ThreadView/ThreadPane 가 app router/pathname/search 를 읽으므로 스텁한다.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages',
  useSearchParams: () => new URLSearchParams(),
}));

// loadConversationThread is a 'use server' action — mock it so selecting a
// conversation in MessageInbox loads its thread without a DB.
const loadConversationThread = vi.fn();
vi.mock('@/lib/server/actions/chat/conversationLoaders', () => ({
  loadConversationThread: (...args: unknown[]) => loadConversationThread(...args),
}));

// MessageInbox mounts the 새 대화 entry (NewConversationSheet), which imports
// the send action — mock it so the inbox renders without a DB.
vi.mock('@/lib/server/actions/chat/sendChatMessageAction', () => ({
  sendChatMessageAction: vi.fn(),
}));

// Opening a thread mounts ThreadView, which fires mark-read (a server action,
// jsdom-unsafe) and subscribes via useChatChannel (real centrifuge SDK) — mock
// both so the inbox renders without a DB or live transport.
vi.mock('@/lib/server/actions/chat/markConversationReadAction', () => ({
  markConversationReadAction: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/lib/hooks/useChatChannel', () => ({
  useChatChannel: () => ({ typingUserIds: [], sendTyping: vi.fn(), connected: null }),
}));

// ThreadView mounts AttachmentGalleryPanel, which imports listConversationAttachments
// (a 'use server' action that transitively pulls in next-auth) — mock it so the
// suite collects without resolving next-auth's `next/server` import under vitest.
vi.mock('@/lib/server/actions/chat/listConversationAttachments', () => ({
  listConversationAttachments: vi.fn().mockResolvedValue([]),
}));

// ThreadView message-author avatars now render as UserProfileCard triggers, which
// import getUserProfileAction + MessageComposeSheet's template actions (all
// 'use server' → next-auth) at module load — mock them so the suite collects.
vi.mock('@/lib/server/actions/user/getUserProfileAction', () => ({
  getUserProfileAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/chat/listTemplatesAction', () => ({
  listTemplatesAction: vi.fn().mockResolvedValue({ ok: true, templates: [] }),
}));
vi.mock('@/lib/server/actions/chat/saveTemplateAction', () => ({
  saveTemplateAction: vi.fn(),
}));

// ContextPanel mock — prevents server-action transitive imports.
vi.mock('../ContextPanel', () => ({
  ContextPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="context-panel" data-conversation={conversationId} />
  ),
}));

// useIsXlUp mock — default to false (non-xl); toggle in xl tests.
const mockXlUp = { value: false };
vi.mock('@/lib/hooks/useIsXlUp', () => ({
  useIsXlUp: () => mockXlUp.value,
}));

// TeamThreadPane imports team-thread-cache → teamThreadLoader (a 'use server'
// action that transitively pulls in next-auth) — mock the cache + TeamThreadView
// so the inbox (which now routes team rows to TeamThreadPane) collects without a
// DB or next-auth. The inbox tests exercise counterparty rows + the filter UI;
// real team-thread loading is covered by ChatPanel/TeamThreadView suites.
vi.mock('../team-thread-cache', () => ({
  getTeamThreadPromise: () =>
    Promise.resolve({ ok: true, rfpId: 'rfp-1', workspaceId: 'ws-self', viewerUserId: 'u-me', messages: [] }),
  invalidateTeamThread: vi.fn(),
}));
vi.mock('../TeamThreadView', () => ({
  TeamThreadView: () => <div data-testid="team-thread-view" />,
}));

afterEach(() => {
  cleanup();
  mockXlUp.value = false;
});
beforeEach(() => {
  loadConversationThread.mockReset();
  clearAllThreadCache();
});

import { MessageInbox } from '../MessageInbox';
import { clearAllThreadCache } from '../thread-cache';
import type { InboxListItem } from '../types';

const items: InboxListItem[] = [
  {
    kind: 'counterparty',
    key: 'c:conv-1',
    conversationId: 'conv-1',
    counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg', logoUpdatedAt: null },
    rfpId: null,
    rfpCode: null,
    rfpTitle: null,
    rfpStatus: null,
    rfpDeadline: null,
    preview: '제안 보냅니다.',
    lastMessageAt: '2026-06-02T01:00:00.000Z',
    unread: true,
    closedAfterAward: false,
  },
];

describe('MessageInbox', () => {
  it('selecting a conversation loads its thread via the server action', async () => {
    const user = userEvent.setup();
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [
        {
          id: 'm1',
          authorUserId: 'u-pg',
          authorName: 'OO페이담당',
          authorEmail: 'sales@pg.com',
          sender: 'other',
          body: '스레드 본문 메시지입니다.',
          rfpId: null,
          createdAt: '2026-06-02T01:00:00.000Z',
          readByCounterparty: false,
          attachments: [],
        },
      ],
    });

    render(<MessageInbox items={items} />);

    // Empty panel before selection.
    expect(screen.getByText('대화를 선택하세요')).toBeInTheDocument();

    // Wrap the click + Suspense resolution in a single awaited act so React
    // can flush the async Suspense retry (use() pings back through act's queue).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /OO페이/ }));
    });

    expect(loadConversationThread).toHaveBeenCalledWith('conv-1');
    expect(screen.getByText('스레드 본문 메시지입니다.')).toBeInTheDocument();
  });

  it('does not call the loader on first render (only on select)', async () => {
    render(<MessageInbox items={items} />);
    await waitFor(() => {
      expect(loadConversationThread).not.toHaveBeenCalled();
    });
  });

  it('인박스 상단에 새 대화 시작 진입점을 노출한다', () => {
    render(<MessageInbox items={items} />);
    expect(screen.getByRole('button', { name: '새 대화' })).toBeInTheDocument();
  });

  it('renders 전체/상대방/팀 filter and filters the list', async () => {
    const user = userEvent.setup();
    const mixed: InboxListItem[] = [
      {
        kind: 'counterparty',
        key: 'c:c1',
        conversationId: 'c1',
        counterparty: { workspaceId: 'w', name: '토스', type: 'pg', logoUpdatedAt: null },
        rfpId: null,
        rfpCode: null,
        rfpTitle: null,
        rfpStatus: null,
        rfpDeadline: null,
        preview: '안녕',
        lastMessageAt: '2026-06-14T03:00:00Z',
        unread: false,
        closedAfterAward: false,
      },
      {
        kind: 'team',
        key: 't:r1',
        rfpId: 'r1',
        rfpCode: 'P-2605-0042',
        rfpTitle: '제목',
        preview: '내부 메모',
        lastMessageAt: '2026-06-14T01:00:00Z',
        unread: true,
      },
    ];
    render(<MessageInbox items={mixed} initialSelectedKey={null} />);
    expect(screen.getByText('토스')).toBeInTheDocument();
    expect(screen.getByText(/내부 메모/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /팀/ }));
    expect(screen.queryByText('토스')).not.toBeInTheDocument();
    expect(screen.getByText(/내부 메모/)).toBeInTheDocument();
  });

  it('미선택 상태: 목록은 표시하고 스레드 pane 은 모바일에서 숨긴다(데스크톱만 표시)', () => {
    const { container } = render(<MessageInbox items={items} />);
    const list = container.querySelector('[data-pane="list"]') as HTMLElement;
    const thread = container.querySelector('[data-pane="thread"]') as HTMLElement;
    // 목록: 모바일 전체폭, 데스크톱 고정폭. 미선택 시 항상 보인다.
    expect(list.className).toContain('w-full');
    expect(list.className).toContain('md:w-80');
    expect(list.className).not.toContain('hidden');
    // 스레드: 미선택 시 모바일에서 숨고 데스크톱(md)에서만 보인다.
    expect(thread.className).toContain('hidden');
    expect(thread.className).toContain('md:flex');
  });

  it('대화 선택 시: 목록 pane 은 모바일에서 숨고 스레드 pane 이 표시된다', async () => {
    const user = userEvent.setup();
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [],
    });
    const { container } = render(<MessageInbox items={items} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /OO페이/ }));
    });
    const list = container.querySelector('[data-pane="list"]') as HTMLElement;
    const thread = container.querySelector('[data-pane="thread"]') as HTMLElement;
    expect(list.className).toContain('hidden');
    expect(list.className).toContain('md:flex');
    expect(thread.className).not.toContain('hidden');
  });

  it('모바일 뒤로가기 버튼을 누르면 대화 목록으로 돌아간다', async () => {
    const user = userEvent.setup();
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [],
    });
    render(<MessageInbox items={items} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /OO페이/ }));
    });
    expect(screen.queryByText('대화를 선택하세요')).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '대화 목록' }));
    });
    expect(screen.getByText('대화를 선택하세요')).toBeInTheDocument();
  });

  it('대화 선택 중 로딩 스켈레톤을 표시한다', async () => {
    const user = userEvent.setup();
    // Return a promise that never resolves during this test
    let resolveThread!: (v: unknown) => void;
    loadConversationThread.mockReturnValue(
      new Promise((resolve) => { resolveThread = resolve; })
    );

    render(<MessageInbox items={items} />);
    await user.click(screen.getByRole('button', { name: /OO페이/ }));

    // While loading, skeleton is visible (animate-pulse element)
    await waitFor(() => {
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    // Cleanup: resolve so no pending promises leak
    resolveThread({ ok: false, error: 'CANCELLED' });
  });

  it('initialSelectedKey로 마운트 시 해당 대화의 스레드를 즉시 보여준다', async () => {
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [
        {
          id: 'm1',
          authorUserId: 'u-pg',
          authorName: 'OO페이담당',
          authorEmail: 'sales@pg.com',
          sender: 'other',
          body: '미리 열린 스레드 메시지입니다.',
          rfpId: null,
          createdAt: '2026-06-06T01:00:00.000Z',
          readByCounterparty: false,
          attachments: [],
        },
      ],
    });

    await act(async () => {
      render(<MessageInbox items={items} initialSelectedKey="c:conv-1" />);
    });

    expect(loadConversationThread).toHaveBeenCalledWith('conv-1');
    expect(screen.getByText('미리 열린 스레드 메시지입니다.')).toBeInTheDocument();
  });

  it('목록에 없는 initialSelectedKey는 무시하고 미선택 상태로 마운트된다', () => {
    render(<MessageInbox items={items} initialSelectedKey="c:conv-does-not-exist" />);
    expect(screen.getByText('대화를 선택하세요')).toBeInTheDocument();
    expect(loadConversationThread).not.toHaveBeenCalled();
  });

  it('검색어 입력 시 이름 기준으로 대화 목록을 필터링한다', async () => {
    const user = userEvent.setup();
    const mixed: InboxListItem[] = [
      {
        kind: 'counterparty', key: 'c:c1',
        conversationId: 'c1',
        counterparty: { workspaceId: 'w1', name: '토스페이', type: 'pg', logoUpdatedAt: null },
        rfpId: null, rfpCode: null, rfpTitle: null, rfpStatus: null, rfpDeadline: null,
        preview: '안녕하세요', lastMessageAt: null, unread: false, closedAfterAward: false,
      },
      {
        kind: 'team', key: 't:r1', rfpId: 'r1',
        rfpCode: 'P-2605-0001', rfpTitle: '결제 서비스',
        preview: '내부 메모', lastMessageAt: null, unread: false,
      },
    ];
    render(<MessageInbox items={mixed} />);
    await user.type(screen.getByPlaceholderText('대화 검색'), '토스');
    expect(screen.getByRole('button', { name: /토스페이/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /결제 서비스/ })).not.toBeInTheDocument();
  });

  it('closedAfterAward=true 대화를 선택하면 선정 종료 안내를 띄운다', async () => {
    const user = userEvent.setup();
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-closed',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [],
    });
    const closedItems: InboxListItem[] = [
      {
        kind: 'counterparty',
        key: 'c:conv-closed',
        conversationId: 'conv-closed',
        counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg', logoUpdatedAt: null },
        rfpId: 'rfp-1',
        rfpCode: 'P-2605-0042',
        rfpTitle: '제목',
        rfpStatus: 'awarded',
        rfpDeadline: null,
        preview: '제안',
        lastMessageAt: '2026-06-02T01:00:00.000Z',
        unread: false,
        closedAfterAward: true,
      },
    ];
    render(<MessageInbox items={closedItems} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /OO페이/ }));
    });
    expect(screen.getByText('견적 선정이 끝나 이 대화는 종료됐어요.')).toBeInTheDocument();
  });

  it('closedAfterAward=false 대화는 선정 종료 안내가 없다', async () => {
    const user = userEvent.setup();
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [],
    });
    render(<MessageInbox items={items} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /OO페이/ }));
    });
    expect(screen.queryByText('견적 선정이 끝나 이 대화는 종료됐어요.')).not.toBeInTheDocument();
  });

  it('팀 스레드 선택 시 모바일 뒤로가기 버튼이 표시되고 클릭하면 목록으로 돌아간다', async () => {
    const user = userEvent.setup();
    const teamItems: InboxListItem[] = [
      {
        kind: 'team',
        key: 't:r1',
        rfpId: 'r1',
        rfpCode: 'P-1',
        rfpTitle: '제목',
        preview: '메모',
        lastMessageAt: '2026-06-14T01:00:00Z',
        unread: false,
      },
    ];
    render(<MessageInbox items={teamItems} initialSelectedKey="t:r1" />);

    // TeamThreadPane resolves async via getTeamThreadPromise mock — wait for back button
    const back = await screen.findByRole('button', { name: '대화 목록' });
    expect(back).toBeInTheDocument();

    await act(async () => {
      await user.click(back);
    });

    // After back, selection cleared → empty state shown
    expect(screen.getByText('대화를 선택하세요')).toBeInTheDocument();
  });
});

describe('xl 컨텍스트 패널', () => {
  beforeEach(() => { mockXlUp.value = true; });

  it('xl에서 대화 미선택 시 ContextPanel을 렌더하지 않는다', () => {
    render(<MessageInbox items={items} />);
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();
  });

  it('xl에서 counterparty 대화 선택 시 ContextPanel이 렌더된다', async () => {
    const user = userEvent.setup();
    loadConversationThread.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' },
      viewer: { userId: 'u-self', name: '나' },
      messages: [],
    });
    render(<MessageInbox items={items} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /OO페이/ }));
    });
    expect(screen.getByText('대화 정보')).toBeInTheDocument();
    expect(screen.getByTestId('context-panel')).toBeInTheDocument();
    expect(screen.getByTestId('context-panel')).toHaveAttribute('data-conversation', 'conv-1');
  });
});
