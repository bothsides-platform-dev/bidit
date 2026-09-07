import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaymentMethod } from '@/lib/types/bid';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
vi.mock('@/lib/http', () => ({ http: { post: vi.fn() } }));
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('use http client')));

const { uploadAttachmentMock } = vi.hoisted(() => ({
  uploadAttachmentMock: vi.fn(),
}));
vi.mock('@/lib/attachments/upload-client', () => ({
  uploadAttachment: (...a: unknown[]) => uploadAttachmentMock(...a),
}));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

vi.mock('@/lib/server/actions/bid', () => ({
  submitBidAction: vi.fn(async () => ({ ok: true as const, bidId: 'b1' })),
}));
const { saveQuoteTemplateActionMock } = vi.hoisted(() => ({
  saveQuoteTemplateActionMock: vi.fn(async () => ({ ok: true as const, templateId: 't1' })),
}));
vi.mock('@/lib/server/actions/quote-template/saveQuoteTemplateAction', () => ({
  saveQuoteTemplateAction: saveQuoteTemplateActionMock,
}));
const toastMock = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock('../../RfpBriefPanel', () => ({ RfpBriefPanel: () => <div /> }));
vi.mock('@/components/messages/CounterpartyProfileCard', () => ({
  CounterpartyProfileCard: ({ counterparty }: { counterparty: { name: string } }) => (
    <span>{counterparty.name}</span>
  ),
}));

import { BidWizard } from '../BidWizard';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
// 구매사 신원 fixture — 아바타를 그리는 화면은 이름 문자열이 아니라 이 객체를 받는다.
const buyerOf = (name: string): WorkspaceDisplay => ({
  id: 'ws-buyer',
  name,
  type: 'buyer',
  logoUpdatedAt: null,
});


const rfp = {
  id: 'tutorial-rfp',
  code: 'TUTORIAL',
  requiredPaymentMethods: ['card'] as PaymentMethod[],
  customPaymentMethods: [],
} as never;

beforeEach(() => {
  localStorage.clear();
  toastMock.mockClear();
  saveQuoteTemplateActionMock.mockClear();
  uploadAttachmentMock.mockReset();
});
afterEach(cleanup);

