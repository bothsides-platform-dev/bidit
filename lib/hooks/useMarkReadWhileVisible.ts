'use client';

/**
 * 스레드가 열려 **보이는 동안** 읽음 cursor 를 계속 전진시킨다.
 *
 * 예전 ThreadView/TeamThreadView 는 마운트 1회만 읽음 처리했다. 그래서 대화창을
 * 켜 둔 채 새 메시지를 받으면 말풍선은 즉시 그려지는데 cursor 는 그대로였고,
 * 인박스 배지가 안 꺼지고 상대에게 읽음 영수증도 가지 않았다.
 *
 * **visibility 게이트가 load-bearing 이다.** 빼면 백그라운드 탭이 상대에게 거짓
 * 읽음 영수증을 보낸다("읽었다"는 사람이 봤다는 뜻이어야 한다). 숨어 있는 동안
 * 도착한 것은 눌러 뒀다가 다시 보일 때 **한 번** 만회한다.
 *
 * focus 가 아니라 visibility 를 보는 이유: 창 두 개를 나란히 띄운 사용자는
 * 포커스가 없어도 대화를 실제로 보고 있다. 반대로 숨은 탭은 확실히 못 본다.
 */
import { useCallback, useEffect, useRef } from 'react';

/** 수다스러운 상대가 액션 폭주를 만들지 않도록 트레일링 디바운스. */
export const MARK_READ_DEBOUNCE_MS = 300;

export function useMarkReadWhileVisible({
  key,
  run,
}: {
  /** 스레드 식별자. 바뀌면 새 스레드로 보고 다시 읽음 처리한다. */
  key: string;
  run: (key: string) => void;
}): () => void {
  const runRef = useRef(run);
  const keyRef = useRef(key);
  // 렌더 중 ref 를 쓰면 React Compiler 규칙 위반이라 커밋 후에 맞춘다. 소비자는
  // 전부 예약된 타이머 안이라 이 시점이면 충분하다.
  useEffect(() => {
    runRef.current = run;
    keyRef.current = key;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 숨어 있는 동안 놓친 요청 — 다시 보일 때 한 번으로 접어 만회한다.
  const missedWhileHiddenRef = useRef(false);

  const isHidden = (): boolean =>
    typeof document !== 'undefined' && document.visibilityState !== 'visible';

  const runNow = useCallback((readKey: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    missedWhileHiddenRef.current = false;
    runRef.current(readKey);
  }, []);

  /** 도착 신호 — 버스트를 한 번으로 접는다. */
  const markRead = useCallback(() => {
    if (isHidden()) {
      missedWhileHiddenRef.current = true;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      missedWhileHiddenRef.current = false;
      runRef.current(keyRef.current);
    }, MARK_READ_DEBOUNCE_MS);
  }, []);

  // 마운트 + 스레드 전환은 **즉시** — 여는 행위 자체가 이미 "봤다"이고, 여기서
  // 디바운스를 기다리면 상대의 읽음 영수증도 그만큼 늦는다. 대기 중이던 이전
  // 스레드의 예약은 runNow 가 취소하므로 새 대화에 잘못 실리지 않는다.
  useEffect(() => {
    if (isHidden()) {
      missedWhileHiddenRef.current = true;
      return;
    }
    runNow(key);
  }, [key, runNow]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (!missedWhileHiddenRef.current) return;
      runNow(keyRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [runNow]);

  // 언마운트 시 예약 취소 — 떠난 화면이 뒤늦게 읽음을 보내지 않는다.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return markRead;
}
