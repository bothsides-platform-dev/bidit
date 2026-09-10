// useTeamChannel — live enhancement for the RFP-scoped internal team thread.
// Far smaller surface than useChatChannel: messages only (no typing/presence/
// read receipts — v1 확정 결정). Same graceful no-op + subscription-cleanup
// discipline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

let CentrifugeCtor: ReturnType<typeof vi.fn>;

vi.mock('@/lib/http', () => ({
  http: { post: vi.fn() },
}));

const RFP_ID = '22222222-2222-2222-2222-222222222222';
const WS_ID = '33333333-3333-3333-3333-333333333333';
const CHANNEL = `team:rfp:${RFP_ID}:${WS_ID}`;

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

describe('useTeamChannel — graceful no-op (URL 미설정)', () => {
  it('(a) NEXT_PUBLIC_CENTRIFUGO_WS_URL 미설정이면 생성·구독을 전혀 하지 않는다', async () => {
    vi.stubEnv('NEXT_PUBLIC_CENTRIFUGO_WS_URL', '');

    const { renderHook } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    const { result } = renderHook(() => useTeamChannel(RFP_ID, WS_ID, {}));

    expect(CentrifugeCtor).not.toHaveBeenCalled();
    expect(mockClient.newSubscription).not.toHaveBeenCalled();
    expect(result.current.connected).toBeNull();
  });
});

describe('useTeamChannel — 라이브 연결 (URL 설정)', () => {
  beforeEach(() => {
    vi.stubEnv(
      'NEXT_PUBLIC_CENTRIFUGO_WS_URL',
      'wss://example.test/connection/websocket',
    );
  });

  it('(b) 설정 시 teamChatChannel(rfpId, wsId)로 구독한다', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    renderHook(() => useTeamChannel(RFP_ID, WS_ID, {}));

    expect(mockClient.newSubscription).toHaveBeenCalledWith(CHANNEL);
    expect(mockSub.subscribe).toHaveBeenCalled();
  });

  it('(c) publication type=message → onMessage(data) 호출', async () => {
    const onMessage = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    renderHook(() => useTeamChannel(RFP_ID, WS_ID, { onMessage }));

    const payload = {
      type: 'message',
      id: 'm1',
      body: '팀 메모',
      authorUserId: 'u1',
      authorName: '김구매',
      createdAt: '2026-06-10T10:00:00.000Z',
    };
    act(() => {
      mockSub.__fire('publication', { data: payload });
    });

    expect(onMessage).toHaveBeenCalledWith(payload);
  });

  it('(c2) message가 아닌 publication은 onMessage를 호출하지 않는다', async () => {
    const onMessage = vi.fn();
    const { renderHook, act } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    renderHook(() => useTeamChannel(RFP_ID, WS_ID, { onMessage }));

    act(() => {
      mockSub.__fire('publication', { data: { type: 'typing' } });
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('(d) subscription state 이벤트로 connected 상태가 전이된다', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    const { result } = renderHook(() => useTeamChannel(RFP_ID, WS_ID, {}));
    expect(result.current.connected).toBeNull();

    act(() => {
      mockSub.__fire('state', { oldState: 'subscribing', newState: 'subscribed' });
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      mockSub.__fire('state', { oldState: 'subscribed', newState: 'subscribing' });
    });
    expect(result.current.connected).toBe(false);
  });

  it('(e) unmount 시 unsubscribe + removeSubscription (재마운트 이중 핸들러 방지)', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    const { unmount } = renderHook(() => useTeamChannel(RFP_ID, WS_ID, {}));
    unmount();

    expect(mockSub.unsubscribe).toHaveBeenCalled();
    expect(mockClient.removeSubscription).toHaveBeenCalledWith(mockSub);
  });

  it('(f) 같은 채널의 기존 구독이 있으면 재사용한다 (newSubscription 미호출)', async () => {
    const existing = makeSub();
    mockClient.getSubscription.mockReturnValue(existing);
    const { renderHook } = await import('@testing-library/react');
    const { useTeamChannel } = await import('@/lib/hooks/useTeamChannel');

    const { unmount } = renderHook(() => useTeamChannel(RFP_ID, WS_ID, {}));

    expect(mockClient.newSubscription).not.toHaveBeenCalled();
    expect(existing.on).toHaveBeenCalledWith('publication', expect.any(Function));
    unmount();
    expect(mockClient.removeSubscription).toHaveBeenCalledWith(existing);
  });
});
