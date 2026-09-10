'use client';

/**
 * useNotifications — Sidebar 배지와 알림 페이지 리스트가 같은 알림 상태를
 * 공유하는 클라이언트 훅. 핵심 결정(advisor):
 *
 *   1) **module-scoped Zustand store** — 같은 페이지에 여러 consumer(Sidebar
 *      배지 + 알림 리스트)가 있어도 상태는 단일 인스턴스.
 *   2) **EventSource ref-count singleton** — 첫 mount 시 1회 open, 마지막
 *      consumer가 unmount 될 때 close. 탭당 SSE 연결 1개 보장.
 *      cookie 자동 동봉(advisor pin 7: same-origin) — auth 별도 처리 불필요.
 *   3) **GET /api/notifications**로 history hydrate, **EventSource**로 신규
 *      prepend (advisor pin 5).
 *   4) 액션은 'use server' import 그대로 호출 — payload는 작아 전송 비용 무시.
 */
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import { canMarkRead, isUnread, type Notification } from '@/lib/types/notification';
import { http } from '@/lib/http';
import { toast } from '@/lib/toast';
import { isThreadOpen } from '@/lib/chat/open-threads';
import { markNotificationReadAction } from '@/lib/server/actions/notifications/markNotificationReadAction';
import { markAllReadAction } from '@/lib/server/actions/notifications/markAllReadAction';
import { retryEmailNotificationAction } from '@/lib/server/actions/notifications/retryEmailNotificationAction';

type NotifStore = {
  notifications: Notification[];
  status: 'idle' | 'loading' | 'live' | 'error';
  setAll: (list: Notification[]) => void;
  prepend: (n: Notification) => void;
  setStatus: (s: NotifStore['status']) => void;
  patchOne: (id: string, patch: Partial<Notification>) => void;
  markAllReadLocal: () => void;
};

// 읽음 직후 history/SSE가 늦게 도착해 예전 pending 스냅샷을 되살리지 않도록
// 스레드별 로컬 상한을 둔다. 서버의 markChatThreadRead(readThrough)와 같은 경계다.
const threadReadWatermarks = new Map<string, number>();

function applyThreadReadWatermark(notification: Notification): Notification {
  if (!notification.linkUrl || !canMarkRead(notification)) return notification;
  const watermark = threadReadWatermarks.get(notification.linkUrl);
  const createdAt = Date.parse(notification.createdAt);
  if (watermark === undefined || !Number.isFinite(createdAt) || createdAt > watermark) {
    return notification;
  }
  return {
    ...notification,
    status: 'read',
    readAt: new Date(watermark).toISOString(),
  };
}

const useStore = create<NotifStore>((set) => ({
  notifications: [],
  status: 'idle',
  setAll: (list) => set({ notifications: list.map(applyThreadReadWatermark) }),
  prepend: (n) =>
    set((s) => ({
      // dedupe — 동일 id가 이미 있으면 무시(서버 재구독 race 등).
      notifications: s.notifications.some((x) => x.id === n.id)
        ? s.notifications
        : [applyThreadReadWatermark(n), ...s.notifications],
    })),
  setStatus: (status) => set({ status }),
  patchOne: (id, patch) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, ...patch } : n,
      ),
    })),
  // `isUnread` 가 아니라 `canMarkRead` 다 — 서버의 markAllRead 는 `read_at IS NULL`
  // 을 전부 지우므로, 로컬 패치가 그보다 좁으면 실패 알림이 서버에서는 읽음인데
  // 화면에서는 안 읽음으로 남아 다음 하이드레이트까지 어긋난다.
  markAllReadLocal: () =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        canMarkRead(n)
          ? { ...n, status: 'read', readAt: new Date().toISOString() }
          : n,
      ),
    })),
}));

/** 스토어 직접 검사용 — 테스트 전용(훅 밖에서 상태를 읽는 유일한 경로). */
export const useNotificationStoreForTest = useStore;

