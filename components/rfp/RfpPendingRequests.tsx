'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/primitives/Button';
import { Label } from '@/components/primitives/Label';
import { CounterpartyProfileCard } from '@/components/messages/CounterpartyProfileCard';
import { toCounterparty } from '@/components/messages/types';
import {
  acceptPgRequestAction,
  rejectPgRequestAction,
} from '@/lib/server/actions/rfp';
import { toast } from '@/lib/toast';
import { Divider } from '@/components/primitives/Divider';
import type { WorkspaceDisplay } from '@/lib/types/workspace';

export type PendingRequestView = {
  id: string;
  /** 요청을 보낸 PG 워크스페이스 신원 — 이름만 받으면 로고가 화면까지 오지 못한다. */
  pgWs: WorkspaceDisplay;
  message: string;
  createdAt: string;
};

/**
 * 구매사 RFP 상세의 "참여 요청" 검토 목록 — 오픈 게시판에서 들어온 콜드 피치를
 * PG명+메시지와 함께 보여주고 수락/거절한다. 빈 목록이면 아무것도 렌더하지 않음.
 */
export function RfpPendingRequests({
  requests,
  canEdit,
}: {
  requests: PendingRequestView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (requests.length === 0) return null;

  function decide(requestId: string, action: 'accept' | 'reject') {
    setPendingId(requestId);
    startTransition(async () => {
      const res =
        action === 'accept'
          ? await acceptPgRequestAction({ requestId })
          : await rejectPgRequestAction({ requestId });
      setPendingId(null);
      if (res.ok) {
        toast(action === 'accept' ? '참여시켰어요.' : '요청을 거절했어요.');
        router.refresh();
      } else {
        toast('처리하지 못했어요.', { type: 'error' });
      }
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Label size="md" muted={false}>
          참여 요청 {requests.length}건
        </Label>
        <Divider />
      </div>
      <ul className="flex flex-col divide-y divide-[var(--md-sys-color-outline-variant)] border-t border-[var(--md-sys-color-outline-variant)]">
        {requests.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <CounterpartyProfileCard
                variant="profile"
                counterparty={toCounterparty(r.pgWs)}
              />
              <p className="whitespace-pre-wrap text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
                {r.message}
              </p>
            </div>
            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => decide(r.id, 'accept')}
                  disabled={pendingId === r.id}
                >
                  수락
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => decide(r.id, 'reject')}
                  disabled={pendingId === r.id}
                >
                  거절
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
