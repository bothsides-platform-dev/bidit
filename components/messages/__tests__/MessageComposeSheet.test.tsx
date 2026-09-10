import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// base-ui Menu/Dialog need these in jsdom.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// Server actions are 'use server' — mock them so the drawer drives the UI
// without a DB or session.
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

// File upload goes through the shared presigned upload-client helper — mock it
// so the drawer collects an attachment id without hitting the real 3-step flow.
const uploadAttachment = vi.fn();
vi.mock('@/lib/attachments/upload-client', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachment(...args),
}));

afterEach(() => cleanup());
beforeEach(() => {
  sendChatMessageAction.mockReset().mockResolvedValue({ ok: true, conversationId: 'c1', messageId: 'm1' });
  listTemplatesAction.mockReset().mockResolvedValue({ ok: true, templates: [] });
  saveTemplateAction.mockReset().mockResolvedValue({ ok: true, templateId: 't1' });
  uploadAttachment.mockReset();
});

import { MessageComposeSheet } from '../MessageComposeSheet';

const counterparty = { name: '(주)샘플테크', type: 'buyer' as const, workspaceId: 'ws-buyer-1', logoUpdatedAt: null };
const rfpContext = {
  id: '11111111-1111-1111-1111-111111111111',
  title: '온라인몰 결제대행 선정',
};

function renderSheet() {
  return render(
    <MessageComposeSheet
      open
      onOpenChange={() => {}}
      counterparty={counterparty}
      rfpContext={rfpContext}
    />,
  );
}

describe('MessageComposeSheet (controlled rich compose drawer)', () => {
  it('open=true이면 받는사람 + RFP 컨텍스트 + 본문 입력이 보인다', async () => {
    renderSheet();
    expect(screen.getByPlaceholderText('상대에게 보낼 메시지를 입력하세요')).toBeInTheDocument();
    expect(screen.getByText('온라인몰 결제대행 선정', { exact: false })).toBeInTheDocument();
  });

  it('open되면 저장된 템플릿을 불러오고, 선택하면 본문에 삽입한다', async () => {
    listTemplatesAction.mockResolvedValue({
      ok: true,
      templates: [
        {
          id: 't-1',
          workspaceId: 'ws-buyer-1',
          title: '인사 템플릿',
          body: '안녕하세요, 제안 잘 받았습니다.',
          createdBy: 'u1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const user = userEvent.setup();
    renderSheet();

    await waitFor(() => expect(listTemplatesAction).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: '저장된 템플릿 불러오기' }));
    await user.click(await screen.findByRole('menuitem', { name: /인사 템플릿/ }));

    const textarea = screen.getByPlaceholderText(
      '상대에게 보낼 메시지를 입력하세요',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('안녕하세요, 제안 잘 받았습니다.');
  });

  it('"템플릿으로 저장" 클릭 시 현재 본문으로 saveTemplateAction을 호출한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    const textarea = screen.getByPlaceholderText('상대에게 보낼 메시지를 입력하세요');
    // `user.type` 을 쓰지 않는다 — base-ui Sheet 의 포커스 트랩 아래에서 키 입력이
    // 유실돼 본문이 '템플' 처럼 잘린 채 단언에 도달한다(실측: 같은 커밋에서 전체
    // 실행은 통과, 단독 실행은 실패 — 순서·타이밍 의존). 이 테스트가 재려는 것은
    // "현재 본문이 그대로 저장되는가"이지 타이핑 자체가 아니므로, 값을 한 번에
    // 넣어 재는 대상을 좁힌다.
    fireEvent.change(textarea, { target: { value: '템플릿 본문입니다' } });
    await user.click(screen.getByRole('button', { name: '템플릿으로 저장' }));

    await waitFor(() =>
      expect(saveTemplateAction).toHaveBeenCalledWith(
        expect.objectContaining({ body: '템플릿 본문입니다' }),
      ),
    );
  });

  it('전송 시 sendChatMessageAction을 본문 + rfpId 태그와 함께 호출한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    // 위 테스트와 같은 이유로 `user.type` 을 쓰지 않는다 — **첫 공백에서 잘린다**
    // ('보낼 메시지 본문' → '보낼'). 공백이 없는 입력('본문만', 아래)은 멀쩡한 것이
    // 그 근거다. 재려는 것은 본문이 그대로 전송되는가이지 타이핑이 아니다.
    fireEvent.change(screen.getByPlaceholderText('상대에게 보낼 메시지를 입력하세요'), {
      target: { value: '보낼 메시지 본문' },
    });
    await user.click(screen.getByRole('button', { name: '바로 전송' }));

    await waitFor(() =>
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          counterpartyWorkspaceId: 'ws-buyer-1',
          body: '보낼 메시지 본문',
          rfpId: '11111111-1111-1111-1111-111111111111',
        }),
      ),
    );
  });

  it('f.type이 빈 문자열인 PDF 파일도 확장자 기반으로 첨부 칩에 노출된다', async () => {
    uploadAttachment.mockResolvedValue({ id: 'att-empty-mime', name: '보고서.pdf', size: 2048, mimeType: 'application/pdf' });
    const user = userEvent.setup();
    renderSheet();

    const file = new File([new Uint8Array([1, 2, 3])], '보고서.pdf', { type: '' });
    const input = screen.getByLabelText('파일 첨부', { selector: 'input[type="file"]' });
    await user.upload(input, file);

    expect(await screen.findByText('보고서.pdf')).toBeInTheDocument();
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalled());
  });

  it('지원하지 않는 파일 형식 선택 시 ERROR 칩이 노출된다', async () => {
    renderSheet();

    const file = new File([new Uint8Array([1, 2, 3])], '보고서.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = screen.getByLabelText('파일 첨부', { selector: 'input[type="file"]' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(await screen.findByText('보고서.docx')).toBeInTheDocument();
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('첨부 추가 → 칩 노출 → 전송 시 attachmentIds 포함, 제거하면 빠진다', async () => {
    uploadAttachment.mockResolvedValue({ id: 'att-1', name: '제안서.pdf', size: 1234, mimeType: 'application/pdf' });
    const user = userEvent.setup();
    renderSheet();

    const file = new File([new Uint8Array([1, 2, 3])], '제안서.pdf', {
      type: 'application/pdf',
    });
    const input = screen.getByLabelText('파일 첨부', { selector: 'input[type="file"]' });
    await user.upload(input, file);

    expect(await screen.findByText('제안서.pdf')).toBeInTheDocument();
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: '바로 전송' }));
    await waitFor(() =>
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentIds: ['att-1'] }),
      ),
    );

    // Remount fresh and remove the chip → no attachmentIds on the next send.
    cleanup();
    sendChatMessageAction.mockClear();
    renderSheet();
    await user.upload(
      screen.getByLabelText('파일 첨부', { selector: 'input[type="file"]' }),
      file,
    );
    const chip = await screen.findByText('제안서.pdf');
    const chipRow = chip.closest('[data-slot="attachment-chip"]') as HTMLElement;
    await user.click(within(chipRow).getByRole('button', { name: /제거/ }));
    await waitFor(() => expect(screen.queryByText('제안서.pdf')).not.toBeInTheDocument());

    await user.type(
      screen.getByPlaceholderText('상대에게 보낼 메시지를 입력하세요'),
      '본문만',
    );
    await user.click(screen.getByRole('button', { name: '바로 전송' }));
    await waitFor(() =>
      expect(sendChatMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentIds: [] }),
      ),
    );
  });
});
