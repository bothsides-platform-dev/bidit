import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HTTPError } from 'ky';
import type { NormalizedOptions } from 'ky';
import type { PaymentMethod } from '@/lib/types/bid';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const uploadAttachment = vi.fn();
vi.mock('@/lib/attachments/upload-client', () => ({
  uploadAttachment: (...a: unknown[]) => uploadAttachment(...a),
}));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const submitBidMock = vi.fn(
  async (_i: unknown): Promise<{ ok: true; bidId: string } | { ok: false; error: string }> => ({
    ok: true,
    bidId: 'b1',
  }),
);
vi.mock('@/lib/server/actions/bid', () => ({
  submitBidAction: (i: unknown) => submitBidMock(i),
}));
const saveTemplateMock = vi.fn(
  async (_i: unknown): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> => ({
    ok: true,
    templateId: 't1',
  }),
);
vi.mock('@/lib/server/actions/quote-template/saveQuoteTemplateAction', () => ({
  saveQuoteTemplateAction: (i: unknown) => saveTemplateMock(i),
}));
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../RfpBriefPanel', () => ({ RfpBriefPanel: () => <div /> }));
vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));

import { BidWizard } from '../BidWizard';
import { toast } from '@/lib/toast';
import type { QuoteTemplateOption } from '@/lib/types/bid';
import { EMPTY_BID_DRAFT, type BidDraft } from '../../useBidDraft';
import { buyerOf } from '@/lib/types/__tests__/_workspace-fixtures';


const rfp = {
  id: 'rfp-uuid',
  code: 'P-2606-0001',
  requiredPaymentMethods: ['card'] as PaymentMethod[],
  customPaymentMethods: [],
} as never;

// 커스텀 결제수단 포함 RFP — customFees 분리 검증용
const rfpWithCustom = {
  id: 'rfp-uuid',
  code: 'P-2606-0001',
  requiredPaymentMethods: ['card'] as PaymentMethod[],
  customPaymentMethods: [{ id: 'c1', label: '포인트결제' }],
} as never;

// PercentInput 은 label↔input aria 연결이 없어 라벨 텍스트 컨테이너에서 input 을 찾는다.
// (NumericFormat 으로 전환되어 type="number" 가 아니므로 컨테이너의 단일 input 을 집는다.)
function feeInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  return label.closest('.space-y-1')!.querySelector('input') as HTMLInputElement;
}

const draftV3 = (fees: Record<string, string>, memo = '') => ({
  __v: 3, cycleUnit: 'D', cycleNum: '1', settleLimit: '', guaranteeInsurance: '0', fees, memo,
});

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  pushMock.mockClear();
  refreshMock.mockClear();
  submitBidMock.mockClear();
  saveTemplateMock.mockClear();
  uploadAttachment.mockReset();
  vi.mocked(toast).mockClear();
});
afterEach(cleanup);

describe('BidWizard', () => {
  it('1단계 정산조건이 먼저 보인다 (수수료 입력칸은 2단계로 이동해야 보임)', () => {
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    expect(screen.getByText('정산 주기')).toBeInTheDocument();
    expect(screen.queryByText(/카드 수수료/)).not.toBeInTheDocument();
  });

  it('단계 이동 후 입력 → 발송 → submitBidAction 호출 + 인플레이스 갱신(refresh)', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);

    // step1: 정산주기
    await user.clear(screen.getByPlaceholderText('1'));
    await user.type(screen.getByPlaceholderText('1'), '1');
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));

    // step2: 카드는 구간 수단 → general 셀 입력
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));

    // step3 → step4
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // step4: 발송 → 확인 다이얼로그 → 확인
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    expect(submitBidMock.mock.calls[0][0]).toMatchObject({
      rfpId: 'rfp-uuid',
      settleCycle: 'D+1',
      paymentFees: { card: { general: 0.015 } },
      signupFee: 0,
    });
    // 별도 /submitted 페이지로 push 하지 않고 같은 창에서 refresh — PgDealRoomBody 가
    // 제출 완료 상태를 인플레이스 렌더.
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalledWith('/inbox/P-2606-0001/submitted');
  });
});

