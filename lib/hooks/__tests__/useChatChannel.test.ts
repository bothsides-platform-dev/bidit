import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── centrifuge mock ────────────────────────────────────────────────────────
// Subscription stores handlers by event name so a test can grab the
// 'publication' / 'join' / 'leave' handler and fire it manually inside act().
type Handler = (ctx: unknown) => void;

function makeSub() {
  const handlers: Record<string, Handler[]> = {};
  return {
    state: 'unsubscribed',
    handlers,
    on: vi.fn((event: string, cb: Handler) => {
      (handlers[event] ??= []).push(cb);
    }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    off: vi.fn((event: string, cb: Handler) => {
      handlers[event] = (handlers[event] ?? []).filter((handler) => handler !== cb);
    }),
    publish: vi.fn().mockResolvedValue(undefined),
    presenceStats: vi.fn().mockResolvedValue({ numClients: 1, numUsers: 1 }),
    // helper for tests to fire a stored handler
    __fire(event: string, ctx: unknown) {
      for (const h of handlers[event] ?? []) h(ctx);
    },
  };
}

type MockSub = ReturnType<typeof makeSub>;
let mockSub: MockSub;
const mockClientHandlers: Record<string, Handler[]> = {};
const mockClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  newSubscription: vi.fn((): MockSub => mockSub),
  getSubscription: vi.fn((): MockSub | null => null),
  removeSubscription: vi.fn(),
  off: vi.fn(),
  on: vi.fn((event: string, cb: Handler) => {
    (mockClientHandlers[event] ??= []).push(cb);
  }),
  __fire(event: string, ctx: unknown) {
    for (const h of mockClientHandlers[event] ?? []) h(ctx);
  },
};
// Defined inside the factory (hoisted) so `new Centrifuge()` resolves to a real
// constructable mock. Exported so tests can assert on construction.
vi.mock('centrifuge', () => ({
  Centrifuge: vi.fn(function Centrifuge(this: unknown) {
    return mockClient;
  }),
}));

let CentrifugeCtor: ReturnType<typeof vi.fn>;

// http mock so the getToken callback never hits the network in tests
vi.mock('@/lib/http', () => ({
  http: { post: vi.fn() },
}));

const CONV_ID = '11111111-1111-1111-1111-111111111111';
const CHANNEL = `chat:conversation:${CONV_ID}`;

