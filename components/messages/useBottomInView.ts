'use client';

/**
 * 스레드 하단 센티널이 **실제로 화면에 걸려 있는가**.
 *
 * `useMarkReadWhileVisible` 의 두 번째 게이트(`isOnScreen`)를 먹인다. 탭이
 * 보이는 것만으로는 최신 메시지를 봤다는 뜻이 아니다 — 긴 대화를 위로 올려
 * 과거 글을 읽는 중에 도착한 메시지는 화면에 없고, 그걸 읽음으로 치면 상대에게
 * 거짓 읽음 영수증이 나간다.
 *
 * 관찰 대상은 말풍선 하나하나가 아니라 목록 맨 끝의 센티널(`bottomRef`)이다.
 * 센티널이 보인다 = 최신 메시지가 화면 안에 있다. 메시지마다 관찰자를 다는 것에
 * 비해 관찰 대상이 1개로 고정되고(수백 개 말풍선에 옵저버가 붙지 않는다),
 * `useStickToBottom` 이 이미 그 센티널을 스크롤 타깃으로 쓰고 있어 공짜다.
 *
 * 판정을 state 가 아니라 **predicate** 로 돌려준다 — 스크롤할 때마다 setState 를
 * 하면 말풍선 목록이 통째로 리렌더된다. 읽음 판정은 이벤트 시점에 한 번 묻는
 * 값이라 렌더에 실을 이유가 없다.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

export function useBottomInView({
  rootRef,
  targetRef,
  onEnter,
}: {
  /** 스크롤 컨테이너. 뷰포트가 아니라 이 안에서의 가시성을 본다. */
  rootRef: RefObject<HTMLElement | null>;
  /** 목록 맨 끝 센티널. */
  targetRef: RefObject<HTMLElement | null>;
  /** 센티널이 보이지 않다가 다시 보이게 된 순간(만회 트리거). */
  onEnter: () => void;
}): () => boolean {
  // 첫 보고 전에는 **보인다**로 본다 — 스레드는 열릴 때 하단으로 스크롤되므로
  // (useStickToBottom) 최신 메시지가 화면에 있는 상태로 시작한다. false 로
  // 시작하면 여는 순간의 읽음 처리가 통째로 막힌다.
  const inViewRef = useRef(true);
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  });

  // 관찰은 ref 객체가 아니라 **실제 노드**를 따라간다. ThreadView 의 tabs 변형은
  // RFP·파일 탭을 다녀오면 목록과 센티널을 새로 마운트하는데 ref 객체는 그대로라
  // deps 로는 그 교체를 볼 수 없다 — 떨어져 나간 옛 노드를 계속 보면 게이트가 실제
  // 화면을 영영 따라가지 못한다. 그래서 커밋마다 노드 동일성만 비교한다(같으면 끝).
  const boundRef = useRef<{ target: HTMLElement; observer: IntersectionObserver } | null>(null);

  useEffect(() => {
    // 관찰자가 없는 환경(구형 브라우저·일부 테스트)에서는 게이트를 **열어 둔다**.
    // 닫으면 읽음 처리가 아예 돌지 않아 원래 VoC(배지가 안 꺼짐)가 그대로
    // 돌아온다 — 거짓 영수증보다 그쪽이 확실한 회귀다.
    if (typeof IntersectionObserver === 'undefined') {
      inViewRef.current = true;
      return;
    }
    const target = targetRef.current;
    const bound = boundRef.current;
    if (bound?.target === target) return;

    bound?.observer.disconnect();
    boundRef.current = null;
    // 목록이 마운트돼 있지 않다 = 다른 탭이 보이는 중이다. 도착한 메시지는 눈에
    // 보일 수 없으므로 게이트를 닫는다.
    if (!target) {
      inViewRef.current = false;
      return;
    }
    // 다시 붙을 때는 '안 보임'에서 시작한다 — 첫 보고가 '보임'이면 그 전이가 만회를
    // 부른다. 처음 붙을 때만 '보임'에서 시작한다(스레드는 하단으로 스크롤된 채 열린다).
    if (bound) inViewRef.current = false;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const was = inViewRef.current;
          inViewRef.current = entry.isIntersecting;
          // 전이에서만 발화한다 — 스크롤 중 관찰자는 같은 값을 여러 번 보고하고,
          // 매번 부르면 만회가 디바운스를 무의미하게 만든다.
          if (!was && entry.isIntersecting) onEnterRef.current();
        }
      },
      { root: rootRef.current ?? null },
    );
    observer.observe(target);
    boundRef.current = { target, observer };
  });

  useEffect(
    () => () => {
      boundRef.current?.observer.disconnect();
      boundRef.current = null;
    },
    [],
  );

  return useCallback(() => inViewRef.current, []);
}
