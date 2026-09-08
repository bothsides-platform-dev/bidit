'use client';

// pg 튜토리얼(/tutorial) 본체 — buyer의 BuyerTutorialFlow와 같은 골격으로 "초대 수신 →
// 요청 조건 확인 → 견적 작성·제출 → 완료" 여정을 가상 체험시킨다(라우트 이동 없음).
// 진행 상태머신(useTutorialPhase)과 화면 골격(TutorialFlowShell)은 두 플로우가 공유한다.
// 실제 요청 조건 패널(RfpBriefPanel)·견적 위저드(BidWizard)를 fixture 데이터로 그대로
// 구동하고, 종결 지점(onSampleSubmit)만 실제 서버 액션을 우회한다.
//
// draft 격리 불필요: BidWizard의 useBidDraft는 rfpId별 localStorage 키('bid-draft:<rfpId>')를
// 쓰는데, tutorialBuyerRfp.id가 실제 RFP uuid와 절대 겹치지 않는 고정 문자열('tutorial-rfp')
// 이라 실제 작성 중이던 draft를 밟을 위험이 없다(buyer의 useIsolatedRfpDraft가 필요했던
// 이유 — 전역 zustand 스토어 하나를 공유하는 RfpCreateWizard와 다른 상황). 그래서 셸의
// onLeave(이탈 직전 정리)도 넘기지 않는다.
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { CoachmarkTour } from '@/components/onboarding/coachmarks';
import { RfpBriefPanel } from '@/components/inbox/RfpBriefPanel';
import { BidWizard } from '@/components/inbox/bid-wizard/BidWizard';
import { clearStoredBidDraft } from '@/components/inbox/useBidDraft';
import { InviteScene } from './InviteScene';
import { TutorialFlowShell } from './TutorialFlowShell';
import { useTutorialPhase } from './useTutorialPhase';
import { pgInviteTour, pgBriefTour, pgWriteTour } from './tours';
import {
  tutorialBuyerRfp,
  tutorialBuyerName,
  tutorialBuyer,
  tutorialBidDraftSeed,
} from '@/lib/onboarding/tutorial-fixtures';

type Phase = 'invite' | 'brief' | 'write' | 'done';

const PHASE_ORDER: Phase[] = ['invite', 'brief', 'write', 'done'];
const PHASE_LABELS: Record<Phase, string> = {
  invite: '초대 확인',
  brief: '요청 조건 확인',
  write: '견적 작성',
  done: '완료',
};

export function PgTutorialFlow() {
  const [inviteTourDone, setInviteTourDone] = useState(false);
  const [briefTourDone, setBriefTourDone] = useState(false);
  const [writeTourDone, setWriteTourDone] = useState(false);
  const { phase, setPhase, stepNum, total, label, isDone, navigate, handleExit, handleComplete } =
    useTutorialPhase({
      order: PHASE_ORDER,
      labels: PHASE_LABELS,
      onboardingKey: 'pgTutorial',
    });

  return (
    <TutorialFlowShell
      variant="pg"
      stepNum={stepNum}
      total={total}
      label={label}
      isDone={isDone}
      onExit={handleExit}
    >
      {phase === 'invite' && (
        <>
          <InviteScene
            buyerName={tutorialBuyerName}
            rfpTitle={tutorialBuyerRfp.title}
            deadline={tutorialBuyerRfp.deadline}
            onProceed={() => setPhase('brief')}
          />
          {!inviteTourDone && (
            <CoachmarkTour steps={pgInviteTour} onFinish={() => setInviteTourDone(true)} onSkip={handleComplete} />
          )}
        </>
      )}

      {phase === 'brief' && (
        <>
          <div className="px-6 py-6">
            <RfpBriefPanel rfp={tutorialBuyerRfp} buyer={tutorialBuyer} />
            <div className="mt-6">
              <Button
                data-coachmark="tutorial-brief-cta"
                onClick={() => {
                  // 과거 튜토리얼(타이핑 허용 시절)의 잔존 초안이 시드를 이기지 않도록
                  // BidWizard 마운트 전에 지운다.
                  clearStoredBidDraft(tutorialBuyerRfp.id);
                  setPhase('write');
                }}
              >
                견적 작성하기
              </Button>
            </div>
          </div>
          {!briefTourDone && (
            <CoachmarkTour steps={pgBriefTour} onFinish={() => setBriefTourDone(true)} onSkip={handleComplete} />
          )}
        </>
      )}

      {phase === 'write' && (
        <>
          <BidWizard
            rfp={tutorialBuyerRfp}
            buyer={tutorialBuyer}
            initialDraft={tutorialBidDraftSeed}
            onSampleSubmit={handleComplete}
          />
          {/* 단일 연속 투어 — 위저드 각 단계의 다음 버튼(action)을 실제로 클릭하며
              제출 ConfirmDialog의 확인 버튼(tutorial-bid-confirm)까지 이어진다.
              확인창에서 취소하면 확인 앵커가 사라져 오프코스 리졸버가 제출 스텝으로
              복귀시킨다(좌초 방지). 확정 클릭이 onSampleSubmit → handleComplete. */}
          {!writeTourDone && (
            <CoachmarkTour steps={pgWriteTour} onFinish={() => setWriteTourDone(true)} onSkip={handleComplete} />
          )}
        </>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <h2 className="text-[20px] font-[700] tracking-[-0.02em] text-[var(--md-sys-color-on-surface)]">
            튜토리얼을 완료했어요
          </h2>
          <p className="text-[14px] text-[var(--md-sys-color-on-surface-variant)]">
            견적은 봉인돼요 — 다른 PG사의 견적이나 참여 수는 서로 공개되지 않아요.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => navigate('/inbox')}>받은 견적 요청 보기</Button>
            <Button variant="outlined" onClick={() => navigate('/home')}>홈으로</Button>
          </div>
        </div>
      )}
    </TutorialFlowShell>
  );
}
