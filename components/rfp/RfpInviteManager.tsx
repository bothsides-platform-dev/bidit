'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/primitives/Button';
import { Label } from '@/components/primitives/Label';
import { Chip } from '@/components/primitives/Chip';
import type { ChipColor } from '@/components/primitives/Chip';
import { WorkspaceAvatar } from '@/components/primitives/WorkspaceAvatar';
import { CounterpartyProfileCard } from '@/components/messages/CounterpartyProfileCard';
import { toCounterparty } from '@/components/messages/types';
import {
  addPgWorkspacesToRfpAction,
  removeDraftPgWorkspaceAction,
  sendDraftInvitationsAction,
} from '@/lib/server/actions/rfp';
import { useLazyPgWorkspaces } from '@/lib/hooks/useLazyPgWorkspaces';
import type { PgWorkspace } from '@/lib/hooks/useLazyPgWorkspaces';
import { toast } from '@/lib/toast';
import { Divider } from '@/components/primitives/Divider';
import type { InvitationStatus } from '@/lib/types/invitation';
import type { WorkspaceDisplay } from '@/lib/types/workspace';
import { X } from 'lucide-react';

type InvitationView = {
  /** 워크스페이스 신원 한 덩어리 — 이름만 받으면 로고가 화면까지 오지 못한다. */
  ws: WorkspaceDisplay;
  status: InvitationStatus;
};

type Props = {
  rfpId: string;
  invitations: InvitationView[];
  canEdit: boolean;
};

const statusLabel: Record<InvitationStatus, string> = {
  draft: '대기중',
  sent: '초대 보냄',
  opened: '열람',
  accepted: '수락',
  declined: '거절',
  expired: '만료',
};

const statusColor: Record<InvitationStatus, ChipColor> = {
  draft: 'surface',
  sent: 'surface',
  opened: 'warning',
  accepted: 'tertiary',
  declined: 'error',
  expired: 'surface',
};