describe('BidWizard 드래프트 자동 복원(1단계)', () => {
  it('드래프트 없으면 복원 토스트도 배너도 없다', () => {
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    expect(toast).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '불러오기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '무시' })).toBeNull();
  });

  it('의미 있는 드래프트는 묻지 않고 자동 복원 + 토스트 1회', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bid-draft:rfp-uuid', JSON.stringify(draftV3({ 'card:general': '0.40' }, '복원됨')));
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);

    // 묻는 배너/버튼 없음
    expect(screen.queryByRole('button', { name: '불러오기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '무시' })).toBeNull();

    // 복원 토스트
    expect(toast).toHaveBeenCalledWith(
      '이전에 작성하던 내용을 그대로 불러왔어요',
      expect.objectContaining({ id: expect.stringContaining('bid-draft-restored') }),
    );

    // 폼이 이미 복원되어 있다
    await user.click(screen.getByRole('button', { name: '수수료' }));
    expect((screen.getByTestId('fee-cell-card-general') as HTMLInputElement).value).toBe('0.40');
  });

  it('빈(pristine) 드래프트는 복원/토스트하지 않는다', () => {
    localStorage.setItem('bid-draft:rfp-uuid', JSON.stringify(draftV3({})));
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    expect(toast).not.toHaveBeenCalled();
  });

  it('초기화 → 처음부터 다시 → 폼이 비워진다', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bid-draft:rfp-uuid', JSON.stringify(draftV3({ 'card:general': '0.40' })));
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);

    await user.click(screen.getByRole('button', { name: '초기화' }));
    await user.click(screen.getByRole('button', { name: '처음부터 다시' }));

    await user.click(screen.getByRole('button', { name: '수수료' }));
    expect((screen.getByTestId('fee-cell-card-general') as HTMLInputElement).value).toBe('');
  });
});

describe('BidWizard 413 업로드 오류(3단계)', () => {
  it('413 응답 시 파일 크기 오류 메시지', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    // step1 → step2 → step3
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));

    const error413 = new HTTPError(
      new Response('', { status: 413 }),
      new Request('http://localhost/api/files/presign'),
      {} as unknown as NormalizedOptions,
    );
    uploadAttachment.mockRejectedValue(error413);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'big.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText(/파일이 너무 큽니다/)).toBeInTheDocument());
  });
});

describe('BidWizard 템플릿 적용(1단계)', () => {
  it('템플릿 선택 시 정산주기 + 요청 결제수단 요율 채움', async () => {
    const user = userEvent.setup();
    const tmpl: QuoteTemplateOption = {
      id: 't1', name: '표준', settleCycle: 'M+2', settleLimit: 0, guaranteeInsurance: 0,
      signupFee: 0,
      paymentFees: { card: 0.005 },
    };
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} templates={[tmpl]} />);
    await user.selectOptions(screen.getByRole('option', { name: '표준' }).closest('select')!, 't1');
    expect((screen.getByPlaceholderText('1') as HTMLInputElement).value).toBe('2');
    // 카드는 구간 수단 — 구버전 단일요율(0.005) → 전 구간 동일값으로 전개
    await user.click(screen.getByRole('button', { name: '수수료' }));
    expect((screen.getByTestId('fee-cell-card-general') as HTMLInputElement).value).toBe('0.5');
    expect((screen.getByTestId('fee-cell-card-sole') as HTMLInputElement).value).toBe('0.5');
  });

  it('드래프트가 복원돼 있어도 템플릿 선택 시 템플릿 값으로 덮어쓴다', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bid-draft:rfp-uuid', JSON.stringify(draftV3({ 'card:general': '0.40' })));
    const tmpl: QuoteTemplateOption = {
      id: 't1', name: '표준', settleCycle: 'M+2', settleLimit: 0, guaranteeInsurance: 0,
      signupFee: 0,
      paymentFees: { card: 0.005 },
    };
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} templates={[tmpl]} />);

    await user.selectOptions(
      screen.getByRole('option', { name: '표준' }).closest('select')!,
      't1',
    );
    expect((screen.getByPlaceholderText('1') as HTMLInputElement).value).toBe('2');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    expect((screen.getByTestId('fee-cell-card-general') as HTMLInputElement).value).toBe('0.5');
  });

  it('저장된 템플릿이 0개면 빈 상태 안내와 관리 링크를 보인다', () => {
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} templates={[]} />);
    expect(screen.getByText(/저장된 견적 템플릿이 없어요/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '템플릿 관리' });
    expect(link).toHaveAttribute('href', '/quote-templates');
  });

  it('템플릿 적용 시 토스트로 알린다', async () => {
    const user = userEvent.setup();
    const tmpl: QuoteTemplateOption = {
      id: 't1', name: '표준', settleCycle: 'M+2', settleLimit: 0, guaranteeInsurance: 0,
      signupFee: 0,
      paymentFees: { card: 0.005 },
    };
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} templates={[tmpl]} />);
    await user.selectOptions(
      screen.getByRole('option', { name: '표준' }).closest('select')!,
      't1',
    );
    expect(toast).toHaveBeenCalledWith(`‘표준’ 템플릿을 불러왔어요`);
  });
});

