'use server';

import { z } from 'zod';

import { getConversationReadState } from '@/lib/chat/read-state/server';
import { conversationThreadLink } from '@/lib/chat/thread-link';
import { getNotificationRepo } from '@/lib/server/repositories/factory';
import { type ChatActionResult, requireActiveWorkspace } from './_shared';

const Input = z.object({
  conversationId: z.string().uuid(),
  throughMessageId: z.string().uuid(),
}).strict();

export type MarkConversationReadInput = z.infer<typeof Input>;
export type MarkConversationReadResult = ChatActionResult<{ readAt: string }>;

export async function markConversationReadAction(
  input: MarkConversationReadInput,
): Promise<MarkConversationReadResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const ws = await requireActiveWorkspace();
  if (!ws.ok) return ws;

  const result = await (await getConversationReadState()).markRead({
    conversationId: parsed.data.conversationId,
    throughMessageId: parsed.data.throughMessageId,
    viewer: { userId: ws.userId, activeWorkspaceId: ws.workspaceId },
  });
  if (!result.ok) return result;

  // 읽음 cursor 와 인앱 알림은 서로 다른 애그리거트다(ADR 0003 — read-state 모듈은
  // cursor·side·projection 만 소유한다). 그래서 정리는 read-state 안이 아니라
  // 여기서 두 소유자를 조합한다.
  //
  // best-effort: 배지는 부수효과라, 여기서 던지면 cursor 는 이미 전진했는데
  // 화면은 실패로 보이고 재시도해도 같은 자리에서 또 죽는다. 남은 배지는
  // 사용자가 알림함에서 지울 수 있고 다음 열람에서 다시 시도된다.
  try {
    const notifRepo = await getNotificationRepo();
    await notifRepo.markChatThreadRead(
      ws.userId,
      ws.workspaceId,
      conversationThreadLink(parsed.data.conversationId),
      new Date(result.readAt),
    );
  } catch (error) {
    console.warn('[chat] failed to clear in-app notifications for conversation', error);
  }

  return result;
}
