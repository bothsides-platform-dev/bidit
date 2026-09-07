// MessageBubble — 상대방·팀 채팅 공용 말풍선 행. 본문은 renderBody 슬롯, 첨부/타임스탬프/
// 전송중 점은 공통. 발신자 헤더·구분선·읽음표시 등 화면별 요소는 호출처 책임.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('../MessageAttachmentGrid', () => ({
  MessageAttachmentGrid: () => <div data-testid="attach-grid" />,
}));

import { MessageBubble } from '../MessageBubble';

const renderBody = (b: string): ReactNode => <span>{b}</span>;
const base = {
  isSelf: false,
  createdAt: '2026-06-16T01:00:00.000Z',
  body: '안녕하세요',
  attachments: [] as never[],
  renderBody,
};

describe('MessageBubble', () => {
  it('renders the body through the renderBody slot', () => {
    render(<MessageBubble {...base} />);
    expect(screen.getByText('안녕하세요')).toBeInTheDocument();
  });

  it('shows the sending dot when pending', () => {
    render(<MessageBubble {...base} pending />);
    expect(screen.getByLabelText('전송 중')).toBeInTheDocument();
  });

  it('shows a timestamp (and no sending dot) when not pending', () => {
    render(<MessageBubble {...base} />);
    expect(screen.queryByLabelText('전송 중')).toBeNull();
  });

  it('renders the attachment grid only when there are attachments', () => {
    const { rerender } = render(<MessageBubble {...base} attachments={[] as never[]} />);
    expect(screen.queryByTestId('attach-grid')).toBeNull();
    rerender(
      <MessageBubble
        {...base}
        attachments={[{ id: 'a', name: 'f.pdf', size: 1, mimeType: 'application/pdf', url: '/x' }] as never[]}
      />,
    );
    expect(screen.getByTestId('attach-grid')).toBeInTheDocument();
  });

  it('reverses the layout for self messages', () => {
    const { container } = render(<MessageBubble {...base} isSelf />);
    expect(container.querySelector('.flex-row-reverse')).not.toBeNull();
  });

});
