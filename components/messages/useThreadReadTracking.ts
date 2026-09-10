'use client';

/**
 * 스레드 읽음 추적 — 두 게이트(탭 가시성 + 최신 메시지 화면 노출)를 하나로 묶어
 * ThreadView·TeamThreadView 에 같은 규칙을 먹인다.
 *
 * 두 훅을 직접 조립하면 **순환**이 생긴다: 관찰자의 `onEnter` 는 읽음 훅의
 * `resume` 을 불러야 하는데, 읽음 훈의 `isOnScreen` 은 관찰자의 술어를 받아야
 * 한다. 선언 순서로는 풀 수 없어 ref 를 한 번 거쳐야 하고, 그 우회를 호출처
 * 두 곳에 복사하면 순서를 잘못 바꾼 사람이 조용히 게이트를 깨뜨린다. 그래서
 * 여기 한 곳에서만 조립한다.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { useMarkReadWhileVisible } from '@/lib/hooks/useMarkReadWhileVisible';
import { useBottomInView } from './useBottomInView';

type ReadBoundary = { id: string; createdAt: string };

function newestBoundary(
  current: ReadBoundary | undefined,
  candidate: ReadBoundary | undefined,
): ReadBoundary | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentAt = Date.parse(current.createdAt);
  const candidateAt = Date.parse(candidate.createdAt);
  if (!Number.isFinite(currentAt) || candidateAt >= currentAt) return candidate;
  return current;
}

export function useThreadReadTracking({
  threadKey,
  initialBoundary,
  run,
  listRef,
  bottomRef,
}: {
  /** 스레드 식별자(conversationId 또는 rfpId). 바뀌면 새 스레드로 본다. */
  threadKey: string;
  /** 서버가 검증할, 화면에 이미 그려진 마지막 메시지. */
  initialBoundary?: ReadBoundary;
  run: (key: string, throughMessageId: string) => void;
  /** 메시지 목록 스크롤 컨테이너. */
  listRef: RefObject<HTMLElement | null>;
  /** 목록 맨 끝 센티널 — 이게 보이면 최신 메시지가 화면에 있다. */
  bottomRef: RefObject<HTMLElement | null>;
}): (boundary: ReadBoundary) => void {
  // 순환을 끊는 유일한 ref. 관찰자는 이걸 통해 아래에서 만들어지는 resume 에
  // 닿는다(마운트 시점엔 no-op, 커밋 후 채워진다).
  const resumeRef = useRef<() => void>(() => {});
  const boundaryRef = useRef(initialBoundary);
  const boundaryThreadKeyRef = useRef(threadKey);
  useEffect(() => {
    if (boundaryThreadKeyRef.current !== threadKey) {
      boundaryThreadKeyRef.current = threadKey;
      boundaryRef.current = initialBoundary;
      return;
    }
    boundaryRef.current = newestBoundary(boundaryRef.current, initialBoundary);
  }, [threadKey, initialBoundary]);

  const isBottomInView = useBottomInView({
    rootRef: listRef,
    targetRef: bottomRef,
    onEnter: useCallback(() => resumeRef.current(), []),
  });

  const { markRead, resume } = useMarkReadWhileVisible({
    key: threadKey,
    run: (key) => {
      const boundary = boundaryRef.current;
      if (boundary) run(key, boundary.id);
    },
    isOnScreen: isBottomInView,
  });

  useEffect(() => {
    resumeRef.current = resume;
  });

  return useCallback((boundary: ReadBoundary) => {
    boundaryRef.current = newestBoundary(boundaryRef.current, boundary);
    markRead();
  }, [markRead]);
}
