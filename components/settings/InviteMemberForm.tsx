'use client';

import { useState } from 'react';
import { Label } from '@/components/primitives/Label';
import { Button } from '@/components/primitives/Button';
import { Select } from '@/components/primitives/Select';
import type { Role } from '@/lib/types/user';
import { ROLE_OPTIONS, isValidInviteEmail, mutationErrorMessage } from './members-panel-utils';
import { Divider } from '@/components/primitives/Divider';
import { underlineInputClass } from '@/components/forms/inputs';
import { cn } from '@/lib/utils';

type InviteResult = { ok: true } | { ok: false; error: string };

type Props = {
  isPending: boolean;
  /** 초대 실행. 성공하면 폼을 초기화한다. */
  onInvite: (input: { email: string; role: Role }) => Promise<InviteResult>;
};

export function InviteMemberForm({ isPending, onInvite }: Props) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [error, setError] = useState<string | null>(null);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const email = inviteEmail.trim().toLowerCase();
    if (!isValidInviteEmail(email)) {
      setError('이메일 형식이 올바르지 않습니다.');
      return;
    }

    const role = inviteRole;
    void onInvite({ email, role }).then((result) => {
      if (!result.ok) {
        if (result.error === 'ALREADY_INVITED') {
          setError('이미 초대 대기 중인 이메일입니다.');
        } else if (result.error === 'FORBIDDEN_NOT_ADMIN') {
          setError('초대 권한이 없습니다.');
        } else if (result.error === 'WORKSPACE_CHANGED') {
          setError(mutationErrorMessage(result.error));
        } else {
          setError(`초대 실패 (${result.error})`);
        }
        return;
      }
      setInviteEmail('');
      setInviteRole('member');
    });
  };

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Label size="md" muted={false}>멤버 초대</Label>
        <Divider />
      </div>
      <form onSubmit={handleInvite} className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1 space-y-1">
            <Label size="md" muted={false}>이메일</Label>
            <input
              type="email"
              value={inviteEmail}
              disabled={isPending}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setError(null);
              }}
              placeholder="member@company.com"
              className={cn(underlineInputClass, 'md-numeric disabled:opacity-50')}
            />
          </div>
          <div className="space-y-1">
            <Label size="md" muted={false}>역할</Label>
            <Select
              options={ROLE_OPTIONS}
              value={inviteRole}
              onChange={(v) => setInviteRole(v as Role)}
            />
          </div>
          <Button
            type="submit"
            disabled={!inviteEmail.trim() || isPending}
            className="md:ml-4"
          >
            {isPending ? '보내는 중…' : '초대 보내기'}
          </Button>
        </div>
        {error && (
          <p className="md-label-small text-[var(--md-sys-color-error)]">
            {error}
          </p>
        )}
        <p className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
          초대 메일이 발송되며, 수락 후 멤버 목록에 추가됩니다.
        </p>
      </form>
    </section>
  );
}
