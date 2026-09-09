import { defineAsyncSingleton } from '@/lib/server/_singleton';
import { getMembership, isApprovedAdmin } from '@/lib/auth/active-workspace';
import { isMasterEmail } from '@/lib/auth/master-allowlist';
import { normalizeEmail, bucket15Min } from './_service-utils';
import { randomUUID } from 'node:crypto';
import type {
  AuditLogRepo,
  BizProfileRepo,
  OutboxRepo,
  UserRepo,
  WorkspaceRepo,
} from '@/lib/server/repositories/types';
import type { BizProfile } from '@/lib/types/biz-profile';
import { isUniqueViolation } from '@/lib/server/repositories/utils';
import { emitAfterCommit } from '@/lib/server/notifications/dispatch';
import { flushAfterCommit } from '@/lib/server/outbox/post-commit';
import { generateToken, hashToken } from '@/lib/server/token';
import { renderWorkspaceInvited } from '@/lib/server/outbox/templates/workspaceInvited';
import { baseUrl } from '@/lib/server/env';
import { createWorkspaceInTx } from '@/lib/server/actions/workspace/_createWorkspace';
import { claimInviteInTx } from '@/lib/server/actions/workspace/_claimWorkspaceInvite';
import { dispatchWorkspaceInviteInApp } from '@/lib/server/actions/workspace/_workspaceInviteNotify';
import { disconnectCentrifugoUser } from '@/lib/server/realtime/centrifugo';
import type { Notification } from '@/lib/types/notification';
import type { Actor, ServiceResult } from './types';

export type WorkspaceActor = Actor;

export type AcceptInviteActor = { userId: string; userEmail: string; workspaceId: string };

