// 메시지 기능 공용 타입.
//
// 실데이터 뷰 타입(인박스 목록·스레드 메시지)은 서버 액션 로더가 단일 진실원천:
// conversationLoaders 의 반환형을 그대로 재노출해 드리프트를 막아요. 풍부한 렌더에
// 필요한 추가 필드(읽음영수증·첨부 등)는 로더가 그 필드를 돌려줄 때 함께 늘려요.
//
// Counterparty/RfpContext 는 컴포즈 진입점(CounterpartyProfileCard·MessageComposeSheet·RecipientCard)이
// 쓰는 표시 전용 타입 — 로더 반환형과 별개로 유지해요.

export type {
  ConversationListItem,
  ThreadMessage,
  LoadThreadResult,
} from '@/lib/server/actions/chat/conversationLoaders';

// 통합 인박스 항목(상대방 대화 + 팀 스레드) — 인박스 로더가 단일 진실원천.
export type { InboxListItem } from '@/lib/server/actions/chat/inboxLoader';

import type { WorkspaceDisplay } from '@/lib/types/workspace';

export type CounterpartyType = 'buyer' | 'pg';

export const COUNTERPARTY_TYPE_LABEL: Record<CounterpartyType, string> = {
  buyer: '구매사',
  pg: 'PG',
};

/**
 * 거래 상대(워크스페이스) 표시 신원.
 *
 * `logoUpdatedAt` 은 **필수**다 — optional 이면 "로고 없음"과 "배선을 잊음"이 값에서도
 * 화면에서도(이니셜 폴백이 정상으로 보인다) 구분되지 않아, 호출부 6곳 중 4곳이 조용히
 * 로고를 흘렸다. 필수로 두면 컴파일러가 그 누락을 잡는다.
 * 로고 버전을 지어내지 말고 `toCounterparty` 로 `WorkspaceDisplay` 를 그대로 넘긴다.
 */
export type Counterparty = {
  name: string;
  type: CounterpartyType;
  workspaceId?: string;
  logoUpdatedAt: string | null;
};

/**
 * `WorkspaceDisplay` → `Counterparty`. 신원을 손으로 펼쳐 넣지 않게 하는 유일한 다리다 —
 * 필드를 하나씩 옮겨 적는 자리가 곧 하나를 빠뜨리는 자리였다. `type` 도 워크스페이스가
 * 이미 알고 있으므로 호출부가 다시 고르지 않는다.
 */
export function toCounterparty(ws: WorkspaceDisplay): Counterparty {
  return {
    name: ws.name,
    type: ws.type,
    workspaceId: ws.id,
    logoUpdatedAt: ws.logoUpdatedAt,
  };
}

export type RfpContext = {
  /** 전송용 RFP uuid — 화면에 렌더하지 않음. */
  id: string;
  /** 사람이 읽는 RFP 코드 (e.g. P-2605-0042) — 있을 때만 표시. */
  code?: string;
  /** RFP 제목 — 있을 때만 표시. */
  title?: string;
};
