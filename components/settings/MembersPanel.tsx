'use client';

import { useCallback, useState, useTransition } from 'react';
import { josa } from 'es-hangul';
import { Label } from '@/components/primitives/Label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/lib/toast';
import { inviteWorkspaceMemberAction } from '@/lib/server/actions/workspace/inviteWorkspaceMemberAction';
import { removeWorkspaceMemberAction } from '@/lib/server/actions/workspace/removeWorkspaceMemberAction';
import { changeWorkspaceMemberRoleAction } from '@/lib/server/actions/workspace/changeWorkspaceMemberRoleAction';
import { cancelWorkspaceInviteAction } from '@/lib/server/actions/workspace/cancelWorkspaceInviteAction';
import { resendWorkspaceInviteAction } from '@/lib/server/actions/workspace/resendWorkspaceInviteAction';
import type { Role, User } from '@/lib/types/user';
import { mutationErrorMessage, roleLabel } from './members-panel-utils';
import { MemberRow } from './MemberRow';
import { Divider } from '@/components/primitives/Divider';
import { PendingInviteRow, type PendingInvite } from './PendingInviteRow';
import { InviteMemberForm } from './InviteMemberForm';

type ConfirmState =
  | { kind: 'remove'; member: User }
  | { kind: 'cancelInvite'; email: string }
  | null;

type InviteResult = { ok: true } | { ok: false; error: string };

type Props = {
  workspaceId: string;
  workspaceName: string;
  initialMembers: User[];
  userRole: Role;
  initialPendingInvites: PendingInvite[];
  /** 현재 로그인한 사용자 id — 자기 자신에 대한 강퇴/역할변경을 막는다. */
  currentUserId: string;
};

export function MembersPanel({
  workspaceId,
  workspaceName,
  initialMembers,
  userRole,
  initialPendingInvites,
  currentUserId,
}: Props) {
  const [members, setMembers] = useState<User[]>(initialMembers);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(initialPendingInvites);
  const [isPending, startTransition] = useTransition();
  const [isMutating, startMutate] = useTransition();
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const isAdmin = userRole === 'admin';

  // ── invite form ──────────────────────────────────────────────────────────
  const handleInvite = useCallback(
    ({ email, role }: { email: string; role: Role }) =>
      new Promise<InviteResult>((resolve) => {
        startTransition(async () => {
          const result = await inviteWorkspaceMemberAction({ workspaceId, email, role });
          if (!result.ok) {
            resolve({ ok: false, error: result.error });
            return;
          }
          setPendingInvites((prev) => [
            ...prev,
            { email, createdAt: new Date().toISOString(), role },
          ]);
          resolve({ ok: true });
        });
      }),
    [workspaceId],
  );

  // ── member mutations ─────────────────────────────────────────────────────
  const handleRemove = useCallback((m: User) => {
    startMutate(async () => {
      const result = await removeWorkspaceMemberAction({ workspaceId, userId: m.id });
      if (!result.ok) {
        toast(mutationErrorMessage(result.error), { type: 'error' });
        return;
      }
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      setConfirm(null);
      toast(`${m.name}님을 내보냈어요.`);
    });
  }, [workspaceId]);

  const handleRoleChange = useCallback((m: User, role: Role) => {
    if (role === m.role) return;
    startMutate(async () => {
      const result = await changeWorkspaceMemberRoleAction({ workspaceId, userId: m.id, role });
      if (!result.ok) {
        toast(mutationErrorMessage(result.error), { type: 'error' });
        return;
      }
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, role } : x)));
      toast(`${m.name}님의 권한을 ${josa(roleLabel[role], '으로/로')} 변경했어요.`);
    });
  }, [workspaceId]);

  // ── pending invite mutations ──────────────────────────────────────────────
  const handleCancelInvite = useCallback((email: string) => {
    startMutate(async () => {
      const result = await cancelWorkspaceInviteAction({ workspaceId, email });
      if (!result.ok) {
        toast(mutationErrorMessage(result.error), { type: 'error' });
        return;
      }
      setPendingInvites((prev) => prev.filter((p) => p.email !== email));
      setConfirm(null);
      toast('초대를 취소했어요.');
    });
  }, [workspaceId]);

  const handleResend = useCallback((email: string) => {
    startMutate(async () => {
      const result = await resendWorkspaceInviteAction({ workspaceId, email });
      if (!result.ok) {
        toast(mutationErrorMessage(result.error), { type: 'error' });
        return;
      }
      toast('초대 메일을 다시 보냈어요.');
    });
  }, [workspaceId]);

  // ── row callbacks (stable refs so memoized rows skip re-render) ────────────
  const handleRemoveClick = useCallback((m: User) => {
    setConfirm({ kind: 'remove', member: m });
  }, []);

  const handleCancelInviteClick = useCallback((email: string) => {
    setConfirm({ kind: 'cancelInvite', email });
  }, []);

  // ── confirm dialog ────────────────────────────────────────────────────────
  const confirmTitle =
    confirm?.kind === 'remove'
      ? `${confirm.member.name}님을 내보낼까요?`
      : confirm?.kind === 'cancelInvite'
        ? '초대를 취소할까요?'
        : '';

  const confirmDescription =
    confirm?.kind === 'cancelInvite' ? confirm.email : undefined;

  const handleConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === 'remove') handleRemove(confirm.member);
    else if (confirm.kind === 'cancelInvite') handleCancelInvite(confirm.email);
  };

  return (
    <>
      {/* ── page header ── */}
      <div>
        <Label size="md" muted={false} as="span" className="block mb-2">SETTINGS · MEMBERS</Label>
        <h1 className="text-[26px] font-[700] tracking-[-0.02em] text-[var(--md-sys-color-on-surface)]">
          멤버 관리
        </h1>
        <p className="mt-2 text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
          {workspaceName} 워크스페이스의 멤버 {members.length}명
          {pendingInvites.length > 0 && ` · 초대 대기 ${pendingInvites.length}건`}
        </p>
      </div>

      {/* ── active members ── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <Label size="md" muted={false}>활성 멤버</Label>
          <span className="md-numeric text-xs text-[var(--md-sys-color-on-surface-variant)]">
            {String(members.length).padStart(2, '0')}
          </span>
          <Divider />
        </div>
        <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-y border-[var(--md-sys-color-outline-variant)]">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isSelf={m.id === currentUserId}
              isAdmin={isAdmin}
              isMutating={isMutating}
              onRoleChange={handleRoleChange}
              onRemoveClick={handleRemoveClick}
            />
          ))}
        </div>
      </section>

      {/* ── pending invitations ── */}
      {pendingInvites.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-4">
            <Label size="md" muted={false}>초대 대기</Label>
            <span className="md-numeric text-xs text-[var(--md-sys-color-warning)]">
              {String(pendingInvites.length).padStart(2, '0')}
            </span>
            <Divider />
          </div>
          <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-y border-[var(--md-sys-color-outline-variant)]">
            {pendingInvites.map((p, i) => (
              <PendingInviteRow
                key={p.email}
                invite={p}
                index={i}
                isAdmin={isAdmin}
                isMutating={isMutating}
                onResend={handleResend}
                onCancelClick={handleCancelInviteClick}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── invite form — admin only ── */}
      {isAdmin && (
        <InviteMemberForm isPending={isPending} onInvite={handleInvite} />
      )}

      {/* ── confirm dialog (shared for remove + cancel invite) ── */}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirm?.kind === 'remove' ? '내보내기' : '초대 취소'}
        variant="danger"
        onConfirm={handleConfirm}
        loading={isMutating}
      />
    </>
  );
}
