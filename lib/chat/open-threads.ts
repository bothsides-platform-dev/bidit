'use client';

/**
 * 지금 화면에 열려 있는 대화 스레드 — 알림 토스트를 억제할 근거.
 *
 * 사용자가 그 대화를 보고 있는데 같은 메시지를 토스트로 또 알리는 것은 중복
 * 신호다(VoC "대화에 사용자가 있는데도 알림이 가고"). 판정 키는 알림 행이
 * 들고 있는 것과 **같은 스레드 링크**다 — 단일 출처는 `lib/chat/thread-link.ts`.
 *
 * React context 가 아니라 모듈 레벨 레지스트리인 이유: 알림 스트림은 앱 셸에서
 * 돌고 스레드는 트리 깊은 곳(딜룸 모달 안 포함)에 있어, 둘을 잇는 공통 조상이
 * 라우트 레이아웃뿐이다. 신호가 사이드바 마운트 여부에 종속되면 모바일에서
 * 조용히 죽는다.
 *
 * 참조 카운트인 이유: 같은 스레드가 동시에 두 곳에 마운트될 수 있다(/messages
 * 와 딜룸 레일). 하나가 언마운트할 때 열림이 꺼지면 남은 화면에 토스트가 뜬다.
 */

import { useEffect } from 'react';

const openCounts = new Map<string, number>();

/** 스레드를 '열림'으로 등록한다. 반환된 함수를 언마운트에서 호출한다(멱등). */
export function registerOpenThread(threadLinkUrl: string): () => void {
  openCounts.set(threadLinkUrl, (openCounts.get(threadLinkUrl) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (openCounts.get(threadLinkUrl) ?? 1) - 1;
    if (next <= 0) openCounts.delete(threadLinkUrl);
    else openCounts.set(threadLinkUrl, next);
  };
}

/** 마운트되어 있는 동안 그 스레드를 '열림'으로 유지한다. */
export function useOpenThreadRegistration(threadLinkUrl: string): void {
  useEffect(() => registerOpenThread(threadLinkUrl), [threadLinkUrl]);
}

/** 그 링크의 스레드가 지금 열려 있는가. 모르는 링크는 `false`(= 토스트한다). */
export function isThreadOpen(threadLinkUrl: string | undefined): boolean {
  if (!threadLinkUrl) return false;
  return (openCounts.get(threadLinkUrl) ?? 0) > 0;
}
