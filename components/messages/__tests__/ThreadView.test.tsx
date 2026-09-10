import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseChatChannelResult } from '@/lib/hooks/useChatChannel';
import type { ChatReadEvent } from '@/lib/chat/read-state/event';
import { NEW_TAB_NOTICE } from '@/lib/a11y/link-notice';
import { isThreadOpen } from '@/lib/chat/open-threads';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// 하단 센티널 가시성 관찰자 — 읽음의 두 번째 게이트를 테스트가 직접 몬다.
// jsdom 에는 IntersectionObserver 가 없다.
type IoCb = (entries: { isIntersecting: boolean }[]) => void;
const intersectionObservers: { fire: (v: boolean) => void }[] = [];
class IntersectionObserverStub {
  constructor(cb: IoCb) {
    intersectionObservers.push({ fire: (v) => cb([{ isIntersecting: v }]) });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);

/** 하단 센티널이 화면 밖으로 나갔다(= 사용자가 위로 스크롤했다). */
function scrollAwayFromBottom(): void {
  for (const o of intersectionObservers) o.fire(false);
}
/** 하단 센티널이 다시 보인다(= 사용자가 아래로 돌아왔다). */
function scrollBackToBottom(): void {
  for (const o of intersectionObservers) o.fire(true);
}

// sendChatMessageAction is a 'use server' action — it imports centrifugo/db
// (server-only) and would break jsdom. Mock it so the composer can call it.
const sendChatMessageAction = vi.fn();
vi.mock('@/lib/server/actions/chat/sendChatMessageAction', () => ({
  sendChatMessageAction: (...args: unknown[]) => sendChatMessageAction(...args),
}));

// listConversationAttachments is a 'use server' action used by AttachmentGalleryPanel.
vi.mock('@/lib/server/actions/chat/listConversationAttachments', () => ({
  listConversationAttachments: vi.fn().mockResolvedValue([]),
}));

// markConversationReadAction is likewise a server action (jsdom-unsafe) — mock
// it for EVERY test, and capture calls for the mark-read-on-open assertion.
const markConversationReadAction = vi.fn();
vi.mock('@/lib/server/actions/chat/markConversationReadAction', () => ({
  markConversationReadAction: (...args: unknown[]) => markConversationReadAction(...args),
}));

// 알림 스토어의 로컬 배지 정리 — 서버 액션 체인을 끌고 오므로 mock 한다.
const markThreadReadLocal = vi.fn();
vi.mock('@/lib/hooks/useNotifications', () => ({
  markThreadReadLocal: (...args: unknown[]) => markThreadReadLocal(...args),
}));

// useChatChannel pulls in the real `centrifuge` SDK — mock it so jsdom stays
// clean, and so we can control typing and capture the onMessage/onRead
// callbacks the component registers. (online presence is now driven by
// useWorkspacePresence, NOT useChatChannel.)
type ChatPayload = { type?: string; userId?: string; [k: string]: unknown };
let channelOptions: { onMessage?: (d: ChatPayload) => void; onRead?: (d: ChatReadEvent) => void } = {};
const sendTyping = vi.fn();
let channelResult: UseChatChannelResult = { typingUserIds: [], sendTyping, connected: null };
vi.mock('@/lib/hooks/useChatChannel', () => ({
  useChatChannel: (_conversationId: string, opts: typeof channelOptions): UseChatChannelResult => {
    channelOptions = opts;
    return channelResult;
  },
}));

const readReceiptInputs: Array<{
  conversationId: string;
  counterpartyWorkspaceId: string;
  messages: Array<{ id: string }>;
}> = [];
vi.mock('@/lib/chat/read-state/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat/read-state/client')>();
  return {
    ...actual,
    useConversationReadReceipt: (
      input: (typeof readReceiptInputs)[number],
    ) => {
      readReceiptInputs.push(input);
      return actual.useConversationReadReceipt(input as Parameters<typeof actual.useConversationReadReceipt>[0]);
    },
  };
});

// useWorkspacePresence drives the header presence dot; useUserPresence drives the
// per-author dot in UserProfileCard — mock both from the same module.
import type { PresenceState } from '@/components/presence/WorkspacePresenceProvider';
let workspacePresenceResult: PresenceState = { online: false, activity: 'offline' };
vi.mock('@/components/presence/WorkspacePresenceProvider', () => ({
  useWorkspacePresence: () => workspacePresenceResult,
  useUserPresence: () => false,
}));

// Author avatars render as UserProfileCard triggers — pulls in getUserProfileAction
// + MessageComposeSheet's template actions ('use server', jsdom-unsafe) at import.
vi.mock('@/lib/server/actions/user/getUserProfileAction', () => ({
  getUserProfileAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/chat/listTemplatesAction', () => ({
  listTemplatesAction: vi.fn().mockResolvedValue({ ok: true, templates: [] }),
}));
vi.mock('@/lib/server/actions/chat/saveTemplateAction', () => ({
  saveTemplateAction: vi.fn(),
}));

// uploadAttachment (presigned 3-step client helper). Mock it so the test can
// hold the upload promise open and assert the in-progress (uploading) UI.
const uploadAttachment = vi.fn();
vi.mock('@/lib/attachments/upload-client', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachment(...args),
}));

// toast — capture failure feedback calls.
const toast = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

vi.mock('../ContextPanel', () => ({
  ContextPanel: ({ rfpContext }: { rfpContext?: { title?: string } }) => (
    <div data-testid="context-panel">{rfpContext?.title ?? ''}</div>
  ),
}));

afterEach(() => cleanup());
beforeEach(() => {
  sendChatMessageAction.mockReset();
  sendChatMessageAction.mockResolvedValue({ ok: true, conversationId: 'conv-1', messageId: 'm-new' });
  markConversationReadAction.mockReset();
  markConversationReadAction.mockResolvedValue({ ok: true });
  sendTyping.mockReset();
  uploadAttachment.mockReset();
  toast.mockReset();
  // 초안 보존이 localStorage 를 쓰므로 테스트 간 격리를 위해 매번 비운다.
  window.localStorage.clear();
  channelOptions = {};
  intersectionObservers.length = 0;
  readReceiptInputs.length = 0;
  channelResult = { typingUserIds: [], sendTyping, connected: null };
  workspacePresenceResult = { online: false, activity: 'offline' };
});

import { ThreadView } from '../ThreadView';
import { formatTime } from '../format';
import type { ThreadMessage } from '../types';
import { MARK_READ_DEBOUNCE_MS } from '@/lib/hooks/useMarkReadWhileVisible';

/** 도착 후 읽음은 트레일링 디바운스다 — "읽음 처리 안 함"을 단언하기 전에 그 창을 지나 보내야 한다.
 *  기다리지 않고 단언하면 게이트가 없어도 카운트가 아직 그대로라 테스트가 아무것도 지키지 못한다. */
async function flushReadDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, MARK_READ_DEBOUNCE_MS + 50));
  });
}

