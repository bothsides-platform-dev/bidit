import type { Role } from '@/lib/types/user';

export const roleLabel: Record<Role, string> = { admin: '관리자', member: '멤버' };

export const ROLE_OPTIONS = [
  { value: 'member', label: '멤버' },
  { value: 'admin', label: '관리자' },
];

export function mutationErrorMessage(error: string): string {
  switch (error) {
    case 'LAST_ADMIN':
      return '마지막 관리자는 내보내거나 권한을 내릴 수 없어요.';
    case 'SELF_REMOVAL':
      return '본인은 내보낼 수 없어요.';
    case 'FORBIDDEN_NOT_ADMIN':
      return '권한이 없어요.';
    case 'INVITE_NOT_FOUND':
      return '초대를 찾지 못했어요.';
    case 'WORKSPACE_NOT_FOUND':
      return '워크스페이스를 찾지 못했어요.';
    case 'WORKSPACE_CHANGED':
      return '다른 워크스페이스로 전환됐어요. 새로고침 후 다시 시도해 주세요.';
    default:
      return `처리하지 못했어요 (${error})`;
  }
}

export function isValidInviteEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