beforeEach(async () => {
  vi.resetModules();
  Object.keys(mockClientHandlers).forEach((k) => delete mockClientHandlers[k]);
  mockSub = makeSub();
  mockClient.newSubscription.mockImplementation(() => mockSub);
  mockClient.getSubscription.mockReturnValue(null);
  const { Centrifuge } = await import('centrifuge');
  CentrifugeCtor = Centrifuge as unknown as ReturnType<typeof vi.fn>;
  CentrifugeCtor.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('useChatChannel — graceful no-op (URL 미설정)', () => {
  it('(a) NEXT_PUBLIC_CENTRIFUGO_WS_URL 미설정이면 Centrifuge 생성·구독을 전혀 하지 않는다', async () => {
    vi.stubEnv('NEXT_PUBLIC_CENTRIFUGO_WS_URL', '');

    const { renderHook } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { result } = renderHook(() => useChatChannel(CONV_ID, {}));

    expect(CentrifugeCtor).not.toHaveBeenCalled();
    expect(mockClient.newSubscription).not.toHaveBeenCalled();
    expect(mockSub.subscribe).not.toHaveBeenCalled();
    expect(result.current.typingUserIds).toEqual([]);
    expect(result.current.connected).toBeNull();
  });
});

describe('useChatChannel — 라이브 연결 (URL 설정)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CENTRIFUGO_WS_URL', 'wss://example.test/connection/websocket');
  });

  it('(b) 설정 시 chatChannel(id)로 구독한다', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, {}));

    expect(mockClient.newSubscription).toHaveBeenCalledWith(CHANNEL);
    expect(mockSub.subscribe).toHaveBeenCalled();
  });

  it('(c) publication type=message → onMessage(data) 호출', async () => {
    const onMessage = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, { onMessage }));

    const payload = { type: 'message', id: 'm1', body: '안녕하세요' };
    act(() => {
      mockSub.__fire('publication', { data: payload });
    });

    expect(onMessage).toHaveBeenCalledWith(payload);
  });

  it('클라이언트가 publish한 message 이벤트는 위조 메시지로 전달하지 않는다', async () => {
    const onMessage = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, { onMessage }));

    act(() => {
      mockSub.__fire('publication', {
        data: {
          type: 'message',
          id: 'forged-message',
          body: '위조 메시지',
          createdAt: '2026-05-28T05:00:00.000Z',
        },
        info: { user: 'u-attacker' },
      });
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('(c2) publication type=read → onRead(data) 호출', async () => {
    const onRead = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, { onRead }));

    const payload = {
      type: 'read',
      userId: 'u-other',
      workspaceId: 'pg-1',
      readAt: '2026-05-28T05:00:00.000Z',
    };
    act(() => {
      mockSub.__fire('publication', { data: payload });
    });

    expect(onRead).toHaveBeenCalledWith(payload);
  });

  it.each([
    { type: 'read', userId: 'u-other', readAt: '2026-05-28T05:00:00.000Z' },
    { type: 'read', userId: 'u-other', workspaceId: 'pg-1' },
    { type: 'read', userId: 'u-other', workspaceId: 'pg-1', readAt: 'not-a-date' },
    { type: 'read', workspaceId: 'pg-1', readAt: '2026-05-28T05:00:00.000Z' },
    { type: 'read', userId: '', workspaceId: 'pg-1', readAt: '2026-05-28T05:00:00.000Z' },
    { type: 'read', userId: 'u-other', workspaceId: '', readAt: '2026-05-28T05:00:00.000Z' },
  ])('필수 필드가 누락되거나 잘못된 서버 read payload를 무시한다: %o', async (payload) => {
    const onRead = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, { onRead }));

    act(() => {
      mockSub.__fire('publication', { data: payload });
    });

    expect(onRead).not.toHaveBeenCalled();
  });

  it('클라이언트가 publish한 read 이벤트는 위조된 읽음 처리로 전달하지 않는다', async () => {
    const onRead = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, { onRead }));

    act(() => {
      mockSub.__fire('publication', {
        data: {
          type: 'read',
          userId: 'u-attacker',
          workspaceId: 'forged-counterparty',
          readAt: '2026-05-28T05:00:00.000Z',
        },
        info: { user: 'u-attacker' },
      });
    });

    expect(onRead).not.toHaveBeenCalled();
  });

  it('user가 빈 ClientInfo가 있어도 클라이언트 read 이벤트로 거부한다', async () => {
    const onRead = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    renderHook(() => useChatChannel(CONV_ID, { onRead }));

    act(() => {
      mockSub.__fire('publication', {
        data: {
          type: 'read',
          userId: 'u-attacker',
          workspaceId: 'forged-counterparty',
          readAt: '2026-05-28T05:00:00.000Z',
        },
        info: { client: 'anonymous-client', user: '' },
      });
    });

    expect(onRead).not.toHaveBeenCalled();
  });

  it('(d) publication type=typing → typingUserIds 반영 후 3초 뒤 해제', async () => {
    vi.useFakeTimers();
    try {
      const { renderHook, act } = await import('@testing-library/react');
      const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

      const { result } = renderHook(() => useChatChannel(CONV_ID, {}));

      // typing: 클라 ephemeral publish — 타이퍼 식별은 ctx.info.user
      act(() => {
        mockSub.__fire('publication', { data: { type: 'typing' }, info: { user: 'u-other' } });
      });
      expect(result.current.typingUserIds).toContain('u-other');

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.typingUserIds).not.toContain('u-other');
    } finally {
      vi.useRealTimers();
    }
  });

  it('(e) sendTyping() → typing 이벤트 publish', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { result } = renderHook(() => useChatChannel(CONV_ID, {}));

    act(() => {
      result.current.sendTyping();
    });

    expect(mockSub.publish).toHaveBeenCalledWith({ type: 'typing' });
  });

  it('언마운트 시 구독 해제 + 레지스트리에서 제거', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { unmount } = renderHook(() => useChatChannel(CONV_ID, {}));
    unmount();

    expect(mockSub.unsubscribe).toHaveBeenCalled();
    // unsubscribe() leaves the sub in the client registry; removeSubscription
    // frees the channel so a remount gets a clean handler set (no duplicates).
    expect(mockClient.removeSubscription).toHaveBeenCalledWith(mockSub);
  });

  it('리마운트 시 핸들러가 중복 등록되지 않는다 (publication 1회만 onMessage)', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const onMessage = vi.fn();

    // Faithful registry over a SINGLE reused sub object, so we can count handlers
    // on it directly. Mirrors centrifuge-js: getSubscription returns the live sub
    // while it's registered; unsubscribe() does NOT free the slot — only
    // removeSubscription does (and a removed sub starts clean, so we wipe its
    // handlers to model the fresh allocation on the next newSubscription).
    let registered = false;
    mockClient.getSubscription.mockImplementation(() => (registered ? mockSub : null));
    mockClient.newSubscription.mockImplementation(() => {
      registered = true;
      return mockSub;
    });
    mockClient.removeSubscription.mockImplementation(() => {
      registered = false;
      for (const k of Object.keys(mockSub.handlers)) delete mockSub.handlers[k];
    });

    // 1st mount registers a publication handler, then unmounts. If cleanup only
    // unsubscribed (no removeSubscription), the handler would survive AND the 2nd
    // mount would re-register on the same sub → two handlers → onMessage twice.
    const first = renderHook(() => useChatChannel(CONV_ID, { onMessage }));
    first.unmount();

    renderHook(() => useChatChannel(CONV_ID, { onMessage }));

    act(() => {
      mockSub.__fire('publication', { data: { type: 'message', id: 'm1' } });
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('(f) 초기 connected 는 null (미확정)', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { result } = renderHook(() => useChatChannel(CONV_ID, {}));

    expect(result.current.connected).toBeNull();
  });

  it('(g) subscription subscribed 이벤트 → connected:true', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { result } = renderHook(() => useChatChannel(CONV_ID, {}));
    expect(result.current.connected).toBeNull();

    act(() => {
      mockSub.__fire('state', { oldState: 'subscribing', newState: 'subscribed' });
    });

    expect(result.current.connected).toBe(true);
  });

  it('(h) subscription subscribing 이벤트 → connected:false', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { result } = renderHook(() => useChatChannel(CONV_ID, {}));

    act(() => {
      mockSub.__fire('state', { oldState: 'subscribing', newState: 'subscribed' });
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      mockSub.__fire('state', { oldState: 'subscribed', newState: 'subscribing' });
    });
    expect(result.current.connected).toBe(false);
  });

  it('언마운트 시 subscription state 핸들러를 해제한다', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useChatChannel } = await import('@/lib/hooks/useChatChannel');

    const { unmount } = renderHook(() => useChatChannel(CONV_ID, {}));
    unmount();

    const offCalls = mockSub.off.mock.calls.map((args: unknown[]) => args[0] as string);
    expect(offCalls).toContain('state');
  });
});
