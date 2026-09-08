'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HTTPError } from 'ky';
import { uploadAttachment } from '@/lib/attachments/upload-client';
import { Divider } from '@/components/primitives/Divider';
import { Button } from '@/components/primitives/Button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/primitives/Label';
import { Select } from '@/components/primitives/Select';
import { toast } from '@/lib/toast';
import { useBidDraft, EMPTY_BID_DRAFT, isPristineDraft, type BidDraft } from '../useBidDraft';
import { submitBidAction } from '@/lib/server/actions/bid';
import { saveQuoteTemplateAction } from '@/lib/server/actions/quote-template/saveQuoteTemplateAction';
import {
  PAYMENT_METHOD_CATEGORIES,
  isFlatFeeMethod,
  type PaymentMethod,
  type QuoteTemplateOption,
} from '@/lib/types/bid';
import { buildPaymentFees, parseSettleCycle, pctToDecimal, templateFeesToFlat } from '@/lib/quote/template-fees';
import type { PgRfpDetailData } from '@/lib/server/rfp-detail-loader';
import type { SigningTemplateOption } from '@/lib/server/signing-template-option';

import { WizardStepSidebar } from '@/components/rfp/WizardStepSidebar';
import { WizardProgressBar } from '@/components/rfp/WizardProgressBar';
import { BID_WIZARD_STEPS, SERVER_ERROR_STEP } from './bid-wizard-steps';
import { getBidWizardValidity, getFirstIncompleteBidStep, deriveAnyFeeFilled } from './bid-wizard-validation';
import { BidContextStrip } from './BidContextStrip';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import { type ProposalState } from './BidStepProposal';
import { BidWizardProvider, type BidWizardContextValue } from './bid-wizard-context';
import { BidStepSettlementContainer } from './BidStepSettlementContainer';
import { BidStepFeesContainer } from './BidStepFeesContainer';
import { BidStepProposalContainer } from './BidStepProposalContainer';
import { BidStepReviewContainer } from './BidStepReviewContainer';

const ALL_PAYMENT_METHODS: PaymentMethod[] = PAYMENT_METHOD_CATEGORIES.flatMap((c) => c.methods);
const TOTAL_STEPS = BID_WIZARD_STEPS.length;

type Props = {
  rfp: PgRfpDetailData['rfp'];
  buyer: WorkspaceDisplay;
  templates?: QuoteTemplateOption[];
  /** PG 워크스페이스에 등록된 재사용 계약서 템플릿 — 검토·발송 단계에서 선택할 수 있다. */
  signingTemplates?: SigningTemplateOption[];
  /** 재요청 시 직전 라운드 견적을 prefill 기준값으로 시드. */
  initialBid?: PgRfpDetailData['myBid'];
  /**
   * pg 튜토리얼 전용(opt-in) — 폼 baseline을 통째로 시드해 타이핑 없이 클릭만으로
   * 제출까지 진행하게 한다. initialBid보다 우선(둘 다 오면 이쪽).
   * initialBid(bidToDraft)는 TierRates를 생략해 구간제 수수료를 prefill할 수 없다.
   */
  initialDraft?: BidDraft;
  /**
   * 랜딩 데모 전용(opt-in). 주어지면 제출 시 서버 액션 대신 이 콜백을 호출한다
   * — 비로그인 임베디드 데모에서 실제 submitBidAction 을 치지 않도록(가입 유도). 프로덕션 미전달 시 no-op.
   */
  onGuestSubmit?: () => void;
  /**
   * 가상 샘플 온보딩 전용(opt-in). 주어지면 제출 시 서버 액션(submitBidAction) 대신
   * 이 콜백만 호출한다 — 서버 호출도 지연도 없다. onGuestSubmit 과 상호배타.
   */
  onSampleSubmit?: () => void;
};

/**
 * Bid 도메인 객체 → BidDraft 폼 상태로 변환 (재요청 prefill용).
 *
 * NOTE: TierRates(객체형) 요율은 단순화로 생략 — 단일 number 요율만 prefill.
 * 구간별 요율 편집은 사용자가 직접 수행.
 */
