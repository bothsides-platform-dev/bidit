import { beforeEach, describe, expect, it, vi } from 'vitest';

const { markRead, publishChatEvent, requireActiveWorkspace, markChatThreadRead } = vi.hoisted(
  () => ({
    markRead: vi.fn(),
    publishChatEvent: vi.fn(),
    requireActiveWorkspace: vi.fn(),
    markChatThreadRead: vi.fn(),
  }),
);

vi.mock('@/lib/server/repositories/factory', () => ({
  getNotificationRepo: vi.fn().mockResolvedValue({ markChatThreadRead }),
}));

vi.mock('../_shared', () => ({
  requireActiveWorkspace,
}));

vi.mock('@/lib/chat/read-state/server', () => ({
  getConversationReadState: vi.fn().mockResolvedValue({ markRead }),
}));

vi.mock('@/lib/server/realtime/centrifugo', () => ({ publishChatEvent }));

import { markConversationReadAction } from '../markConversationReadAction';

describe('markConversationReadAction', () => {
  beforeEach(() => {
    markRead.mockReset();
    markRead.mockResolvedValue({
      ok: true,
      readAt: '2026-09-05T12:00:00.000Z',
    });
    publishChatEvent.mockReset();
    markChatThreadRead.mockReset();
    markChatThreadRead.mockResolvedValue(undefined);
    requireActiveWorkspace.mockReset();
    requireActiveWorkspace.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceType: 'buyer',
    });
  });

  it('인증된 viewer를 Conversation read state module에 위임한다', async () => {
    const result = await markConversationReadAction({
      conversationId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result).toEqual({
      ok: true,
      readAt: '2026-09-05T12:00:00.000Z',
    });
    expect(markRead).toHaveBeenCalledWith({
      conversationId: '00000000-0000-4000-8000-000000000001',
      viewer: { userId: 'user-1', activeWorkspaceId: 'workspace-1' },
    });
    expect(publishChatEvent).not.toHaveBeenCalled();
  });

  it('그 대화의 대기 중 인앱 알림도 함께 읽음 처리한다', async () => {
    await markConversationReadAction({
      conversationId: '00000000-0000-4000-8000-000000000001',
    });

    expect(markChatThreadRead).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      '/messages?c=00000000-0000-4000-8000-000000000001',
      // 정리 상한 = 방금 저장한 cursor — 그 뒤에 도착한 알림은 건드리지 않는다.
      '2026-09-05T12:00:00.000Z',
    );
  });

  it('읽음 cursor 갱신이 실패하면 알림을 건드리지 않는다', async () => {
    markRead.mockResolvedValueOnce({ ok: false, error: 'FORBIDDEN' });

    const result = await markConversationReadAction({
      conversationId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(markChatThreadRead).not.toHaveBeenCalled();
  });

  it('알림 정리가 실패해도 읽음 처리는 성공으로 돌려준다', async () => {
    // 배지 정리는 부수효과다 — 여기서 던지면 cursor 는 이미 전진했는데 화면은
    // 실패로 보이고, 재시도해도 같은 자리에서 또 죽는다.
    markChatThreadRead.mockRejectedValueOnce(new Error('db down'));

    const result = await markConversationReadAction({
      conversationId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result).toEqual({ ok: true, readAt: '2026-09-05T12:00:00.000Z' });
  });

  it.each([
    [{ conversationId: 'not-a-uuid' }],
    [
      {
        conversationId: '00000000-0000-4000-8000-000000000001',
        unexpected: true,
      },
    ],
  ])('잘못된 입력 %j은 module 호출 전에 거부한다', async (input) => {
    const result = await markConversationReadAction(input as never);

    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(requireActiveWorkspace).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('active workspace 확인이 실패하면 module을 호출하지 않는다', async () => {
    requireActiveWorkspace.mockResolvedValueOnce({
      ok: false,
      error: 'UNAUTHENTICATED',
    });

    const result = await markConversationReadAction({
      conversationId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(markRead).not.toHaveBeenCalled();
  });
});
