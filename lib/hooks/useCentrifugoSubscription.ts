'use client';

/**
 * useCentrifugoSubscription — shared Centrifugo channel-subscription lifecycle.
 *
 * Extracted from useChatChannel / useTeamChannel, which had byte-identical
 * connect/subscribe/cleanup boilerplate. Owns: the graceful no-op when realtime
 * is unconfigured, the getSubscription-or-newSubscription handle, publication
 * routing, connected-state tracking, and the subtle cleanup (unsubscribe +
 * removeSubscription so a remount of the same channel gets a fresh handler set
 * instead of double-registering — fires onPublication twice otherwise).
 *
 * Channel-specific concerns stay with the caller: presence (join/leave/
 * subscribed → presenceStats via `subRef`), typing timers, and client publishes
 * (sendTyping via `subRef`). The caller passes the channel string it computes,
 * so the subscribe effect re-runs exactly when the channel identity changes.
 *
 * Graceful no-op (load-bearing): getCentrifuge() returns null when
 * NEXT_PUBLIC_CENTRIFUGO_WS_URL is unset (dev + every test) — no connect, no
 * subscribe, no throw; connected stays null. `connected` means this channel's
 * subscription is ready, not merely that the shared socket is connected.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PublicationContext, Subscription } from 'centrifuge';

import { getCentrifuge } from '@/lib/realtime/centrifuge-client';
import { managedSubscribe } from '@/lib/realtime/managed-subscribe';

export type CentrifugoSubscriptionOptions = {
  // 구독 핸들 노출 — presence(presenceStats)·publish 등 채널별 동작을 소비처가 수행.
  subRef?: MutableRefObject<Subscription | null>;
  onPublication?: (ctx: PublicationContext) => void;
  // presence 신호 — 제공한 이벤트만 등록한다(team 채널은 presence 없음).
  onSubscribed?: () => void;
  onJoin?: () => void;
  onLeave?: () => void;
};

export type UseCentrifugoSubscriptionResult = {
  connected: boolean | null;
};

export function useCentrifugoSubscription(
  channel: string,
  options: CentrifugoSubscriptionOptions,
): UseCentrifugoSubscriptionResult {
  const [connected, setConnected] = useState<boolean | null>(null);

  // 콜백을 ref 로 들고 매 렌더 갱신 — 핸들러가 바뀌어도 재구독하지 않는다.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const client = getCentrifuge();
    // 미설정 realtime → graceful no-op.
    if (!client) return;

    // managedSubscribe handles getSubscription-or-new, registers handlers,
    // calls sub.subscribe(), and returns { sub, dispose }.
    // We use sub directly for subRef so there's no duplicate lookup.
    // publication is always registered via a ref-wrapper (original behavior).
    // presence 핸들러는 제공된 것만 등록 — team 채널은 join/leave/subscribed 미등록.
    const subRef = optionsRef.current.subRef;
    const { sub, dispose: disposeSubscription } = managedSubscribe(client, channel, {
      onPublication: (ctx: PublicationContext) => optionsRef.current.onPublication?.(ctx),
      onSubscribed: optionsRef.current.onSubscribed
        ? () => optionsRef.current.onSubscribed?.()
        : undefined,
      onJoin: optionsRef.current.onJoin
        ? () => optionsRef.current.onJoin?.()
        : undefined,
      onLeave: optionsRef.current.onLeave
        ? () => optionsRef.current.onLeave?.()
        : undefined,
    });
    if (subRef) subRef.current = sub;

    const onSubscriptionState = (ctx: { newState: string }) => {
      setConnected(ctx.newState === 'subscribed');
    };
    sub.on('state', onSubscriptionState);
    if (sub.state === 'subscribed') setConnected(true);

    client.connect();

    return () => {
      sub.off('state', onSubscriptionState);
      disposeSubscription();
      if (subRef) subRef.current = null;
    };
  }, [channel]);

  return { connected };
}