export function bidToDraft(b: NonNullable<PgRfpDetailData['myBid']>): BidDraft {
  const m = /^([A-Z]+)\+?(\d+)?$/.exec(b.settleCycle);
  const fees: Record<string, string> = {};
  // decimal → percent 문자열, 2dp 반올림 (폼 표시와 상태 일치).
  const fmtPct2dp = (rate: number): string => String(Math.round(rate * 1e4) / 100);
  for (const [k, v] of Object.entries(b.paymentFees ?? {})) {
    if (typeof v === 'number') {
      // 정액(건당) 수단은 '원' 정수 그대로, 정률 수단은 decimal → percent 문자열.
      fees[k] = isFlatFeeMethod(k as PaymentMethod) ? String(v) : fmtPct2dp(v);
    }
    // TierRates(object) — 단순화로 생략; 사용자가 직접 입력
  }
  for (const [k, v] of Object.entries(b.customFees ?? {})) {
    fees[k] = fmtPct2dp(v);
  }
  const rawNum = parseInt(m?.[2] ?? '1');
  return {
    __v: 3,
    cycleUnit: (m?.[1] ?? 'D') as BidDraft['cycleUnit'],
    cycleNum: String(Math.min(rawNum, 99)),
    settleLimit: String(b.settleLimit ?? 0),
    guaranteeInsurance: String(b.guaranteeInsurance ?? 0),
    signupFee: String(b.signupFee ?? 0),
    fees,
    memo: b.memo ?? '',
  };
}

