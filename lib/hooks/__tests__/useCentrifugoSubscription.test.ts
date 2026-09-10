import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import type { Subscription } from 'centrifuge';

// ── centrifuge mock (mirrors useChatChannel.test.ts) ────────────────────────
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
vi.mock('centrifuge', () => ({
  Centrifuge: vi.fn(function Centrifuge(this: unknown) {
    return mockClient;
  }),
}));
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));

const CHANNEL = 'chat:conversation:abc';

beforeEach(() => {
  vi.resetModules();
  Object.keys(mockClientHandlers).forEach((k) => delete mockClientHandlers[k]);
  mockSub = makeSub();
  mockClient.newSubscription.mockImplementation(() => mockSub);
  mockClient.getSubscription.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('useCentrifugoSubscription — graceful no-op (URL 미설정)', () => {
  it('URL 미설정이면 구독을 전혀 하지 않고 connected=null', async () => {
    vi.stubEnv('NEXT_PUBLIC_CENTRIFUGO_WS_URL', '');
    const { renderHook } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    const { result } = renderHook(() => useCentrifugoSubscription(CHANNEL, {}));

    expect(mockClient.newSubscription).not.toHaveBeenCalled();
    expect(mockSub.subscribe).not.toHaveBeenCalled();
    expect(result.current.connected).toBeNull();
  });
});

describe('useCentrifugoSubscription — 라이브 연결 (URL 설정)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CENTRIFUGO_WS_URL', 'wss://example.test/connection/websocket');
  });

  it('주어진 channel 로 구독·연결한다', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    renderHook(() => useCentrifugoSubscription(CHANNEL, {}));

    expect(mockClient.newSubscription).toHaveBeenCalledWith(CHANNEL);
    expect(mockSub.subscribe).toHaveBeenCalled();
    expect(mockClient.connect).toHaveBeenCalled();
  });

  it('publication → onPublication(ctx) 로 라우팅', async () => {
    const onPublication = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    renderHook(() => useCentrifugoSubscription(CHANNEL, { onPublication }));

    const ctx = { data: { type: 'message', id: 'm1' } };
    act(() => {
      mockSub.__fire('publication', ctx);
    });

    expect(onPublication).toHaveBeenCalledWith(ctx);
  });

  it('subRef 에 구독 핸들을 노출한다 (presence/publish 용)', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    const { result } = renderHook(() => {
      const subRef = useRef<Subscription | null>(null);
      const r = useCentrifugoSubscription(CHANNEL, { subRef });
      return { subRef, r };
    });

    expect(result.current.subRef.current).toBe(mockSub);
  });

  it('onJoin/onLeave/onSubscribed 가 제공될 때만 해당 이벤트를 등록한다', async () => {
    const onJoin = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    renderHook(() => useCentrifugoSubscription(CHANNEL, { onJoin }));

    const onEvents = mockSub.on.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(onEvents).toContain('join');
    expect(onEvents).not.toContain('leave'); // 미제공 → 미등록

    act(() => {
      mockSub.__fire('join', {});
    });
    expect(onJoin).toHaveBeenCalled();
  });

  it('개별 채널 구독 상태로 connected 상태를 추적한다', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    const { result } = renderHook(() => useCentrifugoSubscription(CHANNEL, {}));
    expect(result.current.connected).toBeNull();

    act(() => mockSub.__fire('state', { oldState: 'subscribing', newState: 'subscribed' }));
    expect(result.current.connected).toBe(true);

    act(() => mockSub.__fire('state', { oldState: 'subscribed', newState: 'subscribing' }));
    expect(result.current.connected).toBe(false);
  });

  it('전역 소켓이 연결돼도 개별 채널 구독 전에는 connected가 아니다', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    const { result } = renderHook(() => useCentrifugoSubscription(CHANNEL, {}));
    act(() => mockClient.__fire('connected', {}));
    expect(result.current.connected).not.toBe(true);

    act(() => {
      mockSub.state = 'subscribed';
      mockSub.__fire('state', { oldState: 'subscribing', newState: 'subscribed' });
    });
    expect(result.current.connected).toBe(true);
  });

  it('이미 구독된 핸들을 재사용하면 마운트 즉시 connected다', async () => {
    mockSub.state = 'subscribed';
    mockClient.getSubscription.mockReturnValue(mockSub);
    const { renderHook } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    const { result } = renderHook(() => useCentrifugoSubscription(CHANNEL, {}));
    expect(result.current.connected).toBe(true);
  });

  it('언마운트 시 unsubscribe + removeSubscription + 구독 state 핸들러 + subRef 정리', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    const { result, unmount } = renderHook(() => {
      const subRef = useRef<Subscription | null>(null);
      const r = useCentrifugoSubscription(CHANNEL, { subRef });
      return { subRef, r };
    });
    expect(result.current.subRef.current).toBe(mockSub);

    unmount();

    expect(mockSub.unsubscribe).toHaveBeenCalled();
    expect(mockClient.removeSubscription).toHaveBeenCalledWith(mockSub);
    const offEvents = mockSub.off.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(offEvents).toContain('state');
    expect(result.current.subRef.current).toBeNull();
  });

  it('재구독은 getSubscription 우선 — 기존 핸들을 재사용한다', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useCentrifugoSubscription } = await import('@/lib/hooks/useCentrifugoSubscription');

    mockClient.getSubscription.mockReturnValue(mockSub);

    renderHook(() => useCentrifugoSubscription(CHANNEL, {}));

    expect(mockClient.getSubscription).toHaveBeenCalledWith(CHANNEL);
    expect(mockClient.newSubscription).not.toHaveBeenCalled();
  });
});
