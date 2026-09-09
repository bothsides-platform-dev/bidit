import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
const mockPathname = vi.fn(() => '/rfp');
const mockSearchParams = vi.fn(() => new URLSearchParams(''));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

import { BoardFilterBar } from '../BoardFilterBar';

const GRADE = [
  { value: 'sole', label: '영세' },
  { value: 'sme1', label: '중소1' },
  { value: 'general', label: '일반' },
];

const STATUS = [
  { value: 'active', label: '진행중' },
  { value: 'closed', label: '마감' },
];

beforeEach(() => {
  replace.mockClear();
  mockPathname.mockReturnValue('/rfp');
  mockSearchParams.mockReturnValue(new URLSearchParams(''));
});
afterEach(() => cleanup());

describe('BoardFilterBar', () => {
  it('renders status filter chips', () => {
    render(<BoardFilterBar statusOptions={STATUS} gradeOptions={GRADE} />);
    expect(screen.getByRole('group', { name: '상태' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '진행중' })).toBeInTheDocument();
  });

  it('selecting a status chip pushes ?status=active', async () => {
    const user = userEvent.setup();
    render(<BoardFilterBar statusOptions={STATUS} gradeOptions={GRADE} />);
    await user.click(screen.getByRole('button', { name: '진행중' }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toContain('status=active');
  });

  it('selecting an active status chip clears ?status', async () => {
    const user = userEvent.setup();
    mockSearchParams.mockReturnValue(new URLSearchParams('status=active'));
    render(<BoardFilterBar statusOptions={STATUS} gradeOptions={GRADE} />);
    await user.click(screen.getByRole('button', { name: '진행중' }));
    expect(replace.mock.calls[0][0]).not.toContain('status=');
  });

  it('selecting a deadline bucket pushes ?deadline=d7', async () => {
    const user = userEvent.setup();
    render(<BoardFilterBar statusOptions={STATUS} gradeOptions={GRADE} />);
    await user.click(screen.getByRole('button', { name: '마감임박' }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toContain('deadline=d7');
  });

  it('selecting a grade pushes ?grade=sme1 and preserves unrelated params', async () => {
    const user = userEvent.setup();
    mockSearchParams.mockReturnValue(new URLSearchParams('deadline=d7'));
    render(<BoardFilterBar statusOptions={STATUS} gradeOptions={GRADE} />);
    await user.selectOptions(screen.getByLabelText('가맹점 등급'), 'sme1');
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain('grade=sme1');
    expect(url).toContain('deadline=d7');
  });

  it('preserves status param when changing grade', async () => {
    const user = userEvent.setup();
    mockSearchParams.mockReturnValue(new URLSearchParams('status=active'));
    render(<BoardFilterBar statusOptions={STATUS} gradeOptions={GRADE} />);
    await user.selectOptions(screen.getByLabelText('가맹점 등급'), 'sme1');
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain('status=active');
    expect(url).toContain('grade=sme1');
  });
});