export function BidWizard({ rfp, buyer, templates = [], signingTemplates, initialBid, initialDraft, onGuestSubmit, onSampleSubmit }: Props) {
  const router = useRouter();
  const rfpId = rfp.id;
  const requiredPaymentMethods = rfp.requiredPaymentMethods;
  const customPaymentMethods = rfp.customPaymentMethods;

  const [pending, startTransition] = useTransition();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // 제출/이동 시도 후 미충족이 확인된 단계 — 사이드바·프로그레스바에 ✗(error) 표시.
  const [failedSteps, setFailedSteps] = useState<Set<number>>(new Set());
  const markFailed = useCallback(
    (n: number) => setFailedSteps((prev) => { const next = new Set(prev); next.add(n); return next; }),
    [],
  );

  // baseline = 위저드가 처음 열렸을 때의 폼(일반=빈 폼, 재요청=직전 라운드 prefill).
  const baseline = useMemo<BidDraft>(
    () => initialDraft ?? (initialBid ? bidToDraft(initialBid) : EMPTY_BID_DRAFT),
    [initialDraft, initialBid],
  );
  // 초안 자동저장/복원
  const { draft, saveDraft, clearDraft, savedAt } = useBidDraft(rfpId);
  // 의미 있는 초안이면 묻지 않고 초기값으로 복원.
  const restoredFromDraft = draft !== null && !isPristineDraft(draft, baseline);
  // 복원된 템플릿 선택이 그 사이 삭제됐으면 초기화 시점에 걷어낸다 — 사용자는
  // "그대로 불러왔어요"를 믿고 검토 단계에서 선택을 다시 확인하지 않는다(M23).
  // 상태 정리는 initializer 에서, 안내 토스트만 아래 마운트 effect 에서.
  // '삭제됨' 판정은 **목록을 받았을 때만** 내린다. 피커가 없는 표면(게스트·샘플·
  // kill switch 로 숨김)에서는 `signingTemplates` 가 undefined 라 목록이 없는 것이지
  // 템플릿이 없어진 게 아니다 — 여기서 걷어내면 초안이 실제로 파괴된다:
  // 마운트 effect 가 곧바로 saveDraft(fields) 를 부르고 useBidDraft 는 언마운트에서도
  // 동기 flush 하므로, 위저드를 1초 열었다 닫기만 해도 localStorage 의 선택이 영영 사라진다.
  const restoredTemplateGone =
    restoredFromDraft &&
    !!signingTemplates &&
    !!draft?.signingTemplateId &&
    !signingTemplates.some((t) => t.id === draft.signingTemplateId);
  const [fields, setFields] = useState<BidDraft>(() => {
    const base = restoredFromDraft ? draft! : baseline;
    return restoredTemplateGone ? { ...base, signingTemplateId: undefined } : base;
  });
  const setField = useCallback(
    <K extends keyof BidDraft>(key: K, value: BidDraft[K]) =>
      setFields((f) => ({ ...f, [key]: value })),
    [],
  );
  const setFee = useCallback(
    (key: string, value: string) =>
      setFields((f) => ({ ...f, fees: { ...f.fees, [key]: value } })),
    [],
  );
  const { cycleUnit, cycleNum, settleLimit, guaranteeInsurance, signupFee, fees, memo } = fields;

  useEffect(() => {
    saveDraft(fields);
  }, [fields]); // eslint-disable-line react-hooks/exhaustive-deps

  // 마운트 1회: 의미 있는 초안을 복원했으면 토스트로만 알린다(묻지 않음).
  useEffect(() => {
    if (restoredFromDraft) {
      toast('이전에 작성하던 내용을 그대로 불러왔어요', { id: `bid-draft-restored:${rfpId}` });
      // 상태 정리는 useState initializer 가 이미 했다 — 여기서는 알리기만 한다.
      if (restoredTemplateGone) {
        toast('골라 두었던 계약서 템플릿이 삭제되어 선택이 해제됐어요', { type: 'info' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 계약서 템플릿 선택(검토·발송 단계) — 초안(BidDraft)의 일부라 저장·복원을 함께 탄다.
  // 별도 useState 로 두면 초안 복원이 이 선택만 무음으로 떨어뜨린다(M23 의 원인).
  const signingTemplateId = fields.signingTemplateId;
  const setSigningTemplateId = useCallback(
    (v: string | undefined) => setField('signingTemplateId', v),
    [setField],
  );

  // 견적서 업로드
  const [proposal, setProposal] = useState<ProposalState>(null);
  const uploadProposal = useCallback(
    async (file: File): Promise<void> => {
      if (file.type !== 'application/pdf') {
        setProposal({ name: file.name, status: 'error', error: 'PDF만 업로드 가능합니다.' });
        return;
      }
      if (onSampleSubmit) {
        // 튜토리얼 샌드박스 — 실 업로드(presign→R2)를 만들지 않는다.
        toast('튜토리얼에서는 업로드되지 않아요');
        return;
      }
      setProposal({ name: file.name, status: 'uploading' });
      try {
        const body = await uploadAttachment(file, { ownerKind: 'bid_proposal', ownerId: rfpId });
        setProposal(body);
      } catch (err) {
        let error = err instanceof Error ? err.message : '네트워크 오류';
        if (err instanceof HTTPError) {
          const { status } = err.response;
          error = status === 413 ? '파일이 너무 큽니다 (최대 20MB)' : status === 415 ? '지원되지 않는 파일 형식입니다' : `업로드 실패 (${status})`;
        }
        setProposal({ name: file.name, status: 'error', error });
      }
    },
    [rfpId, onSampleSubmit],
  );
  const clearProposal = useCallback(() => setProposal(null), []);
  // 처음부터 다시: 초안 삭제 + baseline 으로 폼 리셋 + 견적서 선택 해제 + 1단계로.
  const handleReset = () => {
    clearDraft();
    setFields(baseline);
    setProposal(null);
    setCurrentStep(1);
    setResetConfirmOpen(false);
  };
  const proposalReady = proposal && 'id' in proposal;
  const proposalUploading = proposal && 'status' in proposal && proposal.status === 'uploading';

  // 파생값
  const feeInputMethods = requiredPaymentMethods.length > 0 ? requiredPaymentMethods : ALL_PAYMENT_METHODS;
  const settleCycle = `${cycleUnit}+${cycleNum || '1'}`;
  const anyFeeFilled = deriveAnyFeeFilled(fees, feeInputMethods, customPaymentMethods);

  const applyTemplate = (t: QuoteTemplateOption) => {
    clearDraft();
    const { unit, num } = parseSettleCycle(t.settleCycle);
    // 입찰 폼은 구버전 단일요율 템플릿을 전 구간으로 전개해 보여준다.
    const decoded = templateFeesToFlat(t.paymentFees, feeInputMethods, {
      spreadLegacyTieredSingleRate: true,
    });
    setFields((f) => ({
      ...f,
      cycleUnit: unit,
      cycleNum: num,
      settleLimit: String(t.settleLimit),
      guaranteeInsurance: String(t.guaranteeInsurance),
      signupFee: String(t.signupFee),
      fees: { ...f.fees, ...decoded },
    }));
    toast(`‘${t.name}’ 템플릿을 불러왔어요`);
  };

  // 단계 이동 — 자유 점프(구매사 위저드 미러)
  const completed = getBidWizardValidity({ cycleNum, settleLimit, anyFeeFilled }).map(
    (s) => s.complete,
  );
  const failedAt = BID_WIZARD_STEPS.map((s) => failedSteps.has(s.num));
  const advance = useCallback(() => setCurrentStep((s) => Math.min(TOTAL_STEPS, s + 1)), []);
  const back = useCallback(() => setCurrentStep((s) => Math.max(1, s - 1)), []);
  const goToStep = useCallback(
    (step: number) => setCurrentStep(Math.min(TOTAL_STEPS, Math.max(1, step))),
    [],
  );

  const onSaveTemplate = useCallback(
    async (name: string) => {
      if (onSampleSubmit) {
        // 튜토리얼 샌드박스 — 실 워크스페이스에 템플릿을 만들지 않는다. 패널은
        // 성공 경로({ok:true})로 닫히므로 문구도 실패 뉘앙스가 아닌 안내형으로
        // 맞춘다(닫힘=성공 신호와 "저장되지 않아요"가 모순되던 것을 해소).
        toast('체험이라 실제로 저장하지는 않았어요 — 실제 견적에서는 여기서 템플릿이 저장돼요');
        return { ok: true as const };
      }
      const r = await saveQuoteTemplateAction({
        name,
        settleCycle,
        settleLimit: parseInt(settleLimit) || 0,
        guaranteeInsurance: parseInt(guaranteeInsurance) || 0,
        signupFee: parseInt(signupFee) || 0,
        paymentFees: buildPaymentFees(fees, feeInputMethods),
      });
      if (r.ok) toast('템플릿을 저장했어요', { type: 'success' });
      return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
    },
    [onSampleSubmit, settleCycle, settleLimit, guaranteeInsurance, signupFee, fees, feeInputMethods],
  );

  const handleSubmit = useCallback(() => {
    // 발송 버튼은 막지 않는다. 미충족 단계가 있으면 hint 토스트 + 그 단계로 이동 + ✗ 표시.
    // 샘플(튜토리얼) 모드는 가드를 건너뛴다 — 코치마크 투어가 제출 클릭에서 종료되므로
    // 여기서 막히면 안내 없이 좌초된다(버이어 위저드의 onSampleSubmit 선행 라우팅과 대칭).
    if (!onSampleSubmit) {
      const incomplete = getFirstIncompleteBidStep({ cycleNum, settleLimit, anyFeeFilled });
      if (incomplete) {
        toast(incomplete.hint, { type: 'error' });
        markFailed(incomplete.num);
        setCurrentStep(incomplete.num);
        return;
      }
    }
    setSubmitError(null);
    setSubmitConfirmOpen(true);
  }, [onSampleSubmit, cycleNum, settleLimit, anyFeeFilled, markFailed]);

  // 4단계가 공유하는 컨텍스트 값 — prop-drilling 제거. 안정 참조(useCallback)
  // 액션 + 폼 상태를 묶어 useMemo 로 캐싱해, 무관한 단계의 리렌더를 줄인다.
  const wizardContext: BidWizardContextValue = useMemo(
    () => ({
      cycleUnit,
      cycleNum,
      settleLimit,
      guaranteeInsurance,
      signupFee,
      fees,
      memo,
      settleCycle,
      feeInputMethods,
      customPaymentMethods,
      proposal,
      pending,
      submitError,
      settlementAttempted: failedSteps.has(1),
      feesAttempted: failedSteps.has(2),
      setField,
      setFee,
      uploadProposal: (f) => void uploadProposal(f),
      clearProposal,
      advance,
      back,
      handleSubmit,
      onSaveTemplate,
    }),
    [
      cycleUnit,
      cycleNum,
      settleLimit,
      guaranteeInsurance,
      signupFee,
      fees,
      memo,
      settleCycle,
      feeInputMethods,
      customPaymentMethods,
      proposal,
      pending,
      submitError,
      failedSteps,
      setField,
      setFee,
      uploadProposal,
      clearProposal,
      advance,
      back,
      handleSubmit,
      onSaveTemplate,
    ],
  );

  const doSubmit = () => {
    setSubmitConfirmOpen(false);
    // 랜딩 데모(게스트): 실제 제출 대신 가입 유도 콜백만 호출하고 종료.
    if (onGuestSubmit) {
      onGuestSubmit();
      return;
    }
    // 가상 샘플 온보딩: 서버 제출 없이 콜백만 호출한다 — fixture 에는 실제
    // rfpId/pgWsId 가 없어 실제 submitBidAction 을 태우면 깨진다.
    if (onSampleSubmit) {
      clearDraft(); // 자동저장된 bid-draft:<fixture-id> 잔존 방지.
      onSampleSubmit();
      return;
    }
    const paymentFees = buildPaymentFees(fees, feeInputMethods);
    const customFees: Record<string, number> = {};
    for (const c of customPaymentMethods) {
      const v = fees[c.id] ?? '';
      if (v !== '') customFees[c.id] = pctToDecimal(v);
    }
    startTransition(async () => {
      const r = await submitBidAction({
        rfpId,
        settleCycle,
        settleLimit: parseInt(settleLimit) || 0,
        guaranteeInsurance: parseInt(guaranteeInsurance) || 0,
        signupFee: parseInt(signupFee) || 0,
        paymentFees,
        customFees,
        proposalAttachmentId: proposalReady ? proposal.id : undefined,
        memo: memo.trim() || undefined,
        ...(signingTemplateId ? { signingTemplateId } : {}),
      });
      if (r.ok) {
        clearDraft();
        // 별도 /submitted 페이지로 이탈하지 않고 같은 창에서 갱신 — submitBidAction 이
        // revalidatePath('/inbox/<code>') 했으므로 refresh 면 로더 재실행 → myBid 존재 →
        // PgDealRoomBody 가 제출 완료 상태를 인플레이스 렌더. (push+refresh 동시 금지:
        // Next 16 useTransition 행, vercel/next.js#86055.)
        router.refresh();
      } else {
        setSubmitError(r.error);
        const step = SERVER_ERROR_STEP[r.error] ?? 4;
        if (step !== 4) markFailed(step);
        setCurrentStep(step);
      }
    });
  };

  return (
    <>
      <ConfirmDialog
        open={submitConfirmOpen}
        onOpenChange={(o) => !o && setSubmitConfirmOpen(false)}
        title="견적을 보낼까요?"
        description="보낸 후에는 수정할 수 없어요."
        confirmLabel="견적 보내기"
        variant="default"
        onConfirm={doSubmit}
        loading={pending}
        // 튜토리얼 pgWriteTour의 마지막 action 앵커 — 실 인박스에선 투어가 없어 inert.
        // (다른 앵커들처럼 무조건 달아 화면 상태와 무관하게 존재를 보장한다.)
        confirmDataCoachmark="tutorial-bid-confirm"
      />
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={(o) => !o && setResetConfirmOpen(false)}
        title="작성 중인 내용을 지울까요?"
        description="지금까지 입력한 정산조건·수수료·견적서가 모두 사라져요."
        confirmLabel="처음부터 다시"
        variant="danger"
        onConfirm={handleReset}
      />

      <BidWizardProvider value={wizardContext}>
      <div className="border border-[var(--md-sys-color-outline-variant)] rounded-[8px] overflow-hidden h-full flex flex-col">
        <BidContextStrip buyer={buyer} rfp={rfp} currentStep={currentStep} feeInputMethods={feeInputMethods} />

        <div className="flex flex-1 min-h-0">
          <WizardStepSidebar
            currentStep={currentStep}
            completed={completed}
            failedAt={failedAt}
            onStepClick={goToStep}
            steps={BID_WIZARD_STEPS}
            title="견적 작성"
            footer={
              !isPristineDraft(fields, baseline) || savedAt ? (
                <div className="flex flex-col gap-1.5">
                  {!isPristineDraft(fields, baseline) && (
                    <button
                      type="button"
                      onClick={() => setResetConfirmOpen(true)}
                      className="self-start md-label-small text-[var(--md-sys-color-on-surface-variant)] underline underline-offset-2 hover:text-[var(--md-sys-color-on-surface)]"
                    >
                      초기화
                    </button>
                  )}
                  {savedAt ? (
                    <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
                      💾 자동저장됨 · {savedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  ) : null}
                </div>
              ) : null
            }
          />

          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            <WizardProgressBar currentStep={currentStep} completed={completed} failedAt={failedAt} onStepClick={goToStep} steps={BID_WIZARD_STEPS} />

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6" data-coachmark="tutorial-bid-form">
              <div className="flex items-center gap-3 mb-6">
                <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
                  {String(currentStep).padStart(2, '0')} — {BID_WIZARD_STEPS[currentStep - 1].label}
                </span>
                <Divider />
              </div>

              {currentStep === 1 && (
                <div className="space-y-8">
                  <div className="space-y-1">
                    <Label size="md" muted={false}>견적 템플릿 불러오기</Label>
                    {templates.length > 0 ? (
                      <Select
                        options={[{ value: '', label: '템플릿 선택…' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]}
                        value=""
                        onChange={(id) => {
                          const t = templates.find((x) => x.id === id);
                          if (t) applyTemplate(t);
                        }}
                      />
                    ) : (
                      <div className="rounded-[6px] border border-[var(--md-sys-color-outline-variant)] px-3 py-2.5 text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
                        저장된 견적 템플릿이 없어요. 자주 쓰는 정산조건·수수료를 템플릿으로 저장하면 다음부터 한 번에 불러올 수 있어요.{' '}
                        <Link
                          href="/quote-templates"
                          className="text-[var(--md-sys-color-primary)] underline underline-offset-2"
                        >
                          템플릿 관리
                        </Link>
                      </div>
                    )}
                  </div>
                  <BidStepSettlementContainer />
                </div>
              )}

              {currentStep === 2 && <BidStepFeesContainer />}

              {currentStep === 3 && <BidStepProposalContainer />}

              {currentStep === 4 && (
                <div className="space-y-8">
                  {/* undefined = 표면 자체가 해당 없음(게스트·샘플). [] = 템플릿 0개인
                      PG — 블록을 통째로 숨기면 기능의 존재를 알 길이 없어, step1 견적
                      템플릿 피커와 같은 문법으로 안내 + 관리 링크를 보여준다. */}
                  {signingTemplates && (
                    <div className="space-y-1">
                      {/* htmlFor 로 실제 select 와 묶는다 — 라벨 클릭이 포커스를 옮기고,
                          접근성 이름도 aria-label 중복 없이 이 라벨 하나에서 나온다. */}
                      <Label as="label" htmlFor="signing-template" size="md" muted={false}>
                        계약서 템플릿
                      </Label>
                      {signingTemplates.length > 0 ? (
                        <>
                          <Select
                            id="signing-template"
                            options={[
                              { value: '', label: '선택 안 함' },
                              ...signingTemplates.map((t) => ({ value: t.id, label: t.name })),
                            ]}
                            value={signingTemplateId ?? ''}
                            onChange={(v) => setSigningTemplateId(v || undefined)}
                          />
                          <p className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
                            선정되면 딜룸에서 이 계약서로 바로 발송할 수 있어요.
                          </p>
                        </>
                      ) : (
                        <div className="rounded-[6px] border border-[var(--md-sys-color-outline-variant)] px-3 py-2.5 text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
                          저장된 계약서 템플릿이 없어요. 계약서 PDF와 서명칸을 미리 저장해 두면,
                          선정된 뒤 딜룸에서 바로 발송할 수 있어요.{' '}
                          <Link
                            href="/contract-templates"
                            className="text-[var(--md-sys-color-primary)] underline underline-offset-2"
                          >
                            템플릿 관리
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                  <BidStepReviewContainer />
                </div>
              )}
            </div>

            <div
              data-testid="wizard-nav-footer"
              className="shrink-0 border-t border-[var(--md-sys-color-outline-variant)] px-6 py-4 flex items-center justify-between"
            >
              <div>
                {currentStep > 1 && (
                  <Button type="button" variant="text" onClick={back} icon={<span aria-hidden>←</span>}>
                    {BID_WIZARD_STEPS[currentStep - 2].label}
                  </Button>
                )}
              </div>
              <div>
                {currentStep < TOTAL_STEPS ? (
                  <Button
                    type="button"
                    data-coachmark={`tutorial-bid-next-${currentStep}`}
                    onClick={advance}
                    trailingIcon={<span aria-hidden>→</span>}
                  >
                    {BID_WIZARD_STEPS[currentStep].label}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    data-coachmark="tutorial-bid-submit"
                    onClick={handleSubmit}
                    disabled={pending || !!proposalUploading}
                  >
                    {pending ? '보내는 중…' : '견적 보내기'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      </BidWizardProvider>
    </>
  );
}
