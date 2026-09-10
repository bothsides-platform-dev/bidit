import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));
const toast = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: (...a: unknown[]) => toast(...a) }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const acceptPgRequestAction = vi.fn();
const rejectPgRequestAction = vi.fn();
vi.mock('@/lib/server/actions/rfp', () => ({
  acceptPgRequestAction: (...a: unknown[]) => acceptPgRequestAction(...a),
  rejectPgRequestAction: (...a: unknown[]) => rejectPgRequestAction(...a),
}));

import { RfpPendingRequests } from '../RfpPendingRequests';

const reqs = [
  { id: 'req-1', pgWs: { id: 'ws-toss', name: '토스페이먼츠', type: 'pg' as const, logoUpdatedAt: null }, message: '제안 드리고 싶어요', createdAt: new Date().toISOString() },
];

beforeEach(() => {
  toast.mockReset();
  refresh.mockReset();
  acceptPgRequestAction.mockReset();
  rejectPgRequestAction.mockReset();
});
afterEach(cleanup);

describe('RfpPendingRequests', () => {
  it('renders the PG name and pitch message', () => {
    render(<RfpPendingRequests requests={reqs} canEdit />);
    expect(screen.getByText('토스페이먼츠')).toBeInTheDocument();
    expect(screen.getByText('제안 드리고 싶어요')).toBeInTheDocument();
  });

  it('accepts a request', async () => {
    acceptPgRequestAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<RfpPendingRequests requests={reqs} canEdit />);

    await user.click(screen.getByRole('button', { name: '수락' }));
    await waitFor(() =>
      expect(acceptPgRequestAction).toHaveBeenCalledWith({ requestId: 'req-1' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('rejects a request', async () => {
    rejectPgRequestAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<RfpPendingRequests requests={reqs} canEdit />);

    await user.click(screen.getByRole('button', { name: '거절' }));
    await waitFor(() =>
      expect(rejectPgRequestAction).toHaveBeenCalledWith({ requestId: 'req-1' }),
    );
  });

  it('renders nothing when there are no requests', () => {
    const { container } = render(<RfpPendingRequests requests={[]} canEdit />);
    expect(container).toBeEmptyDOMElement();
  });
});
