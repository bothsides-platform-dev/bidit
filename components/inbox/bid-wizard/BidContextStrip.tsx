'use client';

import { useState } from 'react';
import { RfpBriefPanel } from '../RfpBriefPanel';
import { CounterpartyProfileCard } from '@/components/messages/CounterpartyProfileCard';
import { toCounterparty } from '@/components/messages/types';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/types/bid';
import type { PgRfpDetailData } from '@/lib/server/rfp-detail-loader';
import type { WorkspaceDisplay } from '@/lib/types/workspace';

type Props = {
  buyer: WorkspaceDisplay;
  rfp: PgRfpDetailData['rfp'];
  currentStep: number;
  feeInputMethods: PaymentMethod[];
};

export function BidContextStrip({ buyer, rfp, currentStep, feeInputMethods }: Props) {
  const [open, setOpen] = useState(false);

  // 단계별 '요청 핵심' — 2단계(수수료)에선 요청 결제수단을 노출.
  const hint =
    currentStep === 2
      ? `요청: ${feeInputMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' · ')} 수수료`
      : '견적 요청 정보';

  return (
    <div className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 truncate text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
          <CounterpartyProfileCard
            variant="profile"
            counterparty={toCounterparty(buyer)}
            rfpContext={{ id: rfp.id, title: rfp.title }}
          />
          <span className="mx-1 text-[var(--md-sys-color-outline-variant)]">·</span>
          {hint}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 md-label-small text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] transition-colors"
        >
          요청 전문 {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div className="border-t border-[var(--md-sys-color-outline-variant)] px-4 py-5 max-h-[420px] overflow-y-auto">
          <RfpBriefPanel rfp={rfp} buyer={buyer} />
        </div>
      )}
    </div>
  );
}
