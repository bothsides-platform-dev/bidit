// useBottomInView — 스레드 하단 센티널이 실제로 뷰포트에 걸려 있는지.
//
// "읽음"의 두 번째 게이트(useMarkReadWhileVisible 의 isOnScreen)를 먹인다.
// 탭이 보이는 것만으로는 최신 메시지를 봤다는 뜻이 아니다 — 긴 대화를 위로
// 올려둔 채 받은 메시지는 화면에 없다.
//
// 판정을 state 가 아니라 **predicate(ref)** 로 돌려주는 이유: 메시지가 도착할
// 때마다 스크롤 위치로 리렌더를 유발하면 말풍선 목록이 통째로 다시 그려진다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';

import { useBottomInView } from '../useBottomInView';

type Cb = (entries: { isIntersecting: boolean }[]) => void;

const observers: IntersectionObserverStub[] = [];

class IntersectionObserverStub {
  observed: unknown[] = [];
  disconnected = false;
  constructor(readonly cb: Cb) {
    observers.push(this);
  }
  observe(el: unknown): void {
    this.observed.push(el);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean): void {
    this.cb([{ isIntersecting }]);
  }
}

function harness(onEnter: () => void) {
  return renderHook(() => {
    const rootRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLDivElement>(null);
    // jsdom 에서는 ref 가 비어 있으므로 실제 엘리먼트를 붙여 관찰이 일어나게 한다.
    if (!rootRef.current) rootRef.current = document.createElement('div');
    if (!targetRef.current) targetRef.current = document.createElement('div');
    return useBottomInView({ rootRef, targetRef, onEnter });
  });
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBottomInView', () => {
  it('treats the bottom as in view before the observer has reported', () => {
    // 스레드는 열릴 때 하단으로 스크롤된다(useStickToBottom). 첫 보고 전에
    // false 를 돌려주면 여는 순간의 읽음 처리가 통째로 막힌다.
    const { result } = harness(vi.fn());
    expect(result.current()).toBe(true);
  });

  it('reports false once the sentinel leaves the viewport', () => {
    const { result } = harness(vi.fn());

    act(() => observers[0].fire(false));

    expect(result.current()).toBe(false);
  });

  it('reports true again when the sentinel comes back', () => {
    const { result } = harness(vi.fn());

    act(() => observers[0].fire(false));
    act(() => observers[0].fire(true));

    expect(result.current()).toBe(true);
  });

  it('calls onEnter only on the false→true transition', () => {
    const onEnter = vi.fn();
    harness(onEnter);

    act(() => observers[0].fire(false));
    expect(onEnter).not.toHaveBeenCalled();

    act(() => observers[0].fire(true));
    expect(onEnter).toHaveBeenCalledTimes(1);

    // 이미 보이는 상태에서 다시 보고돼도 재발화하지 않는다 — 스크롤 중
    // 관찰자는 같은 값을 여러 번 보고한다.
    act(() => observers[0].fire(true));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = harness(vi.fn());
    const observer = observers[0];

    unmount();

    expect(observer.disconnected).toBe(true);
  });

  it('fails open when IntersectionObserver is unavailable', () => {
    // 관찰자가 없으면 게이트를 영구히 닫는 대신 통과시킨다 — 닫으면 읽음 처리가
    // 아예 안 돌아 원래 VoC(배지가 안 꺼짐)가 그대로 돌아온다.
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);

    const { result } = harness(vi.fn());

    expect(result.current()).toBe(true);
  });
});
