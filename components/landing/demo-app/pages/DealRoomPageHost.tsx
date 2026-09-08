'use client';

import { DealRoomProvider } from '@/components/deal-room/DealRoomContext';
import { FocusComparison } from '@/components/rfp/comparison/FocusComparison';
import { Button } from '@/components/primitives/Button';
import {
  demoCompareBids,
  demoPgWsById,
  demoCompareCurrent,
  demoBuyerGrade,
} from '../demo-app-fixtures';

const DEMO_METHODS = ['card', 'virtual_account', 'naver_pay'] as const;

// 데모 딜룸 비교 — 실제 FocusComparison을 fixture로. onSampleAward 로 실제
// awardRfpAction 서버액션(가짜 rfpId/bidId라 실패) 대신 가입 페이지로 유도한다 —
// 무반응 클릭(no-op)이 되지 않도록 아래 배너와 동일한 전환 동작을 재사용.
export function DealRoomPageHost() {
  return (
    <div className="relative flex flex-col gap-4 px-6 py-6">
      <DealRoomProvider>
        <FocusComparison
          bids={demoCompareBids}
          pgWsById={demoPgWsById}
          current={demoCompareCurrent}
          rfpStatus="sent"
          awardedBidId={null}
          requiredPaymentMethods={DEMO_METHODS}
          customPaymentMethods={[]}
          rfpId="demo-rfp-1"
          rfpCode="P-2606-0042"
          buyerGrade={demoBuyerGrade}
          onSampleAward={() => window.location.assign('/signup/buyer')}
        />
      </DealRoomProvider>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-4 py-3">
        <span className="text-sm leading-[inherit] text-[var(--md-sys-color-on-surface-variant)]">
          실제로 PG 견적을 받고 이렇게 비교해 선정해보세요.
        </span>
        <Button
          variant="filled"
          size="sm"
          type="button"
          onClick={() => window.location.assign('/signup/buyer')}
        >
          무료로 시작하기 →
        </Button>
      </div>
    </div>
  );
}
