'use client';

// 구매사 견적 비교 — 포커스 스포트라이트. 상단 탭으로 PG 전환(hover peek), 본문에 한
// 견적을 깊게: 개선 요약(hero) + 부차정보 아코디언 3종. 값 단위 hover 는 MetricComparePopover
// 로 전 PG 줄세움. CTA 는 인라인 AwardConfirmDialog 로 선정 확정. 표/보드/별도 award 페이지
// 를 대체한다. 표현 전용 — 데이터는 loadBuyerRfpDetail 산출물.
//
// 내부 구조는 응집 단위로 분할된다(공개 props/exports 불변):
//   BidTabStrip(탭+peek) · FeeMatrixTables(구간 매트릭스) · FeeComparisonRows(요율 비교)
//   · PgMemoPdfPanel(메모/PDF) · AwardCtaBar(CTA). 순수 파생은 focus-comparison-model.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { ImprovementSummary, type CurrentConditions } from './ImprovementSummary';
import { AwardConfirmDialog } from './AwardConfirmDialog';
import { AwardResult } from './AwardResult';
import { RequoteDialog } from './RequoteDialog';
import { BidTabStrip } from './BidTabStrip';
import { FeeMatrixTables } from './FeeMatrixTables';
import { FeeComparisonRows } from './FeeComparisonRows';
import { PgMemoPdfPanel } from './PgMemoPdfPanel';
import { AwardCtaBar } from './AwardCtaBar';
import { sortBidsByCardFee, buildFeeRows } from './focus-comparison-model';
import { TierContextHeader } from './TierContextHeader';
import { useFlashOnChange } from './useFlashOnChange';
import { CounterpartyProfileCard } from '@/components/messages/CounterpartyProfileCard';
import { useDealRoom } from '@/components/deal-room/DealRoomContext';
import { Divider } from '@/components/primitives/Divider';
import { formatDeadline } from '@/lib/utils/format';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import {
  type Bid,
  type CustomPaymentMethod,
  type MerchantTier,
  type PaymentMethod,
} from '@/lib/types/bid';

type Props = {
  bids: Bid[];
  /** pgWsId → 워크스페이스 신원. 이름 맵과 로고 맵을 나누면 한쪽만 배선되는 사고가 난다. */
  pgWsById: Record<string, WorkspaceDisplay>;
  current: CurrentConditions;
  rfpStatus: string;
  awardedBidId?: string | null;
  requiredPaymentMethods: readonly PaymentMethod[];
  customPaymentMethods: CustomPaymentMethod[];
  /** uuid — awardRfpAction 용 */
  rfpId: string;
  rfpCode: string;
  /** 재요청 현황 — pgWsId → 최신 요청 상태. 없으면 재요청 없음. */
  requoteByPg?: Record<string, { status: 'pending' | 'responded'; round: number; deadline: string }>;
  /** 구매사 자신의 영중소 구간 — 비교 화면이 이 구간을 기본 선택해 먼저 보여준다. */
  buyerGrade?: MerchantTier;
  /** 딜룸 모달의 '견적 비교' 탭에 임베드될 때 — 탭이 제목을 제공하므로 외곽 헤더를 숨긴다. */
  hideHeader?: boolean;
  /** 견적이 아직 없을 때 구매사에게 보여줄 초대 현황. */
  invitedPgCount?: number;
  /** PG 관리에 추가했지만 아직 초대 메일을 보내지 않은 PG 수. */
  draftPgCount?: number;
  /** 견적이 아직 없을 때 보여줄 요청 마감. */
  deadline?: string;
  /** PG 초대를 추가할 권한이 있는지. 읽기 전용 화면에서 실행 불가능한 약속을 피한다. */
  canEditInvitations?: boolean;
  /** 빈 상태의 단일 CTA — 구매사 딜룸의 PG 관리 탭으로 이동한다. */
  onManageInvitations?: () => void;
  /**
   * 가상 샘플 온보딩 전용(opt-in) — 주어지면 클릭 시 실제 awardRfpAction(AwardConfirmDialog)
   * 대신 이 콜백을 호출한다(가짜 선정).
   * 재요청 버튼은 숨긴다. 프로덕션 실 딜룸에는 전달되지 않는다.
   */
  onSampleAward?: (bidId: string) => void;
};

