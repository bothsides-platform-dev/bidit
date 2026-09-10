export type NotificationChannel = 'email' | 'inapp';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

export type Notification = {
  id: string;
  userId: string;
  // null = user-level (워크스페이스에 묶이지 않은 알림 — 어느 ws를 보든 표시).
  workspaceId: string | null;
  type: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  linkUrl?: string;
  createdAt: string;
  sentAt?: string;
  readAt?: string;
};

/**
 * **세는 것** — 사이드바 배지·`PageHeader` 개수 칩·목록 행 칩이 공유한다.
 *
 * `failed` 는 제외한다. 전달 실패는 안 읽음이 아니라 실패이며 행 칩이 이미
 * `실패` 로 따로 말한다 — 여기서 세면 헤더 숫자가 바로 아래 칩들과 어긋난다.
 *
 * ⚠️ 술어는 하나가 아니라 **둘**이다(`canMarkRead` 참조). 하나로 합치려다
 * 틀린 코드가 나온 적이 있어 나란히 둔다. 그리고 앱 밖에 **세 번째**가 있다 —
 * `workspace.ts` 의 SQL `read_at IS NULL`(워크스페이스 스위처 점). 그쪽은
 * `canMarkRead` 와 같은 뜻이며, "이 워크스페이스에 볼 게 있나"를 묻는 것이라
 * 의도적으로 넓다. 셋을 하나로 합치는 것이 목표가 아니라, 각자 무엇을 묻는지가
 * 이름에 드러나 있는 것이 목표다.
 */
export function isUnread(n: Pick<Notification, 'status'>): boolean {
  return n.status === 'pending' || n.status === 'sent';
}

/**
 * **치울 수 있는 것** — 행의 `읽음 처리` 버튼과 제목 강조, 그리고
 * `markAllRead` 의 낙관적 로컬 패치가 쓴다.
 *
 * `isUnread` 와 `failed` 에서 갈린다. 실패 알림은 세지 않지만 사용자가 치울
 * 수는 있어야 하고, 무엇보다 `markAllRead` 의 SQL 이 `read_at IS NULL` 을
 * 전부 지우므로 로컬 패치가 좁으면 서버는 읽음인데 화면은 안 읽음으로 남는다.
 */
export function canMarkRead(n: Pick<Notification, 'status'>): boolean {
  return n.status !== 'read';
}

/**
 * 사용자에게 보이거나 들리는 미확인 문구의 **단일 출처**.
 * 규범은 `UX_WRITING.md` §8, 표기 방식(가시/sr-only/aria-label)은 `DESIGN.md` §7.3.
 * 리터럴을 표면마다 다시 적으면 여섯 번째 표면이 `미읽음` 으로 새어 나간다.
 */
export const UNREAD_LABEL = '안 읽음';

/** 개수까지 붙인 형태 — 사이드바 배지·헤더 칩의 접근 가능한 이름. */
export function unreadCountLabel(count: number): string {
  return `${UNREAD_LABEL} ${count}${UNREAD_COUNT_SUFFIX}`;
}

/** 개수 뒤에 붙는 단위. 숫자만 `.md-numeric` 으로 떼어 그리는 표면이 라벨을 다시 적지 않도록 분리했다. */
export const UNREAD_COUNT_SUFFIX = '건';
