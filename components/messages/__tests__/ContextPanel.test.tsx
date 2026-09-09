import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

vi.mock('@/lib/server/actions/chat/listConversationAttachments', () => ({
  listConversationAttachments: vi.fn().mockResolvedValue([]),
}));

// AttachmentGalleryPanel uses useEffect + server action — stub it to keep tests pure
vi.mock('../AttachmentGalleryPanel', () => ({
  AttachmentGalleryPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="gallery-panel" data-conversation={conversationId} />
  ),
}));

import { ContextPanel } from '../ContextPanel';

describe('ContextPanel', () => {
  it('rfpContext 없으면 RFP 섹션을 렌더하지 않는다', () => {
    render(<ContextPanel conversationId="conv-1" />);
    expect(screen.queryByText('견적 요청')).not.toBeInTheDocument();
    expect(screen.getByText('공유 파일')).toBeInTheDocument();
  });

  it('rfpContext 있으면 코드와 제목을 렌더한다', () => {
    render(
      <ContextPanel
        conversationId="conv-1"
        rfpContext={{ code: 'P-2605-0042', title: '온라인 결제 견적', status: 'sent', deadline: '2026-07-01T00:00:00.000Z' }}
      />,
    );
    expect(screen.getByText('견적 요청')).toBeInTheDocument();
    expect(screen.getByText('P-2605-0042')).toBeInTheDocument();
    expect(screen.getByText('온라인 결제 견적')).toBeInTheDocument();
  });

  it('status가 "sent"이면 "요청 보냄" 칩을 렌더한다', () => {
    render(
      <ContextPanel
        conversationId="conv-1"
        rfpContext={{ code: 'P-2605-0042', title: '견적', status: 'sent', deadline: null }}
      />,
    );
    expect(screen.getByText('요청 보냄')).toBeInTheDocument();
  });

  it('deadline이 있으면 날짜를 렌더한다', () => {
    render(
      <ContextPanel
        conversationId="conv-1"
        rfpContext={{ code: 'P-2605-0042', title: '견적', status: 'sent', deadline: '2026-07-01T00:00:00.000Z' }}
      />,
    );
    expect(screen.getByText(/7월/)).toBeInTheDocument();
  });

  it('status와 deadline이 없어도 크래시하지 않는다', () => {
    render(
      <ContextPanel
        conversationId="conv-1"
        rfpContext={{ code: 'P-2605-0042', title: '견적' }}
      />,
    );
    expect(screen.getByText('P-2605-0042')).toBeInTheDocument();
  });
});
