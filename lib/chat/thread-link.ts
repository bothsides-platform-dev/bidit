/**
 * 알림 행이 가리키는 **스레드 링크** — 대화 식별자의 단일 출처.
 *
 * `notifications` 에는 대화·rfp 컬럼이 없다(userId + workspaceId + type + linkUrl).
 * 그래서 "이 알림이 어느 스레드의 것인가"를 표현하는 유일한 자리가 linkUrl 이며,
 * 팀 채팅이 먼저 그렇게 쓰고 있었다. 서버(팬아웃 dedupe·읽음 정리)와 클라이언트
 * (토스트 억제)가 **같은 문자열**을 만들어야 하므로 여기 한 곳에서만 만든다.
 *
 * 링크는 동시에 진짜 딥링크다 — 알림을 누르면 그 스레드가 열린다.
 */

export const CONVERSATION_QUERY_KEY = 'c';
export const TEAM_THREAD_QUERY_KEY = 't';

/** 1:1(구매사↔PG) 대화 스레드 링크. */
export function conversationThreadLink(conversationId: string): string {
  return `/messages?${CONVERSATION_QUERY_KEY}=${conversationId}`;
}

/** 팀 내부 스레드 링크(rfp 단위). */
export function teamThreadLink(rfpId: string): string {
  return `/messages?${TEAM_THREAD_QUERY_KEY}=${rfpId}`;
}