const counterparty = { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' as const, logoUpdatedAt: null };
const viewer = { userId: 'u-self', name: '나', avatarUpdatedAt: null };

// Timestamps in the T03:00Z–T14:00Z window so UTC and KST agree on the
// calendar day (avoids a TZ-dependent date-divider flake).
const messages: ThreadMessage[] = [
  {
    id: 'm1',
    authorUserId: 'u-pg',
    authorName: 'OO페이담당',
    authorEmail: 'sales@pg.com',
    authorAvatarUpdatedAt: null,
    sender: 'other',
    body: '안녕하세요, 제안 드립니다.',
    rfpId: null,
    createdAt: '2026-05-26T05:00:00.000Z',
    readByCounterparty: false,
    attachments: [],
  },
  {
    id: 'm2',
    authorUserId: 'u-self',
    authorName: '나',
    authorEmail: 'me@buyer.com',
    authorAvatarUpdatedAt: null,
    sender: 'self',
    body: '확인했습니다. 감사합니다.',
    rfpId: null,
    createdAt: '2026-05-27T05:00:00.000Z',
    readByCounterparty: false,
    attachments: [],
  },
];

function base(overrides: Partial<React.ComponentProps<typeof ThreadView>> = {}) {
  return (
    <ThreadView
      conversationId="conv-1"
      counterparty={counterparty}
      viewer={viewer}
      messages={messages}
      {...overrides}
    />
  );
}

describe('ThreadView', () => {
  it('받은 메시지는 좌측, 보낸 메시지는 우측으로 정렬한다', () => {
    render(base());

    const received = screen.getByText('안녕하세요, 제안 드립니다.').closest('[data-message-row]');
    const sent = screen.getByText('확인했습니다. 감사합니다.').closest('[data-message-row]');

    expect(received).toHaveAttribute('data-sender', 'other');
    expect(sent).toHaveAttribute('data-sender', 'self');
  });

  it('마운트 시 markConversationReadAction 을 conversationId 로 1회 호출한다(읽음 처리)', async () => {
    render(base());
    await waitFor(() => {
      expect(markConversationReadAction).toHaveBeenCalledWith({ conversationId: 'conv-1' });
    });
    expect(markConversationReadAction).toHaveBeenCalledTimes(1);
  });

  it('열려 있는 동안 상대 메시지가 오면 다시 읽음 처리한다', async () => {
    render(base());
    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(1));

    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-read-1',
        body: '읽음 갱신 트리거',
        authorWsId: 'pg-1', // counterparty
        rfpId: null,
        createdAt: '2026-05-27T06:00:00.000Z',
      });
    });

    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(2));
    expect(markConversationReadAction).toHaveBeenLastCalledWith({ conversationId: 'conv-1' });
  });

  it('위로 스크롤해 최신 메시지가 화면에 없으면 읽음 처리하지 않는다', async () => {
    // 긴 대화를 위로 올려 과거 글을 읽는 중에 도착한 메시지는 눈에 보이지 않는다.
    // 그걸 읽음으로 치면 상대에게 거짓 읽음 영수증이 나간다.
    render(base());
    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(1));

    act(() => scrollAwayFromBottom());
    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-offscreen',
        body: '화면 밖 메시지',
        authorWsId: 'pg-1',
        rfpId: null,
        createdAt: '2026-05-27T06:03:00.000Z',
      });
    });

    // 도착 자체는 렌더된다(위에 pill 이 뜬다) — 읽음만 미룬다.
    expect(await screen.findByText('화면 밖 메시지')).toBeInTheDocument();
    await flushReadDebounce();
    expect(markConversationReadAction).toHaveBeenCalledTimes(1);
  });

  it('아래로 다시 내려와 최신 메시지가 보이면 그때 읽음 처리한다', async () => {
    render(base());
    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(1));

    act(() => scrollAwayFromBottom());
    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-catchup',
        body: '나중에 볼 메시지',
        authorWsId: 'pg-1',
        rfpId: null,
        createdAt: '2026-05-27T06:04:00.000Z',
      });
    });
    await flushReadDebounce();
    expect(markConversationReadAction).toHaveBeenCalledTimes(1);

    act(() => scrollBackToBottom());

    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(2));
    expect(markConversationReadAction).toHaveBeenLastCalledWith({ conversationId: 'conv-1' });
  });

  it('탭이 숨겨져 있으면 도착한 메시지로 읽음 처리하지 않는다(거짓 읽음 영수증 방지)', async () => {
    render(base());
    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(1));

    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      act(() => {
        channelOptions.onMessage?.({
          type: 'message',
          id: 'live-read-2',
          body: '숨은 탭 메시지',
          authorWsId: 'pg-1',
          rfpId: null,
          createdAt: '2026-05-27T06:01:00.000Z',
        });
      });
      // 도착 자체는 렌더된다 — 읽음만 미룬다.
      expect(await screen.findByText('숨은 탭 메시지')).toBeInTheDocument();
      await flushReadDebounce();
      expect(markConversationReadAction).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
    }
  });

  it('내가 보낸 메시지 echo 로는 읽음 처리하지 않는다', async () => {
    render(base());
    await waitFor(() => expect(markConversationReadAction).toHaveBeenCalledTimes(1));

    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-self-1',
        body: '내 메시지 echo',
        authorWsId: 'buyer-1', // 내 워크스페이스 → 'self'
        rfpId: null,
        createdAt: '2026-05-27T06:02:00.000Z',
      });
    });

    expect(await screen.findByText('내 메시지 echo')).toBeInTheDocument();
    await flushReadDebounce();
    expect(markConversationReadAction).toHaveBeenCalledTimes(1);
  });

  it('읽음 처리와 함께 그 대화의 알림 배지를 로컬에서도 내린다', async () => {
    render(base());

    await waitFor(() =>
      expect(markThreadReadLocal).toHaveBeenCalledWith('/messages?c=conv-1'),
    );
  });

  it('열려 있는 동안 그 대화를 열린 스레드로 등록한다(토스트 억제 근거)', () => {
    const { unmount } = render(base());
    expect(isThreadOpen('/messages?c=conv-1')).toBe(true);

    unmount();
    expect(isThreadOpen('/messages?c=conv-1')).toBe(false);
  });

  it('상대 읽음 영수증 projection을 Conversation read-state hook에 위임한다', () => {
    render(<ThreadView conversationId="conv-1" counterparty={counterparty} viewer={viewer} messages={messages} />);

    expect(readReceiptInputs.at(-1)).toMatchObject({
      conversationId: 'conv-1',
      counterpartyWorkspaceId: 'pg-1',
    });
    expect(readReceiptInputs.at(-1)?.messages.map((message) => message.id)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('마지막 보낸 메시지의 readByCounterparty 가 true 면 하단에 "읽음" 영수증을 표시한다', () => {
    const read: ThreadMessage[] = [
      messages[0],
      { ...messages[1], readByCounterparty: true },
    ];
    render(base({ messages: read }));
    expect(screen.getByText('읽음')).toBeInTheDocument();
  });

  it('읽음 영수증은 readByCounterparty 가 모두 false 면 표시하지 않는다', () => {
    render(base());
    expect(screen.queryByText('읽음')).not.toBeInTheDocument();
  });

  it('부분 읽음: 앞선 보낸 메시지만 read 면 그 메시지에 "읽음"을 붙인다(마지막 보낸 메시지는 미읽음)', () => {
    // 상대가 A를 읽은 뒤 내가 B를 더 보낸 케이스 — 로더가 메시지별로 계산한다.
    const partial: ThreadMessage[] = [
      {
        id: 'a',
        authorUserId: 'u-self',
        authorName: '나',
        authorEmail: 'me@buyer.com',
        authorAvatarUpdatedAt: null,
        sender: 'self',
        body: '먼저 보낸 메시지 A',
        rfpId: null,
        createdAt: '2026-05-27T05:00:00.000Z',
        readByCounterparty: true,
        attachments: [],
      },
      {
        id: 'b',
        authorUserId: 'u-self',
        authorName: '나',
        authorEmail: 'me@buyer.com',
        authorAvatarUpdatedAt: null,
        sender: 'self',
        body: '나중에 보낸 메시지 B',
        rfpId: null,
        createdAt: '2026-05-27T06:00:00.000Z',
        readByCounterparty: false,
        attachments: [],
      },
    ];
    render(base({ messages: partial }));
    // "읽음"은 한 번, 그리고 A의 말풍선 행에 붙어야 한다(B에는 없음).
    const receipt = screen.getByText('읽음');
    const row = receipt.closest('[data-message-row]');
    expect(row).toContainElement(screen.getByText('먼저 보낸 메시지 A'));
    expect(row).not.toContainElement(screen.getByText('나중에 보낸 메시지 B'));
  });

  it('상대 PG 워크스페이스의 read 이벤트를 받으면 마지막 보낸 메시지에 "읽음"을 갱신한다', async () => {
    render(base());
    expect(screen.queryByText('읽음')).not.toBeInTheDocument();

    act(() => {
      channelOptions.onRead?.({
        type: 'read',
        userId: 'pg-user-1',
        workspaceId: 'pg-1',
        readAt: '2026-05-28T05:00:00.000Z',
      });
    });

    expect(await screen.findByText('읽음')).toBeInTheDocument();
  });

  it('PG 발신 메시지도 상대 구매사가 대화창에 들어온 뒤에만 읽음으로 표시한다', async () => {
    render(base({
      counterparty: {
        workspaceId: 'buyer-1',
        name: '구매사',
        type: 'buyer',
        logoUpdatedAt: null,
      },
      viewer: { userId: 'pg-user-1', name: 'PG 담당자', avatarUpdatedAt: null },
      messages: [{
        ...messages[1],
        id: 'pg-sent-message',
        authorUserId: 'pg-user-1',
        authorName: 'PG 담당자',
        authorEmail: 'sales@pg.com',
        body: '구매사에 보낸 메시지',
      }],
    }));

    act(() => {
      channelOptions.onRead?.({
        type: 'read',
        userId: 'pg-user-1',
        workspaceId: 'pg-1',
        readAt: '2026-05-28T05:00:00.000Z',
      });
    });
    expect(screen.queryByText('읽음')).not.toBeInTheDocument();

    act(() => {
      channelOptions.onRead?.({
        type: 'read',
        userId: 'buyer-user-1',
        workspaceId: 'buyer-1',
        readAt: '2026-05-28T05:00:00.000Z',
      });
    });
    expect(await screen.findByText('읽음')).toBeInTheDocument();
  });

  it('내 워크스페이스 동료의 read 이벤트는 상대방 읽음으로 표시하지 않는다', () => {
    render(base());

    act(() => {
      channelOptions.onRead?.({
        type: 'read',
        userId: 'buyer-teammate',
        workspaceId: 'buyer-1',
        readAt: '2026-05-28T05:00:00.000Z',
      });
    });

    expect(screen.queryByText('읽음')).not.toBeInTheDocument();
  });

  it('onRead 페이로드의 readAt(ISO) 이 있으면 Date.now() 대신 서버 시간을 워터마크로 사용한다', async () => {
    render(base());
    expect(screen.queryByText('읽음')).not.toBeInTheDocument();

    act(() => {
      // 2026-05-26T04:00:00Z = m2 createdAt(2026-05-27T05:00:00Z) 보다 이전
      channelOptions.onRead?.({ type: 'read', userId: 'pg-user-1', workspaceId: 'pg-1', readAt: '2026-05-26T04:00:00.000Z' });
    });

    // readAt < m2.createdAt이므로 읽음 미표시
    expect(screen.queryByText('읽음')).not.toBeInTheDocument();
  });

  it('onRead readAt 이 m2 이후 시각이면 "읽음" 표시', async () => {
    render(base());

    act(() => {
      channelOptions.onRead?.({ type: 'read', userId: 'pg-user-1', workspaceId: 'pg-1', readAt: '2026-05-28T05:00:00.000Z' });
    });

    expect(await screen.findByText('읽음')).toBeInTheDocument();
  });

  it('늦게 도착한 예전 read 이벤트가 최신 읽음 표시를 뒤로 돌리지 않는다', async () => {
    render(base());

    act(() => {
      channelOptions.onRead?.({
        type: 'read',
        userId: 'pg-user-1',
        workspaceId: 'pg-1',
        readAt: '2026-05-28T05:00:00.000Z',
      });
    });
    expect(await screen.findByText('읽음')).toBeInTheDocument();

    act(() => {
      channelOptions.onRead?.({
        type: 'read',
        userId: 'pg-user-1',
        workspaceId: 'pg-1',
        readAt: '2026-05-26T04:00:00.000Z',
      });
    });
    expect(screen.getByText('읽음')).toBeInTheDocument();
  });

  it('useWorkspacePresence.online 이 true 면 프레즌스 점을 렌더한다', () => {
    workspacePresenceResult = { online: true, activity: 'active' };
    render(base());
    expect(screen.getByLabelText('온라인')).toBeInTheDocument();
  });

  it('useWorkspacePresence.online 이 false 면 프레즌스 점을 렌더하지 않는다', () => {
    workspacePresenceResult = { online: false, activity: 'offline' };
    render(base());
    expect(screen.queryByLabelText('온라인')).not.toBeInTheDocument();
  });

  it('typingUserIds 가 있으면 타이핑 점(TypingDots)을 렌더한다', () => {
    channelResult = { typingUserIds: ['pg-user-1'], sendTyping, connected: null };
    render(base());
    expect(screen.getByLabelText('입력 중')).toBeInTheDocument();
  });

  it('typingUserIds 가 비어 있으면 타이핑 점을 렌더하지 않는다', () => {
    render(base());
    expect(screen.queryByLabelText('입력 중')).not.toBeInTheDocument();
  });

  it('online 이면 헤더에 "온라인" 텍스트 라벨을 표시한다', () => {
    workspacePresenceResult = { online: true, activity: 'active' };
    render(base());
    expect(screen.getByText('온라인')).toBeInTheDocument();
  });

  it('rfpContext 가 있으면(page 변형) 헤더에 RFP 코드·제목을 표시한다', () => {
    render(base({ rfpContext: { code: 'P-2605-0042', title: '온라인 결제 견적' } }));
    expect(screen.getByText('P-2605-0042')).toBeInTheDocument();
    expect(screen.getByText(/온라인 결제 견적/)).toBeInTheDocument();
  });

  it('onMessage 콜백으로 새 메시지를 받으면 목록에 append 한다(상대 메시지)', async () => {
    render(base());
    expect(screen.queryByText('실시간 새 메시지')).not.toBeInTheDocument();

    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-1',
        body: '실시간 새 메시지',
        authorWsId: 'pg-1', // counterparty → 'other'
        rfpId: null,
        createdAt: '2026-05-27T06:00:00.000Z',
      });
    });

    const appended = await screen.findByText('실시간 새 메시지');
    expect(appended.closest('[data-message-row]')).toHaveAttribute('data-sender', 'other');
  });

  it('onMessage 에 attachments 가 포함된 경우 첨부 링크를 렌더한다', async () => {
    render(base());

    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-att-1',
        body: '파일 확인해 주세요.',
        authorWsId: 'pg-1', // counterparty
        rfpId: null,
        createdAt: '2026-05-27T06:00:00.000Z',
        attachments: [
          {
            id: 'att-uuid-1',
            name: '제안서.pdf',
            size: 12345,
            mimeType: 'application/pdf',
            url: '/api/files/att-uuid-1',
          },
        ],
      });
    });

    await screen.findByText('파일 확인해 주세요.');
    const link = screen.getByRole('link', { name: /제안서.pdf/ });
    expect(link).toHaveAttribute('href', '/api/files/att-uuid-1');
  });

  it('onMessage 에 attachments 가 없으면 첨부 링크를 렌더하지 않는다', async () => {
    render(base());

    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-no-att',
        body: '첨부 없는 메시지.',
        authorWsId: 'pg-1',
        rfpId: null,
        createdAt: '2026-05-27T06:00:00.000Z',
      });
    });

    await screen.findByText('첨부 없는 메시지.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('onMessage 로 같은 id 메시지가 다시 와도 중복 append 하지 않는다', async () => {
    render(base());
    const evt = {
      type: 'message',
      id: 'live-dup',
      body: '중복 방지 대상',
      authorWsId: 'pg-1',
      rfpId: null,
      createdAt: '2026-05-27T06:00:00.000Z',
    };
    act(() => channelOptions.onMessage?.(evt));
    await screen.findByText('중복 방지 대상');
    act(() => channelOptions.onMessage?.(evt));
    expect(screen.getAllByText('중복 방지 대상')).toHaveLength(1);
  });

  it('서로 다른 날짜 사이에 날짜 구분선을 표시한다', () => {
    render(base());
    const dividers = screen.getAllByRole('separator');
    expect(dividers.length).toBe(2);
    expect(screen.getByText(/5월 26일/)).toBeInTheDocument();
    expect(screen.getByText(/5월 27일/)).toBeInTheDocument();
  });

  it('메시지에 rfpId 가 있고 컨텍스트가 주어지면 RFP 코드 칩을 표시한다(uuid 원문은 표시 안 함)', () => {
    const withRfp: ThreadMessage[] = [
      {
        id: 'm3',
        authorUserId: 'u-pg',
        authorName: 'OO페이담당',
        authorEmail: 'sales@pg.com',
        authorAvatarUpdatedAt: null,
        sender: 'other',
        body: '입찰표 보냅니다.',
        rfpId: 'rfp-uuid-123',
        createdAt: '2026-05-26T05:00:00.000Z',
        readByCounterparty: false,
        attachments: [],
      },
    ];
    render(
      base({
        messages: withRfp,
        rfpById: { 'rfp-uuid-123': { code: 'P-2605-0042', title: '결제대행 선정' } },
      }),
    );
    expect(screen.getByText(/P-2605-0042/)).toBeInTheDocument();
    expect(screen.queryByText(/rfp-uuid-123/)).not.toBeInTheDocument();
  });

  it('본문의 URL 을 링크로 자동 변환한다(여러 개 모두)', () => {
    render(
      base({
        messages: [
          {
            id: 'm4',
            authorUserId: 'u-pg',
            authorName: 'OO페이담당',
            authorEmail: 'sales@pg.com',
            authorAvatarUpdatedAt: null,
            sender: 'other',
            body: '여기 https://example.com/rfp 와 https://example.com/bid 보세요',
            rfpId: null,
            createdAt: '2026-05-26T05:00:00.000Z',
            readByCounterparty: false,
            attachments: [],
          },
        ],
      }),
    );
    // 접근성 이름 = URL + sr-only 새 탭 고지. URL 자체가 라벨이라 정확 일치가 아닌
    // 부분 일치로 찾는다.
    const first = screen.getByRole('link', { name: /^https:\/\/example\.com\/rfp/ });
    const second = screen.getByRole('link', { name: /^https:\/\/example\.com\/bid/ });
    expect(first).toHaveAttribute('href', 'https://example.com/rfp');
    expect(first).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(second).toHaveAttribute('href', 'https://example.com/bid');
  });

  it('본문 자동 링크가 새 탭으로 열린다는 사실을 접근성 이름에 싣는다', () => {
    render(
      base({
        messages: [
          {
            id: 'm5',
            authorUserId: 'u-pg',
            authorName: 'OO페이담당',
            authorEmail: 'sales@pg.com',
            authorAvatarUpdatedAt: null,
            sender: 'other',
            body: '여기 https://example.com/rfp 보세요',
            rfpId: null,
            createdAt: '2026-05-26T05:00:00.000Z',
            readByCounterparty: false,
            attachments: [],
          },
        ],
      }),
    );
    // 라벨이 URL 문자열 자체라 새 탭 여부를 알 방법이 없었다. 보이는 문구를 덧붙이면
    // 메시지마다 URL 뒤에 안내가 붙어 본문을 해치므로 sr-only 로만 싣는다.
    const link = screen.getByRole('link', { name: new RegExp(NEW_TAB_NOTICE) });
    expect(link).toHaveAttribute('href', 'https://example.com/rfp');
    expect(screen.getByText(NEW_TAB_NOTICE)).toHaveClass('sr-only');
  });

  it('보내기를 누르면 conversationId 와 본문으로 sendChatMessageAction 을 호출하고 입력을 비운다', async () => {
    const user = userEvent.setup();
    render(base());

    const textarea = screen.getByPlaceholderText('메시지를 입력하세요…');
    await user.type(textarea, '새 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          body: '새 메시지',
          attachmentIds: [],
        }),
      );
    });
    expect(textarea).toHaveValue('');
  });

  it('전송 성공 시 보낸 메시지를 낙관적으로 목록에 추가한다(no-op 환경에서도 즉시 보임)', async () => {
    const user = userEvent.setup();
    render(base());
    const textarea = screen.getByPlaceholderText('메시지를 입력하세요…');
    await user.type(textarea, '낙관적 추가 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    const sent = await screen.findByText('낙관적 추가 메시지');
    expect(sent.closest('[data-message-row]')).toHaveAttribute('data-sender', 'self');
  });

  it('컴포저 입력 시 sendTyping 을 호출한다', async () => {
    const user = userEvent.setup();
    render(base());
    const textarea = screen.getByPlaceholderText('메시지를 입력하세요…');
    await user.type(textarea, 'a');
    expect(sendTyping).toHaveBeenCalled();
  });

  it('빈 본문이면 전송하지 않는다', async () => {
    const user = userEvent.setup();
    render(base());
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });

  it('Shift+Enter 는 줄바꿈, Enter 는 전송', async () => {
    const user = userEvent.setup();
    render(base());
    const textarea = screen.getByPlaceholderText('메시지를 입력하세요…');

    await user.type(textarea, '첫줄{Shift>}{Enter}{/Shift}둘째줄');
    expect(textarea).toHaveValue('첫줄\n둘째줄');
    expect(sendChatMessageAction).not.toHaveBeenCalled();

    await user.type(textarea, '{Enter}');
    await waitFor(() => {
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          body: '첫줄\n둘째줄',
          attachmentIds: [],
        }),
      );
    });
  });

  it('disabled 클립/ComingSoon 잔재가 없다(첨부 버튼은 활성)', () => {
    render(base());
    const clip = screen.getByRole('button', { name: '파일 첨부' });
    expect(clip).not.toBeDisabled();
  });

  it('connected 가 false 면 "재연결 중" 배너를 렌더한다', () => {
    channelResult = { typingUserIds: [], sendTyping, connected: false };
    render(base());
    expect(screen.getByRole('status')).toHaveTextContent('재연결 중');
  });

  it('connected 가 null 이면 배너를 렌더하지 않는다', () => {
    channelResult = { typingUserIds: [], sendTyping, connected: null };
    render(base());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('connected 가 true 면 배너를 렌더하지 않는다', () => {
    channelResult = { typingUserIds: [], sendTyping, connected: true };
    render(base());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('f.type이 빈 문자열인 PDF 파일도 확장자 기반으로 업로드 스켈레톤 칩이 뜬다', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockResolvedValue({ id: 'att-empty-mime', name: '보고서.pdf', size: 2048, mimeType: 'application/pdf' });

    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // type: '' simulates a browser/OS that doesn't report a MIME for PDF files
    const file = new File([new Uint8Array([1, 2, 3])], '보고서.pdf', { type: '' });
    await user.upload(input, file);

    // Chip must appear — currently silently dropped because ACCEPTED_MIMES.has('') === false
    expect(await screen.findByLabelText('보고서.pdf 첨부 제거')).toBeInTheDocument();
  });

  it('서버 업로드 실패 시 행이 제거되지 않고 에러 칩으로 전환되며, X 버튼으로 제거할 수 있다', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockRejectedValue(new Error('network error'));

    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '제안서.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    // Error chip must appear with the file name — currently the row is removed
    expect(await screen.findByLabelText('제안서.pdf 업로드 실패')).toBeInTheDocument();
    // Remove button should be available on the error chip
    const removeBtn = screen.getByLabelText('제안서.pdf 첨부 제거');
    await user.click(removeBtn);
    await waitFor(() => expect(screen.queryByLabelText('제안서.pdf 업로드 실패')).not.toBeInTheDocument());
  });

  it('지원하지 않는 파일 형식 선택 시 에러 칩이 노출된다', async () => {
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '보고서.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    // Simulate OS "모든 파일" selection bypassing accept filter
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    // Error chip must appear — currently silently dropped
    expect(await screen.findByLabelText('보고서.docx 업로드 실패')).toBeInTheDocument();
  });

  it('서버가 415 를 반환하면 에러 칩 메시지가 "지원되지 않는 파일 형식이에요"다', async () => {
    const user = userEvent.setup();
    // Construct a minimal HTTPError with a response stub carrying status 415.
    const { HTTPError } = await import('ky');
    const fakeResponse = { status: 415, statusText: 'Unsupported Media Type' } as Response;
    const fakeRequest = new Request('https://example.com/api/files/att/complete', { method: 'POST' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kyErr = new HTTPError(fakeResponse, fakeRequest, {} as any);
    uploadAttachment.mockRejectedValue(kyErr);

    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '악성.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    const chip = await screen.findByLabelText('악성.pdf 업로드 실패');
    expect(chip).toHaveAttribute('title', '지원되지 않는 파일 형식이에요');
  });

  it('MAX_BYTES 초과 파일은 칩에 추가되지 않는다(silent skip)', async () => {
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // Create a file whose size property reports >20 MB.
    const oversized = new File([new Uint8Array(1)], '큰파일.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [oversized], configurable: true });
    fireEvent.change(input);

    // Nothing should appear — no uploading chip, no error chip.
    await waitFor(() => {
      expect(screen.queryByLabelText('큰파일.pdf 업로드 중')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('큰파일.pdf 업로드 실패')).not.toBeInTheDocument();
    });
    // uploadAttachment must not have been called either.
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('첨부 업로드 중에는 "업로드 중" 스켈레톤 칩을 보여주고 전송을 잠그며, 완료되면 일반 칩으로 바뀐다', async () => {
    const user = userEvent.setup();
    // 업로드 응답을 테스트가 직접 resolve 하도록 promise 를 붙잡는다.
    let resolveUpload: ((v: unknown) => void) | null = null;
    uploadAttachment.mockReturnValue(new Promise((res) => { resolveUpload = res; }));

    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '제안서.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    // 업로드 중: 스켈레톤(업로드 중) 칩이 즉시 뜨고, 제거 버튼은 아직 없으며,
    // 전송 버튼은 잠긴다(완료 전 전송으로 첨부가 누락되지 않도록).
    expect(screen.getByLabelText('제안서.pdf 업로드 중')).toBeInTheDocument();
    expect(screen.queryByLabelText('제안서.pdf 첨부 제거')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();

    // 업로드 완료 → 일반 칩(제거 버튼 포함)으로 전환, 스켈레톤 사라짐.
    await act(async () => {
      resolveUpload?.({ id: 'att-1', name: '제안서.pdf', size: 1234, mimeType: 'application/pdf' });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('제안서.pdf 첨부 제거')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('제안서.pdf 업로드 중')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).not.toBeDisabled();
  });
});

describe('ThreadView 실패 피드백', () => {
  it('전송 실패 시 에러 토스트를 띄우고 입력을 유지한다', async () => {
    const user = userEvent.setup();
    sendChatMessageAction.mockResolvedValueOnce({ ok: false, error: 'NETWORK' });
    render(base());
    const textarea = screen.getByPlaceholderText('메시지를 입력하세요…');
    await user.type(textarea, '실패할 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.any(String), { type: 'error' });
    });
    // 실패 시 입력은 보존(다시 보낼 수 있게).
    expect(textarea).toHaveValue('실패할 메시지');
  });

  it('전송 성공 시에는 에러 토스트를 띄우지 않는다', async () => {
    const user = userEvent.setup();
    render(base());
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '성공 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await screen.findByText('성공 메시지');
    expect(toast).not.toHaveBeenCalled();
  });

  it('첨부 업로드 실패 시 에러 칩으로 전환되고 토스트는 띄우지 않는다', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockRejectedValue(new Error('upload failed'));
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '실패.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByLabelText('실패.pdf 업로드 실패')).toBeInTheDocument();
    });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('ThreadView 초안 보존', () => {
  beforeEach(() => window.localStorage.clear());

  it('입력한 초안을 conversationId 키로 localStorage 에 저장한다', async () => {
    const user = userEvent.setup();
    render(base());
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '저장될 초안');
    expect(window.localStorage.getItem('chat-draft:conv-1')).toBe('저장될 초안');
  });

  it('마운트 시 저장된 초안을 textarea 에 복원한다', () => {
    window.localStorage.setItem('chat-draft:conv-1', '복원될 초안');
    render(base());
    expect(screen.getByPlaceholderText('메시지를 입력하세요…')).toHaveValue('복원될 초안');
  });

  it('전송 성공 시 저장된 초안을 제거한다', async () => {
    const user = userEvent.setup();
    render(base());
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '보낼 초안');
    expect(window.localStorage.getItem('chat-draft:conv-1')).toBe('보낼 초안');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await waitFor(() => {
      expect(window.localStorage.getItem('chat-draft:conv-1')).toBeNull();
    });
  });
});

describe('ThreadView 연속 메시지 그룹핑', () => {
  const other = (id: string, body: string, createdAt: string): ThreadMessage => ({
    id, authorUserId: 'u-pg', authorName: 'OO페이담당', authorEmail: 'sales@pg.com',
    authorAvatarUpdatedAt: null,
    sender: 'other', body, rfpId: null, createdAt, readByCounterparty: false, attachments: [],
  });
  const self = (id: string, body: string, createdAt: string): ThreadMessage => ({
    id, authorUserId: 'u-self', authorName: '나', authorEmail: 'me@buyer.com',
    authorAvatarUpdatedAt: null,
    sender: 'self', body, rfpId: null, createdAt, readByCounterparty: false, attachments: [],
  });

  it('같은 상대가 5분 내 연속으로 보낸 메시지는 두 번째부터 이름·아바타 헤더를 생략한다', () => {
    render(base({ messages: [
      other('g1', '첫 번째', '2026-05-26T05:00:00.000Z'),
      other('g2', '두 번째', '2026-05-26T05:02:00.000Z'),
    ] }));
    const first = screen.getByText('첫 번째').closest('[data-message-row]') as HTMLElement;
    const second = screen.getByText('두 번째').closest('[data-message-row]') as HTMLElement;
    expect(within(first).getByText('OO페이담당')).toBeInTheDocument();
    expect(within(second).queryByText('OO페이담당')).not.toBeInTheDocument();
  });

  it('sender 가 바뀌면 헤더를 다시 표시한다', () => {
    render(base({ messages: [
      other('s1', '상대 첫 메시지', '2026-05-26T05:00:00.000Z'),
      self('s2', '내 답장', '2026-05-26T05:01:00.000Z'),
      other('s3', '상대 재개', '2026-05-26T05:02:00.000Z'),
    ] }));
    const third = screen.getByText('상대 재개').closest('[data-message-row]') as HTMLElement;
    expect(within(third).getByText('OO페이담당')).toBeInTheDocument();
  });

  it('같은 상대라도 5분을 넘기면 헤더를 다시 표시한다', () => {
    render(base({ messages: [
      other('t1', '이전 메시지', '2026-05-26T05:00:00.000Z'),
      other('t2', '한참 뒤 메시지', '2026-05-26T05:10:00.000Z'),
    ] }));
    const second = screen.getByText('한참 뒤 메시지').closest('[data-message-row]') as HTMLElement;
    expect(within(second).getByText('OO페이담당')).toBeInTheDocument();
  });

  it('날짜가 바뀌면(구분선) 같은 상대라도 헤더를 다시 표시한다', () => {
    render(base({ messages: [
      other('d1', '어제 메시지', '2026-05-26T05:00:00.000Z'),
      other('d2', '오늘 메시지', '2026-05-27T05:00:00.000Z'),
    ] }));
    const second = screen.getByText('오늘 메시지').closest('[data-message-row]') as HTMLElement;
    expect(within(second).getByText('OO페이담당')).toBeInTheDocument();
  });
});

describe('ThreadView 빈 스레드', () => {
  it('메시지가 없으면 첫 메시지를 유도하는 안내를 표시한다', () => {
    render(base({ messages: [] }));
    expect(screen.getByText('아직 주고받은 메시지가 없어요')).toBeInTheDocument();
  });

  it('메시지가 있으면 빈 스레드 안내를 표시하지 않는다', () => {
    render(base());
    expect(screen.queryByText('아직 주고받은 메시지가 없어요')).not.toBeInTheDocument();
  });
});

describe('ThreadView 전송 중 상태', () => {
  it('전송 중 말풍선을 morph 오버레이 없이 목록에 직접 표시한다', async () => {
    const user = userEvent.setup();
    let resolveSend!: (v: unknown) => void;
    sendChatMessageAction.mockReturnValue(new Promise((res) => { resolveSend = res; }));
    render(base());

    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '즉시 표시 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    const bubble = await screen.findByText('즉시 표시 메시지');
    expect(bubble.closest('[data-message-row]')).toHaveAttribute('data-sender', 'self');
    expect(document.querySelector('[data-morph-bounds]')).toBeNull();

    await act(async () => {
      resolveSend({ ok: true, conversationId: 'conv-1', messageId: 'm-new' });
    });
  });

  it('전송 중에는 "전송 중" 표식을 보이고, 성공하면 일반 상태로 바뀐다', async () => {
    const user = userEvent.setup();
    let resolveSend!: (v: unknown) => void;
    sendChatMessageAction.mockReturnValue(new Promise((res) => { resolveSend = res; }));
    render(base());
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '전송 중 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    // 전송 중: 낙관적 말풍선이 "전송 중" 표식과 함께 즉시 보이고 입력은 비워진다.
    expect(await screen.findByText('전송 중 메시지')).toBeInTheDocument();
    expect(screen.getByLabelText('전송 중')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('메시지를 입력하세요…')).toHaveValue('');

    await act(async () => {
      resolveSend({ ok: true, conversationId: 'conv-1', messageId: 'm-new' });
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('전송 중')).not.toBeInTheDocument();
    });
    expect(screen.getByText('전송 중 메시지')).toBeInTheDocument();
  });

  it('본인 메시지의 라이브 echo 가 도착해도 중복 말풍선을 만들지 않는다', async () => {
    const user = userEvent.setup();
    let resolveSend!: (v: unknown) => void;
    sendChatMessageAction.mockReturnValue(new Promise((res) => { resolveSend = res; }));
    render(base());
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '내 메시지 echo');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(screen.getAllByText('내 메시지 echo')).toHaveLength(1);

    // await 해소 전에 본인 작성(authorWsId ≠ 상대)인 echo 가 실제 id 로 도착.
    act(() => channelOptions.onMessage?.({
      type: 'message',
      id: 'm-echo-real',
      body: '내 메시지 echo',
      authorWsId: 'buyer-self',
      rfpId: null,
      createdAt: '2026-05-27T06:00:00.000Z',
    }));
    expect(screen.getAllByText('내 메시지 echo')).toHaveLength(1);

    await act(async () => {
      resolveSend({ ok: true, conversationId: 'conv-1', messageId: 'm-echo-real' });
    });
    expect(screen.getAllByText('내 메시지 echo')).toHaveLength(1);
  });

  it('전송 실패 시 낙관적 말풍선을 제거하고 입력을 복원한다', async () => {
    const user = userEvent.setup();
    let resolveSend!: (v: unknown) => void;
    sendChatMessageAction.mockReturnValue(new Promise((res) => { resolveSend = res; }));
    render(base());
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '실패 복원 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    // 전송 중: 낙관적 말풍선이 목록에 보인다.
    const bubble = await screen.findByText('실패 복원 메시지');
    expect(bubble.closest('[data-message-row]')).not.toBeNull();

    // 실패로 종료 → 말풍선 제거 + 입력 복원.
    await act(async () => {
      resolveSend({ ok: false, error: 'NETWORK' });
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('메시지를 입력하세요…')).toHaveValue('실패 복원 메시지');
    });
    const inBubble = screen
      .queryAllByText('실패 복원 메시지')
      .filter((el) => el.closest('[data-message-row]'));
    expect(inBubble).toHaveLength(0);
  });
});

describe('ThreadView 자동 스크롤', () => {
  // jsdom 은 레이아웃을 계산하지 않으므로 컨테이너의 scroll 메트릭을 직접 정의해
  // "하단 근처" 판정을 통제한다.
  function setScrolledUp(list: HTMLElement) {
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
    list.scrollTop = 0; // diff = 1000 - 0 - 300 = 700 > 임계값 → 하단 아님
  }

  const liveMsg = (id: string, body: string) => ({
    type: 'message',
    id,
    body,
    authorWsId: 'pg-1', // counterparty → 'other'
    rfpId: null,
    createdAt: '2026-05-27T06:00:00.000Z',
  });

  it('마운트 시 최신 메시지로 스크롤한다', () => {
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(base());
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('하단에 있을 때 새 메시지를 받으면 최신으로 스크롤한다', async () => {
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(base());
    scrollSpy.mockClear(); // 마운트 스크롤은 제외
    act(() => channelOptions.onMessage?.(liveMsg('live-bottom', '하단 새 메시지')));
    await screen.findByText('하단 새 메시지');
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('위로 스크롤한 상태에서 새 메시지가 오면 자동 스크롤하지 않고 "새 메시지" 버튼을 표시한다', async () => {
    const { container } = render(base());
    const list = container.querySelector('[data-message-list]') as HTMLElement;
    setScrolledUp(list);
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    act(() => channelOptions.onMessage?.(liveMsg('live-up', '안 보이는 새 메시지')));
    expect(await screen.findByRole('button', { name: /새 메시지/ })).toBeInTheDocument();
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('"새 메시지" 버튼을 누르면 최신으로 스크롤하고 버튼을 숨긴다', async () => {
    const user = userEvent.setup();
    const { container } = render(base());
    const list = container.querySelector('[data-message-list]') as HTMLElement;
    setScrolledUp(list);
    act(() => channelOptions.onMessage?.(liveMsg('live-pill', 'pill 트리거')));
    const pill = await screen.findByRole('button', { name: /새 메시지/ });
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    await user.click(pill);
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /새 메시지/ })).not.toBeInTheDocument();
    scrollSpy.mockRestore();
  });

  it('위로 올려둔 상태여도 본인이 메시지를 보내면 최신으로 스크롤한다', async () => {
    const user = userEvent.setup();
    const { container } = render(base());
    const list = container.querySelector('[data-message-list]') as HTMLElement;
    setScrolledUp(list);
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '내가 보낸 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await screen.findByText('내가 보낸 메시지');
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /새 메시지/ })).not.toBeInTheDocument();
    scrollSpy.mockRestore();
  });

  it('"새 메시지" 표시 중 사용자가 하단으로 스크롤하면 버튼이 사라진다', async () => {
    const { container } = render(base());
    const list = container.querySelector('[data-message-list]') as HTMLElement;
    setScrolledUp(list);
    act(() => channelOptions.onMessage?.(liveMsg('live-scroll', '스크롤 복귀 테스트')));
    await screen.findByRole('button', { name: /새 메시지/ });
    list.scrollTop = 700; // diff = 1000 - 700 - 300 = 0 → 하단 근처
    fireEvent.scroll(list);
    expect(screen.queryByRole('button', { name: /새 메시지/ })).not.toBeInTheDocument();
  });
});

// ── 채팅 레일 확장: defaultRfpId + variant='rail' ────────────────────────────
// 상세 화면 임베드(ChatRail)에서 ThreadView 가 (1) 컴포저 전송에 해당 RFP 태그를
// 기본 적용하고 (2) w-64 사이드 갤러리 대신 오버레이 갤러리를 쓰도록 하는 분기.

describe('ThreadView — defaultRfpId (레일 컨텍스트 RFP 태그)', () => {
  it('defaultRfpId 가 있으면 전송 시 rfpId 를 포함하고 낙관적 말풍선에 RFP 칩을 단다', async () => {
    const user = userEvent.setup();
    render(
      base({
        defaultRfpId: 'rfp-uuid-1',
        rfpById: { 'rfp-uuid-1': { code: 'P-2606-0001', title: '결제 견적 요청' } },
      }),
    );

    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '레일에서 보낸 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          body: '레일에서 보낸 메시지',
          attachmentIds: [],
          rfpId: 'rfp-uuid-1',
        }),
      );
    });

    // 낙관적/확정 말풍선에 RFP 컨텍스트 칩(코드, uuid 원문 노출 금지)이 붙는다.
    const row = screen.getByText('레일에서 보낸 메시지').closest('[data-message-row]')!;
    expect(within(row as HTMLElement).getByText('P-2606-0001')).toBeInTheDocument();
    expect(screen.queryByText('rfp-uuid-1')).not.toBeInTheDocument();
  });

  it('defaultRfpId 가 없으면 기존처럼 rfpId 없이 전송한다', async () => {
    const user = userEvent.setup();
    render(base());

    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '일반 전송');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          body: '일반 전송',
          attachmentIds: [],
        }),
      );
    });
  });
});

