import { defineAsyncSingleton } from '@/lib/server/_singleton';
import { randomUUID } from 'node:crypto';

import type {
  AttachmentRepo,
  ChatConversationRepo,
  ChatMessageRepo,
  InvitationRepo,
  RfpRepo,
  UserRepo,
  WorkspaceRepo,
} from '@/lib/server/repositories/types';
import { conversationThreadLink } from '@/lib/chat/thread-link';
import { canWorkspaceAccessRfp } from '@/lib/server/rfp-access';
import { emitAfterCommit } from '@/lib/server/notifications/dispatch';
import { notify, type NotifyChannel } from '@/lib/server/notifications/notify';
import { flushAfterCommit } from '@/lib/server/outbox/post-commit';
import {
  chatDigestDedupeKey,
  chatDigestWindowEnd,
} from '@/lib/server/outbox/chat-digest-key';
import { renderChatMessage } from '@/lib/server/outbox/templates/chatMessage';
import { presentUserIdsInConversation } from '@/lib/server/realtime/centrifugo';
import type { Notification } from '@/lib/types/notification';
import type { WorkspaceType } from '@/lib/types/workspace';
import type { ServiceResult } from './types';
import { assertAttachmentClaimed, AttachmentClaimMismatchError } from './_attachment-claim';

export type ChatActor = {
  userId: string;
  workspaceId: string;
  workspaceType: WorkspaceType;
};

export type SendMessageInput = {
  conversationId?: string;
  counterpartyWorkspaceId?: string;
  counterpartyEmail?: string;
  body?: string;
  rfpId?: string;
  attachmentIds: string[];
};

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

