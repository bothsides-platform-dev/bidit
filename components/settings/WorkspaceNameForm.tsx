'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { Field } from '@/components/primitives/Field';
import { underlineInputClass } from '@/components/forms/inputs';
import { requestWorkspaceNameChangeAction } from '@/lib/server/actions/workspace/requestWorkspaceNameChangeAction';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { errorLabel } from '@/lib/utils/error-label';

type Props = {
  workspaceId: string;
  currentName: string;
  canEdit: boolean;
  pendingRequest: { requestedName: string } | null;
  lastRejectedRequest?: { requestedName: string; reason: string } | null;
};

const ERROR_LABELS: Record<string, string> = {
  INVALID_INPUT: '1자 이상 200자 이하로 입력해요.',
  FORBIDDEN: '권한이 없어요.',
  NOT_FOUND: '워크스페이스를 찾지 못했어요.',
  SAME_NAME: '현재 이름과 다른 이름을 입력해 주세요.',
  ALREADY_PENDING: '이미 확인 중인 이름 변경 요청이 있어요.',
  WORKSPACE_INACTIVE: '현재 워크스페이스에서는 이름 변경을 요청할 수 없어요.',
  WORKSPACE_CHANGED: '다른 워크스페이스로 전환됐어요. 새로고침 후 다시 시도해 주세요.',
};

export function WorkspaceNameForm({ workspaceId, currentName, canEdit, pendingRequest, lastRejectedRequest }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const trimmed = name.trim();
  const dirty = trimmed !== currentName && trimmed.length >= 1 && trimmed.length <= 200;

  const handleSubmit = async () => {
    if (!dirty || submitting) return;
    setSubmitting(true);
    try {
      const result = await requestWorkspaceNameChangeAction({ workspaceId, name: trimmed });
      if (!result.ok) {
        toast(errorLabel(ERROR_LABELS, result.error, '요청하지 못했어요. 잠시 후 다시 시도해 주세요.'), { type: 'error' });
        return;
      }
      toast('이름 변경을 요청했어요.');
      setEditing(false);
      startTransition(() => router.refresh());
    } catch {
      toast('요청하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingRequest) {
    return (
      <div className="py-3 space-y-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">이름</span>
          <span className="text-[13px] text-[var(--md-sys-color-on-surface)] break-all sm:break-keep">{currentName}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] text-[var(--md-sys-color-on-surface)]">{pendingRequest.requestedName}</p>
            <p className="text-xs text-[var(--md-sys-color-on-surface-variant)]">승인 전까지 현재 이름이 유지돼요.</p>
          </div>
          <Chip label="운영자 확인 중" color="warning" />
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="py-2 space-y-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <span className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">이름</span>
          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
            <span className="text-[13px] text-[var(--md-sys-color-on-surface)] break-all sm:break-keep">{currentName}</span>
            {canEdit && (
              <button type="button" onClick={() => { setName(currentName); setEditing(true); }} className="md-label-small text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] transition-colors shrink-0">
                변경 요청
              </button>
            )}
          </div>
        </div>
        {lastRejectedRequest?.reason && (
          <div role="status" className="rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-error)]/30 bg-[var(--md-sys-color-error-container)] px-3 py-2 text-[13px] text-[var(--md-sys-color-on-error-container)]">
            <p>‘{lastRejectedRequest.requestedName}’ 요청이 거절됐어요.</p>
            <p className="mt-1">{lastRejectedRequest.reason}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-3 space-y-3">
      <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)]">운영자가 확인한 뒤 이름이 바뀌어요.</p>
      <Field label="변경할 이름" htmlFor="workspace-name-input">
        <input ref={inputRef} id="workspace-name-input" type="text" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void handleSubmit(); }
          if (event.key === 'Escape') { event.preventDefault(); setEditing(false); setName(currentName); }
        }} className={cn(underlineInputClass, 'sm:max-w-[360px]')} />
      </Field>
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => { setEditing(false); setName(currentName); }} className="md-label-small text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] transition-colors">취소</button>
        <Button type="button" disabled={!dirty || submitting} onClick={handleSubmit}>{submitting ? '요청 중…' : '이름 변경 요청'}</Button>
      </div>
    </div>
  );
}
