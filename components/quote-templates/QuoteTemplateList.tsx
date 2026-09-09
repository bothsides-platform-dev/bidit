'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutTemplateIcon, PlusIcon } from '@/components/icons';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Note } from '@/components/primitives/Note';
import { PageHeader } from '@/components/shell/PageHeader';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { QuoteTemplateDrawer } from '@/components/quote-templates/QuoteTemplateDrawer';
import { captureActionError } from '@/lib/observability/capture';
import { quoteTemplateErrorMessage } from '@/lib/quote/error-messages';
import { MAX_QUOTE_TEMPLATES } from '@/lib/quote/limits';
import { toast } from '@/lib/toast';
import { deleteQuoteTemplateAction } from '@/lib/server/actions/quote-template/deleteQuoteTemplateAction';
import { duplicateQuoteTemplateAction } from '@/lib/server/actions/quote-template/duplicateQuoteTemplateAction';
import {
  PAYMENT_METHOD_LABELS,
  isFlatFeeMethod,
  type PaymentMethod,
  type TierRates,
} from '@/lib/types/bid';
import type { QuoteTemplateOption } from '@/lib/types/bid';
import { fmtPct } from '@/lib/quote/template-fees';
import { formatKRW } from '@/lib/utils/format';

const MAX_CHIPS = 4;

function buildChips(paymentFees: Partial<Record<PaymentMethod, number | TierRates>>): string[] {
  const chips: string[] = [];
  for (const [method, value] of Object.entries(paymentFees) as [PaymentMethod, number | TierRates][]) {
    const label = PAYMENT_METHOD_LABELS[method] ?? method;
    if (typeof value === 'object') {
      chips.push(`${label} 구간별`);
    } else if (isFlatFeeMethod(method)) {
      // 정액(건당) 수단 — % 가 아니라 건당 '원' 금액.
      chips.push(`${label} 건당 ${formatKRW(value)}`);
    } else {
      chips.push(`${label} ${fmtPct(value)}%`);
    }
  }
  return chips;
}

export function QuoteTemplateList({
  initialTemplates,
}: {
  initialTemplates: QuoteTemplateOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QuoteTemplateOption | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuoteTemplateOption | null>(null);
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  const openNew = () => {
    setEditTarget(null);
    setDrawerOpen(true);
  };

  const openEdit = (t: QuoteTemplateOption) => {
    setEditTarget(t);
    setDrawerOpen(true);
  };

  // 딜룸 계약 탭 SigningTab.run() 과 같은 계약 — 액션이 throw 해도 화면이 굳지 않고 이유를 알린다.
  // 여기선 busy 대신 useTransition 의 pending 이 게이트라 finally 가 필요 없다.
  const runAction = async <T extends { ok: boolean; error?: string }>(
    fn: () => Promise<T>,
    failMessage: string,
    scope: string,
  ): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      captureActionError(scope, e);
      toast(failMessage, { type: 'error' });
      return null;
    }
  };

  const handleDuplicate = (t: QuoteTemplateOption) => {
    startTransition(async () => {
      const r = await runAction(
        () => duplicateQuoteTemplateAction({ templateId: t.id }),
        '템플릿을 복제하지 못했어요',
        'quote-template.duplicate',
      );
      if (!r) return;
      if (!r.ok) {
        toast(quoteTemplateErrorMessage(r.error, '템플릿을 복제하지 못했어요'), { type: 'error' });
        return;
      }
      toast('템플릿을 복제했어요', { type: 'success' });
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const templateId = deleteTarget.id;
    startTransition(async () => {
      const r = await runAction(
        () => deleteQuoteTemplateAction({ templateId }),
        '템플릿을 삭제하지 못했어요',
        'quote-template.delete',
      );
      // 확인창은 성공·실패·throw 어느 쪽이든 닫는다 — 열린 채 굳으면 빠져나갈 길이 없다.
      setDeleteTarget(null);
      if (!r) return;
      if (!r.ok) {
        toast(quoteTemplateErrorMessage(r.error, '템플릿을 삭제하지 못했어요'), { type: 'error' });
        return;
      }
      toast('템플릿을 삭제했어요', { type: 'success' });
      router.refresh();
    });
  };

  const isEmpty = initialTemplates.length === 0;

  return (
    <>
      <QuoteTemplateDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        template={editTarget}
        onSaved={(templateId) => {
          setSavedTemplateId(templateId);
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSavedTemplateId(null), 1800);
          setTimeout(() => setDrawerOpen(false), 800);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="템플릿을 삭제할까요?"
        description={`"${deleteTarget?.name ?? ''}" 템플릿이 영구히 삭제돼요.`}
        confirmLabel="삭제할게요"
        variant="danger"
        onConfirm={handleDelete}
        loading={pending}
      />

      {/* count: 빈 화면에서는 칩을 숨긴다 — 바로 아래 빈 상태가 이미 "없어요"라고 말한다. */}
      <PageHeader
        title="견적 템플릿"
        count={isEmpty ? undefined : initialTemplates.length}
        description="자주 쓰는 정산조건과 수수료율을 저장해 두고, 견적 작성 시 한 번에 불러와요."
        action={
          isEmpty ? undefined : (
            <Button
              type="button"
              size="sm"
              variant="outlined"
              icon={<PlusIcon />}
              onClick={openNew}
            >
              새 템플릿
            </Button>
          )
        }
      />

      <div className="flex-1 overflow-auto px-6 py-4">
        {isEmpty ? (
          <EmptyState
            icon={<LayoutTemplateIcon />}
            title="아직 저장한 견적 템플릿이 없어요"
            description="한 번 만들어 두면 견적 작성 1단계에서 골라 정산조건·수수료율 칸을 한 번에 채워요."
            action={
              <Button
                type="button"
                variant="filled"
                size="md"
                icon={<PlusIcon />}
                onClick={openNew}
              >
                새 템플릿 만들기
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-[var(--md-sys-color-outline-variant)] border-y border-[var(--md-sys-color-outline-variant)]">
              {initialTemplates.map((t) => {
                const allChips = buildChips(t.paymentFees);
                const visibleChips = allChips.slice(0, MAX_CHIPS);
                const overflow = allChips.length - MAX_CHIPS;

                return (
                  <li key={t.id} className={`-mx-3 space-y-2 px-3 py-4 transition-colors duration-100 ${savedTemplateId === t.id ? 'bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_10%,transparent)]' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">
                          {t.name}
                        </p>
                        <p className="md-numeric text-xs text-[var(--md-sys-color-on-surface-variant)]">
                          정산 {t.settleCycle} · 한도 {t.settleLimit.toLocaleString()}원
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" size="sm" variant="text" onClick={() => openEdit(t)}>
                          편집
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="text"
                          onClick={() => handleDuplicate(t)}
                          disabled={pending}
                        >
                          복제
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="text"
                          color="error"
                          onClick={() => setDeleteTarget(t)}
                        >
                          삭제
                        </Button>
                      </div>
                    </div>
                    {visibleChips.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {visibleChips.map((chip) => (
                          <Chip key={chip} label={chip} color="surface" />
                        ))}
                        {overflow > 0 && <Chip label={`+${overflow}`} color="surface" />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Note className="mt-3">
              템플릿은 최대 {MAX_QUOTE_TEMPLATES}개까지 저장할 수 있어요.
            </Note>
          </>
        )}
      </div>
    </>
  );
}
