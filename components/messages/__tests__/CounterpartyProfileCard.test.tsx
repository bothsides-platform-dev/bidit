import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const sendChatMessageAction = vi.fn();
const listTemplatesAction = vi.fn();
const saveTemplateAction = vi.fn();
vi.mock('@/lib/server/actions/chat/sendChatMessageAction', () => ({
  sendChatMessageAction: (...args: unknown[]) => sendChatMessageAction(...args),
}));
vi.mock('@/lib/server/actions/chat/listTemplatesAction', () => ({
  listTemplatesAction: (...args: unknown[]) => listTemplatesAction(...args),
}));
vi.mock('@/lib/server/actions/chat/saveTemplateAction', () => ({
  saveTemplateAction: (...args: unknown[]) => saveTemplateAction(...args),
}));
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));

const presenceRef: { value: { online: boolean; activity: 'active' | 'idle' | 'offline' } } = {
  value: { online: false, activity: 'offline' },
};
vi.mock('@/components/presence/WorkspacePresenceProvider', () => ({
  useWorkspacePresence: () => presenceRef.value,
}));

afterEach(() => cleanup());
beforeEach(() => {
  presenceRef.value = { online: false, activity: 'offline' };
  sendChatMessageAction.mockReset().mockResolvedValue({ ok: true, conversationId: 'c1', messageId: 'm1' });
  listTemplatesAction.mockReset().mockResolvedValue({ ok: true, templates: [] });
  saveTemplateAction.mockReset().mockResolvedValue({ ok: true, templateId: 't1' });
});

import { CounterpartyProfileCard } from '../CounterpartyProfileCard';

const pg = { name: '토스페이먼츠', type: 'pg' as const, workspaceId: 'ws-pg-1', logoUpdatedAt: null };

describe('CounterpartyProfileCard', () => {
  it('variant=profile 트리거에 상대 이름이 보인다', () => {
    render(<CounterpartyProfileCard counterparty={pg} variant="profile" />);
    expect(screen.getByText('토스페이먼츠')).toBeInTheDocument();
  });

  it('트리거 클릭 시 신원 카드(이름 + 타입 칩)와 메시지 보내기 버튼이 뜬다', async () => {
    const user = userEvent.setup();
    render(<CounterpartyProfileCard counterparty={pg} variant="profile" />);

    await user.click(screen.getByRole('button', { name: '토스페이먼츠 프로필' }));

    // 카드 안에 타입 칩(PG)과 메시지 버튼이 보인다.
    expect(await screen.findByText('PG')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '메시지 보내기' })).toBeInTheDocument();
  });

  it('메시지 보내기 클릭 시 작성 드로어가 열린다', async () => {
    const user = userEvent.setup();
    render(<CounterpartyProfileCard counterparty={pg} variant="avatar" />);

    await user.click(screen.getByRole('button', { name: '토스페이먼츠 프로필' }));
    await user.click(await screen.findByRole('button', { name: '메시지 보내기' }));

    expect(
      await screen.findByPlaceholderText('상대에게 보낼 메시지를 입력하세요'),
    ).toBeInTheDocument();
  });

  it('상대가 온라인이면 카드에 온라인 표시가 보인다', async () => {
    presenceRef.value = { online: true, activity: 'active' };
    const user = userEvent.setup();
    render(<CounterpartyProfileCard counterparty={pg} variant="avatar" />);

    await user.click(screen.getByRole('button', { name: '토스페이먼츠 프로필' }));

    expect(await screen.findByLabelText('온라인')).toBeInTheDocument();
  });

  it('workspaceId가 없으면 메시지 보내기 버튼을 노출하지 않는다(신원만 표시)', async () => {
    const user = userEvent.setup();
    render(
      <CounterpartyProfileCard
        counterparty={{ name: '미상회사', type: 'buyer', logoUpdatedAt: null }}
        variant="profile"
      />,
    );

    await user.click(screen.getByRole('button', { name: '미상회사 프로필' }));

    expect(await screen.findByText('구매사')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '메시지 보내기' })).not.toBeInTheDocument();
  });
});