export function RfpInviteManager({
  rfpId,
  invitations,
  canEdit,
}: Props) {
  const router = useRouter();
  const { pgList, error: pgError, load: loadPg } = useLazyPgWorkspaces();
  const [inputError, setInputError] = useState('');
  const [pending, startTransition] = useTransition();
  const [pendingKind, setPendingKind] = useState<'add' | 'remove' | 'send' | null>(null);

  // 추가 영역(canEdit)에서만 PG 목록을 불러온다. 트리거(팝오버)가 없어졌으므로
  // 마운트 시 eager-load. 비편집 RFP는 추가 영역이 없어 fetch 도 발생하지 않는다.
  // (훅 규칙상 effect 는 최상위에 두고 canEdit 으로 본문을 가드.)
  useEffect(() => {
    if (canEdit) loadPg();
  }, [canEdit, loadPg]);

  const draftCount = invitations.filter((i) => i.status === 'draft').length;
  const invitedIds = new Set(invitations.map((i) => i.ws.id));
  const availablePgs = pgList.filter((pg) => !invitedIds.has(pg.id));

  const handleSelect = (ws: PgWorkspace) => {
    setInputError('');
    if (invitedIds.has(ws.id)) {
      setInputError('이미 추가된 워크스페이스입니다.');
      return;
    }
    setPendingKind('add');
    startTransition(async () => {
      try {
        const r = await addPgWorkspacesToRfpAction({ rfpId, workspaceIds: [ws.id] });
        if (!r.ok) {
          toast(`추가하지 못했어요 — ${r.error}`, { type: 'error' });
          return;
        }
        router.refresh();
      } catch {
        toast('추가하지 못했어요 — 잠시 후 다시 시도해 주세요.', { type: 'error' });
      } finally {
        setPendingKind(null);
      }
    });
  };

  const handleRemoveDraft = (inv: InvitationView) => {
    setPendingKind('remove');
    startTransition(async () => {
      try {
        const r = await removeDraftPgWorkspaceAction({ rfpId, workspaceId: inv.ws.id });
        if (!r.ok) {
          toast(`선택을 취소하지 못했어요 — ${r.error}`, { type: 'error' });
          return;
        }
        router.refresh();
      } catch {
        toast('선택을 취소하지 못했어요 — 잠시 후 다시 시도해 주세요.', { type: 'error' });
      } finally {
        setPendingKind(null);
      }
    });
  };

  const handleSendDrafts = () => {
    if (draftCount === 0) return;
    setPendingKind('send');
    startTransition(async () => {
      try {
        const r = await sendDraftInvitationsAction({ rfpId });
        if (!r.ok) {
          toast(`초대 메일을 보내지 못했어요 — ${r.error}`, { type: 'error' });
          return;
        }
        toast(`${r.sentCount}개 PG에 초대 메일을 보냈어요.`);
        router.refresh();
      } catch {
        toast('초대 메일을 보내지 못했어요 — 잠시 후 다시 시도해 주세요.', { type: 'error' });
      } finally {
        setPendingKind(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* PG 목록 */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <Label size="md" muted={false}>초대 PG</Label>
          <Divider />
        </div>
        {invitations.length === 0 ? (
          <p className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
            초대한 PG가 없어요.
          </p>
        ) : (
          <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-t border-[var(--md-sys-color-outline-variant)]">
            {invitations.map((inv, i) => (
              <div
                key={inv.ws.id}
                className="py-2 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="md-numeric text-xs text-[var(--md-sys-color-on-surface-variant)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <CounterpartyProfileCard
                    variant="profile"
                    counterparty={toCounterparty(inv.ws)}
                  />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Chip label={statusLabel[inv.status]} color={statusColor[inv.status]} />
                  {canEdit && inv.status === 'draft' && (
                    <button
                      type="button"
                      aria-label={`${inv.ws.name} 선택 취소`}
                      disabled={pending}
                      onClick={() => handleRemoveDraft(inv)}
                      className="grid size-6 place-items-center rounded-[var(--md-sys-shape-extra-small)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)] hover:text-[var(--md-sys-color-error)] disabled:opacity-50"
                    >
                      <X aria-hidden className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <>
          {/* PG 칩 추가 */}
          <div className="space-y-2">
            <Label size="md" muted={false}>PG 워크스페이스 추가</Label>

            {pgError ? (
              <p className="md-label-small text-[var(--md-sys-color-error)]">
                {pgError}
              </p>
            ) : pgList.length === 0 ? (
              <p
                role="status"
                className="md-label-small text-[var(--md-sys-color-on-surface-variant)]"
              >
                불러오는 중…
              </p>
            ) : availablePgs.length === 0 ? (
              <p className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
                모든 PG를 이미 추가했어요.
              </p>
            ) : (
              <div className="flex flex-wrap gap-[6px]">
                {availablePgs.map((pg) => (
                  <button
                    key={pg.id}
                    type="button"
                    disabled={pending}
                    onClick={() => handleSelect(pg)}
                    className="inline-flex items-center gap-1.5 py-[5px] pl-[5px] pr-3 rounded-[6px] text-[13px] bg-transparent text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)] hover:border-[var(--md-sys-color-outline)] disabled:opacity-50 transition-colors"
                  >
                    {/* 로고는 장식 — 칩 텍스트가 이미 PG명을 알리므로 a11y 트리에서 숨김 */}
                    <span aria-hidden className="inline-flex">
                      <WorkspaceAvatar
                        size="sm"
                        name={pg.name}
                        workspaceId={pg.id}
                        logoUpdatedAt={pg.logoUpdatedAt}
                      />
                    </span>
                    {pg.displayName}
                  </button>
                ))}
              </div>
            )}

            {inputError && (
              <p className="md-label-small text-[var(--md-sys-color-error)]">
                {inputError}
              </p>
            )}
            <p className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
              칩을 누르면 &ldquo;대기중&rdquo;으로 쌓여요. 아래 &ldquo;초대 보내기&rdquo;를
              누르면 메일이 나가요.
            </p>
          </div>

          {/* 초대 보내기 */}
          <div className="space-y-2">
            <Button
              type="button"
              fullWidth
              size="md"
              variant={draftCount > 0 ? 'filled' : 'text'}
              disabled={draftCount === 0 || pending}
              onClick={handleSendDrafts}
            >
              {pendingKind === 'send'
                ? '보내는 중…'
                : draftCount > 0
                  ? `${draftCount}개 PG에 초대 보내기`
                  : '보낼 대기 PG 없음'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
