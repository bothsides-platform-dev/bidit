import { defineAsyncSingleton } from '@/lib/server/_singleton';
import { randomUUID } from 'node:crypto';

import type { Attachment } from '@/lib/types/common';
import type {
  AttachmentRepo,
  InvitationRepo,
  NotificationRepo,
  RfpRepo,
  RfpTeamMessageReadRepo,
  RfpTeamMessageRepo,
  RfpTeamMessageWithAuthor,
  TeamMember,
  UserRepo,
  WorkspaceRepo,
} from '@/lib/server/repositories/types';
import { emitAfterCommit } from '@/lib/server/notifications/dispatch';
import { notify } from '@/lib/server/notifications/notify';
import { flushAfterCommit } from '@/lib/server/outbox/post-commit';
import { teamDigestDedupeKey, teamDigestWindowEnd } from '@/lib/server/outbox/team-digest';
import { teamThreadLink } from '@/lib/chat/thread-link';
import { canWorkspaceAccessRfp } from '@/lib/server/rfp-access';
import { extractMentions, mentionsToPlainText } from '@/lib/utils/team-mentions';
import type { Notification } from '@/lib/types/notification';
import type { WorkspaceType } from '@/lib/types/workspace';
import type { ServiceResult } from './types';
import { CHAT_DIGEST_WINDOW_MS, chatDigestBucket } from './_chat-constants';
import { assertAttachmentClaimed, AttachmentClaimMismatchError } from './_attachment-claim';

export type TeamChatActor = {
  userId: string;
  workspaceId: string;
  workspaceType: WorkspaceType;
};

export type TeamThreadEntry = {
  rfpId: string;
  rfpCode: string;
  rfpTitle: string;
  preview: string;
  lastMessageAt: string;
  unread: boolean;
};

