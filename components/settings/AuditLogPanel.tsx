'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/primitives/Button';
import { LocalTime } from '@/components/primitives/LocalTime';
import { listAuditLogsAction } from '@/lib/server/actions/workspace/listAuditLogsAction';
import type { AuditLogCursor, AuditLogRecord } from '@/lib/server/repositories/types';
import type { WorkspaceType } from '@/lib/types/workspace';

type Props = {
  workspaceId: string;
  workspaceType: WorkspaceType;
  initialLogs: AuditLogRecord[];
  initialNextCursor: AuditLogCursor | null;
};

// '<도메인>.<행위>' → 사용자 문구 (UX_WRITING §8 — '견적' 언어, 해요체).
const ACTION_LABELS: Record<string, string> = {
  'rfp.create': '견적 요청을 만들었어요',
  'rfp.send_invitations': '견적 요청을 보냈어요',
  'rfp.award': '견적을 선정했어요',
  'rfp.cancel': '견적 요청을 취소했어요',
  'rfp.close': '견적 요청을 마감했어요',
  'rfp.requote': '견적 재요청을 보냈어요',
  'rfp.board_visibility': '게시판 노출 설정을 바꿨어요',
  'bid.submit': '견적을 제출했어요',
  'bid.withdraw': '견적을 철회했어요',
  'workspace.create': '워크스페이스를 만들었어요',
  'workspace.name_change_request': '회사 이름 변경을 요청했어요',
  'workspace.member_invite': '멤버를 초대했어요',
  'workspace.member_invite_resend': '초대 메일을 다시 보냈어요',
  'workspace.member_invite_cancel': '초대를 취소했어요',
  'workspace.invite_accept': '초대를 수락했어요',
  'workspace.member_role_change': '멤버 역할을 바꿨어요',
  'workspace.member_remove': '멤버를 내보냈어요',
  'signing.awaiting_template': '계약서 준비를 시작했어요',
  'signing.sent': '계약서를 보냈어요',
  'signing.send_claim_taken': '계약서 작성을 이어받았어요',
  'signing.completed': '전자서명이 완료됐어요',
  'signing.canceled': '전자서명을 취소했어요',
  // 스노우싸인 콘솔 등 외부 취소 — 사건형 문구로 사람의 행위를 주장하지 않는다.
  'signing.canceled_by_provider': '전자서명이 외부에서 취소됐어요',
  'signing.declined': '전자서명이 거절됐어요',
  'signing.expired': '전자서명 기한이 지났어요',
  'signing.resent': '전자서명을 다시 시작했어요',
  'signing.reminded': '서명 리마인더를 보냈어요',
};

/** RFP 코드 엔터티는 워크스페이스 종류에 맞는 상세 화면으로 링크한다. */
function entityHref(workspaceType: WorkspaceType, entityType: string | null, entityId: string | null): string | null {
  if (entityType !== 'rfp' || !entityId || !/^P-\d{4}-\d{4}$/.test(entityId)) return null;
  return workspaceType === 'buyer' ? `/rfp/${entityId}` : `/inbox/${entityId}`;
}

export function AuditLogPanel({ workspaceId, workspaceType, initialLogs, initialNextCursor }: Props) {
  const [logs, setLogs] = useState(initialLogs);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [isPending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const r = await listAuditLogsAction({ workspaceId, before: cursor });
      if (!r.ok) return;
      setLogs((prev) => [...prev, ...r.logs]);
      setCursor(r.nextCursor);
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--md-sys-color-on-surface)]">
          활동 기록
        </h1>
        <p className="mt-1 text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
          워크스페이스에서 일어난 주요 활동이 시간순으로 남아요.
        </p>
      </div>

      {logs.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
          아직 기록된 활동이 없어요.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--md-sys-color-outline-variant)] border-y border-[var(--md-sys-color-outline-variant)]">
          {logs.map((row) => {
            const href = entityHref(workspaceType, row.entityType, row.entityId);
            return (
              <li key={row.id} className="flex items-center gap-3 py-2.5 text-[14px]">
                <span className="shrink-0 font-medium text-[var(--md-sys-color-on-surface)]">
                  {row.actorName ?? '탈퇴한 멤버'}
                </span>
                {row.viaMaster && (
                  <span className="shrink-0 rounded-[var(--md-sys-shape-extra-small)] bg-[var(--md-sys-color-surface-container-high)] px-1.5 py-0.5 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                    운영자
                  </span>
                )}
                <span className="min-w-0 truncate text-[var(--md-sys-color-on-surface-variant)]">
                  {ACTION_LABELS[row.action] ?? row.action}
                </span>
                {row.entityId &&
                  (href ? (
                    <Link
                      href={href}
                      className="md-numeric shrink-0 text-[13px] text-[var(--md-sys-color-primary)] hover:underline"
                    >
                      {row.entityId}
                    </Link>
                  ) : null)}
                <span className="md-numeric ml-auto shrink-0 text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
                  <LocalTime iso={row.createdAt} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button variant="outlined" size="sm" onClick={loadMore} disabled={isPending}>
            {isPending ? '불러오는 중…' : '더 보기'}
          </Button>
        </div>
      )}
    </section>
  );
}
