import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DealRoomActionRail } from '../DealRoomActionRail';

afterEach(cleanup);

const icon = <svg data-testid="icon" />;

describe('DealRoomActionRail', () => {
  it('액션 라벨을 모두 버튼으로 렌더한다', () => {
    render(
      <DealRoomActionRail
        actions={[
          { id: 'award', label: '선정', icon, onSelect: () => {} },
          { id: 'requote', label: '재요청', icon, onSelect: () => {} },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: '선정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재요청' })).toBeInTheDocument();
  });

  it('버튼 클릭 시 해당 onSelect 를 호출한다', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DealRoomActionRail actions={[{ id: 'award', label: '선정', icon, onSelect }]} />,
    );
    await user.click(screen.getByRole('button', { name: '선정' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('disabled 액션은 비활성화되고 클릭해도 onSelect 가 호출되지 않는다', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DealRoomActionRail
        actions={[{ id: 'award', label: '선정', icon, onSelect, disabled: true }]}
      />,
    );
    const btn = screen.getByRole('button', { name: '선정' });
    expect(btn).toBeDisabled();
    await user.click(btn).catch(() => {});
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('dot 이 있으면 상태 점을 그린다', () => {
    render(
      <DealRoomActionRail
        actions={[
          { id: 'contract', label: '계약', icon: <span />, onSelect: vi.fn(), dot: 'warning' },
          { id: 'compare', label: '견적 비교', icon: <span />, onSelect: vi.fn() },
        ]}
      />,
    );
    const dots = screen.getAllByTestId('rail-dot');
    expect(dots).toHaveLength(1);
    // jsdom 은 CSS 변수 값을 계산하지 않으므로 style 속성 문자열로 검증한다.
    expect(dots[0].getAttribute('style')).toContain('--md-sys-color-warning');
  });

  it('dotLabel 이 있으면 색으로만 전달되던 상태가 접근성 이름에도 실린다', () => {
    render(
      <DealRoomActionRail
        actions={[
          {
            id: 'contract',
            label: '계약',
            icon: <span />,
            onSelect: vi.fn(),
            dot: 'primary',
            dotLabel: '서명 진행 중',
          },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: '계약 서명 진행 중' })).toBeInTheDocument();
  });

  it('dotLabel 이 없으면 버튼 접근성 이름은 라벨만이다(기존 동작 유지)', () => {
    render(
      <DealRoomActionRail
        actions={[{ id: 'award', label: '선정', icon, onSelect: vi.fn() }]}
      />,
    );
    expect(screen.getByRole('button', { name: '선정' })).toBeInTheDocument();
  });

  it('종결 작업은 입력 순서와 무관하게 기본 작업 뒤의 별도 키보드 순서에 둔다', () => {
    render(
      <DealRoomActionRail
        actions={[
          { id: 'cancel', label: '취소', icon, onSelect: vi.fn(), placement: 'bottom' },
          { id: 'award', label: '선정', icon, onSelect: vi.fn() },
          { id: 'close', label: '마감', icon, onSelect: vi.fn(), placement: 'bottom' },
          { id: 'requote', label: '재요청', icon, onSelect: vi.fn() },
        ]}
      />,
    );

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '선정',
      '재요청',
      '취소',
      '마감',
    ]);
  });
});