/**
 * 한 스레드의 알림을 **로컬에서** 읽음으로 내린다 — 서버의 markChatThreadRead 와
 * 짝. 없으면 그 대화를 보고 있는 동안 토스트만 안 뜨고 사이드바 배지는 계속
 * 올라가 새로고침 전까지 남는다(스토어는 마운트 1회만 hydrate 한다).
 *
 * 낙관적이어도 안전하다 — 서버가 곧바로 같은 행을 같은 기준으로 쓴다.
 */
export function markThreadReadLocal(
  threadLinkUrl: string,
  serverReadAt: string,
): void {
  const readThrough = Date.parse(serverReadAt);
  if (!Number.isFinite(readThrough)) return;
  threadReadWatermarks.set(
    threadLinkUrl,
    Math.max(threadReadWatermarks.get(threadLinkUrl) ?? 0, readThrough),
  );
  const readAt = new Date(readThrough).toISOString();
  useStore.setState((s) => ({
    notifications: s.notifications.map((n) =>
      n.linkUrl === threadLinkUrl && canMarkRead(n)
        ? { ...n, status: 'read' as const, readAt }
        : n,
    ),
  }));
}

// 팬아웃 폭주(예: 다수 수신자 award/close, 수다스러운 상대방)로 짧은 시간에
// 알림이 몰리면 toast 가 줄줄이 큐에 쌓여 수 분간 흘러나온다. 이 윈도우 안에는
// toast 를 1회만 발화해 storm 을 막는다. 미읽음 배지는 그대로 모두 증가한다.
const TOAST_COALESCE_MS = 4000;
let lastToastAt = 0;

// 사용자가 이미 알림 목록(/notifications)을 보고 있으면 toast 는 같은 항목의
// 중복 신호이므로 생략한다.
function onNotificationsRoute(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/notifications')
  );
}

// 새 라이브 알림에 대해 경로 게이트 + coalesce 를 적용해 toast 를 발화한다.
function maybeToastNew(n: Notification): void {
  if (onNotificationsRoute()) return;
  // 그 스레드를 지금 보고 있으면 토스트는 중복 신호다 — 메시지는 이미 눈앞에
  // 말풍선으로 도착했다. 판정 키는 알림 행이 든 스레드 링크 그대로다.
  if (isThreadOpen(n.linkUrl)) return;
  const now = Date.now();
  if (now - lastToastAt < TOAST_COALESCE_MS) return;
  lastToastAt = now;
  toast(n.title);
}

/**
 * 라이브 알림 구독 — 알림을 **신호**로 쓰는 화면을 위한 좁은 구멍.
 *
 * 스토어를 셀렉터로 읽는 것과 다르다: 스토어에는 history hydrate 로 들어온 과거
 * 알림이 섞여 있어서, 그걸 보고 반응하면 어제의 알림이 오늘 화면을 즉시 건드린다.
 * 여기로는 **이번 연결에서 새로 도착한 것만** 흐른다(toast dedupe 와 같은 판정).
 *
 * 첫 소비자: 딜룸 계약 탭이 '발송 리스를 뺏겼다' 알림을 받아 열려 있는 임베드를
 * 즉시 내린다 — 스노우싸인에 세션 취소 API 가 없어 그게 실제 차단이다.
 */
const liveListeners = new Set<(n: Notification) => void>();

export function subscribeToLiveNotifications(fn: (n: Notification) => void): () => void {
  liveListeners.add(fn);
  // **구독이 스트림을 연다.** Set 에 넣기만 하면, 스트림을 여는 유일한 곳인
  // `useNotifications()` 가 마운트돼 있는지에 신호가 종속된다 — 그 훅의 앱 전역
  // 마운트는 사이드바 하나뿐이고, 모바일에서 사이드바는 Sheet(포털, keepMounted
  // 없음) 안이라 서랍이 닫혀 있으면 마운트 자체가 없다. 그러면 딜룸의 즉시 차단
  // 신호가 모바일에서 통째로 죽는다(하트비트 60초만 남는다).
  //
  // 훅과 **같은 ref-count** 를 쓴다 — 따로 세면 구독 해제가 사이드바의 스트림을 끊는다.
  // history 는 당기지 않는다: 신호만 필요한 소비자에게 목록은 불필요한 요청이다.
  subscribers += 1;
  openStream();
  return () => {
    liveListeners.delete(fn);
    subscribers -= 1;
    if (subscribers <= 0) {
      subscribers = 0;
      closeStream();
    }
  };
}