export class WorkspaceService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _db: any,
    private readonly outboxRepo: OutboxRepo,
    private readonly auditRepo: AuditLogRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly userRepo: UserRepo,
    private readonly bizProfileRepo: BizProfileRepo,
  ) {}

  private async workspaceManagementAccess(
    actor: WorkspaceActor,
  ): Promise<{ allowed: boolean; viaMaster: boolean }> {
    // 운영계정은 어느 워크스페이스에도 멤버십 행을 만들지 않고 synthetic admin 으로
    // 진입한다. 세션의 isMaster 플래그를 신뢰하지 않고 DB의 현재 이메일을 서버 전용
    // allowlist 와 다시 대조해, 서비스 경계를 직접 호출해도 같은 권한 판정이 적용된다.
    const [membership, user] = await Promise.all([
      getMembership(actor.userId, actor.workspaceId),
      this.userRepo.findById(actor.userId),
    ]);
    const viaMaster = isMasterEmail(user?.email);
    return { allowed: viaMaster || isApprovedAdmin(membership), viaMaster };
  }

  async requestNameChange(
    actor: WorkspaceActor,
    requestedName: string,
  ): Promise<ServiceResult<object>> {
    try {
      return await this._db.transaction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (tx: any): Promise<ServiceResult<object>> => {
          const currentName = await this.workspaceRepo.getActiveName(actor.workspaceId, tx);
          if (!currentName) return { ok: false, error: 'WORKSPACE_INACTIVE' };
          if (currentName === requestedName) return { ok: false, error: 'SAME_NAME' };

          await this.workspaceRepo.createNameChangeRequest(
            {
              workspaceId: actor.workspaceId,
              requestedByUserId: actor.userId,
              currentName,
              requestedName,
            },
            tx,
          );
          await this.auditRepo.insert(
            {
              actorUserId: actor.userId,
              actorWorkspaceId: actor.workspaceId,
              action: 'workspace.name_change_request',
              entityType: 'workspace',
              entityId: actor.workspaceId,
              metadata: { currentName, requestedName },
            },
            tx,
          );
          return { ok: true };
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, error: 'ALREADY_PENDING' };
      throw error;
    }
  }

  /**
   * 워크스페이스 등록정보(=현재 시점 사업자 프로필) 교체.
   *
   * biz_profiles 는 불변 — 현재 row 를 베이스로 patch 를 머지한 **새 row** 를 만들고
   * workspace.biz_profile_id 포인터를 그 row 로 옮긴다(createRfp 는 스냅샷만 남기고
   * 포인터를 건드리지 않는다는 점이 다르다). 등급은 사용자가 명시 갱신했으므로
   * 'user_overridden'. 관리자 게이트와 국세청 재조회(검증된 값만 patch 로 도착)는
   * 호출자(액션)의 몫이다.
   */
  async replaceBizProfile(
    actor: WorkspaceActor,
    patch: {
      grade?: BizProfile['grade'];
      bizProfile?: Required<Pick<BizProfile, 'bizNo' | 'taxType' | 'status'>>;
    },
  ): Promise<ServiceResult<{ bizProfileId: string }>> {
    return this._db.transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any): Promise<ServiceResult<{ bizProfileId: string }>> => {
        const currentId = await this.workspaceRepo.getBizProfileId(actor.workspaceId, tx);
        const base = currentId ? await this.bizProfileRepo.findById(currentId, tx) : undefined;
        if (!base && !patch.bizProfile) {
          // 처음 생성. 가입 시 입력했어야 하는 케이스 — 명시 입력 강제.
          return { ok: false, error: 'BIZ_PROFILE_REQUIRED' };
        }

        const newId = randomUUID();
        await this.bizProfileRepo.save(
          {
            id: newId,
            bizNo: patch.bizProfile?.bizNo ?? base!.bizNo,
            taxType: patch.bizProfile?.taxType ?? base!.taxType,
            status: patch.bizProfile?.status ?? base!.status,
            grade: patch.grade ?? base?.grade ?? undefined,
            gradeSource: 'user_overridden',
            gradeConfirmedBy: actor.userId,
            gradeConfirmedAt: new Date().toISOString(),
          },
          tx,
        );
        await this.workspaceRepo.setBizProfilePointer(actor.workspaceId, newId, tx);
        return { ok: true, bizProfileId: newId };
      },
    );
  }

  async createWorkspace(
    input: {
      userId: string;
      type: 'buyer' | 'pg';
      name: string;
      bizProfile?: object;
      /** false = 국세청 장애로 미검증 통과 — createWorkspaceInTx 가 risk flag 를 남긴다. */
      bizVerified?: boolean;
    },
    _actor: WorkspaceActor,
  ): Promise<ServiceResult<{ workspaceId: string; applicationId: string }>> {
    const { workspaceId, applicationId } = await this._db.transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        const ids = await createWorkspaceInTx(tx, {
          userId: input.userId,
          type: input.type,
          name: input.name,
          bizProfile: input.bizProfile as Parameters<typeof createWorkspaceInTx>[1]['bizProfile'],
          bizVerified: input.bizVerified,
        });
        // 감사 로그 (C5) — 생성과 같은 트랜잭션에서 커밋.
        await this.auditRepo.insert(
          {
            actorUserId: input.userId,
            actorWorkspaceId: ids.workspaceId,
            action: 'workspace.create',
            entityType: 'workspace',
            entityId: ids.workspaceId,
            metadata: { name: input.name, type: input.type },
          },
          tx,
        );
        return ids;
      },
    );
    return { ok: true, workspaceId, applicationId };
  }

  async inviteMember(
    input: { email: string; role: 'admin' | 'member' },
    actor: WorkspaceActor,
  ): Promise<ServiceResult> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      return { ok: false, error: 'INVALID_INPUT' };
    }

    // 승인된 admin 또는 운영계정만 관리 권한. 미승인 admin 은 계속 차단한다.
    const access = await this.workspaceManagementAccess(actor);
    if (!access.allowed) {
      return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
    }

    const wsName = await this.workspaceRepo.getName(actor.workspaceId);
    if (wsName === undefined) return { ok: false, error: 'WORKSPACE_NOT_FOUND' };

    const normalizedEmail = normalizeEmail(input.email);
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    let pendingEmit: Notification | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this._db.transaction(async (tx: any): Promise<ServiceResult> => {
      try {
        await this.workspaceRepo.createInvitation(
          {
            workspaceId: actor.workspaceId,
            invitedEmail: normalizedEmail,
            invitedByUserId: actor.userId,
            role: input.role,
            tokenHash,
            expiresAt,
          },
          tx,
        );
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: 'ALREADY_INVITED' };
        throw err;
      }

      const inviteUrl = `${baseUrl()}/invite/workspace/${rawToken}`;
      const html = await renderWorkspaceInvited({ workspaceName: wsName, inviteUrl });
      await this.outboxRepo.enqueue(
        {
          event: 'workspace.invited',
          to: normalizedEmail,
          subject: '[서포트비] 워크스페이스 초대장',
          html,
          dedupeKey: `ws-invite:${actor.workspaceId}:${normalizedEmail}:${bucket15Min()}`,
        },
        tx,
      );

      pendingEmit = await dispatchWorkspaceInviteInApp(tx, {
        invitedEmail: normalizedEmail,
        workspaceName: wsName,
        linkUrl: `/invite/workspace/${rawToken}`,
      });

      // 감사 로그 (C5) — 초대와 같은 트랜잭션에서 커밋.
      await this.auditRepo.insert(
        {
          actorUserId: actor.userId,
          actorWorkspaceId: actor.workspaceId,
          action: 'workspace.member_invite',
          entityType: 'workspace',
          entityId: actor.workspaceId,
          metadata: { email: normalizedEmail, role: input.role, actorWasMaster: access.viaMaster },
        },
        tx,
      );

      return { ok: true };
    });

    if (result.ok) {
      if (pendingEmit) emitAfterCommit([pendingEmit]);
      flushAfterCommit();
    }
    return result;
  }

  async resendInvite(
    input: { email: string },
    actor: WorkspaceActor,
  ): Promise<ServiceResult> {
    const access = await this.workspaceManagementAccess(actor);
    if (!access.allowed) {
      return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
    }

    const wsName = await this.workspaceRepo.getName(actor.workspaceId);
    if (wsName === undefined) return { ok: false, error: 'WORKSPACE_NOT_FOUND' };

    const normalizedEmail = normalizeEmail(input.email);
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    let pendingEmit: Notification | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this._db.transaction(async (tx: any): Promise<ServiceResult> => {
      const updated = await this.workspaceRepo.resetPendingInvitationToken(
        { workspaceId: actor.workspaceId, email: normalizedEmail, tokenHash, expiresAt },
        tx,
      );

      if (!updated) return { ok: false, error: 'INVITE_NOT_FOUND' };

      const inviteUrl = `${baseUrl()}/invite/workspace/${rawToken}`;
      const html = await renderWorkspaceInvited({ workspaceName: wsName, inviteUrl });
      await this.outboxRepo.enqueue(
        {
          event: 'workspace.invited',
          to: normalizedEmail,
          subject: '[서포트비] 워크스페이스 초대장',
          html,
          dedupeKey: `ws-invite-resend:${actor.workspaceId}:${normalizedEmail}:${tokenHash}`,
        },
        tx,
      );

      pendingEmit = await dispatchWorkspaceInviteInApp(tx, {
        invitedEmail: normalizedEmail,
        workspaceName: wsName,
        linkUrl: `/invite/workspace/${rawToken}`,
      });

      await this.auditRepo.insert(
        {
          actorUserId: actor.userId,
          actorWorkspaceId: actor.workspaceId,
          action: 'workspace.member_invite_resend',
          entityType: 'workspace',
          entityId: actor.workspaceId,
          metadata: { email: normalizedEmail, actorWasMaster: access.viaMaster },
        },
        tx,
      );

      return { ok: true };
    });

    if (result.ok) {
      if (pendingEmit) emitAfterCommit([pendingEmit]);
      flushAfterCommit();
    }
    return result;
  }

  async cancelInvite(
    input: { email: string },
    actor: WorkspaceActor,
  ): Promise<ServiceResult> {
    const access = await this.workspaceManagementAccess(actor);
    if (!access.allowed) {
      return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
    }

    const normalizedEmail = normalizeEmail(input.email);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this._db.transaction(async (tx: any): Promise<ServiceResult> => {
      const updated = await this.workspaceRepo.expirePendingInvitation(
        {
          workspaceId: actor.workspaceId,
          email: normalizedEmail,
        },
        tx,
      );

      if (!updated) return { ok: false, error: 'INVITE_NOT_FOUND' };

      await this.auditRepo.insert(
        {
          actorUserId: actor.userId,
          actorWorkspaceId: actor.workspaceId,
          action: 'workspace.member_invite_cancel',
          entityType: 'workspace',
          entityId: actor.workspaceId,
          metadata: { email: normalizedEmail, actorWasMaster: access.viaMaster },
        },
        tx,
      );

      return { ok: true };
    });
  }

  async acceptInvite(
    rawToken: string,
    actor: AcceptInviteActor,
  ): Promise<ServiceResult<{ workspaceId: string }>> {
    const { hashToken: hashFn } = await import('@/lib/server/token');
    const tokenHash = hashFn(rawToken);

    const invitation = await this.workspaceRepo.findInvitationClaimByTokenHash(tokenHash);

    if (!invitation) return { ok: false, error: 'INVITE_INVALID' };

    if (invitation.status !== 'pending' || invitation.expiresAt < new Date()) {
      return { ok: false, error: 'INVITE_EXPIRED' };
    }

    if (normalizeEmail(invitation.invitedEmail) !== normalizeEmail(actor.userEmail)) {
      return { ok: false, error: 'INVITE_EMAIL_MISMATCH' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this._db.transaction(async (tx: any) => {
      const r = await claimInviteInTx(tx, invitation, actor.userId);
      if (r.ok) {
        // 감사 로그 (C5) — 수락과 같은 트랜잭션에서 커밋.
        await this.auditRepo.insert(
          {
            actorUserId: actor.userId,
            actorWorkspaceId: invitation.workspaceId,
            action: 'workspace.invite_accept',
            entityType: 'workspace',
            entityId: invitation.workspaceId,
          },
          tx,
        );
      }
      return r;
    });
  }

  async changeMemberRole(
    input: { targetUserId: string; role: 'admin' | 'member' },
    actor: WorkspaceActor,
  ): Promise<ServiceResult> {
    const access = await this.workspaceManagementAccess(actor);
    if (!access.allowed) {
      return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
    }

    // 대상 조회 · 마지막 admin 판정 · 역할 쓰기를 한 트랜잭션에 묶는다. 판정을 밖에서
    // 하면 동시에 들어온 강등 둘이 서로를 못 보고 모두 통과해 승인 admin 이 0명인
    // 워크스페이스가 만들어질 수 있다(모든 관리 표면이 영구 FORBIDDEN).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failure = await this._db.transaction(async (tx: any) => {
      const target = await this.workspaceRepo.getMembership(
        input.targetUserId,
        actor.workspaceId,
        tx,
      );
      if (!target) return 'MEMBER_NOT_FOUND' as const;

      // 승인된 admin 만 집계하므로 미승인 admin 강등은 마지막 admin 을 없애지 못한다
      // — 대상이 실효 admin 일 때만 가드를 건다. 카운트는 admin 행을 FOR UPDATE 로
      // 잠가, 뒤따르는 동시 강등이 이 트랜잭션의 커밋 결과를 반영해 재평가하도록 한다.
      if (input.role === 'member' && isApprovedAdmin(target)) {
        const adminCount = await this.workspaceRepo.countApprovedAdminsForUpdate(
          actor.workspaceId,
          tx,
        );
        if (adminCount <= 1) return 'LAST_ADMIN' as const;
      }

      await this.workspaceRepo.updateMemberRole(
        { workspaceId: actor.workspaceId, userId: input.targetUserId, role: input.role },
        tx,
      );
      // 감사 로그 (C5) — 역할 변경과 같은 트랜잭션에서 커밋.
      await this.auditRepo.insert(
        {
          actorUserId: actor.userId,
          actorWorkspaceId: actor.workspaceId,
          action: 'workspace.member_role_change',
          entityType: 'workspace',
          entityId: actor.workspaceId,
          metadata: {
            targetUserId: input.targetUserId,
            role: input.role,
            actorWasMaster: access.viaMaster,
          },
        },
        tx,
      );
      return null;
    });

    if (failure) return { ok: false, error: failure };

    return { ok: true };
  }

  async removeMember(
    input: { targetUserId: string },
    actor: WorkspaceActor,
  ): Promise<ServiceResult> {
    const access = await this.workspaceManagementAccess(actor);
    if (!access.allowed) {
      return { ok: false, error: 'FORBIDDEN_NOT_ADMIN' };
    }

    if (input.targetUserId === actor.userId) {
      return { ok: false, error: 'SELF_REMOVAL' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failure = await this._db.transaction(async (tx: any) => {
      const target = await this.workspaceRepo.getMembership(
        input.targetUserId,
        actor.workspaceId,
        tx,
      );
      if (!target) return 'MEMBER_NOT_FOUND' as const;

      // 운영계정은 워크스페이스 멤버가 아니므로 기존 SELF_REMOVAL 불변식만으로는
      // 마지막 관리자를 보호할 수 없다. 역할 변경과 같은 행 잠금 카운트를 사용해
      // 동시 추방/강등에서도 승인된 관리자가 0명이 되는 것을 막는다.
      if (isApprovedAdmin(target)) {
        const adminCount = await this.workspaceRepo.countApprovedAdminsForUpdate(
          actor.workspaceId,
          tx,
        );
        if (adminCount <= 1) return 'LAST_ADMIN' as const;
      }

      await this.workspaceRepo.removeMember(
        { workspaceId: actor.workspaceId, userId: input.targetUserId },
        tx,
      );
      // 제거된 멤버의 JWT를 즉시 무효화 — 다음 요청에서 isSessionRevoked가 401 반환.
      await this.userRepo.bumpSessionVersion(input.targetUserId, tx);
      // 감사 로그 (C5) — 제거와 같은 트랜잭션에서 커밋.
      await this.auditRepo.insert(
        {
          actorUserId: actor.userId,
          actorWorkspaceId: actor.workspaceId,
          action: 'workspace.member_remove',
          entityType: 'workspace',
          entityId: actor.workspaceId,
          metadata: { targetUserId: input.targetUserId, actorWasMaster: access.viaMaster },
        },
        tx,
      );
      return null;
    });

    if (failure) return { ok: false, error: failure };

    // 라이브 WS 연결 즉시 차단 — password reset 패턴 동일.
    void disconnectCentrifugoUser(input.targetUserId);

    return { ok: true };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export const {
  get: getWorkspaceService,
  set: __setWorkspaceServiceForTest,
  reset: __resetWorkspaceServiceForTest,
} = defineAsyncSingleton('workspace_service', 'service', async () => {
  const { getDb, getOutboxRepo, getAuditLogRepo, getWorkspaceRepo, getUserRepo, getBizProfileRepo } =
    await import('@/lib/server/repositories/factory');
  const [db, outboxRepo, auditRepo, workspaceRepo, userRepo, bizProfileRepo] = await Promise.all([
    getDb(),
    getOutboxRepo(),
    getAuditLogRepo(),
    getWorkspaceRepo(),
    getUserRepo(),
    getBizProfileRepo(),
  ]);
  return new WorkspaceService(db, outboxRepo, auditRepo, workspaceRepo, userRepo, bizProfileRepo);
});
