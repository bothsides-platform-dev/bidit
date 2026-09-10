// 메시지함 — /messages
//
// 통합 인박스: 상대방 비공개 스레드 + 팀 스레드를 한 목록에 합쳐 전달한다.
// 목록은 서버 액션 로더(listInboxForViewer)로 실데이터를 전달하고, 각 스레드
// 메시지는 항목 선택 시 클라이언트에서 로드한다(MessageInbox 내부).
//
// 딥링크 searchParam(상호배타, 동시엔 c 우선):
//   ?c=<conversationId> — 상대방 대화 자동 선택(홈 위젯·레일 "메시지함에서 열기").
//   ?t=<rfpId>          — 팀 스레드 자동 선택.
import { PageEnter } from '@/components/primitives/PageEnter';
import { PageHeader } from '@/components/shell/PageHeader';
import { MessageInbox } from '@/components/messages/MessageInbox';
import { listInboxForViewer } from '@/lib/server/actions/chat/inboxLoader';
import { CONVERSATION_QUERY_KEY, TEAM_THREAD_QUERY_KEY } from '@/lib/chat/thread-link';

export const dynamic = 'force-dynamic';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<typeof CONVERSATION_QUERY_KEY | typeof TEAM_THREAD_QUERY_KEY, string>>>;
}) {
  const [items, params] = await Promise.all([listInboxForViewer(), searchParams]);
  // 쿼리 키는 알림 링크를 만드는 쪽(lib/chat/thread-link.ts)과 **같은 상수**를 쓴다.
  // 여기에 리터럴 'c'/'t' 를 다시 적으면 만드는 쪽과 읽는 쪽이 말없이 갈라져
  // 알림 딥링크가 통째로 죽는다(그때 깨지는 것을 알려줄 테스트도 없었다).
  const c = params[CONVERSATION_QUERY_KEY];
  const t = params[TEAM_THREAD_QUERY_KEY];
  const unread = items.filter((i) => i.unread).length;
  // c·t 상호배타, 동시 지정 시 c(상대방 대화) 우선.
  const initialSelectedKey = c ? `c:${c}` : t ? `t:${t}` : null;

  return (
    <PageEnter className="flex h-full flex-col">
      <PageHeader title="메시지" count={unread} countKind="unread" />
      <MessageInbox items={items} initialSelectedKey={initialSelectedKey} className="min-h-0 flex-1" />
    </PageEnter>
  );
}