describe('BidWizard 제출 — paymentFees / customFees 분리', () => {
  it('enum 요율은 paymentFees, 커스텀 요율은 customFees로 전송', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfpWithCustom} buyer={buyerOf('토스')} />);
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    // 카드는 구간 수단 → general 셀 입력
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.0');
    await user.type(feeInput('포인트결제 수수료'), '2.0');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    const arg = submitBidMock.mock.calls[0][0] as {
      paymentFees: Record<string, unknown>;
      customFees: Record<string, number>;
    };
    expect(arg.paymentFees).toEqual({ card: { general: 0.01 } });
    expect(arg.customFees).toEqual({ c1: 0.02 });
  });
});

describe('BidWizard confirm 닫기', () => {
  it('확인 다이얼로그에서 닫기를 누르면 제출 안 함', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(submitBidMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('BidWizard 구간 수수료 조립', () => {
  it('구간 셀을 채워 발송하면 paymentFees가 구간맵으로 조립된다', async () => {
    const user = userEvent.setup();
    const rfpTiered = {
      id: 'rfp-uuid',
      code: 'P-2606-0001',
      requiredPaymentMethods: ['card', 'virtual_account'] as PaymentMethod[],
      customPaymentMethods: [],
    } as never;
    render(<BidWizard rfp={rfpTiered} buyer={buyerOf('토스')} />);

    // step1: 정산주기
    await user.clear(screen.getByPlaceholderText('1'));
    await user.type(screen.getByPlaceholderText('1'), '1');
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));

    // step2: 카드 구간 셀(영세·일반) + 가상계좌 건당 정액(원)
    await user.type(screen.getByTestId('fee-cell-card-sole'), '0.5');
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.8');
    await user.type(feeInput('가상계좌 건당 수수료'), '300');
    await user.click(screen.getByRole('button', { name: '견적서' }));

    // step3 → step4
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // step4: 발송 → 확인 다이얼로그 → 확인
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    const arg = submitBidMock.mock.calls[0][0] as {
      paymentFees: Record<string, unknown>;
    };
    expect(arg.paymentFees).toMatchObject({
      card: { sole: 0.005, general: expect.closeTo(0.018, 5) },
      virtual_account: 300,
    });
  });
});

describe('BidWizard 네비게이션 푸터', () => {
  it('wizard-nav-footer가 항상 렌더된다', () => {
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    expect(screen.getByTestId('wizard-nav-footer')).toBeInTheDocument();
  });

  it('4단계: 수수료 미입력 시 견적 보내기는 비활성이 아니라, 누르면 수수료 단계로 이동·안내', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />); // cycleNum 기본 '1'(유효) → 첫 미충족 = 수수료(2단계)
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    const footer = screen.getByTestId('wizard-nav-footer');
    const sendBtn = within(footer).getByRole('button', { name: '견적 보내기' });
    expect(sendBtn).not.toBeDisabled();

    await user.click(sendBtn);
    // 수수료(2단계)로 이동 → 수수료 카운터가 보인다
    expect(screen.getByTestId('fees-count')).toBeInTheDocument();
    // 안내 토스트(미충족 단계 hint)
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('수수료'),
      expect.objectContaining({ type: 'error' }),
    );
    // 제출 다이얼로그는 열리지 않는다
    expect(submitBidMock).not.toHaveBeenCalled();
  });
});

