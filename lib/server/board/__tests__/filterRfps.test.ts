import { describe, it, expect } from 'vitest';
import {
  matchesDeadlineBucket,
  matchesGrade,
  filterRfps,
  filterInboxRows,
} from '../filterRfps';
import type { RFP } from '@/lib/types/rfp';
import type { InboxRow } from '@/components/inbox/InboxList';

// Fixed "now": 2026-05-24 KST. T03:00:00Z = 12:00 KST, safely mid-day regardless of runner TZ.
const NOW = new Date('2026-05-24T03:00:00.000Z');
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T03:00:00.000Z`;

describe('matchesDeadlineBucket', () => {
  it('returns true when bucket is absent/unknown (no filter)', () => {
    expect(matchesDeadlineBucket(iso(2026, 5, 27), undefined, NOW)).toBe(true);
    expect(matchesDeadlineBucket(iso(2026, 5, 27), '', NOW)).toBe(true);
    expect(matchesDeadlineBucket(iso(2026, 5, 27), 'bogus', NOW)).toBe(true);
  });

  it('d7 = today through +7 days', () => {
    expect(matchesDeadlineBucket(iso(2026, 5, 27), 'd7', NOW)).toBe(true); // +3
    expect(matchesDeadlineBucket(iso(2026, 6, 3), 'd7', NOW)).toBe(false); // +10
    expect(matchesDeadlineBucket(iso(2026, 5, 23), 'd7', NOW)).toBe(false); // -1 (overdue)
  });

  it('overdue = strictly before today', () => {
    expect(matchesDeadlineBucket(iso(2026, 5, 23), 'overdue', NOW)).toBe(true);
    expect(matchesDeadlineBucket(iso(2026, 5, 24), 'overdue', NOW)).toBe(false);
    expect(matchesDeadlineBucket(iso(2026, 5, 27), 'overdue', NOW)).toBe(false);
  });

  it('month = same calendar month/year', () => {
    expect(matchesDeadlineBucket(iso(2026, 5, 15), 'month', NOW)).toBe(true);
    expect(matchesDeadlineBucket(iso(2026, 5, 30), 'month', NOW)).toBe(true);
    expect(matchesDeadlineBucket(iso(2026, 6, 1), 'month', NOW)).toBe(false);
  });
});

describe('matchesGrade', () => {
  it('returns true when no grade param (no filter)', () => {
    expect(matchesGrade('sme1', undefined)).toBe(true);
    expect(matchesGrade(undefined, '')).toBe(true);
  });
  it('matches exact raw grade enum', () => {
    expect(matchesGrade('sme1', 'sme1')).toBe(true);
    expect(matchesGrade('general', 'sme1')).toBe(false);
    expect(matchesGrade(undefined, 'sme1')).toBe(false);
  });
});

describe('filterRfps (status + deadline + grade, AND)', () => {
  const base: Omit<RFP, 'id' | 'status' | 'deadline' | 'bizProfile'> = {
    code: 'P-2605-0001',
    buyerWsId: 'ws1',
    title: 't',
    memo: '',
    rfpFiles: [],
    allowedPgWorkspaceIds: [],
    requiredPaymentMethods: [],
    customPaymentMethods: [],
    createdBy: 'u1',
    createdAt: iso(2026, 5, 1),
  };
  const rfp = (over: Partial<RFP>): RFP => ({ ...base, id: 'x', status: 'sent', deadline: iso(2026, 5, 27), ...over } as RFP);

  const rows: RFP[] = [
    rfp({ id: 'a', status: 'sent', deadline: iso(2026, 5, 27), bizProfile: { grade: 'sme1', gradeSource: 'unset' } }),
    rfp({ id: 'b', status: 'draft', deadline: iso(2026, 6, 10), bizProfile: { grade: 'general', gradeSource: 'unset' } }),
    rfp({ id: 'c', status: 'sent', deadline: iso(2026, 6, 10), bizProfile: { grade: 'sme1', gradeSource: 'unset' } }),
  ];

  it('no params → all', () => {
    expect(filterRfps(rows, {}, NOW).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('status=active (→ sent)', () => {
    expect(filterRfps(rows, { status: 'active' }, NOW).map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('deadline=d7 keeps only near deadlines', () => {
    expect(filterRfps(rows, { deadline: 'd7' }, NOW).map((r) => r.id)).toEqual(['a']);
  });
  it('grade=sme1', () => {
    expect(filterRfps(rows, { grade: 'sme1' }, NOW).map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('combined status=active & grade=sme1 & deadline=d7', () => {
    expect(filterRfps(rows, { status: 'active', grade: 'sme1', deadline: 'd7' }, NOW).map((r) => r.id)).toEqual(['a']);
  });
});

describe('filterInboxRows (status + deadline + grade, AND)', () => {
  const row = (over: Partial<InboxRow>): InboxRow => ({
    invitationId: 'i', stage: 'received',
    rfpId: 'P-1', rfpTitle: 't', rfpDeadline: iso(2026, 5, 27), grade: '중소1', gradeRaw: 'sme1',
    ...over,
  });
  const rows: InboxRow[] = [
    row({ invitationId: 'a', stage: 'received', rfpDeadline: iso(2026, 5, 27), gradeRaw: 'sme1' }),
    row({ invitationId: 'b', stage: 'submitted', rfpDeadline: iso(2026, 6, 10), gradeRaw: 'general' }),
    row({ invitationId: 'c', stage: 'received', rfpDeadline: iso(2026, 6, 10), gradeRaw: 'sme1' }),
  ];

  it('no params → all', () => {
    expect(filterInboxRows(rows, {}, NOW).map((r) => r.invitationId)).toEqual(['a', 'b', 'c']);
  });
  it('status=new (→ stage received)', () => {
    expect(filterInboxRows(rows, { status: 'new' }, NOW).map((r) => r.invitationId)).toEqual(['a', 'c']);
  });
  it('deadline=d7', () => {
    expect(filterInboxRows(rows, { deadline: 'd7' }, NOW).map((r) => r.invitationId)).toEqual(['a']);
  });
  it('grade=sme1', () => {
    expect(filterInboxRows(rows, { grade: 'sme1' }, NOW).map((r) => r.invitationId)).toEqual(['a', 'c']);
  });
});

/**
 * KST 경계 — TZ-비의존 테스트
 *
 * 이 블록의 테스트는 TZ=UTC와 TZ=Asia/Seoul 환경 모두에서 동일한 결과를 내야 한다.
 * 마감일은 신규 규약(+09:00)으로 작성하고, "KST 기준" 달력일 비교가 올바른지 검증한다.
 *
 * 시나리오:
 *   deadline = 2026-06-30T23:59:59+09:00  (= 2026-06-30T14:59:59Z, KST 6월 30일 끝)
 *   now      = 2026-06-30T15:00:00Z       (= 2026-07-01T00:00:00+09:00, KST 7월 1일 자정)
 *
 * KST 관점: 마감은 "6/30" 이었고, 지금은 "7/1 00:00" → 마감 지남(overdue), 다른 달.
 */
describe('KST 경계 — TZ-비의존', () => {
  // KST 7월 1일 00:00:00
  const nowKstJul1Midnight = new Date('2026-06-30T15:00:00.000Z');
  // KST 6월 30일 23:59:59 (신규 저장 규약)
  const deadlineKstJun30End = '2026-06-30T23:59:59+09:00';

  it('KST 자정이 지나면 마감일이 overdue로 분류된다', () => {
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'overdue', nowKstJul1Midnight)).toBe(true);
  });

  it('KST 자정이 지나면 마감일이 이번 달(month)에 해당하지 않는다', () => {
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'month', nowKstJul1Midnight)).toBe(false);
  });

  it('KST 자정이 지나면 d7 범위에서 벗어난다', () => {
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'd7', nowKstJul1Midnight)).toBe(false);
  });

  it('KST 자정 직전에는 아직 overdue가 아니다', () => {
    // now = 2026-06-30T14:59:58Z = 2026-06-30T23:59:58+09:00 (1초 전)
    const nowJustBefore = new Date('2026-06-30T14:59:58.000Z');
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'overdue', nowJustBefore)).toBe(false);
  });

  it('KST 같은 달 내에서 d7 이내이면 true', () => {
    // now = 2026-06-28T03:00:00Z = 2026-06-28T12:00:00+09:00 (KST 6/28 정오)
    // deadline = 2026-06-30T23:59:59+09:00 → 2일 후 → d7 내
    const nowKstJun28Noon = new Date('2026-06-28T03:00:00.000Z');
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'd7', nowKstJun28Noon)).toBe(true);
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'month', nowKstJun28Noon)).toBe(true);
    expect(matchesDeadlineBucket(deadlineKstJun30End, 'overdue', nowKstJun28Noon)).toBe(false);
  });
});
