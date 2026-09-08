// RecipientCard — 받는사람 미니카드
// RfpContext.id(uuid) 는 전송용이고 절대 렌더하지 않는다.
// code(사람용 코드) · title 은 각각 있을 때만 렌더한다.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecipientCard } from '../RecipientCard';

const cp = { name: '(주)샘플테크', type: 'buyer' as const, workspaceId: 'ws-buyer-1', logoUpdatedAt: null };

describe('RecipientCard', () => {
  it('rfpContext 없으면 RFP 줄을 렌더하지 않는다', () => {
    render(<RecipientCard counterparty={cp} />);
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('code 와 title 이 모두 있을 때 분리 기호(·)와 함께 렌더한다', () => {
    render(
      <RecipientCard
        counterparty={cp}
        rfpContext={{ id: 'uuid-999', code: 'P-2605-0042', title: '온라인몰 결제대행 선정' }}
      />,
    );
    expect(screen.getByText('P-2605-0042')).toBeInTheDocument();
    expect(screen.getByText(/온라인몰 결제대행 선정/)).toBeInTheDocument();
    expect(screen.getByText('·', { exact: false })).toBeInTheDocument();
  });

  it('title 만 있고 code 가 없으면 분리 기호(·)없이 title 만 렌더한다', () => {
    render(
      <RecipientCard
        counterparty={cp}
        rfpContext={{ id: 'uuid-123', title: '온라인몰 결제대행 선정' }}
      />,
    );
    expect(screen.getByText(/온라인몰 결제대행 선정/)).toBeInTheDocument();
    // code 없으면 · 구분기호도 없어야 한다
    expect(screen.queryByText('·', { exact: false })).not.toBeInTheDocument();
    // uuid 는 절대 렌더하지 않는다
    expect(screen.queryByText('uuid-123')).not.toBeInTheDocument();
  });

  it('id(uuid) 는 code/title 이 함께 있어도 절대 렌더하지 않는다', () => {
    render(
      <RecipientCard
        counterparty={cp}
        rfpContext={{ id: 'some-uuid-value', code: 'P-2605-0042', title: '견적 요청' }}
      />,
    );
    expect(screen.queryByText('some-uuid-value')).not.toBeInTheDocument();
    expect(screen.getByText('P-2605-0042')).toBeInTheDocument();
  });

  it('code 만 있고 title 이 없으면 code 만 렌더하고 · 는 없다', () => {
    render(
      <RecipientCard
        counterparty={cp}
        rfpContext={{ id: 'uuid-abc', code: 'P-2605-0042' }}
      />,
    );
    expect(screen.getByText('P-2605-0042')).toBeInTheDocument();
    expect(screen.queryByText('·', { exact: false })).not.toBeInTheDocument();
  });
});
