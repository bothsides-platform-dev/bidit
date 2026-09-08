import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockAuth = vi.hoisted(() => vi.fn());
const mockGetMembership = vi.hoisted(() => vi.fn());
const mockListForWorkspace = vi.hoisted(() => vi.fn());

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/auth/active-workspace', () => ({
  getMembership: mockGetMembership,
  isApprovedAdmin: (membership: { role: string; approvalStatus: string } | null) =>
    membership?.role === 'admin' && membership.approvalStatus === 'approved',
}));
vi.mock('@/lib/server/repositories/factory', () => ({
  getAuditLogRepo: async () => ({ listForWorkspace: mockListForWorkspace }),
}));
vi.mock('@/components/primitives/PageEnter', () => ({
  PageEnter: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/settings/AuditLogPanel', () => ({
  AuditLogPanel: () => <div data-testid="audit-log-panel" />,
}));

import AuditLogPage from '../page';

const originalMasterEmails = process.env.MASTER_ACCOUNT_EMAILS;

describe('AuditLogPage', () => {
  beforeEach(() => {
    process.env.MASTER_ACCOUNT_EMAILS = 'ops@support-b.com';
    mockAuth.mockReset();
    mockGetMembership.mockReset();
    mockListForWorkspace.mockReset();
    mockAuth.mockResolvedValue({
      user: {
        id: 'master-1',
        email: 'ops@support-b.com',
        workspaceId: 'workspace-1',
        workspaceType: 'buyer',
      },
    });
    mockGetMembership.mockResolvedValue(null);
    mockListForWorkspace.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalMasterEmails === undefined) delete process.env.MASTER_ACCOUNT_EMAILS;
    else process.env.MASTER_ACCOUNT_EMAILS = originalMasterEmails;
  });

  it('운영계정은 멤버십 행 없이 현재 워크스페이스의 활동 기록 화면을 본다', async () => {
    render(await AuditLogPage());

    expect(screen.getByTestId('audit-log-panel')).toBeInTheDocument();
    expect(mockListForWorkspace).toHaveBeenCalledWith('workspace-1', { limit: 50 });
  });
});
