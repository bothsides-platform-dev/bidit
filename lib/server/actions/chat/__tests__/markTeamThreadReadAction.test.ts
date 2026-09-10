import { beforeEach, describe, expect, it, vi } from 'vitest';

const { markRead, requireActiveWorkspace, markChatThreadRead } = vi.hoisted(() => ({
  markRead: vi.fn(),
  requireActiveWorkspace: vi.fn(),
  markChatThreadRead: vi.fn(),
}));

vi.mock('../_shared', () => ({ requireActiveWorkspace }));

vi.mock('@/lib/server/services/team-chat', () => ({
  getTeamChatService: vi.fn().mockResolvedValue({ markRead }),
}));

vi.mock('@/lib/server/repositories/factory', () => ({
  getNotificationRepo: vi.fn().mockResolvedValue({ markChatThreadRead }),
}));

import { markTeamThreadReadAction } from '../markTeamThreadReadAction';

const RFP_ID = '00000000-0000-4000-8000-0000000000aa';

describe('markTeamThreadReadAction', () => {
  beforeEach(() => {
    markRead.mockReset();
    markRead.mockResolvedValue({ ok: true, readAt: '2026-09-05T12:00:00.000Z' });
    markChatThreadRead.mockReset();
    markChatThreadRead.mockResolvedValue(undefined);
    requireActiveWorkspace.mockReset();
    requireActiveWorkspace.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceType: 'pg',
    });
  });

  it('그 팀 스레드의 대기 중 인앱 알림도 함께 읽음 처리한다', async () => {
    const result = await markTeamThreadReadAction({
      rfpId: RFP_ID,
      throughMessageId: '00000000-0000-4000-8000-0000000000bb',
    });

    expect(result).toEqual({ ok: true, readAt: '2026-09-05T12:00:00.000Z' });
    expect(markChatThreadRead).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      `/messages?t=${RFP_ID}`,
      new Date('2026-09-05T12:00:00.000Z'),
    );
    expect(markRead).toHaveBeenCalledWith(
      RFP_ID,
      expect.any(Object),
      '00000000-0000-4000-8000-0000000000bb',
    );
  });

  it('읽음 cursor 갱신이 실패하면 알림을 건드리지 않는다', async () => {
    markRead.mockResolvedValueOnce({ ok: false, error: 'FORBIDDEN' });

    const result = await markTeamThreadReadAction({
      rfpId: RFP_ID,
      throughMessageId: '00000000-0000-4000-8000-0000000000bb',
    });

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(markChatThreadRead).not.toHaveBeenCalled();
  });

  it('알림 정리가 실패해도 읽음 처리는 성공으로 돌려준다', async () => {
    markChatThreadRead.mockRejectedValueOnce(new Error('db down'));

    const result = await markTeamThreadReadAction({
      rfpId: RFP_ID,
      throughMessageId: '00000000-0000-4000-8000-0000000000bb',
    });

    expect(result).toEqual({ ok: true, readAt: '2026-09-05T12:00:00.000Z' });
  });

  it('잘못된 입력은 서비스 호출 전에 거부한다', async () => {
    const result = await markTeamThreadReadAction({ rfpId: 'not-a-uuid' } as never);

    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(markRead).not.toHaveBeenCalled();
    expect(markChatThreadRead).not.toHaveBeenCalled();
  });
});