function emitLive(n: Notification): void {
  for (const fn of liveListeners) {
    // 한 구독자가 던져도 스트림과 다른 구독자를 죽이지 않는다 — onmessage 안에서
    // 터지면 그 뒤 알림이 통째로 사라진다.
    try {
      fn(n);
    } catch {
      // 구독자 쪽 문제는 구독자가 처리한다.
    }
  }
}

// ── Singleton EventSource + history fetch (ref-counted) ────────────────
let subscribers = 0;
let eventSource: EventSource | null = null;
let historyLoaded = false;
// 현재 싱글톤이 들고 있는 워크스페이스. 워크스페이스를 전환하면 이전 ws의
// 알림/구독이 그대로 남아 stale 해지므로(Phase 7b 버그), 키가 바뀔 때 리셋한다.
let activeWorkspaceId: string | undefined;

async function loadHistory(): Promise<void> {
  if (historyLoaded) return;
  historyLoaded = true;
  // 이 fetch 가 속한 워크스페이스를 고정한다. 전환 중이면 이전 ws 요청이 아직
  // in-flight 인 채로 새 ws fetch 가 시작되고, 둘이 역순으로 도착할 수 있다.
  // 응답이 돌아왔을 때 activeWorkspaceId 가 바뀌었으면 stale 응답이므로 버린다
  // (안 그러면 늦게 온 이전 ws 알림이 새 ws 를 덮어써 다시 stale 해진다 — TOCTOU).
  const fetchWorkspaceId = activeWorkspaceId;
  try {
    useStore.getState().setStatus('loading')
    const data = await http
      .get('/api/notifications')
      .json<{ notifications: Notification[] }>()
    if (activeWorkspaceId !== fetchWorkspaceId) return;
    useStore.getState().setAll(data.notifications)
  } catch {
    if (activeWorkspaceId !== fetchWorkspaceId) return;
    useStore.getState().setStatus('error')
    historyLoaded = false
  }
}

function openStream(): void {
  if (eventSource) return;
  // EventSource는 same-origin이면 cookie 자동 동봉(withCredentials는 cross-
  // origin에서만 의미). 401이면 onerror에서 status 갱신 후 close.
  const es = new EventSource('/api/notifications/stream');
  eventSource = es;
  es.onopen = () => useStore.getState().setStatus('live');
  es.onmessage = (ev) => {
    try {
      const n = JSON.parse(ev.data) as Notification;
      // 재구독 race 등으로 동일 id가 다시 올 수 있다. prepend 는 자체 dedupe 하므로,
      // 중복일 때 toast 가 발화하지 않도록 prepend 전에 신규 여부를 판정한다.
      // (history hydrate 는 setAll 경로라 이 핸들러를 거치지 않아 자연히 toast 되지 않는다.)
      const isNew = !useStore
        .getState()
        .notifications.some((x) => x.id === n.id);
      useStore.getState().prepend(n);
      if (isNew) {
        maybeToastNew(n);
        emitLive(n);
      }
    } catch {
      // ignore malformed payload
    }
  };
  es.onerror = () => {
    useStore.getState().setStatus('error');
    // 브라우저가 자동 재연결 시도하므로 close 안 함. 단, 서버가 401로
    // 응답한 경우 onerror 후 readyState===CLOSED — 그 경우만 정리.
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      if (eventSource === es) eventSource = null;
    }
  };
}

function closeStream(): void {
  if (!eventSource) return;
  eventSource.close();
  eventSource = null;
  historyLoaded = false;
  useStore.getState().setStatus('idle');
}