export function FocusComparison(props: Props) {
  const { bids, pgWsById, current, rfpStatus, awardedBidId, requoteByPg, onSampleAward } = props;
  const router = useRouter();

  const [tier, setTier] = useState<MerchantTier>(props.buyerGrade ?? 'general');
  const flash = useFlashOnChange(tier);

  // 정렬: 카드 수수료 낮은 순(기본). 동률·미입력은 뒤로.
  const sortedBids = useMemo(() => sortBidsByCardFee(bids, tier), [bids, tier]);

  const defaultBidId = awardedBidId ?? sortedBids[0]?.id;
  const [activeBidId, setActiveBidId] = useState<string | undefined>(defaultBidId);
  const [peekBidId, setPeekBidId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requoteOpen, setRequoteOpen] = useState(false);
  // 선정 확정 직후 1회만 뜨는 결과 화면. 초기 awarded 로드로는 set되지 않는다(1회성).
  const [resultBid, setResultBid] = useState<Bid | null>(null);

  // hooks 는 무조건 호출돼야 하므로 active 계산을 early return 위로 둔다
  // (빈 목록이면 undefined). 포커스 PG 를 DealRoom 컨텍스트에 set 해 우측
  // 채팅 레일의 '상대방 채팅' 탭이 탭 전환을 추종하게 한다.
  const active: Bid | undefined =
    sortedBids.find((b) => b.id === activeBidId) ?? sortedBids[0];
  const { setCounterparty } = useDealRoom();
  const activePgWsId = active?.pgWsId;
  useEffect(() => {
    if (!activePgWsId) return;
    setCounterparty({
      workspaceId: activePgWsId,
      name: pgWsById[activePgWsId]?.name ?? activePgWsId,
      type: 'pg',
      logoUpdatedAt: pgWsById[activePgWsId]?.logoUpdatedAt ?? null,
    });
  }, [activePgWsId, pgWsById, setCounterparty]);

  const pgName = useCallback((wsId: string) => pgWsById[wsId]?.name ?? wsId, [pgWsById]);

  const pgLogoFn = useCallback((wsId: string) => pgWsById[wsId]?.logoUpdatedAt ?? null, [pgWsById]);

  // 탭/peek/요율-비교 콜백은 안정 참조로 — memo 된 서브패널의 재렌더를 막는다.
  const onPeekEnter = useCallback((bidId: string) => setPeekBidId(bidId), []);
  const onPeekLeave = useCallback(
    (bidId: string) => setPeekBidId((p) => (p === bidId ? null : p)),
    [],
  );
  const onSelectByPgWs = useCallback(
    (wsId: string) => {
      const target = sortedBids.find((b) => b.pgWsId === wsId);
      if (target) setActiveBidId(target.id);
    },
    [sortedBids],
  );
  const onRequoteOpen = useCallback(() => setRequoteOpen(true), []);
  const onAwardOpen = useCallback(() => {
    if (onSampleAward && active) {
      onSampleAward(active.id);
      return;
    }
    setDialogOpen(true);
  }, [onSampleAward, active]);

  // 활성 견적의 결제수단 요율 행 — 각 행 hover 시 전 PG 줄세움.
  const feeRows = useMemo(
    () => (active ? buildFeeRows(active, props.customPaymentMethods, current.feeRate) : []),
    [active, props.customPaymentMethods, current.feeRate],
  );

  if (sortedBids.length === 0 || !active) {
    const invitedPgCount = props.invitedPgCount ?? 0;
    const hasInvitations = invitedPgCount > 0;
    const draftPgCount = props.draftPgCount ?? 0;
    const hasDrafts = draftPgCount > 0;
    const canEditInvitations = props.canEditInvitations ?? true;
    const deadlineLabel = props.deadline ? formatDeadline(props.deadline) : null;
    return (
      <EmptyState
        icon={<Inbox aria-hidden />}
        title="아직 도착한 견적이 없어요"
        description={
          deadlineLabel === '마감' ? (
            '마감일까지 도착한 견적이 없어요.'
          ) : hasInvitations ? (
            <>
              PG사 <span className="md-numeric">{invitedPgCount}</span>곳에 요청했어요. 견적이
              도착하면 알림으로 알려드릴게요.
            </>
          ) : hasDrafts ? (
            canEditInvitations ? (
              <>
                PG사 <span className="md-numeric">{draftPgCount}</span>곳을 추가했어요. 초대를
                보내면 견적을 받을 수 있어요.
              </>
            ) : (
              <>
                PG사 <span className="md-numeric">{draftPgCount}</span>곳이 초대 발송을 기다리고
                있어요. PG 관리에서 현재 상태를 확인할 수 있어요.
              </>
            )
          ) : canEditInvitations ? (
            '아직 초대한 PG사가 없어요. PG사를 추가하면 견적을 받을 수 있어요.'
          ) : (
            '초대한 PG사가 없어요. PG 관리에서 현재 상태를 확인할 수 있어요.'
          )
        }
        action={
          <div className="flex flex-col items-center gap-4">
            {(hasInvitations || hasDrafts || deadlineLabel) && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-[length:var(--md-typescale-label-medium-size)] text-[var(--md-sys-color-on-surface-variant)]">
                {hasInvitations && (
                  <span>
                    초대 <span className="md-numeric">{invitedPgCount}</span>곳
                  </span>
                )}
                {hasInvitations && hasDrafts && <span aria-hidden>·</span>}
                {hasDrafts && (
                  <span>
                    발송 대기 <span className="md-numeric">{draftPgCount}</span>곳
                  </span>
                )}
                {(hasInvitations || hasDrafts) && deadlineLabel && <span aria-hidden>·</span>}
                {deadlineLabel &&
                  (deadlineLabel === '마감' ? (
                    <span>마감</span>
                  ) : (
                    <span>
                      마감 <span className="md-numeric">{deadlineLabel}</span>
                    </span>
                  ))}
              </div>
            )}
            {props.onManageInvitations && (
              <Button type="button" onClick={props.onManageInvitations}>
                {hasInvitations || hasDrafts
                  ? '초대 현황 보기'
                  : canEditInvitations
                    ? 'PG사 추가하기'
                    : 'PG 관리 보기'}
              </Button>
            )}
          </div>
        }
      />
    );
  }

  const isAwarded = rfpStatus === 'awarded' || rfpStatus === 'closed';
  const canAward = rfpStatus === 'sent';
  const peek = peekBidId ? sortedBids.find((b) => b.id === peekBidId) ?? null : null;

  if (resultBid) {
    return (
      <AwardResult
        pgName={pgName(resultBid.pgWsId)}
        pgWsId={resultBid.pgWsId}
        bid={resultBid}
        current={current}
        tier={tier}
      />
    );
  }

  return (
    <section>
      {!props.hideHeader && (
        <div className="flex items-center gap-3 mb-4" data-coachmark="tutorial-compare-header">
          <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
            견적 비교
          </span>
          <Divider />
          <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
            정렬: 카드 수수료 낮은 순
          </span>
        </div>
      )}

      <TierContextHeader tier={tier} onTierChange={setTier} />

      <BidTabStrip
        sortedBids={sortedBids}
        activeId={active.id}
        awardedBidId={awardedBidId}
        isAwarded={isAwarded}
        requoteByPg={requoteByPg}
        tier={tier}
        peek={peek}
        pgName={pgName}
        pgLogoFn={pgLogoFn}
        onSelect={setActiveBidId}
        onPeekEnter={onPeekEnter}
        onPeekLeave={onPeekLeave}
      />

      {/* Active bid body */}
      <div className="mt-5 space-y-2">
        <div className="mb-2 flex items-center justify-between gap-3">
          <CounterpartyProfileCard
            variant="profile"
            counterparty={{
              name: pgName(active.pgWsId),
              type: 'pg',
              // 샘플 모드(튜토리얼)는 workspaceId를 비워 라이브 메시지 CTA·프레즌스
              // 구독을 차단한다 — fixture ID로 실제 액션/WS 채널을 태우면 안 된다.
              workspaceId: onSampleAward ? '' : active.pgWsId,
              logoUpdatedAt: pgLogoFn(active.pgWsId),
            }}
            rfpContext={{ id: props.rfpId, code: props.rfpCode }}
          />
          {isAwarded && (
            <Chip
              label={active.id === awardedBidId ? '선정됨' : '미선정'}
              color={active.id === awardedBidId ? 'tertiary' : 'surface'}
            />
          )}
        </div>

        <ImprovementSummary bid={active} current={current} tier={tier} flash={flash} />

        <Accordion>
          <AccordionItem value="rates" title={`전체 결제수단 요율 (${feeRows.length})`}>
            <FeeMatrixTables active={active} />
            <FeeComparisonRows
              feeRows={feeRows}
              sortedBids={sortedBids}
              active={active}
              tier={tier}
              pgWsById={pgWsById}
              onSelect={onSelectByPgWs}
              flash={flash}
            />
          </AccordionItem>

          <AccordionItem value="pg-memo" title="PG 메모 · 제안서 PDF">
            <PgMemoPdfPanel active={active} />
          </AccordionItem>

        </Accordion>

        <AwardCtaBar
          canAward={canAward}
          showRequote={!props.onSampleAward}
          onRequote={onRequoteOpen}
          onAward={onAwardOpen}
        />
      </div>

      <AwardConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rfpId={props.rfpId}
        awardedBidId={active.id}
        pgName={pgName(active.pgWsId)}
        otherCount={sortedBids.length - 1}
        onAwarded={() => setResultBid(active)}
      />

      <RequoteDialog
        open={requoteOpen}
        onOpenChange={setRequoteOpen}
        rfpId={props.rfpId}
        candidates={sortedBids.map((b) => ({ pgWsId: b.pgWsId, name: pgName(b.pgWsId) }))}
        onRequested={() => router.refresh()}
      />
    </section>
  );
}
