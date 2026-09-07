// optimistic-thread — 낙관적 전송 reconcile 순수 로직(상대방·팀 채팅 공용).
// 전송 성공 승격(라이브 echo 선행 시 중복 방지), 실패 제거, 라이브 echo 승격/중복무시.

import { describe, it, expect } from 'vitest';

import { promoteSentMessage, removeMessage, applyLiveEcho } from '../optimistic-thread';

type Msg = { id: string; pending?: boolean; createdAt: string; body: string; attachments?: string[]; localKey?: string };

const pending = (id: string): Msg => ({ id, pending: true, createdAt: 'T0', body: 'hi' });
const real = (id: string): Msg => ({ id, createdAt: 'T1', body: 'yo' });

describe('promoteSentMessage', () => {
  it('promotes the temp pending bubble to the real id (pending off, server createdAt)', () => {
    const out = promoteSentMessage([real('a'), pending('tmp')], 'tmp', 'real-1', 'TS');
    expect(out).toEqual([
      { id: 'a', createdAt: 'T1', body: 'yo' },
      { id: 'real-1', pending: false, createdAt: 'TS', body: 'hi' },
    ]);
  });

  it('drops the temp bubble if a message with the real id already exists (echo beat it)', () => {
    const out = promoteSentMessage([real('real-1'), pending('tmp')], 'tmp', 'real-1', 'TS');
    expect(out).toEqual([{ id: 'real-1', createdAt: 'T1', body: 'yo' }]);
  });

  it('falls back to the temp createdAt when the server omits it', () => {
    const out = promoteSentMessage([pending('tmp')], 'tmp', 'real-1', undefined);
    expect(out[0].createdAt).toBe('T0');
  });

  it('applies a patch (e.g. server attachments) on promote', () => {
    const out = promoteSentMessage([pending('tmp')], 'tmp', 'real-1', 'TS', { attachments: ['f1'] });
    expect(out[0]).toMatchObject({ id: 'real-1', pending: false, attachments: ['f1'] });
  });

  it('preserves localKey through promotion (id changes, localKey stays)', () => {
    const opt: Msg = { id: 'tmp', localKey: 'tmp', pending: true, createdAt: 'T0', body: 'hi' };
    const out = promoteSentMessage([opt], 'tmp', 'real-1', 'TS', { attachments: ['f1'] });
    expect(out[0]).toMatchObject({ id: 'real-1', localKey: 'tmp', pending: false, attachments: ['f1'] });
  });

  it('leaves non-temp messages untouched', () => {
    const msgs = [real('a'), real('b')];
    expect(promoteSentMessage(msgs, 'tmp', 'real-1', 'TS')).toEqual(msgs);
  });

  it('is a no-op when a live echo already consumed the temp row (tempId absent, realId present)', () => {
    // 라이브 echo 가 pending 을 먼저 real-1 로 승격해 tmp 가 사라진 상태에서
    // 전송 액션이 뒤늦게 resolve → 깔끔한 no-op 이어야 한다(이중 추가 금지).
    const msgs = [real('a'), real('real-1')];
    expect(promoteSentMessage(msgs, 'tmp', 'real-1', 'TS')).toEqual(msgs);
  });
});

describe('removeMessage', () => {
  it('removes the given id, keeps the rest', () => {
    expect(removeMessage([real('a'), pending('tmp')], 'tmp')).toEqual([real('a')]);
  });

  it('returns the list unchanged when the id is absent (already reconciled)', () => {
    const msgs = [real('a'), real('b')];
    expect(removeMessage(msgs, 'missing')).toEqual(msgs);
  });
});

describe('applyLiveEcho', () => {
  it('returns the same array (dedup) when the id already exists', () => {
    const msgs = [real('real-1')];
    expect(applyLiveEcho(msgs, 'real-1', true, 'TS')).toBe(msgs);
  });

  it('promotes the pending bubble for a self echo', () => {
    const out = applyLiveEcho([pending('tmp')], 'real-1', true, 'TS');
    expect(out).toEqual([{ id: 'real-1', pending: false, createdAt: 'TS', body: 'hi' }]);
  });

  it('preserves localKey on self-echo promotion', () => {
    const opt: Msg = { id: 'tmp', localKey: 'tmp', pending: true, createdAt: 'T0', body: 'hi' };
    const out = applyLiveEcho([opt], 'real-1', true, 'TS');
    expect(out?.[0]).toMatchObject({ id: 'real-1', localKey: 'tmp', pending: false });
  });

  it('returns null for a self echo with no pending bubble (caller appends)', () => {
    expect(applyLiveEcho([real('a')], 'real-1', true, 'TS')).toBeNull();
  });

  it('returns null for a non-self echo (caller appends)', () => {
    expect(applyLiveEcho([pending('tmp')], 'real-1', false, 'TS')).toBeNull();
  });

  it('falls back to the pending createdAt when the echo omits it', () => {
    const out = applyLiveEcho([pending('tmp')], 'real-1', true, undefined as unknown as string);
    expect(out?.[0].createdAt).toBe('T0');
  });

  // ── tempId 정확 매칭 (멀티탭 echo 오인 승격 방지) ─────────────────────────────
  // tempId 를 제공하면 첫 pending 이 아닌 id 가 정확히 일치하는 행만 승격한다.

  it('promotes the SPECIFIC pending bubble matching tempId, leaves others pending', () => {
    // 두 탭이 동시 전송: tmp-a 와 tmp-b 각각 pending. echo 는 tmp-b 소유.
    const msgs = [pending('tmp-a'), pending('tmp-b')];
    const out = applyLiveEcho(msgs, 'real-2', true, 'TS', 'tmp-b');
    expect(out).toEqual([
      pending('tmp-a'),
      { id: 'real-2', pending: false, createdAt: 'TS', body: 'hi' },
    ]);
  });

  it('returns null when tempId is provided but no pending with that id (multi-tab no-op)', () => {
    // 이 탭의 pending 은 tmp-Y 이고, echo 의 tempId 는 tmp-X(다른 탭 소유).
    // 승격 대상이 없으므로 null 반환 → 호출처가 새 메시지를 append.
    const msgs = [pending('tmp-Y')];
    const out = applyLiveEcho(msgs, 'real-2', true, 'TS', 'tmp-X');
    expect(out).toBeNull();
  });

  it('falls back to first-pending match when tempId is omitted (backward compat)', () => {
    // tempId 없이 호출: 기존 동작 유지 — 첫 pending 을 승격.
    const out = applyLiveEcho([pending('tmp')], 'real-1', true, 'TS');
    expect(out).toEqual([{ id: 'real-1', pending: false, createdAt: 'TS', body: 'hi' }]);
  });
});