describe('BidWizard 튜토리얼 코치마크 훅', () => {
  it('폼 콘텐츠 영역에 data-coachmark="tutorial-bid-form"이 있다', () => {
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} />);
    expect(document.querySelector('[data-coachmark="tutorial-bid-form"]')).toBeInTheDocument();
  });

  it('1단계에서는 제출 버튼(tutorial-bid-submit)이 없고, 4단계(검토·발송) 도달 시에만 나타난다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} />);
    expect(document.querySelector('[data-coachmark="tutorial-bid-submit"]')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    expect(document.querySelector('[data-coachmark="tutorial-bid-submit"]')).toBeInTheDocument();
  });

  it('제출 확인 다이얼로그가 열리면 확인 버튼에 tutorial-bid-confirm 앵커가 붙는다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} onSampleSubmit={() => {}} />);
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // 다이얼로그 열기 전엔 확인 앵커가 없다.
    expect(document.querySelector('[data-coachmark="tutorial-bid-confirm"]')).not.toBeInTheDocument();

    await user.click(document.querySelector('[data-coachmark="tutorial-bid-submit"]') as HTMLElement);

    // pgWriteTour 마지막 스텝이 링하는 앵커 — 배선이 빠지면 e2e까지 가야 잡히므로 여기서 고정.
    const confirmAnchor = document.querySelector('[data-coachmark="tutorial-bid-confirm"]');
    expect(confirmAnchor).toBeInTheDocument();
    expect(confirmAnchor).toHaveTextContent('견적 보내기');
  });

  it('푸터 다음 버튼에 스텝별 tutorial-bid-next-N 앵커가 붙는다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} />);
    expect(document.querySelector('[data-coachmark="tutorial-bid-next-1"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '수수료' }));
    expect(document.querySelector('[data-coachmark="tutorial-bid-next-2"]')).toBeInTheDocument();
    expect(document.querySelector('[data-coachmark="tutorial-bid-next-1"]')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '견적서' }));
    expect(document.querySelector('[data-coachmark="tutorial-bid-next-3"]')).toBeInTheDocument();
  });

  it('저장된 초안이 initialDraft 시드와 동일하면 복원 토스트를 띄우지 않는다 (baseline이 시드)', async () => {
    const { tutorialBidDraftSeed } = await import('@/lib/onboarding/tutorial-fixtures');
    localStorage.setItem('bid-draft:tutorial-rfp', JSON.stringify(tutorialBidDraftSeed));
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} initialDraft={tutorialBidDraftSeed} />);
    expect(toastMock).not.toHaveBeenCalledWith(
      '이전에 작성하던 내용을 그대로 불러왔어요',
      expect.anything(),
    );
  });

  it('저장된 초안이 initialDraft와 다르면 초안이 이긴다 (복원 우선 계약 — clearStoredBidDraft의 존재 이유)', async () => {
    const { tutorialBidDraftSeed } = await import('@/lib/onboarding/tutorial-fixtures');
    const divergent = { ...tutorialBidDraftSeed, memo: '과거에 타이핑한 내용', cycleNum: '7' };
    localStorage.setItem('bid-draft:tutorial-rfp', JSON.stringify(divergent));
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} initialDraft={tutorialBidDraftSeed} />);

    // 정산주기 입력이 시드(2)가 아니라 저장 초안(7)에서 온다 + 복원 토스트 발화.
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      '이전에 작성하던 내용을 그대로 불러왔어요',
      expect.anything(),
    );
  });

  it('onSampleSubmit 모드에서 템플릿 저장은 실 액션 없이 안내 토스트를 띄우고 패널을 닫는다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} onSampleSubmit={() => {}} />);

    // 4단계(검토·발송)로 이동 — 푸터 "다음" 버튼을 순서대로(기존 테스트와 동일 패턴).
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    // 템플릿 저장 폼 오픈
    await user.click(screen.getByRole('button', { name: '템플릿으로 저장' }));
    await user.type(screen.getByPlaceholderText('템플릿 이름'), '내 템플릿');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(saveQuoteTemplateActionMock).not.toHaveBeenCalled();
    // 문구는 안내형 — 패널 닫힘(성공 신호)과 모순되는 "저장되지 않아요" 실패
    // 뉘앙스를 내지 않는다(오픈 샌드박스: 제스처는 실 화면과 동일하게 성공).
    expect(toastMock).toHaveBeenCalledWith(
      '체험이라 실제로 저장하지는 않았어요 — 실제 견적에서는 여기서 템플릿이 저장돼요',
    );
    // {ok:true} 반환 계약 — 패널이 성공 경로로 닫힌다.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('템플릿 이름')).not.toBeInTheDocument(),
    );
  });

  it('onSampleSubmit 모드에서 견적서 PDF 선택은 실 업로드(uploadAttachment)를 부르지 않고 안내 토스트만 띄운다', async () => {
    const user = userEvent.setup();
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} onSampleSubmit={() => {}} />);

    // 3단계(견적서)로 이동 — 푸터 "다음" 버튼을 순서대로.
    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'proposal.pdf', { type: 'application/pdf' }));

    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('튜토리얼에서는 업로드되지 않아요');
  });

  it('샘플 모드에서는 필수값이 비어도 제출 클릭이 확인 다이얼로그로 진행한다 (좌초 방지)', async () => {
    const user = userEvent.setup();
    // initialDraft 없이 렌더 — 수수료가 전혀 채워지지 않은 기본 폼(anyFeeFilled=false)으로
    // 4단계(검토·발송)까지 이동한다. 실 모드라면 여기서 제출 가드가 막아야 정상이지만,
    // 샘플(튜토리얼) 모드는 코치마크 투어가 제출 클릭에서 종료되므로 가드에 막히면 안내
    // 없이 좌초된다 — 확인 다이얼로그로 진행해야 한다.
    render(<BidWizard rfp={rfp} buyer={buyerOf('튜토리얼 쇼핑몰')} onSampleSubmit={() => {}} />);

    await user.click(screen.getByRole('button', { name: '수수료' }));
    await user.click(screen.getByRole('button', { name: '견적서' }));
    await user.click(screen.getByRole('button', { name: '검토·발송' }));

    await user.click(screen.getByRole('button', { name: '견적 보내기' }));

    expect(await screen.findByText('견적을 보낼까요?')).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalledWith('수수료를 1칸 이상 입력해주세요', expect.anything());
  });
});