describe('BidWizard 가입비(signupFee) 상태 배선', () => {
  it('initialDraft로 signupFee가 시드되면 제출 페이로드에 파싱된 숫자로 포함된다', async () => {
    const user = userEvent.setup();
    const seeded: BidDraft = { ...EMPTY_BID_DRAFT, settleLimit: '50000000', signupFee: '300000' };
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} initialDraft={seeded} />);

    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    expect(submitBidMock.mock.calls[0][0]).toMatchObject({ signupFee: 300000 });
  });

  it('템플릿 적용 시 signupFee가 폼 상태에 반영되어 이후 제출 페이로드에 포함된다', async () => {
    const user = userEvent.setup();
    const tmpl: QuoteTemplateOption = {
      id: 't2',
      name: '가입비 템플릿',
      settleCycle: 'D+1',
      settleLimit: 50_000_000,
      guaranteeInsurance: 0,
      signupFee: 120000,
      paymentFees: { card: 0.005 },
    };
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} templates={[tmpl]} />);
    await user.selectOptions(screen.getByRole('option', { name: '가입비 템플릿' }).closest('select')!, 't2');

    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    expect(submitBidMock.mock.calls[0][0]).toMatchObject({ signupFee: 120000 });
  });

  it('템플릿 저장 시 saveQuoteTemplateAction 페이로드에 signupFee가 포함된다', async () => {
    const user = userEvent.setup();
    const seeded: BidDraft = { ...EMPTY_BID_DRAFT, settleLimit: '50000000', signupFee: '75000' };
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} initialDraft={seeded} />);

    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    await user.click(screen.getByRole('button', { name: '템플릿으로 저장' }));
    await user.type(screen.getByPlaceholderText('템플릿 이름'), '내 템플릿');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(saveTemplateMock).toHaveBeenCalledTimes(1));
    expect(saveTemplateMock.mock.calls[0][0]).toMatchObject({ signupFee: 75000 });
  });
});

