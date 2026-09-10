'use client';

/**
 * PgDealRoomBody — PG 딜룸 본문(좌측 액션 레일 + 가운데 탭).
 *
 * 탭: (signing 있을 때) 계약(SigningTab, 맨 앞·기본 활성) · 견적작성(BidWizard / 재요청
 *     prefill / 제출완료 안내) · 요청조건(RfpBriefPanel) · 첨부. 레일: 계약(signing 있을
 *     때만)·견적작성·요청보기·첨부(탭 전환) · 철회(ConfirmDialog → withdraw).
 */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, FileText, Paperclip, Undo2 } from 'lucide-react';

import { DealRoomActionRail, type RailAction } from '@/components/deal-room/DealRoomActionRail';
import { DealRoomCenter, type DealRoomTab } from '@/components/deal-room/DealRoomCenter';
import { RfpBriefPanel } from '@/components/inbox/RfpBriefPanel';
import { SubmittedSummary } from '@/components/inbox/SubmittedSummary';
import { buildSubmittedSummaryRows } from '@/components/inbox/buildSubmittedSummaryRows';
import { BidWizard } from '@/components/inbox/bid-wizard/BidWizard';
import { RequoteBanner } from '@/components/inbox/RequoteBanner';
import { AttachmentPreviewList } from '@/components/attachments/AttachmentPreviewList';
import { LocalTime } from '@/components/primitives/LocalTime';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { withdrawBidAction } from '@/lib/server/actions/bid/withdrawBidAction';
import { toast } from '@/lib/toast';
import { ContactBlock } from '@/components/deal-room/ContactBlock';
import { DealResultHeader } from '@/components/deal-room/DealResultHeader';
import { SigningSummaryStrip } from '@/components/deal-room/signing/SigningSummaryStrip';
import { buildContractTabEntries } from '@/components/deal-room/signing/build-contract-tab-entries';
import { CONTRACT_TEMPLATES_ENABLED } from '@/lib/features/contract-templates';
import type { PgRfpDetailData } from '@/lib/server/rfp-detail-loader';

