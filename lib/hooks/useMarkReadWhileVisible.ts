'use client';

/**
 * 스레드가 열려 있고 **최신 메시지가 실제로 화면에 있는 동안** 읽음 cursor 를
 * 전진시킨다.
 *
 * 예전 ThreadView/TeamThreadView 는 마운트 1회만 읽음 처리했다. 그래서 대화창을
 * 켜 둔 채 새 메시지를 받으면 말풍선은 즉시 그려지는데 cursor 는 그대로였고,
 * 인박스 배지가 안 꺼지고 상대에게 읽음 영수증도 가지 않았다.
 *
 * 게이트는 **둘**이고 둘 다 load-bearing 이다. "읽었다"는 사람이 봤다는 뜻이어야
 * 하고, 둘 중 하나만으로는 거짓말이 된다:
 *
 *   1) **탭이 보이는가**(`document.visibilityState`). 없으면 백그라운드 탭이
 *      상대에게 거짓 읽음 영수증을 보낸다.
 *   2) **최신 메시지가 화면에 있는가**(`isOnScreen`). 없으면 긴 대화를 위로
 *      올려 과거 글을 읽는 중에 도착한 — 눈에 보이지도 않은 — 메시지가 읽음이
 *      된다. 탭은 보이고 있으므로 1)로는 절대 못 잡는 절반이다.
 *
 * focus 가 아니라 visibility 를 보는 이유: 창 두 개를 나란히 띄운 사용자는
 * 포커스가 없어도 대화를 실제로 보고 있다. 반대로 숨은 탭은 확실히 못 본다.
 *
 * 어느 게이트에 막혔든 놓친 요청은 하나의 플래그에 눌러 뒀다가, 막았던 조건이
 * 풀릴 때(탭 복귀 또는 `resume()`) **한 번**으로 접어 만회한다.
 */
import { useCallback, useEffect, useRef } from 'react';

/** 수다스러운 상대가 액션 폭주를 만들지 않도록 트레일링 디바운스. */
export const MARK_READ_DEBOUNCE_MS = 300;

export type MarkReadWhileVisible = {
  /** 도착 신호 — 버스트를 한 번으로 접는다. */
  markRead: () => void;
  /**
   * 화면 게이트가 풀렸다(최신 메시지가 다시 보인다). 눌러 둔 요청이 있으면
   * 그때 만회한다. 없으면 아무 일도 하지 않는다.
   */
  resume: () => void;
};

export function useMarkReadWhileVisible({
  key,
  run,
  isOnScreen,
}: {
  /** 스레드 식별자. 바뀌면 새 스레드로 보고 다시 읽음 처리한다. */
  key: string;
  run: (key: string) => void;
  /**
   * 최신 메시지가 화면에 있는가. 생략하면 항상 참으로 본다 — 관찰자를 붙이지
   * 않은 호출자는 예전과 같이 동작한다.
   *
   * 관찰자가 아직 첫 보고를 하기 전(마운트 직후)에는 호출자가 참을 돌려주는
   * 것이 맞다: 스레드는 열릴 때 하단으로 스크롤되므로 최신 메시지가 화면에
   * 있는 상태로 시작한다(`useStickToBottom` 의 초기 동작).
   */
  isOnScreen?: () => boolean;
}): MarkReadWhileVisible {
  const runRef = useRef(run);
  const keyRef = useRef(key);
  const isOnScreenRef = useRef(isOnScreen);
  // 렌더 중 ref 를 쓰면 React Compiler 규칙 위반이라 커밋 후에 맞춘다. 소비자는
  // 전부 예약된 타이머·이벤트 핸들러 안이라 이 시점이면 충분하다.
  useEffect(() => {
    runRef.current = run;
    keyRef.current = key;
    isOnScreenRef.current = isOnScreen;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 게이트에 막혀 놓친 요청 — 풀릴 때 한 번으로 접어 만회한다.
  const missedRef = useRef(false);

  /** 지금 읽음으로 쳐도 되는가 — 두 게이트를 모두 통과해야 한다. */
  const canMarkRead = useCallback((): boolean => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return false;
    }
    return isOnScreenRef.current?.() ?? true;
  }, []);

  const runNow = useCallback((readKey: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    missedRef.current = false;
    runRef.current(readKey);
  }, []);

  const markRead = useCallback(() => {
    if (!canMarkRead()) {
      missedRef.current = true;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      missedRef.current = false;
      runRef.current(keyRef.current);
    }, MARK_READ_DEBOUNCE_MS);
  }, [canMarkRead]);

  /** 막혔던 조건이 풀렸을 때의 공통 만회 경로(탭 복귀·화면 복귀 공용). */
  const catchUp = useCallback(() => {
    if (!missedRef.current) return;
    if (!canMarkRead()) return;
    runNow(keyRef.current);
  }, [canMarkRead, runNow]);

  // 마운트 + 스레드 전환은 **즉시** — 여는 행위 자체가 이미 "봤다"이고, 여기서
  // 디바운스를 기다리면 상대의 읽음 영수증도 그만큼 늦는다. 대기 중이던 이전
  // 스레드의 예약은 runNow 가 취소하므로 새 대화에 잘못 실리지 않는다.
  useEffect(() => {
    if (!canMarkRead()) {
      missedRef.current = true;
      return;
    }
    runNow(key);
  }, [key, canMarkRead, runNow]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      catchUp();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [catchUp]);

  // 언마운트 시 예약 취소 — 떠난 화면이 뒤늦게 읽음을 보내지 않는다.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return { markRead, resume: catchUp };
}