describe('BidWizard 계약서 템플릿 피커(4단계)', () => {
  it('signingTemplates가 있으면 피커를 보이고 선택한 값을 제출 페이로드에 포함한다', async () => {
    const user = userEvent.setup();
    render(
      <BidWizard
        rfp={rfp}
        buyer={buyerOf('토스')}
        signingTemplates={[
          { id: 'st1', kind: 'pdf', name: '표준 계약서' },
        ]}
      />,
    );

    // step1: 정산조건
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    // step2: 수수료
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    // step3 → step4
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // 처음 보는 PG 도 피커의 용도를 알 수 있어야 한다 — 한 줄 설명이 함께 보인다.
    expect(screen.getByText(/선정되면 딜룸에서 이 계약서로 바로 발송할 수 있어요/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('계약서 템플릿'), '표준 계약서');

    // step4: 발송 → 확인 다이얼로그 → 확인
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    expect(submitBidMock.mock.calls[0][0]).toMatchObject({ signingTemplateId: 'st1' });
  });

  // M23 — 선택이 초안에 안 실리면 "그대로 불러왔어요" 복원 뒤 제출이 NULL 로 나간다.
  it('드래프트의 계약서 템플릿 선택이 복원되어 제출 페이로드에 실린다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'bid-draft:rfp-uuid',
      JSON.stringify({ ...draftV3({ 'card:general': '0.40' }), signingTemplateId: 'st1' }),
    );
    render(
      <BidWizard
        rfp={rfp}
        buyer={buyerOf('토스')}
        signingTemplates={[
          { id: 'st1', kind: 'pdf', name: '표준 계약서' },
        ]}
      />,
    );

    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // 복원된 선택이 피커에 이미 반영돼 있다.
    expect((screen.getByLabelText('계약서 템플릿') as HTMLSelectElement).value).toBe('st1');

    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));
    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    expect(submitBidMock.mock.calls[0][0]).toMatchObject({ signingTemplateId: 'st1' });
  });

  // 피커가 없는 표면(게스트·샘플·kill switch 로 숨김)에서는 목록이 없는 것이지
  // 템플릿이 사라진 게 아니다. 여기서 걷어내면 마운트 effect 의 saveDraft +
  // useBidDraft 의 언마운트 flush 가 초안을 실제로 파괴한다 — 위저드를 잠깐
  // 열었다 닫기만 해도 선택이 영영 사라지고, '다시 열면 그대로 있어요' 약속이 깨진다.
  it('피커가 없는 표면(signingTemplates undefined)에서는 초안 선택을 건드리지 않는다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'bid-draft:rfp-uuid',
      JSON.stringify({ ...draftV3({ 'card:general': '0.40' }), signingTemplateId: 'st1' }),
    );
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);

    expect(toast).not.toHaveBeenCalledWith(
      expect.stringContaining('템플릿이 삭제'),
      expect.anything(),
    );

    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    expect(screen.queryByLabelText('계약서 템플릿')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '템플릿 관리' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    // 선택은 살아서 제출까지 간다 — 플래그를 되돌리면 그 자리에 그대로 있어야 한다.
    // (재견적 라운드는 새 bids 행을 만들므로, 여기서 빠지면 연결이 영구 소실된다.)
    expect(submitBidMock.mock.calls[0][0]).toMatchObject({ signingTemplateId: 'st1' });
  });

  // 데이터 소실 회귀: 제출까지 갈 필요도 없다. 마운트 effect 가 saveDraft(fields) 를
  // 부르고 useBidDraft 는 언마운트에서 pendingRef 를 동기 flush 하므로, 위저드를
  // 잠깐 열었다 닫는 것만으로 스크럽된 초안이 localStorage 에 덮어써진다.
  it('피커가 없는 표면에서 위저드를 열었다 닫아도 저장된 초안의 템플릿 선택이 살아있다', () => {
    const stored = { ...draftV3({ 'card:general': '0.40' }), signingTemplateId: 'st1' };
    localStorage.setItem('bid-draft:rfp-uuid', JSON.stringify(stored));

    const view = render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);
    view.unmount(); // 언마운트 flush 경로를 그대로 탄다

    expect(JSON.parse(localStorage.getItem('bid-draft:rfp-uuid') ?? '{}')).toMatchObject({
      signingTemplateId: 'st1',
    });
  });

  it('복원된 템플릿이 그 사이 삭제됐으면 무음 드롭이 아니라 안내한다', async () => {
    localStorage.setItem(
      'bid-draft:rfp-uuid',
      JSON.stringify({ ...draftV3({ 'card:general': '0.40' }), signingTemplateId: 'gone' }),
    );
    render(
      <BidWizard
        rfp={rfp}
        buyer={buyerOf('토스')}
        signingTemplates={[
          { id: 'st1', kind: 'pdf', name: '표준 계약서' },
        ]}
      />,
    );
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('템플릿이 삭제'),
      expect.anything(),
    );
  });

  // 템플릿 0개일 때 블록이 통째로 사라지면 이 기능의 존재를 알 길이 없다 — step1
  // 견적 템플릿 피커와 같은 문법으로 안내 + /contract-templates 링크를 보여준다.
  // 제출 페이로드에는 여전히 signingTemplateId 가 실리지 않는다.
  it('signingTemplates가 비어 있으면 안내 힌트+템플릿 관리 링크를 보이고 페이로드에는 없다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} signingTemplates={[]} />);

    // step1: 정산조건
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    // step2: 수수료
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    // step3 → step4
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // Select 는 없다 — 대신 안내와 관리 화면 링크.
    expect(screen.queryByLabelText('계약서 템플릿')).not.toBeInTheDocument();
    expect(screen.getByText(/저장된 계약서 템플릿이 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '템플릿 관리' })).toHaveAttribute(
      'href',
      '/contract-templates',
    );

    // step4: 발송 → 확인 다이얼로그 → 확인
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    expect(submitBidMock.mock.calls[0][0]).not.toHaveProperty('signingTemplateId');
  });

  // undefined = 표면 자체가 해당 없음(게스트·샘플 플로) — 힌트도 Select 도 없다.
  // []("템플릿 0개인 PG")와 시맨틱이 다르다.
  it('signingTemplates가 undefined 면 피커도 안내 힌트도 없다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />);

    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    expect(screen.queryByLabelText('계약서 템플릿')).not.toBeInTheDocument();
    expect(screen.queryByText(/저장된 계약서 템플릿이 없어요/)).not.toBeInTheDocument();
  });
});

describe('BidWizard 서버 거부 매핑', () => {
  it('INVALID_ATTACHMENT 거부 시 견적서(3) 단계로 이동한다', async () => {
    const user = userEvent.setup();
    submitBidMock.mockResolvedValueOnce({ ok: false as const, error: 'INVALID_ATTACHMENT' });
    render(<BidWizard rfp={rfp} buyer={buyerOf('토스')} />); // cycleNum 기본 '1'
    await user.type(screen.getByPlaceholderText('50,000,000'), '50000000');

    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.type(screen.getByTestId('fee-cell-card-general'), '1.5');
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기' }));
    await user.click(screen.getByRole('button', { name: '견적 보내기', hidden: false }));

    await waitFor(() => expect(submitBidMock).toHaveBeenCalledTimes(1));
    // 견적서(3단계)로 이동 → 파일 입력이 보인다
    await waitFor(() =>
      expect(document.querySelector('input[type="file"]')).toBeInTheDocument(),
    );
  });
});
