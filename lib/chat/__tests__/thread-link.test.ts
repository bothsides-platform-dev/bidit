// thread-link — 스레드 링크의 단일 출처, 그리고 그 주장을 참으로 유지하는 가드.
//
// 이 링크는 세 가지가 **문자열 정확일치**로 걸려 있다: 알림 팬아웃의 dedupe,
// 읽음 시 알림 정리, 그리고 열려 있는 스레드의 토스트 억제. 예전에는 키가
// 어긋나면 '링크 하나가 안 열림'이었지만 지금은 셋이 한꺼번에 조용히 깨진다.
//
// 그래서 리터럴을 손으로 만드는 곳이 하나라도 새로 생기면 이 테스트가 잡는다
// (레포가 PAYMENT_METHODS·TEST_PG_NAME_TOKENS 에 쓰는 것과 같은 드리프트 가드).

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  CONVERSATION_QUERY_KEY,
  TEAM_THREAD_QUERY_KEY,
  conversationThreadLink,
  teamThreadLink,
} from '../thread-link';

describe('thread-link builders', () => {
  it('builds the 1:1 conversation link from the query key', () => {
    expect(conversationThreadLink('conv-1')).toBe(`/messages?${CONVERSATION_QUERY_KEY}=conv-1`);
  });

  it('builds the team thread link from the query key', () => {
    expect(teamThreadLink('rfp-1')).toBe(`/messages?${TEAM_THREAD_QUERY_KEY}=rfp-1`);
  });
});

describe('thread-link drift guard', () => {
  // 이 파일 자신과 테스트는 리터럴을 적어도 된다(그게 고정하는 대상이다).
  const ALLOWED = new Set(['lib/chat/thread-link.ts']);

  function grepLiteralBuilders(): string[] {
    // `/messages?c=` · `/messages?t=` 를 **만들어 내는** 곳을 찾는다. 주석·문서의
    // 언급은 대상이 아니므로 템플릿 보간(`${`)이나 문자열 결합이 뒤따르는 것만 센다.
    let out = '';
    try {
      out = execFileSync(
        'git',
        [
          'grep',
          '-nE',
          String.raw`/messages\?[ct]=\$\{`,
          '--',
          'lib',
          'app',
          'components',
        ],
        { encoding: 'utf8' },
      );
    } catch (error) {
      // git grep exits 1 when there are no matches — that is the passing case.
      const status = (error as { status?: number }).status;
      if (status === 1) return [];
      throw error;
    }
    return out
      .split('\n')
      .filter(Boolean)
      .filter((line) => {
        const file = line.split(':')[0];
        return !ALLOWED.has(file) && !file.includes('__tests__');
      });
  }

  it('has no hand-built thread links outside lib/chat/thread-link.ts', () => {
    const offenders = grepLiteralBuilders();
    expect(
      offenders,
      `스레드 링크를 손으로 만드는 곳이 남아 있습니다. conversationThreadLink()/teamThreadLink() 를 쓰세요:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
