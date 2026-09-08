'use server';

import { z } from 'zod';

import { requireSession } from '@/lib/auth/session';
import { getMembership, isApprovedAdmin } from '@/lib/auth/active-workspace';
import { isMasterEmail } from '@/lib/auth/master-allowlist';
import { getAuditLogRepo } from '@/lib/server/repositories/factory';
import type { AuditLogCursor, AuditLogRecord } from '@/lib/server/repositories/types';
import type { ActionResult } from '@/lib/server/actions/_result';

const Input = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    before: z
      // createdAt 은 repo 가 돌려준 ISO 문자열 그대로 — 임의 문자열이
      // new Date() 에서 Invalid Date 로 변해 쿼리 에러가 되는 것을 차단.
      .object({ createdAt: z.iso.datetime(), id: z.uuid() })
      .optional(),
  })
  .strict();

export type ListAuditLogsInput = z.input<typeof Input>;
export type ListAuditLogsResult = ActionResult<{
  logs: AuditLogRecord[];
  nextCursor: AuditLogCursor | null;
}>;

const DEFAULT_LIMIT = 50;

/**
 * 설정 > 활동 기록 (C5) — 워크스페이스 감사 로그 조회.
 * 승인된 admin 또는 운영계정 전용. 일반 사용자의 JWT role 은 stale 할 수 있으므로
 * DB 멤버십을 재검증한다.
 */
export async function listAuditLogsAction(
  input: ListAuditLogsInput = {},
): Promise<ListAuditLogsResult> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: 'UNAUTHENTICATED' };
  }

  const wsId = session.user.workspaceId;
  if (!wsId) return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  if (!isMasterEmail(session.user.email)) {
    const membership = await getMembership(session.user.id, wsId);
    if (!isApprovedAdmin(membership)) {
      return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
    }
  }

  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  const repo = await getAuditLogRepo();
  const logs = await repo.listForWorkspace(wsId, { limit, before: parsed.data.before });
  const last = logs[logs.length - 1];
  const nextCursor =
    logs.length === limit && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { ok: true, logs, nextCursor };
}