// 워크스페이스가 바뀌면 이전 ws의 캐시·구독을 버리고 깨끗한 상태로 되돌린다.
// (ref-count 는 건드리지 않는다 — 같은 mount들이 새 ws로 다시 hydrate 한다.)
function resetForWorkspace(workspaceId: string | undefined): void {
  if (workspaceId === activeWorkspaceId) return;
  // **아직 워크스페이스를 모르는 상태면 버릴 것이 없다 — 채택만 한다.**
  // `subscribeToLiveNotifications` 는 workspaceId 를 모른 채 스트림을 연다(딜룸이
  // 임베드를 열며 구독하고, 사이드바는 그 뒤에 마운트된다 — 모바일에선 서랍을 그때
  // 연다). 그 스트림을 '남의 ws 것' 으로 보고 끊으면, 재연결하는 사이 도착한 이어받기
  // 신호가 사라진다(재생이 없다). 그 신호가 곧 실제 차단이라 60초 하트비트 폴백만 남는다.
  // 첫 채택 시점엔 eventSource 만 있고 캐시는 비어 있으므로 정리할 것도 없다.
  const adoptingFirstWorkspace = activeWorkspaceId === undefined;
  activeWorkspaceId = workspaceId;
  if (adoptingFirstWorkspace) {
    // 스트림은 살려 두되 **`historyLoaded` 는 반드시 내린다.** `loadHistory` 는 응답을
    // 받을 때 `activeWorkspaceId` 가 바뀌었으면 버리는데, 이 값을 바꾸는 곳이 여기뿐이던
    // 시절엔 아래 teardown 이 항상 함께 내려 곧바로 다시 받아왔다. 조기 반환이 값만 바꾸고
    // 빠져나가면 진행 중이던 fetch 가 폐기되고 **아무도 재요청하지 않는다** — 목록이
    // 영구히 빈 채 'loading' 에 갇힌다(설정 페이지 로딩 중 모바일 서랍을 여는 동선).
    // 호출 직후 이어지는 loadHistory() 가 이제 알게 된 ws 로 다시 받아온다.
    historyLoaded = false;
    return;
  }
  threadReadWatermarks.clear();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  historyLoaded = false;
  useStore.getState().setAll([]);
  useStore.getState().setStatus('idle');
}

export function useNotifications(workspaceId?: string) {
  const notifications = useStore((s) => s.notifications);
  const status = useStore((s) => s.status);

  useEffect(() => {
    // 워크스페이스 전환 감지 → 싱글톤 리셋 후 새 ws용으로 다시 hydrate.
    if (workspaceId !== undefined) resetForWorkspace(workspaceId);
    subscribers += 1;
    void loadHistory();
    openStream();
    return () => {
      subscribers -= 1;
      if (subscribers <= 0) {
        subscribers = 0;
        closeStream();
      }
    };
  }, [workspaceId]);

  const markRead = useCallback(async (id: string) => {
    // optimistic — server roundtrip 후 실패하면 최악으로도 unread 복구는
    // 다음 history fetch에서 자연 정정됨.
    useStore.getState().patchOne(id, {
      status: 'read',
      readAt: new Date().toISOString(),
    });
    await markNotificationReadAction({ notificationId: id });
  }, []);

  const markAllRead = useCallback(async () => {
    useStore.getState().markAllReadLocal();
    await markAllReadAction();
  }, []);

  const retryEmail = useCallback(async (id: string) => {
    return retryEmailNotificationAction({ notificationId: id });
  }, []);

  // 판정식은 lib/types/notification.ts 단일 출처 — 사이드바 배지와 알림 페이지
  // 헤더 칩이 같은 정의를 써야 두 숫자가 같은 것을 센다.
  const unreadCount = notifications.filter(isUnread).length;

  return {
    notifications,
    unreadCount,
    status,
    markRead,
    markAllRead,
    retryEmail,
  };
}