export function PgDealRoomBody({ data }: { data: PgRfpDetailData }) {
  const {
    rfp, myBid, buyer, quoteTemplates, pendingRequote, awardedToMe, buyerContact, signing,
    linkedSigningTemplate, signingTemplates,
  } = data;
  const router = useRouter();

  const isAwarded = rfp.status === 'awarded';
  // 봉인입찰 방어 — 로더가 이미 awardedToMe 일 때만 signing 을 내리지만, 컴포넌트도
  // 같은 불변식을 지켜 미선정 PG 에게 낙찰자의 계약 상태가 새지 않게 한다.
  const contractVisible = awardedToMe ? signing : null;
  // 계약서 템플릿 kill switch — 위저드 피커와 딜룸 지름길이 여기 한 곳에서 함께 꺼진다.
  // 피커는 **undefined 여야** 사라진다: BidWizard 의 게이트가 truthy 검사라 `[]` 를
  // 넘기면 '저장된 템플릿이 없어요 + 템플릿 관리 링크' 안내 카드가 그대로 남는다.
  const linkedTemplateVisible =
    CONTRACT_TEMPLATES_ENABLED && awardedToMe ? linkedSigningTemplate : null;
  const signingTemplatesVisible = CONTRACT_TEMPLATES_ENABLED ? signingTemplates : undefined;

  const [tab, setTab] = useState(contractVisible ? 'contract' : 'write');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  let writeContent: ReactNode;
  if (pendingRequote) {
    writeContent = (
      <>
        <RequoteBanner message={pendingRequote.message} deadline={pendingRequote.deadline} />
        <BidWizard rfp={rfp} buyer={buyer} templates={quoteTemplates} signingTemplates={signingTemplatesVisible} initialBid={myBid} />
      </>
    );
  } else if (isAwarded && awardedToMe) {
    writeContent = (
      <div className="space-y-4">
        <DealResultHeader
          tone="award"
          title="이 견적이 선정됐어요"
          subtitle={myBid?.submittedAt ? <>보낸 시각 <LocalTime iso={myBid.submittedAt} /></> : undefined}
        >
          {buyerContact && <ContactBlock contact={buyerContact} counterpartyKind="buyer" />}
        </DealResultHeader>
        {contractVisible && (
          <SigningSummaryStrip signing={contractVisible} side="pg" onOpen={() => setTab('contract')} />
        )}
        {myBid && <SubmittedSummary rows={buildSubmittedSummaryRows(rfp, myBid)} />}
      </div>
    );
  } else if (isAwarded && !awardedToMe) {
    writeContent = (
      <div className="space-y-4">
        <DealResultHeader
          tone="neutral"
          title="이번엔 선정되지 않았어요"
          subtitle="구매사가 다른 PG를 선정했어요. 보내주신 견적은 잘 전달됐고, 좋은 기회로 다시 만나요."
        />
        {myBid && <SubmittedSummary rows={buildSubmittedSummaryRows(rfp, myBid)} />}
      </div>
    );
  } else if (myBid) {
    writeContent = (
      <div className="space-y-4">
        <p className="md-label-small text-[var(--md-sys-color-tertiary)]">
          ✓ 견적을 보냈어요
        </p>
        <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
          보낸 시각: {myBid.submittedAt ? <LocalTime iso={myBid.submittedAt} /> : '—'}
        </p>
        <SubmittedSummary rows={buildSubmittedSummaryRows(rfp, myBid)} />
      </div>
    );
  } else {
    writeContent = <BidWizard rfp={rfp} buyer={buyer} templates={quoteTemplates} signingTemplates={signingTemplatesVisible} />;
  }

  // signing 이 아니라 contractVisible 을 넘긴다 — 위 봉인입찰 방어(미선정 PG 에겐
  // null)가 여기서도 그대로 이어져야 계약 탭·레일 액션이 낙찰자 상태를 새지 않는다.
  const contractTab = buildContractTabEntries({
    rfpCode: rfp.code,
    signing: contractVisible,
    side: 'pg',
    contact: buyerContact,
    counterpartyWsId: rfp.buyerWsId,
    buyerSigner: buyerContact,
    linkedSigningTemplate: linkedTemplateVisible,
    onSelect: () => setTab('contract'),
  });

  const tabs: DealRoomTab[] = [
    ...contractTab.tabs,
    { id: 'write', label: '견적 작성', content: writeContent },
    { id: 'request', label: '요청 조건', content: <RfpBriefPanel rfp={rfp} buyer={buyer} /> },
    { id: 'attach', label: '첨부', content: <AttachmentPreviewList files={rfp.rfpFiles} /> },
  ];

  const actions: RailAction[] = [
    ...contractTab.actions,
    { id: 'write', label: '견적 작성', icon: <Pencil />, primary: true, onSelect: () => setTab('write') },
    { id: 'request', label: '요청 보기', icon: <FileText />, onSelect: () => setTab('request') },
    { id: 'attach', label: '첨부', icon: <Paperclip />, onSelect: () => setTab('attach') },
    {
      id: 'withdraw',
      label: '철회',
      icon: <Undo2 />,
      danger: true,
      disabled: !myBid,
      onSelect: () => setWithdrawOpen(true),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <DealRoomActionRail actions={actions} />
        <div className="min-w-0 flex-1">
          <DealRoomCenter tabs={tabs} activeId={tab} onChange={setTab} />
        </div>
      </div>

      {myBid && (
        <ConfirmDialog
          open={withdrawOpen}
          onOpenChange={(o) => !busy && setWithdrawOpen(o)}
          title="보낸 견적을 철회할까요?"
          description="철회하면 구매사가 더 이상 이 견적을 볼 수 없어요."
          confirmLabel="철회"
          variant="danger"
          loading={busy}
          onConfirm={async () => {
            setBusy(true);
            const r = await withdrawBidAction({ bidId: myBid.id });
            setBusy(false);
            if (!r.ok) {
              toast(`철회하지 못했어요 — ${r.error}`, { type: 'error' });
              return;
            }
            setWithdrawOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
