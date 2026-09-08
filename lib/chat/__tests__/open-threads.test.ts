// 지금 화면에 열려 있는 대화 스레드 레지스트리 — 알림 토스트 억제의 근거.
//
// 같은 스레드가 두 곳에 동시에 마운트될 수 있어(딜룸 모달 + /messages) 참조
// 카운트로 센다. 하나가 언마운트했다고 열림이 꺼지면 남은 화면에 토스트가 뜬다.

import { describe, expect, it } from 'vitest';

import { isThreadOpen, registerOpenThread } from '../open-threads';

const LINK = '/messages?c=conv-1';

describe('open-threads registry', () => {
  it('is closed by default', () => {
    expect(isThreadOpen(LINK)).toBe(false);
  });

  it('reports a registered thread as open until it is released', () => {
    const release = registerOpenThread(LINK);
    expect(isThreadOpen(LINK)).toBe(true);

    release();
    expect(isThreadOpen(LINK)).toBe(false);
  });

  it('stays open while a second mount still holds it', () => {
    const releaseA = registerOpenThread(LINK);
    const releaseB = registerOpenThread(LINK);

    releaseA();
    expect(isThreadOpen(LINK)).toBe(true);

    releaseB();
    expect(isThreadOpen(LINK)).toBe(false);
  });

  it('ignores a double release (does not underflow the count)', () => {
    const releaseA = registerOpenThread(LINK);
    const releaseB = registerOpenThread(LINK);

    releaseA();
    releaseA();
    expect(isThreadOpen(LINK)).toBe(true);

    releaseB();
    expect(isThreadOpen(LINK)).toBe(false);
  });

  it('keeps threads independent', () => {
    const release = registerOpenThread(LINK);
    expect(isThreadOpen('/messages?c=conv-2')).toBe(false);
    release();
  });

  it('treats an unknown link as closed (fail-open: 모르면 토스트한다)', () => {
    expect(isThreadOpen(undefined)).toBe(false);
    expect(isThreadOpen('/rfp/P-2605-0042')).toBe(false);
  });
});
