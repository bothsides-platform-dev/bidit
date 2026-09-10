'use client';

// buyer 튜토리얼(/tutorial) 본체 — 같은 라우트 안에서 phase 전환만으로 "RFP 작성 →
// 견적 도착 연출 → 비교·선정 → 완료" 여정을 가상 체험시킨다(라우트 이동 없음). 실제
// 위저드(RfpCreateWizard)·비교 화면(FocusComparison)을 fixture 데이터로 그대로
// 구동하고, 종결 지점(onSampleSubmit/onSampleAward)만 실제 서버 액션을 우회한다.
// 진행 상태머신·화면 골격은 PgTutorialFlow 와 공유한다(useTutorialPhase/TutorialFlowShell).
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { CoachmarkTour } from '@/components/onboarding/coachmarks';
import { RfpCreateWizard } from '@/components/rfp/RfpCreateWizard';
import { FocusComparison } from '@/components/rfp/comparison/FocusComparison';
import { DealRoomProvider } from '@/components/deal-room/DealRoomContext';
import { BidsArrivalScene } from './BidsArrivalScene';
import { TutorialFlowShell } from './TutorialFlowShell';
import { useTutorialPhase } from './useTutorialPhase';
import { useIsolatedRfpDraft } from './useIsolatedRfpDraft';
import { buyerCreateTour, buyerArrivalTour, buyerCompareTour } from './tours';
import {
  tutorialBuyerRfp,
  tutorialBids,
  tutorialPgNames,
  tutorialPgWsById,
  tutorialBuyerName,
  tutorialRfpDraftSeed,
  tutorialBizProfile,
  tutorialPgList,
} from '@/lib/onboarding/tutorial-fixtures';

type Phase = 'create' | 'arrival' | 'compare' | 'done';

const PHASE_ORDER: Phase[] = ['create', 'arrival', 'compare', 'done'];
const PHASE_LABELS: Record<Phase, string> = {
  create: '견적 요청 작성',
  arrival: '견적 도착',
  compare: '견적 비교·선정',
  done: '완료',
};

export function BuyerTutorialFlow() {
  const [createTourDone, setCreateTourDone] = useState(false);
  const [arrivalTourDone, setArrivalTourDone] = useState(false);
  const [compareTourDone, setCompareTourDone] = useState(false);
  const { restore } = useIsolatedRfpDraft(tutorialRfpDraftSeed);
  const { phase, setPhase, stepNum, total, label, isDone, navigate, handleExit, handleComplete } =
    useTutorialPhase({
      order: PHASE_ORDER,
      labels: PHASE_LABELS,
      onboardingKey: 'buyerTutorial',
      onLeave: restore,
    });

  return (
    <TutorialFlowShell
      variant="buyer"
      stepNum={stepNum}
      total={total}
      label={label}
      isDone={isDone}
      onExit={handleExit}
    >
      {phase === 'create' && (
        <>
          <RfpCreateWizard
            bizProfile={tutorialBizProfile}
            workspaceName={tutorialBuyerName}
            pgList={tutorialPgList}
            onSampleSubmit={() => setPhase('arrival')}
          />
          {/* 단일 연속 투어 — 각 스텝의 다음 버튼(action)을 실제로 클릭하며 제출까지
              이어진다. 마지막 action(제출) 클릭은 onFinish와 phase 전환(onSampleSubmit)을
              동시에 일으키지만 onFinish는 로컬 state만 닫으므로 충돌 없음. */}
          {!createTourDone && (
            <CoachmarkTour steps={buyerCreateTour} onFinish={() => setCreateTourDone(true)} onSkip={handleComplete} />
          )}
        </>
      )}

      {phase === 'arrival' && (
        <>
          <BidsArrivalScene
            pgNames={tutorialBids.map((b) => tutorialPgNames[b.pgWsId] ?? b.pgWsId)}
            onProceed={() => setPhase('compare')}
          />
          {/* CTA가 도착 연출 스태거(~1.8s) 후에 등장하므로 기본 3s보다 넉넉히 기다린다. */}
          {!arrivalTourDone && (
            <CoachmarkTour steps={buyerArrivalTour} timeoutMs={5000} onFinish={() => setArrivalTourDone(true)} onSkip={handleComplete} />
          )}
        </>
      )}

      {phase === 'compare' && (
        <DealRoomProvider>
          <div className="px-6 py-6">
            <FocusComparison
              bids={tutorialBids}
              pgWsById={tutorialPgWsById}
              current={{
                feeRate: tutorialBuyerRfp.currentFeeRate,
                settlementCycle: tutorialBuyerRfp.currentSettlementCycle,
                settlementLimit: tutorialBuyerRfp.currentSettlementLimit,
                guaranteeInsurance: tutorialBuyerRfp.currentGuaranteeInsurance,
              }}
              rfpStatus={tutorialBuyerRfp.status}
              requiredPaymentMethods={tutorialBuyerRfp.requiredPaymentMethods}
              customPaymentMethods={tutorialBuyerRfp.customPaymentMethods}
              rfpId={tutorialBuyerRfp.id}
              rfpCode={tutorialBuyerRfp.code}
              onSampleAward={handleComplete}
            />
          </div>
          {!compareTourDone && (
            <CoachmarkTour steps={buyerCompareTour} onFinish={() => setCompareTourDone(true)} onSkip={handleComplete} />
          )}
        </DealRoomProvider>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <h2 className="text-[20px] font-[700] tracking-[-0.02em] text-[var(--md-sys-color-on-surface)]">
            튜토리얼을 완료했어요
          </h2>
          <p className="text-[14px] text-[var(--md-sys-color-on-surface-variant)]">
            이제 실제 견적 요청을 작성해서 여러 PG사의 견적을 받아보세요.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => navigate('/rfp-create')}>실제 견적 요청 보내기</Button>
            <Button variant="outlined" onClick={() => navigate('/home')}>홈으로</Button>
          </div>
        </div>
      )}
    </TutorialFlowShell>
  );
}
