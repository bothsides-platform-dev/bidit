import { describe, it, expect } from 'vitest';
import {
  mutationErrorMessage,
  roleLabel,
  ROLE_OPTIONS,
  isValidInviteEmail,
} from '../members-panel-utils';

describe('mutationErrorMessage', () => {
  it('maps known error codes to friendly Korean copy', () => {
    expect(mutationErrorMessage('LAST_ADMIN')).toBe(
      '마지막 관리자는 내보내거나 권한을 내릴 수 없어요.',
    );
    expect(mutationErrorMessage('SELF_REMOVAL')).toBe('본인은 내보낼 수 없어요.');
    expect(mutationErrorMessage('FORBIDDEN_NOT_ADMIN')).toBe('권한이 없어요.');
    expect(mutationErrorMessage('INVITE_NOT_FOUND')).toBe('초대를 찾지 못했어요.');
    expect(mutationErrorMessage('WORKSPACE_NOT_FOUND')).toBe(
      '워크스페이스를 찾지 못했어요.',
    );
    expect(mutationErrorMessage('WORKSPACE_CHANGED')).toBe(
      '다른 워크스페이스로 전환됐어요. 새로고침 후 다시 시도해 주세요.',
    );
  });

  it('falls back to a generic message with the raw code for unknown errors', () => {
    expect(mutationErrorMessage('SOMETHING_ELSE')).toBe(
      '처리하지 못했어요 (SOMETHING_ELSE)',
    );
  });
});

describe('roleLabel', () => {
  it('maps role keys to Korean labels', () => {
    expect(roleLabel.admin).toBe('관리자');
    expect(roleLabel.member).toBe('멤버');
  });
});

describe('ROLE_OPTIONS', () => {
  it('lists member first, then admin, with matching labels', () => {
    expect(ROLE_OPTIONS).toEqual([
      { value: 'member', label: '멤버' },
      { value: 'admin', label: '관리자' },
    ]);
  });
});

describe('isValidInviteEmail', () => {
  it('accepts a well-formed email', () => {
    expect(isValidInviteEmail('new@example.com')).toBe(true);
  });

  it('rejects malformed emails', () => {
    expect(isValidInviteEmail('no-at-sign')).toBe(false);
    expect(isValidInviteEmail('missing@domain')).toBe(false);
    expect(isValidInviteEmail('spaces @example.com')).toBe(false);
    expect(isValidInviteEmail('')).toBe(false);
  });
});