describe('ThreadView — 컴포저 가드·승격 시각', () => {
  it('한글 IME 조합 중 Enter 는 전송하지 않는다', async () => {
    const user = userEvent.setup();
    render(base());
    const ta = screen.getByPlaceholderText('메시지를 입력하세요…');

    await user.type(ta, '한글입력');
    fireEvent.keyDown(ta, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });

  it('확정 승격 시 서버 createdAt 을 채택한다', async () => {
    sendChatMessageAction.mockResolvedValue({
      ok: true,
      conversationId: 'conv-1',
      messageId: 'm-new',
      createdAt: '2026-06-10T01:23:00.000Z',
    });
    const user = userEvent.setup();
    render(base());

    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '시각 확인');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      const row = screen.getByText('시각 확인').closest('[data-message-row]')!;
      expect(
        within(row as HTMLElement).getByText(formatTime('2026-06-10T01:23:00.000Z')),
      ).toBeInTheDocument();
    });
  });
});

describe('ThreadView — variant="rail" 갤러리 오버레이', () => {
  const messagesWithAttachment: ThreadMessage[] = [
    {
      id: 'm-att',
      authorUserId: 'u-pg',
      authorName: 'OO페이담당',
      authorEmail: 'sales@pg.com',
      authorAvatarUpdatedAt: null,
      sender: 'other',
      body: '첨부 보냈어요.',
      rfpId: null,
      createdAt: '2026-05-26T05:00:00.000Z',
      readByCounterparty: false,
      attachments: [
        {
          id: 'att-1',
          name: '제안서.pdf',
          size: 1000,
          mimeType: 'application/pdf',
          url: '/api/files/att-1',
        },
      ],
    },
  ];

  it('rail 변형에서 갤러리 토글은 사이드 패널 대신 오버레이로 띄운다', async () => {
    const user = userEvent.setup();
    const { container } = render(
      base({ variant: 'rail', messages: messagesWithAttachment }),
    );

    await user.click(screen.getByRole('button', { name: /파일 1/ }));

    expect(container.querySelector('[data-gallery-overlay]')).toBeInTheDocument();
    expect(container.querySelector('[data-gallery-pane]')).not.toBeInTheDocument();
  });

  it('기본(page) 변형에서는 갤러리 토글 버튼과 사이드 패널이 없다', async () => {
    const { container } = render(base({ messages: messagesWithAttachment }));

    expect(screen.queryByRole('button', { name: /파일 1/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-gallery-pane]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-gallery-overlay]')).not.toBeInTheDocument();
  });
});

describe('ThreadView 작성자(담당자) 표시', () => {
  const mk = (
    id: string,
    sender: 'self' | 'other',
    authorUserId: string,
    authorName: string,
    body: string,
    createdAt: string,
    authorEmail = `${authorUserId}@x.com`,
  ): ThreadMessage => ({
    id, authorUserId, authorName, authorEmail, authorAvatarUpdatedAt: null, sender, body, rfpId: null,
    createdAt, readByCounterparty: false, attachments: [],
  });

  it('받은 메시지와 보낸 메시지 모두 작성자 이름 헤더를 표시한다', () => {
    render(base({ messages: [
      mk('a1', 'other', 'u-pg', '박영업', '안녕하세요', '2026-05-26T05:00:00.000Z'),
      mk('a2', 'self', 'u-self', '김구매', '확인했습니다', '2026-05-26T05:00:30.000Z'),
    ] }));
    const received = screen.getByText('안녕하세요').closest('[data-message-row]') as HTMLElement;
    const sent = screen.getByText('확인했습니다').closest('[data-message-row]') as HTMLElement;
    expect(within(received).getByText('박영업')).toBeInTheDocument();
    expect(within(sent).getByText('김구매')).toBeInTheDocument();
  });

  it('같은 측이라도 작성자가 다르면 각자 헤더를 표시한다(우리 팀원 구분)', () => {
    render(base({ messages: [
      mk('t1', 'self', 'u-self', '김구매', '제가 보냅니다', '2026-05-26T05:00:00.000Z'),
      mk('t2', 'self', 'u-mate', '이동료', '제가 이어서요', '2026-05-26T05:01:00.000Z'),
    ] }));
    const second = screen.getByText('제가 이어서요').closest('[data-message-row]') as HTMLElement;
    expect(within(second).getByText('이동료')).toBeInTheDocument();
  });

  it('같은 작성자가 5분 내 연속이면 두 번째부터 헤더를 생략한다', () => {
    render(base({ messages: [
      mk('s1', 'other', 'u-pg', '박영업', '첫 줄', '2026-05-26T05:00:00.000Z'),
      mk('s2', 'other', 'u-pg', '박영업', '둘째 줄', '2026-05-26T05:02:00.000Z'),
    ] }));
    const first = screen.getByText('첫 줄').closest('[data-message-row]') as HTMLElement;
    const second = screen.getByText('둘째 줄').closest('[data-message-row]') as HTMLElement;
    expect(within(first).getByText('박영업')).toBeInTheDocument();
    expect(within(second).queryByText('박영업')).not.toBeInTheDocument();
  });

  it('작성자 이름에 이메일 title(호버)을 단다', () => {
    render(base({ messages: [
      mk('e1', 'other', 'u-pg', '박영업', '메일 확인', '2026-05-26T05:00:00.000Z', 'park@pg.com'),
    ] }));
    expect(screen.getByText('박영업')).toHaveAttribute('title', 'park@pg.com');
  });

  it('낙관적으로 보낸 메시지는 viewer 이름으로 헤더를 표시한다', async () => {
    const user = userEvent.setup();
    render(base({ messages: [] }));
    await user.type(screen.getByPlaceholderText('메시지를 입력하세요…'), '내 첫 메시지');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    const row = (await screen.findByText('내 첫 메시지')).closest('[data-message-row]') as HTMLElement;
    // Avatar renders '나' as initials AND the span shows '나' — both are correct;
    // use getAllByText since two elements (Avatar div + name span) match.
    expect(within(row).getAllByText('나').length).toBeGreaterThan(0);
  });

  it('라이브 수신 메시지는 페이로드의 authorName 으로 헤더를 표시한다', async () => {
    render(base({ messages: [] }));
    act(() => {
      channelOptions.onMessage?.({
        type: 'message',
        id: 'live-author',
        body: '실시간 담당자',
        authorWsId: 'pg-1',
        authorUserId: 'u-pg',
        authorName: '최라이브',
        authorEmail: 'choi@pg.com',
        rfpId: null,
        createdAt: '2026-05-27T06:00:00.000Z',
      });
    });
    const row = (await screen.findByText('실시간 담당자')).closest('[data-message-row]') as HTMLElement;
    expect(within(row).getByText('최라이브')).toBeInTheDocument();
  });
});

describe('ThreadView — sendDisabledReason="closed" (선정 종료)', () => {
  it('종료 안내 문구를 보여주고 전송 버튼·입력을 막는다', () => {
    render(base({ sendDisabledReason: 'closed' }));
    expect(screen.getByText(/선정이 끝나 이 대화는 종료됐어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
    expect(screen.getByPlaceholderText('메시지를 입력하세요…')).toBeDisabled();
  });

  it('Enter 로도 전송되지 않는다', async () => {
    render(base({ sendDisabledReason: 'closed' }));
    const ta = screen.getByPlaceholderText('메시지를 입력하세요…') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });
});

describe('ThreadView — sendDisabledReason 없음(기본)', () => {
  it('안내 문구 없이 입력이 활성화된다', () => {
    render(base());
    expect(screen.queryByText(/종료됐어요/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('메시지를 입력하세요…')).not.toBeDisabled();
  });
});

describe('variant=tabs', () => {
  const baseProps = {
    conversationId: 'conv-1',
    counterparty: { workspaceId: 'pg-1', name: 'OO페이', type: 'pg' as const, logoUpdatedAt: null },
    viewer: { userId: 'u-self', name: '나', avatarUpdatedAt: null },
    messages: [],
    variant: 'tabs' as const,
    rfpContext: { code: 'P-2605-0042', title: '온라인 결제 견적', status: 'sent', deadline: null },
  };

  it('탭 버튼 3개(채팅·RFP·파일)를 렌더한다', () => {
    render(<ThreadView {...baseProps} />);
    expect(screen.getByRole('tab', { name: '채팅' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'RFP' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '파일' })).toBeInTheDocument();
  });

  it('기본 탭은 채팅이고 컴포저가 보인다', () => {
    render(<ThreadView {...baseProps} />);
    // composer textarea or input exists
    const composer = screen.queryByPlaceholderText('메시지를 입력하세요…')
      ?? screen.queryByRole('textbox');
    expect(composer).toBeInTheDocument();
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();
  });

  it('RFP 탭 클릭 시 ContextPanel을 렌더하고 컴포저를 숨긴다', async () => {
    const user = userEvent.setup();
    render(<ThreadView {...baseProps} />);
    await user.click(screen.getByRole('tab', { name: 'RFP' }));
    expect(screen.getByTestId('context-panel')).toBeInTheDocument();
    const composer = screen.queryByPlaceholderText('메시지를 입력하세요…')
      ?? screen.queryByRole('textbox');
    expect(composer).not.toBeInTheDocument();
  });

  it('파일 탭 클릭 후 채팅 탭 클릭 시 컴포저가 복원된다', async () => {
    const user = userEvent.setup();
    render(<ThreadView {...baseProps} />);
    await user.click(screen.getByRole('tab', { name: '파일' }));
    await user.click(screen.getByRole('tab', { name: '채팅' }));
    const composer = screen.queryByPlaceholderText('메시지를 입력하세요…')
      ?? screen.queryByRole('textbox');
    expect(composer).toBeInTheDocument();
  });
});

describe('variant=page (갤러리 버튼 없음)', () => {
  const msgWithAttachment = {
    id: 'm1', authorUserId: 'u-pg', authorName: 'PG', authorEmail: 'p@pg.com',
    authorAvatarUpdatedAt: null,
    sender: 'other' as const, body: '파일 보냅니다', rfpId: null,
    createdAt: new Date().toISOString(), readByCounterparty: false,
    attachments: [{ id: 'a1', name: 'test.pdf', size: 100, mimeType: 'application/pdf', url: '/api/files/a1' }],
  };

  it('page variant에서는 "파일 N" 토글 버튼이 없다', () => {
    render(
      <ThreadView
        conversationId="conv-1"
        counterparty={{ workspaceId: 'pg-1', name: 'OO페이', type: 'pg', logoUpdatedAt: null }}
        viewer={{ userId: 'u-self', name: '나', avatarUpdatedAt: null }}
        messages={[msgWithAttachment]}
        variant="page"
      />
    );
    expect(screen.queryByText(/파일 \d/)).not.toBeInTheDocument();
  });
});
