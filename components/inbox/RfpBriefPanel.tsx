import { Chip } from '@/components/primitives/Chip';
import { Label } from '@/components/primitives/Label';
import { InfoTip } from '@/components/ui/info-tip';
import { CounterpartyProfileCard } from '@/components/messages/CounterpartyProfileCard';
import { toCounterparty } from '@/components/messages/types';
import { AttachmentPreviewList } from '@/components/attachments/AttachmentPreviewList';
import { MERCHANT_TIER_LABELS } from '@/lib/types/bid';
import { formatDate, formatDeadline, formatKrwReadable, formatKrwField, formatFeeRateDisplay } from '@/lib/utils/format';
import { CONTRACT_TYPE_LABELS, CONTRACT_TYPE_COLOR } from '@/lib/types/rfp';
import type { RFP } from '@/lib/types/rfp';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import { Divider } from '@/components/primitives/Divider';

// buyer 는 신원 한 덩어리로 받는다 — 상호명 문자열만 받던 시절 아바타가 로고를 잃었다.
type Props = { rfp: RFP; buyer: WorkspaceDisplay };

export function RfpBriefPanel({ rfp, buyer }: Props) {
  const bizProfile = rfp.bizProfile;
  const bizNoMissing = !bizProfile?.bizNo;
  const grade = bizProfile?.grade;
  const daysLeft = formatDeadline(rfp.deadline);
  const isUrgent = daysLeft.startsWith('D-') && parseInt(daysLeft.slice(2)) <= 3;
  // 현재 카드 수수료 PG 노출(opt-out). false면 PG 화면에서만 숨김 — undefined는 노출로 취급.
  const pgCardFee = rfp.currentFeeVisibleToPg === false ? undefined : rfp.currentFeeRate;

  return (
    <div className="space-y-6" data-coachmark="tutorial-brief-panel">
      {/* Header */}
      <div>
        <span className="md-numeric text-xs text-[var(--md-sys-color-on-surface-variant)]">{rfp.id}</span>
        <h2 className="text-[22px] font-[700] tracking-[-0.02em] text-[var(--md-sys-color-on-surface)] mt-0.5">
          {rfp.title}
        </h2>
        <div className="flex items-center gap-3 mt-2">
          <span
            className={`md-numeric text-[12px] font-medium ${isUrgent ? 'text-[var(--md-sys-color-error)]' : 'text-[var(--md-sys-color-on-surface-variant)]'}`}
          >
            마감 {daysLeft} ({formatDate(rfp.deadline)})
          </span>
          {rfp.contractType && (
            <Chip
              label={CONTRACT_TYPE_LABELS[rfp.contractType]}
              color={CONTRACT_TYPE_COLOR[rfp.contractType]}
            />
          )}
        </div>
      </div>

      {bizNoMissing && (
        <div className="border border-[var(--md-sys-color-outline-variant)] px-4 py-3 space-y-1">
          <div className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
            [ 사업자번호 미입력 ]
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
            사전 견적 또는 보완 예정 견적 요청 — 일반 등급 가정으로 9개 카드사별 견적을 작성해요.
          </p>
        </div>
      )}

      {/* Buyer biz info */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <Label size="md" muted={false}>구매사 정보</Label>
          <Divider />
          <CounterpartyProfileCard
            variant="avatar"
            counterparty={toCounterparty(buyer)}
            rfpContext={{ id: rfp.id, title: rfp.title }}
          />
        </div>
        <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-t border-[var(--md-sys-color-outline-variant)]">
          {[
            ['상호명', buyer.name],
            ['사업자번호', bizProfile?.bizNo ?? '미입력'],
            ['대표자', '—'],
          ].map(([label, value]) => (
            <div key={label} className="py-2.5 flex items-baseline justify-between">
              <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">{label}</span>
              <span className="text-[13px] text-[var(--md-sys-color-on-surface)]">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grade + statutory fee */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <Label size="md" muted={false}>가맹점 등급</Label>
          <InfoTip term="가맹점등급" />
          <Divider />
        </div>
        <div className="flex items-center justify-between py-2.5 border-t border-[var(--md-sys-color-outline-variant)] border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-center gap-3">
            {grade ? (
              <Chip label={MERCHANT_TIER_LABELS[grade]} color="surface" />
            ) : (
              <>
                <Chip label="미정" color="surface" />
                <span className="md-label-medium text-[var(--md-sys-color-on-surface-variant)]">
                  등급 미입력
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 사업 운영 정보 — 6 optional fields */}
      {[rfp.websiteUrl, rfp.mainProducts, rfp.annualPgVolume, pgCardFee, rfp.currentSettlementLimit, rfp.currentGuaranteeInsurance, rfp.currentSettlementCycle, rfp.deliveryServicePeriod].some(Boolean) && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Label size="md" muted={false}>사업 운영 정보</Label>
            <Divider />
          </div>
          <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-t border-[var(--md-sys-color-outline-variant)]">
            {(
              [
                ['사업 운영 홈페이지', rfp.websiteUrl],
                ['주요 판매 상품', rfp.mainProducts],
                ['전년도 연간 PG 거래액', rfp.annualPgVolume ? (formatKrwReadable(Number(rfp.annualPgVolume)) || rfp.annualPgVolume) : undefined],
                ['현재 카드 수수료', formatFeeRateDisplay(pgCardFee)],
                ['현재 정산한도', formatKrwField(rfp.currentSettlementLimit)],
                ['현재 보증보험', formatKrwField(rfp.currentGuaranteeInsurance)],
                ['현재 정산주기', rfp.currentSettlementCycle],
                ['배송 및 서비스 기간', rfp.deliveryServicePeriod],
              ] as [string, string | undefined][]
            )
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="py-2.5 flex items-baseline justify-between">
                  <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">{label}</span>
                  <span className="text-[13px] text-[var(--md-sys-color-on-surface)]">{value}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 견적 요청 세부 내용 */}
      {rfp.memo && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Label size="md" muted={false}>견적 요청 세부 내용</Label>
            <Divider />
          </div>
          <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)] leading-relaxed whitespace-pre-wrap">
            {rfp.memo}
          </p>
        </div>
      )}

      {/* 구매사 첨부파일 — 미리보기 (없으면 렌더 안 함) */}
      <AttachmentPreviewList files={rfp.rfpFiles} />
    </div>
  );
}