// RFP-scoped internal team thread. Read-state (rfp_team_message_reads), per-RFP
// unread, and notifications (in-app + a coalesced email digest, mirroring the
// ChatService digest pattern) are supported. @-mentions: bodies store structured
// tokens (<@uuid> / <@all>, see lib/team-mentions.ts); sendMessage re-derives
// mentions from the body, validates membership, and routes a team_chat.mention
// notification to mentioned members (others get team_chat.message). Surfaced in
// the unified inbox (/messages) via listThreads + the ?t=<rfpId> deep-link.
// Supports PDF/image attachments (absorbed the per-bid memo). Separate from
// ChatService (which owns buyer↔PG pair resolution + counterparty fanout). ACL
// mirrors the page loaders: buyer must own the RFP, PG must hold an invitation
// (invRepo.canAccess — same gate as loadPgRfpDetail). sendMessage re-parents
// draft attachments in one transaction (BidService.addNote pattern); list/insert
// stay append-only.
export class TeamChatService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _db: any,
    private readonly rfpRepo: RfpRepo,
    private readonly invRepo: InvitationRepo,
    private readonly userRepo: UserRepo,
    private readonly msgRepo: RfpTeamMessageRepo,
    private readonly readRepo: RfpTeamMessageReadRepo,
    private readonly wsRepo: WorkspaceRepo,
    private readonly notifRepo: NotificationRepo,
    private readonly attRepo: AttachmentRepo,
  ) {}

  private async authorize(
    rfpId: string,
    actor: TeamChatActor,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const access = await canWorkspaceAccessRfp(this.rfpRepo, this.invRepo, rfpId, actor.workspaceId);
    if (access.allowed) return { ok: true };
    return { ok: false, error: access.reason };
  }

  async sendMessage(
    input: { rfpId: string; body: string; attachmentIds?: string[] },
    actor: TeamChatActor,
  ): Promise<
    ServiceResult<{
      messageId: string;
      createdAt: string;
      authorName: string;
      attachments: Attachment[];
    }>
  > {
    // 길이 상한은 액션 zod 와 동일하게 서비스도 소유(defense-in-depth) — 미래의
    // 다른 호출자(잡 등)가 무제한 본문을 영속·팬아웃하지 못하게 한다.
    const body = input.body.trim();
    const attachmentIds = input.attachmentIds ?? [];
    // 첨부만 있는 메시지는 허용 — 본문·첨부가 모두 비면 거부.
    if (body.length === 0 && attachmentIds.length === 0) {
      return { ok: false, error: 'INVALID_INPUT' };
    }
    if (body.length > 4000) {
      return { ok: false, error: 'INVALID_INPUT' };
    }

    const auth = await this.authorize(input.rfpId, actor);
    if (!auth.ok) return auth;

    const id = randomUUID();
    const createdAt = new Date();
    // 표시 전용 — 알림 제목과 성공 반환에 쓸 작성자 이름. tx 밖에서 1회 조회.
    const author = await this.userRepo.findById(actor.userId);
    const authorName = author?.name ?? '';

    // 메시지 insert + 첨부 재부모(re-parent)를 한 트랜잭션으로 — BidService.addNote
    // 패턴. 첨부는 업로드 시 ownerless draft 로 착지하므로 여기서 본인 소유·미링크
    // 인지 검증한 뒤 rfp_team_message_id 로 옮긴다.
    let linked: Attachment[] = [];
    const pendingEmits: Notification[] = [];
    let txResult: 'ok' | 'INVALID_ATTACHMENT';
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      txResult = await this._db.transaction(async (tx: any) => {
      if (attachmentIds.length > 0) {
        // 미링크·본인 소유 검증 — findUnclaimedByIds 는 모든 owner 컬럼 IS NULL 인
        // 행만 distinct 로 반환하므로, 이미 링크됐거나 중복 id 면 length 가 어긋난다
        // (원래 inArray select 와 동일한 dedupe·length 가드).
        const unclaimed = await this.attRepo.findUnclaimedByIds(attachmentIds, tx);
        if (unclaimed.length !== attachmentIds.length) return 'INVALID_ATTACHMENT' as const;
        for (const r of unclaimed) {
          if (r.uploadedBy !== actor.userId) return 'INVALID_ATTACHMENT' as const;
        }
        // 표시용 메타(name/size/mimeType)는 record 로 다시 조회 — 사용자가 추가한
        // attachmentIds 순서를 유지한다.
        const records = await Promise.all(attachmentIds.map((aid) => this.attRepo.findById(aid, tx)));
        linked = records.map((r) => ({
          id: r!.id,
          name: r!.name,
          size: r!.size,
          mimeType: r!.mimeType,
          url: `/api/files/${r!.id}`,
        }));
      }

      await this.msgRepo.save(
        {
          id,
          rfpId: input.rfpId,
          workspaceId: actor.workspaceId,
          authorUserId: actor.userId,
          body,
          createdAt,
        },
        tx,
      );

      // 팀 알림 팬아웃 — 같은 워크스페이스의 다른 멤버(작성자 제외)에게 인앱 알림.
      // 멘션된 멤버는 team_chat.mention(멘션 전용 dedupe), 그 외는 기존
      // team_chat.message(일반 dedupe). 이메일 digest 는 윈도당 멤버 1회 enqueue.
      const now = createdAt;
      const windowStart = new Date(chatDigestBucket(now) * CHAT_DIGEST_WINDOW_MS);
      // roster(표시용) 는 화면에 노출되는 멤버만 — 이름 멘션 검증·미리보기에 쓴다.
      const roster = await this.wsRepo.teamRoster(actor.workspaceId, tx);
      const nameById = new Map(roster.map((r) => [r.userId, r.name]));
      const rosterIdSet = new Set(roster.map((r) => r.userId));
      // 팬아웃 수신자는 화면엔 숨겨지지만 실제 알림을 읽는 master/ops 계정까지 포함해야
      // 하므로 표시용 roster 가 아닌 승인된(approved) 알림 수신자 목록을 쓴다.
      // 승인 대기(pending_approval) 멤버는 앱에 접근할 수 없어 알림 대상에서도 제외한다.
      const recipients = await this.wsRepo.approvedMemberRecipients(actor.workspaceId, tx);
      const recipientIds = recipients.map((r) => r.userId);
      const emailByUserId = new Map(recipients.map((r) => [r.userId, r.email]));
      const { userIds: mentionedRaw, all } = extractMentions(body);
      // 서버에서 멤버십 재검증 — 이름 멘션은 화면 멤버(roster)만 허용하고 비멤버 토큰은
      // 드롭한다(크로스팀 누출/알림 방지). @전체는 숨은 master 포함 전체 수신자가 대상.
      const mentioned = new Set<string>(
        all ? recipientIds : mentionedRaw.filter((uid) => rosterIdSet.has(uid)),
      );
      // 미리보기는 토큰이 아닌 평문(@이름/@전체).
      const preview =
        body.length > 0 ? mentionsToPlainText(body, nameById).slice(0, 120) : '첨부 파일';

      for (const memberId of recipientIds) {
        if (memberId === actor.userId) continue;

        // 디스패치 전에 윈도 내 기존 팀 알림을 스냅샷(이메일 1회 enqueue 게이트용).
        const hadGeneric = await this.notifRepo.hasPendingTeamNotification(
          memberId, input.rfpId, windowStart, tx,
        );
        const hadMention = await this.notifRepo.hasPendingTeamMentionNotification(
          memberId, input.rfpId, windowStart, tx,
        );

        if (mentioned.has(memberId)) {
          if (!hadMention) {
            pendingEmits.push(
              ...(await notify(tx, {
                recipients: [{ userId: memberId, workspaceId: actor.workspaceId, email: '' }],
                channels: ['inapp'],
                type: 'team_chat.mention',
                title: `${authorName}님이 회원님을 언급했어요`,
                body: preview,
                linkUrl: teamThreadLink(input.rfpId),
              })),
            );
          }
        } else {
          if (!hadGeneric) {
            pendingEmits.push(
              ...(await notify(tx, {
                recipients: [{ userId: memberId, workspaceId: actor.workspaceId, email: '' }],
                channels: ['inapp'],
                type: 'team_chat.message',
                title: `${authorName}님의 팀 메시지`,
                body: preview,
                linkUrl: teamThreadLink(input.rfpId),
              })),
            );
          }
        }

        // 이메일 digest — (rfp, workspace, recipient) 윈도당 1회. 첫 팀 알림 발생
        // 시점에만 enqueue(outbox dedupeKey UNIQUE 로 coalesce). 본문은 placeholder;
        // flushTeamChatDigests 가 발송 시 재계산·읽음 단락.
        if (!hadGeneric && !hadMention) {
          const memberEmail = emailByUserId.get(memberId);
          if (memberEmail) {
            await notify(tx, {
              recipients: [{ userId: memberId, workspaceId: actor.workspaceId, email: memberEmail }],
              channels: ['email'],
              type: 'team_chat.message',
              title: '',
              body: '',
              email: {
                event: 'team_chat.message',
                subject: '[서포트비] 새 팀 메시지',
                html: '<p>새 팀 메시지가 있어요.</p>', // placeholder — processor recomputes at send
                dedupeKey: () => teamDigestDedupeKey(input.rfpId, actor.workspaceId, memberId, now),
                scheduledAt: teamDigestWindowEnd(now),
              },
            });
          }
        }
      }

      if (attachmentIds.length > 0) {
        const claimedIds = await this.attRepo.claim(
          { ids: attachmentIds, owner: { rfpTeamMessageId: id }, uploadedBy: actor.userId },
          tx,
        );
        assertAttachmentClaimed(claimedIds, attachmentIds);
      }
        return 'ok' as const;
      });
    } catch (error) {
      if (error instanceof AttachmentClaimMismatchError) {
        return { ok: false, error: 'INVALID_ATTACHMENT' };
      }
      throw error;
    }

    if (txResult === 'INVALID_ATTACHMENT') {
      return { ok: false, error: 'INVALID_ATTACHMENT' };
    }

    // commit 이후에만 SSE emit — rollback과 정합(dispatch.ts 계약).
    emitAfterCommit(pendingEmits);
    flushAfterCommit();
    return {
      ok: true,
      messageId: id,
      createdAt: createdAt.toISOString(),
      authorName,
      attachments: linked,
    };
  }

  async listMessages(
    rfpId: string,
    actor: TeamChatActor,
  ): Promise<ServiceResult<{ messages: RfpTeamMessageWithAuthor[] }>> {
    const auth = await this.authorize(rfpId, actor);
    if (!auth.ok) return auth;
    const messages = await this.msgRepo.listByScope(rfpId, actor.workspaceId);
    return { ok: true, messages };
  }

  async listTeamMembers(
    rfpId: string,
    actor: TeamChatActor,
  ): Promise<ServiceResult<{ members: TeamMember[] }>> {
    const auth = await this.authorize(rfpId, actor);
    if (!auth.ok) return auth;
    const members = await this.wsRepo.teamRoster(actor.workspaceId);
    return { ok: true, members };
  }

  async markRead(rfpId: string, actor: TeamChatActor): Promise<ServiceResult<{ readAt: string }>> {
    const auth = await this.authorize(rfpId, actor);
    if (!auth.ok) return auth;
    const at = new Date();
    await this.readRepo.upsert(rfpId, actor.workspaceId, actor.userId, at);
    return { ok: true, readAt: at.toISOString() };
  }

  async listThreads(actor: TeamChatActor): Promise<ServiceResult<{ threads: TeamThreadEntry[] }>> {
    const [summaries, roster] = await Promise.all([
      this.msgRepo.listThreadsForWorkspace(actor.workspaceId),
      this.wsRepo.teamRoster(actor.workspaceId),
    ]);
    const nameById = new Map(roster.map((r) => [r.userId, r.name]));
    const entries = await Promise.all(
      summaries.map(async (s) => {
        const [rfp, read] = await Promise.all([
          this.rfpRepo.findById(s.rfpId),
          this.readRepo.getFor(s.rfpId, actor.workspaceId, actor.userId),
        ]);
        const lastReadAt = read?.lastReadAt ?? null;
        const unread =
          s.lastAuthorUserId !== actor.userId &&
          (lastReadAt === null || s.lastMessageAt > lastReadAt);
        return {
          rfpId: s.rfpId,
          rfpCode: rfp?.code ?? '',
          rfpTitle: rfp?.title ?? '',
          preview: s.lastBody.length > 0 ? mentionsToPlainText(s.lastBody, nameById) : '첨부 파일',
          lastMessageAt: s.lastMessageAt.toISOString(),
          unread,
        } satisfies TeamThreadEntry;
      }),
    );
    return { ok: true, threads: entries };
  }
}

export const {
  get: getTeamChatService,
  set: __setTeamChatServiceForTest,
  reset: __resetTeamChatServiceForTest,
} = defineAsyncSingleton('team_chat_service', 'service', async () => {
  const {
    getDb,
    getAttachmentRepo,
    getInvitationRepo,
    getNotificationRepo,
    getRfpRepo,
    getRfpTeamMessageRepo,
    getRfpTeamMessageReadRepo,
    getUserRepo,
    getWorkspaceRepo,
  } = await import('@/lib/server/repositories/factory');
  const [db, rfpRepo, invRepo, userRepo, msgRepo, readRepo, wsRepo, notifRepo, attRepo] = await Promise.all([
    getDb(),
    getRfpRepo(),
    getInvitationRepo(),
    getUserRepo(),
    getRfpTeamMessageRepo(),
    getRfpTeamMessageReadRepo(),
    getWorkspaceRepo(),
    getNotificationRepo(),
    getAttachmentRepo(),
  ]);
  return new TeamChatService(
    db,
    rfpRepo,
    invRepo,
    userRepo,
    msgRepo,
    readRepo,
    wsRepo,
    notifRepo,
    attRepo,
  );
});
