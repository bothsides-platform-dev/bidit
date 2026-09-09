import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toast = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const requestWorkspaceNameChangeAction = vi.fn();
vi.mock('@/lib/server/actions/workspace/requestWorkspaceNameChangeAction', () => ({
  requestWorkspaceNameChangeAction: (...args: unknown[]) => requestWorkspaceNameChangeAction(...args),
}));

import { WorkspaceNameForm } from '../WorkspaceNameForm';

beforeEach(() => {
  toast.mockReset();
  refresh.mockReset();
  requestWorkspaceNameChangeAction.mockReset();
});
afterEach(() => cleanup());

describe('WorkspaceNameForm', () => {
  it('이름 변경을 즉시 저장하지 않고 운영자 확인 요청으로 안내한다', async () => {
    requestWorkspaceNameChangeAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<WorkspaceNameForm workspaceId="ws-rendered" currentName="테스트 회사" canEdit pendingRequest={null} />);

    await user.click(screen.getByRole('button', { name: '변경 요청' }));
    expect(screen.getByText('운영자가 확인한 뒤 이름이 바뀌어요.')).toBeDefined();
    const input = screen.getByRole('textbox', { name: '변경할 이름' });
    await user.clear(input);
    await user.type(input, '새 이름');
    await user.click(screen.getByRole('button', { name: '이름 변경 요청' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('이름 변경을 요청했어요.'));
    expect(requestWorkspaceNameChangeAction).toHaveBeenCalledWith({
      workspaceId: 'ws-rendered',
      name: '새 이름',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('대기 요청이 있으면 추가 변경 입력을 막고 요청 이름을 보여준다', () => {
    render(<WorkspaceNameForm workspaceId="ws-rendered" currentName="테스트 회사" canEdit pendingRequest={{ requestedName: '새 이름' }} />);
    expect(screen.getByText('새 이름')).toBeDefined();
    expect(screen.getByText('운영자 확인 중')).toBeDefined();
    expect(screen.queryByRole('button', { name: '변경 요청' })).toBeNull();
  });

  it('권한이 없으면 변경 요청 버튼을 표시하지 않는다', () => {
    render(<WorkspaceNameForm workspaceId="ws-rendered" currentName="테스트 회사" canEdit={false} pendingRequest={null} />);
    expect(screen.queryByRole('button', { name: '변경 요청' })).toBeNull();
  });

  it('최근 요청이 거절되면 사유를 보여주고 다시 요청할 수 있다', () => {
    render(
      <WorkspaceNameForm
        workspaceId="ws-rendered"
        currentName="테스트 회사"
        canEdit
        pendingRequest={null}
        lastRejectedRequest={{ requestedName: '새 이름', reason: '사업자 정보와 달라요.' }}
      />,
    );
    expect(screen.getByText('사업자 정보와 달라요.')).toBeDefined();
    expect(screen.getByRole('button', { name: '변경 요청' })).toBeDefined();
  });

  it.each([
    ['WORKSPACE_INACTIVE', '현재 워크스페이스에서는 이름 변경을 요청할 수 없어요.'],
    ['WORKSPACE_CHANGED', '다른 워크스페이스로 전환됐어요. 새로고침 후 다시 시도해 주세요.'],
    ['UNKNOWN_ERROR', '요청하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('요청 실패 %s를 복구 가능한 문구로 보여주고 새로고침하지 않는다', async (error, message) => {
    requestWorkspaceNameChangeAction.mockResolvedValue({ ok: false, error });
    const user = userEvent.setup();
    render(<WorkspaceNameForm workspaceId="ws-rendered" currentName="테스트 회사" canEdit pendingRequest={null} />);

    await user.click(screen.getByRole('button', { name: '변경 요청' }));
    const input = screen.getByRole('textbox', { name: '변경할 이름' });
    await user.clear(input);
    await user.type(input, '새 이름');
    await user.click(screen.getByRole('button', { name: '이름 변경 요청' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(message, { type: 'error' }));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '변경할 이름' })).toBeInTheDocument();
  });

  it('요청 처리 중에는 버튼을 잠가 연속 제출을 막는다', async () => {
    let resolveRequest!: (result: { ok: true }) => void;
    requestWorkspaceNameChangeAction.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const user = userEvent.setup();
    render(<WorkspaceNameForm workspaceId="ws-rendered" currentName="테스트 회사" canEdit pendingRequest={null} />);

    await user.click(screen.getByRole('button', { name: '변경 요청' }));
    const input = screen.getByRole('textbox', { name: '변경할 이름' });
    await user.clear(input);
    await user.type(input, '새 이름');
    await user.click(screen.getByRole('button', { name: '이름 변경 요청' }));

    const pendingButton = screen.getByRole('button', { name: '요청 중…' });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(requestWorkspaceNameChangeAction).toHaveBeenCalledTimes(1);

    resolveRequest({ ok: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('이름 변경을 요청했어요.'));
  });

  it('서버 액션이 예외를 던져도 로딩을 풀고 일반 오류를 안내한다', async () => {
    requestWorkspaceNameChangeAction.mockRejectedValue(new Error('network unavailable'));
    const user = userEvent.setup();
    render(<WorkspaceNameForm workspaceId="ws-rendered" currentName="테스트 회사" canEdit pendingRequest={null} />);

    await user.click(screen.getByRole('button', { name: '변경 요청' }));
    const input = screen.getByRole('textbox', { name: '변경할 이름' });
    await user.clear(input);
    await user.type(input, '새 이름');
    await user.click(screen.getByRole('button', { name: '이름 변경 요청' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        '요청하지 못했어요. 잠시 후 다시 시도해 주세요.',
        { type: 'error' },
      );
    });
    expect(screen.getByRole('button', { name: '이름 변경 요청' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