export class ChatService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _db: any,
    private readonly convRepo: ChatConversationRepo,
    private readonly wsRepo: WorkspaceRepo,
    private readonly userRepo: UserRepo,
    private readonly attRepo: AttachmentRepo,
    private readonly msgRepo: ChatMessageRepo,
    private readonly rfpRepo: RfpRepo,
    private readonly invRepo: InvitationRepo,
  ) {}

  async sendMessage(
    input: SendMessageInput,
    actor: ChatActor,
  ): Promise<
    ServiceResult<{
      conversationId: string;
      messageId: string;
      createdAt: string;
      authorName: string;
      authorEmail: string;
      rfpId: string | null;
    }>
  > {
    const body = (input.body ?? '').trim();
    if (body.length === 0 && input.attachmentIds.length === 0) {
      return { ok: false, error: 'INVALID_INPUT' };
    }

    // ── Resolve the conversation ────────────────────────────────────────
    let buyerWsId: string;
    let pgWsId: string;
    let conversationId: string | undefined;

    if (input.conversationId) {
      const conv = await this.convRepo.findById(input.conversationId);
      if (!conv) return { ok: false, error: 'CONVERSATION_NOT_FOUND' };
      const myWsId = actor.workspaceType === 'buyer' ? conv.buyerWsId : conv.pgWsId;
      if (myWsId !== actor.workspaceId) return { ok: false, error: 'FORBIDDEN' };
      buyerWsId = conv.buyerWsId;
      pgWsId = conv.pgWsId;
      conversationId = conv.id;
    } else {
      let counterpartyWsId = input.counterpartyWorkspaceId;
      if (!counterpartyWsId && input.counterpartyEmail) {
        const user = await this.userRepo.findByEmail(input.counterpartyEmail);
        if (!user) return { ok: false, error: 'COUNTERPARTY_NOT_FOUND' };
        const memberships = await this.wsRepo.listForUser(user.id);
        const wantType = actor.workspaceType === 'buyer' ? 'pg' : 'buyer';
        const target = memberships.find((m) => m.type === wantType);
        if (!target) return { ok: false, error: 'COUNTERPARTY_NOT_FOUND' };
        counterpartyWsId = target.id;
      }
      if (!counterpartyWsId) return { ok: false, error: 'INVALID_INPUT' };

      const counterparty = await this.wsRepo.findById(counterpartyWsId);
      if (!counterparty) return { ok: false, error: 'COUNTERPARTY_NOT_FOUND' };
      if (counterparty.type === actor.workspaceType) {
        return { ok: false, error: 'INVALID_COUNTERPARTY' };
      }
      if (actor.workspaceType === 'buyer') {
        buyerWsId = actor.workspaceId;
        pgWsId = counterpartyWsId;
      } else {
        buyerWsId = counterpartyWsId;
        pgWsId = actor.workspaceId;
      }
    }

    const counterpartyWsId = actor.workspaceType === 'buyer' ? pgWsId : buyerWsId;

    // Validate attachments are unlinked drafts uploaded by the sender.
    if (input.attachmentIds.length > 0) {
      for (const id of input.attachmentIds) {
        const att = await this.attRepo.findById(id);
        if (!att || att.rfpId || att.bidId || att.bidNoteId || att.chatMessageId) {
          return { ok: false, error: 'INVALID_ATTACHMENT' };
        }
        // 본인이 올린 미링크 첨부만 허용 — team-chat·bid-note 와 동일 기준.
        // (isMember 기준은 마스터/운영 임퍼소네이션 계정을 false 처리하는 버그였다:
        //  마스터는 workspace_members 행이 없어 자기가 올린 첨부도 거부됐다.)
        if (att.uploadedBy !== actor.userId) {
          return { ok: false, error: 'INVALID_ATTACHMENT' };
        }
      }
    }

    // RFP 태그 접근 검증 — 교차 테넌트 uuid 오염 방지. 검증 실패 시 태그만 드롭
    // (메시지는 정상 전송). tx 밖에서 실행해 불필요한 DB 락을 피한다.
    let effectiveRfpId: string | null = input.rfpId ?? null;
    if (effectiveRfpId) {
      const access = await canWorkspaceAccessRfp(this.rfpRepo, this.invRepo, effectiveRfpId, actor.workspaceId);
      if (!access.allowed) effectiveRfpId = null;
    }

    const now = new Date();
    const messageId = randomUUID();
    // 표시 전용 — 보낸 사람 이름/이메일(라이브 수신자가 메시지에 라벨을 붙인다).
    const me = await this.userRepo.findById(actor.userId);
    const pendingEmits: Notification[] = [];

    // ── 프레즌스는 트랜잭션 밖에서 미리 구한다 ─────────────────────────────
    // 이건 Centrifugo HTTP 왕복이고, 예전에는 수신자마다 트랜잭션 **안에서**
    // 불렀다. 실시간 서버가 느리거나 죽으면 그 지연이 그대로 트랜잭션 수명이
    // 되고(커넥션 풀 max:10) 메시지 전송마다 그 비용을 낸다. 용도는 '이메일도
    // 보낼까?' 판정 하나뿐이라 트랜잭션 일관성이 필요 없다.
    const recipients = await this.wsRepo.approvedMemberRecipients(counterpartyWsId);
    // 대화가 아직 없으면(첫 메시지) 아무도 그 채널을 구독하고 있을 수 없다 —
    // 물어볼 필요조차 없으므로 HTTP 를 아예 내지 않는다.
    const existingConvId =
      conversationId ?? (await this.convRepo.findPair(buyerWsId, pgWsId))?.id ?? null;
    // 채널 단위로 **한 번만** 묻는다 — presence 응답 자체가 채널 전체라서
    // 수신자마다 부르면 같은 페이로드를 N번 받아 1비트씩만 쓰고 버리게 된다.
    const presentUserIds = existingConvId
      ? await presentUserIdsInConversation(existingConvId)
      : new Set<string>();

    let result: ServiceResult<{
      conversationId: string;
      messageId: string;
      createdAt: string;
      authorName: string;
      authorEmail: string;
      rfpId: string | null;
    }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await this._db.transaction(async (tx: any) => {
      const conv = conversationId
        ? { id: conversationId }
        : await this.convRepo.findOrCreatePair(buyerWsId, pgWsId, tx);

      await this.msgRepo.save(
        {
          id: messageId,
          conversationId: conv.id,
          authorUserId: actor.userId,
          authorWsId: actor.workspaceId,
          body,
          rfpId: effectiveRfpId,
          createdAt: now,
        },
        tx,
      );

      if (input.attachmentIds.length > 0) {
        const claimedIds = await this.attRepo.claim(
          { ids: input.attachmentIds, owner: { chatMessageId: messageId } },
          tx,
        );
        assertAttachmentClaimed(claimedIds, input.attachmentIds);
      }

      await this.convRepo.touchLastMessageAt(conv.id, now, tx);

      const senderName = (await this.wsRepo.getName(actor.workspaceId, tx)) ?? '상대';

      const preview = body.length > 0 ? body.slice(0, 120) : '첨부 파일을 보냈어요.';
      const conversationUrl = `${BASE_URL}/messages`;
      const html = await renderChatMessage({ senderName, preview, conversationUrl });

      const digestScheduledAt = chatDigestWindowEnd(now);
      // 알림 행에는 대화 컬럼이 없다 — 이 링크가 곧 대화 키다(dedupe·읽음 정리·
      // 토스트 억제가 전부 이걸 본다). 단일 출처는 lib/chat/thread-link.ts.
      const threadLinkUrl = conversationThreadLink(conv.id);

      for (const m of recipients) {
        if (m.userId === actor.userId) continue;

        // 인앱 행은 메시지별 경계를 보존한다. 이메일만 dedupeKey로 묶는다.
        const channels: NotifyChannel[] = ['inapp'];
        // 트랜잭션 밖에서 미리 구해 둔 판정 — 여기서 외부 IO 를 하지 않는다.
        if (!presentUserIds.has(m.userId)) channels.push('email');

        pendingEmits.push(
          ...(await notify(tx, {
            recipients: [{ userId: m.userId, workspaceId: counterpartyWsId, email: m.email }],
            channels,
            type: 'chat.message',
            title: `${senderName}님의 새 메시지`,
            body: preview,
            createdAt: now,
            linkUrl: threadLinkUrl,
            email: {
              event: 'chat.message',
              subject: `[서포트비] ${senderName}님의 새 메시지`,
              html,
              dedupeKey: () =>
                chatDigestDedupeKey(conv.id, counterpartyWsId, m.userId, now),
              scheduledAt: digestScheduledAt,
            },
          })),
        );
      }

        return {
        ok: true as const,
        conversationId: conv.id,
        messageId,
        // 서버 권위 타임스탬프 — 클라이언트가 낙관적 말풍선을 확정으로 승격할 때
        // 자기 시계 대신 이 값을 채택한다(리로드 후 로더 렌더와 일치).
        createdAt: now.toISOString(),
        authorName: me?.name ?? '',
        authorEmail: me?.email ?? '',
        rfpId: effectiveRfpId,
        };
      });
    } catch (error) {
      if (error instanceof AttachmentClaimMismatchError) {
        return { ok: false, error: 'INVALID_ATTACHMENT' };
      }
      throw error;
    }

    if (result.ok) {
      emitAfterCommit(pendingEmits);
      flushAfterCommit();
    }
    return result;
  }

  /**
   * 상대 워크스페이스와의 대화를 보장한다(없으면 생성). 메시지는 보내지 않는다 —
   * 결과 화면의 "메시지 시작" CTA가 빈 대화로 딥링크하기 위한 경로. buyer↔PG
   * 타입 불변식은 sendMessage와 동일하게 여기서 검증한다.
   */
  async getOrCreateConversation(
    counterpartyWorkspaceId: string,
    actor: ChatActor,
  ): Promise<ServiceResult<{ conversationId: string }>> {
    const counterparty = await this.wsRepo.findById(counterpartyWorkspaceId);
    if (!counterparty) return { ok: false, error: 'COUNTERPARTY_NOT_FOUND' };
    if (counterparty.type === actor.workspaceType) {
      return { ok: false, error: 'INVALID_COUNTERPARTY' };
    }
    const buyerWsId = actor.workspaceType === 'buyer' ? actor.workspaceId : counterpartyWorkspaceId;
    const pgWsId = actor.workspaceType === 'buyer' ? counterpartyWorkspaceId : actor.workspaceId;
    const conv = await this.convRepo.findOrCreatePair(buyerWsId, pgWsId);
    return { ok: true, conversationId: conv.id };
  }

  /**
   * 읽기 전용 페어 해소 — 없으면 conversationId null, **행을 생성하지 않는다**.
   * 채팅 레일 표시용: 열람·포커스 추종만으로 빈 대화를 만들면 상대 인박스에
   * "보고 있다"는 관심 신호가 새므로(sealed-bid), 생성은 첫 전송에만 맡긴다.
   */
  async findConversation(
    counterpartyWorkspaceId: string,
    actor: ChatActor,
  ): Promise<ServiceResult<{ conversationId: string | null }>> {
    const counterparty = await this.wsRepo.findById(counterpartyWorkspaceId);
    if (!counterparty) return { ok: false, error: 'COUNTERPARTY_NOT_FOUND' };
    if (counterparty.type === actor.workspaceType) {
      return { ok: false, error: 'INVALID_COUNTERPARTY' };
    }
    const buyerWsId = actor.workspaceType === 'buyer' ? actor.workspaceId : counterpartyWorkspaceId;
    const pgWsId = actor.workspaceType === 'buyer' ? counterpartyWorkspaceId : actor.workspaceId;
    const conv = await this.convRepo.findPair(buyerWsId, pgWsId);
    return { ok: true, conversationId: conv?.id ?? null };
  }

}

// ─── Factory ─────────────────────────────────────────────────────────────────

export const {
  get: getChatService,
  set: __setChatServiceForTest,
  reset: __resetChatServiceForTest,
} = defineAsyncSingleton('chat_service', 'service', async () => {
  const {
    getDb,
    getChatConversationRepo,
    getWorkspaceRepo,
    getUserRepo,
    getAttachmentRepo,
    getChatMessageRepo,
    getRfpRepo,
    getInvitationRepo,
  } = await import('@/lib/server/repositories/factory');
  const [db, convRepo, wsRepo, userRepo, attRepo, msgRepo, rfpRepo, invRepo] =
    await Promise.all([
      getDb(),
      getChatConversationRepo(),
      getWorkspaceRepo(),
      getUserRepo(),
      getAttachmentRepo(),
      getChatMessageRepo(),
      getRfpRepo(),
      getInvitationRepo(),
    ]);
  return new ChatService(
    db,
    convRepo,
    wsRepo,
    userRepo,
    attRepo,
    msgRepo,
    rfpRepo,
    invRepo,
  );
});
