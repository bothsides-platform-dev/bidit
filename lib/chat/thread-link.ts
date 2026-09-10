/**
 * 알림 행이 가리키는 **스레드 링크** — 대화 식별자의 단일 출처.
 *
 * `notifications` 에는 대화·rfp 컬럼이 없다(userId + workspaceId + type + linkUrl).
 * 그래서 "이 알림이 어느 스레드의 것인가"를 표현하는 유일한 자리가 linkUrl 이며,
 * 팀 채팅이 먼저 그렇게 쓰고 있었다. 서버(팬아웃 dedupe·읽음 정리)와 클라이언트
 * (토스트 억제)가 **같은 문자열**을 만들어야 하므로 여기 한 곳에서만 만든다.
 *
 * 링크는 동시에 진짜 딥링크다 — 알림을 누르면 그 스레드가 열린다. **읽는 쪽**
 * (`app/(app)/messages/page.tsx`)도 리터럴 대신 여기의 쿼리 키 상수를 쓴다:
 * 만드는 쪽과 읽는 쪽이 갈라지면 딥링크가 통째로 죽기 때문이다.
 *
 * 이 "한 곳에서만"은 주석의 다짐이 아니라 테스트가 지킨다 —
 * `__tests__/thread-link.test.ts` 의 드리프트 가드가 `lib`·`app`·`components`
 * 어디든 손으로 만든 링크가 새로 생기면 그 파일과 줄 번호를 찍어 실패한다.
 * 예전에는 여섯 곳이 각자 만들고 있었고, 그때는 키가 어긋나도 '링크 하나가 안
 * 열림'으로 끝났다. 지금은 dedupe·읽음 정리·토스트 억제 셋이 문자열 정확일치에
 * 걸려 있어 한꺼번에 조용히 깨진다.
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
