// useMarkReadWhileVisible — 스레드가 열려 **보이는 동안** 읽음 cursor 를 전진시킨다.
//
// 예전에는 마운트 1회뿐이라, 대화창을 켜 둔 채 새 메시지를 받으면 말풍선은
// 그려지는데 읽음 cursor 는 그대로였다 → 인박스 배지가 안 꺼지고 상대에게 읽음
// 영수증도 안 갔다(VoC "대화에 사용자가 있는데도 읽음 처리가 안 됨").
//
// visibility 게이트가 load-bearing 이다: 빼면 백그라운드 탭이 상대에게 **거짓
// 읽음 영수증**을 보낸다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useMarkReadWhileVisible } from '../useMarkReadWhileVisible';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMarkReadWhileVisible', () => {
  it('marks read on mount without waiting for the debounce', () => {
    const run = vi.fn();
    renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));

    // 열자마자 읽음이다 — 여는 행위 자체가 이미 사용자의 의사 표시라
    // 디바운스를 기다릴 이유가 없다(상대의 읽음 영수증도 그만큼 늦어진다).
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('conv-1');

    act(() => {
      vi.runAllTimers();
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does NOT mark read on mount when the tab is already hidden', () => {
    // 백그라운드 탭에서 열린 스레드(다른 탭에서 링크를 열어 둔 경우)가 상대에게
    // 거짓 읽음 영수증을 보내지 않는다 — 훅 헤더가 load-bearing 이라고 부르는
    // 게이트의 마운트 쪽 절반이다. 나머지 절반(도착 시)은 아래 테스트가 본다.
    setVisibility('hidden');
    const run = vi.fn();
    renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));

    act(() => {
      vi.runAllTimers();
    });
    expect(run).not.toHaveBeenCalled();

    // 탭으로 돌아오면 그때 한 번 만회한다.
    act(() => {
      setVisibility('visible');
      vi.runAllTimers();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('conv-1');
  });

  it('catches up with the NEW key when the thread switches while hidden', () => {
    const run = vi.fn();
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useMarkReadWhileVisible({ key, run }),
      { initialProps: { key: 'conv-1' } },
    );
    run.mockClear();

    act(() => {
      setVisibility('hidden');
    });
    rerender({ key: 'conv-2' });
    act(() => {
      vi.runAllTimers();
    });
    expect(run).not.toHaveBeenCalled();

    act(() => {
      setVisibility('visible');
      vi.runAllTimers();
    });
    expect(run).toHaveBeenCalledTimes(1);
    // 숨은 동안 갈아탄 대화를 읽음 처리해야 한다 — 옛 키로 보내면 엉뚱한 대화가
    // 읽음이 되고 지금 보고 있는 대화는 배지가 남는다.
    expect(run).toHaveBeenCalledWith('conv-2');
  });

  it('marks read again when a message arrives while visible', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    act(() => {
      result.current();
      vi.runAllTimers();
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does NOT mark read when a message arrives while the tab is hidden', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    act(() => {
      setVisibility('hidden');
      result.current();
      vi.runAllTimers();
    });

    expect(run).not.toHaveBeenCalled();
  });

  it('catches up once when the tab becomes visible again', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    act(() => {
      setVisibility('hidden');
      result.current();
      result.current();
      vi.runAllTimers();
    });
    expect(run).not.toHaveBeenCalled();

    act(() => {
      setVisibility('visible');
      vi.runAllTimers();
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not fire on becoming visible when nothing arrived while hidden', () => {
    const run = vi.fn();
    renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    act(() => {
      setVisibility('hidden');
      vi.runAllTimers();
      setVisibility('visible');
      vi.runAllTimers();
    });

    expect(run).not.toHaveBeenCalled();
  });

  it('coalesces a burst of arrivals into one call', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useMarkReadWhileVisible({ key: 'conv-1', run }));
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    act(() => {
      result.current();
      result.current();
      result.current();
      vi.runAllTimers();
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('re-marks with the new key when the thread switches', () => {
    const run = vi.fn();
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useMarkReadWhileVisible({ key, run }),
      { initialProps: { key: 'conv-1' } },
    );
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    rerender({ key: 'conv-2' });
    act(() => {
      vi.runAllTimers();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('conv-2');
  });

  it('drops a queued arrival when the thread switches away from it', () => {
    const run = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useMarkReadWhileVisible({ key, run }),
      { initialProps: { key: 'conv-1' } },
    );
    run.mockClear();

    // conv-1 도착이 디바운스 대기 중인 상태에서 대화를 갈아탄다. 그 예약이 살아
    // 남으면 conv-2 를 읽었다고 두 번 말하게 된다.
    act(() => {
      result.current();
    });
    rerender({ key: 'conv-2' });
    act(() => {
      vi.runAllTimers();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('conv-2');
  });

  it('does not run after unmount', () => {
    const run = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMarkReadWhileVisible({ key: 'conv-1', run }),
    );
    act(() => {
      vi.runAllTimers();
    });
    run.mockClear();

    act(() => {
      result.current();
    });
    unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(run).not.toHaveBeenCalled();
  });
});
