'use server';
import { z } from 'zod';
import { teamThreadLink } from '@/lib/chat/thread-link';
import { getNotificationRepo } from '@/lib/server/repositories/factory';
import { getTeamChatService } from '@/lib/server/services/team-chat';
import { type ChatActionResult, requireActiveWorkspace } from './_shared';

const Input = z.object({ rfpId: z.string().uuid() }).strict();
export type MarkTeamThreadReadResult = ChatActionResult<{ readAt: string }>;

export async function markTeamThreadReadAction(
  input: z.infer<typeof Input>,
): Promise<MarkTeamThreadReadResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };
  const ws = await requireActiveWorkspace();
  if (!ws.ok) return ws;
  const service = await getTeamChatService();
  const result = await service.markRead(parsed.data.rfpId, {
    userId: ws.userId, workspaceId: ws.workspaceId, workspaceType: ws.workspaceType,
  });
  if (!result.ok) return result;

  // 1:1 대화와 같은 이유로 best-effort — markConversationReadAction 의 주석 참조.
  // 멘션 알림(team_chat.mention)도 같은 링크를 달고 있어 함께 걷힌다: 스레드를
  // 열어 실제로 본 순간 배지가 남을 이유가 없다.
  try {
    const notifRepo = await getNotificationRepo();
    await notifRepo.markChatThreadRead(
      ws.userId,
      ws.workspaceId,
      teamThreadLink(parsed.data.rfpId),
      result.readAt,
    );
  } catch (error) {
    console.warn('[team-chat] failed to clear in-app notifications for thread', error);
  }

  return result;
}
