// inboxLoader — integration tests covering:
// 1. RFP metadata enrichment in listConversationsForViewer
// 2. listInboxForViewer (counterparty + team merge + sort)
// 3. markTeamThreadReadAction
// Harness mirrors sendTeamMessage.test.ts: sessionRef + setupRfpActionEnv.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  seedBuyerWorkspace,
  seedMembership,
  seedPgWorkspace,
  seedRfp,
  seedUser,
} from '@/lib/server/repositories/drizzle/__tests__/_seed';
import { setupRfpActionEnv, teardownRfpActionEnv } from '../../rfp/__tests__/_setup';
import type { PgliteDB } from '@/lib/db/client-pglite';

type SessionUser = {
  id: string;
  email: string;
  workspaceId: string;
  workspaceType: 'buyer' | 'pg';
};
const sessionRef: { value: { user: SessionUser } | null } = { value: null };

vi.mock('@/lib/auth/session', () => ({
  requireSession: () =>
    sessionRef.value
      ? Promise.resolve(sessionRef.value)
      : Promise.reject(new Error('UNAUTHENTICATED')),
}));

vi.mock('@/lib/server/realtime/centrifugo', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../realtime/centrifugo')>();
  return {
    ...actual,
    publishChatEvent: vi.fn().mockResolvedValue(undefined),
    publishTeamChatEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import { sendTeamMessageAction } from '../sendTeamMessageAction';
import { sendChatMessageAction } from '../sendChatMessageAction';
import { listConversationsForViewer } from '../conversationLoaders';
import { listInboxForViewer } from '../inboxLoader';
import { markTeamThreadReadAction } from '../markTeamThreadReadAction';

let db: PgliteDB;

beforeEach(async () => {
  db = await setupRfpActionEnv();
});
afterEach(() => {
  teardownRfpActionEnv();
  sessionRef.value = null;
  vi.clearAllMocks();
});

describe('listConversationsForViewer — RFP enrichment', () => {
  it('counterparty 항목에 마지막 메시지의 RFP code/title/status/deadline을 포함한다', async () => {
    const buyerUser = await seedUser(db, { email: 'buyer2@b.com', name: '구매' });
    const buyerWs = await seedBuyerWorkspace(db);
    await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
    const pgWs = await seedPgWorkspace(db, 'PG사');
    const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });

    sessionRef.value = {
      user: { id: buyerUser.id, email: buyerUser.email, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    };

    await sendChatMessageAction({ counterpartyWorkspaceId: pgWs.id, body: '안녕', rfpId: rfp.id });

    const items = await listConversationsForViewer();
    const counterpartyItem = items.find((i) => i.counterparty.type === 'pg');
    expect(counterpartyItem).toBeDefined();
    expect(counterpartyItem!.rfpCode).toBeTruthy();
    expect(counterpartyItem!.rfpTitle).toBeTruthy();
    expect(counterpartyItem!.rfpStatus).toBeTruthy();
    expect(counterpartyItem!.rfpDeadline).toBeTruthy();
  });

  it('마지막 메시지에 rfpId가 없으면 rfpCode 등이 null이다', async () => {
    const buyerUser = await seedUser(db, { email: 'buyer3@b.com', name: '구매2' });
    const buyerWs = await seedBuyerWorkspace(db);
    await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
    const pgWs = await seedPgWorkspace(db, 'PG사2');

    sessionRef.value = {
      user: { id: buyerUser.id, email: buyerUser.email, workspaceId: buyerWs.id, workspaceType: 'buyer' },
    };

    await sendChatMessageAction({ counterpartyWorkspaceId: pgWs.id, body: '안녕', rfpId: undefined });

    const items = await listConversationsForViewer();
    const counterpartyItem = items.find((i) => i.counterparty.type === 'pg');
    expect(counterpartyItem).toBeDefined();
    expect(counterpartyItem!.rfpCode).toBeNull();
    expect(counterpartyItem!.rfpTitle).toBeNull();
  });
});

describe('inboxLoader', () => {
  describe('listInboxForViewer', () => {
    it('merges team thread + counterparty conversation, sorted by lastMessageAt desc', async () => {
      // Seed: buyer workspace + member, pg workspace, rfp
      const buyerUser = await seedUser(db, { email: 'buyer@b.com', name: '김구매' });
      const buyerWs = await seedBuyerWorkspace(db);
      await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
      const pgWs = await seedPgWorkspace(db, 'PG사');
      const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });

      // Session = buyer
      sessionRef.value = {
        user: { id: buyerUser.id, email: buyerUser.email, workspaceId: buyerWs.id, workspaceType: 'buyer' },
      };

      // Send team message FIRST (earlier lastMessageAt)
      const teamResult = await sendTeamMessageAction({ rfpId: rfp.id, body: '팀 메모' });
      expect(teamResult.ok).toBe(true);

      // Send counterparty message SECOND (later lastMessageAt)
      const sent = await sendChatMessageAction({
        counterpartyWorkspaceId: pgWs.id,
        body: '상대방',
        rfpId: rfp.id,
        attachmentIds: [],
      });
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      const items = await listInboxForViewer();

      expect(items).toHaveLength(2);
      expect(items[0].kind).toBe('counterparty');
      expect(items[0].key).toBe(`c:${sent.conversationId}`);
      expect(items[1].kind).toBe('team');
      expect(items[1].key).toBe(`t:${rfp.id}`);
    });
  });

  describe('markTeamThreadReadAction', () => {
    it('marks the thread read so listInboxForViewer shows unread=false', async () => {
      const buyerUser = await seedUser(db, { email: 'buyer2@b.com', name: '이구매' });
      const buyerWs = await seedBuyerWorkspace(db);
      await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');

      // Teammate posts a message as a different user in the same workspace
      const teamMate = await seedUser(db, { email: 'mate@b.com', name: '팀원' });
      await seedMembership(db, buyerWs.id, teamMate.id, 'member');
      const rfp = await seedRfp(db, { buyerWsId: buyerWs.id, createdBy: buyerUser.id });

      // Teammate sends team message
      sessionRef.value = {
        user: { id: teamMate.id, email: teamMate.email, workspaceId: buyerWs.id, workspaceType: 'buyer' },
      };
      const r = await sendTeamMessageAction({ rfpId: rfp.id, body: '동료 메시지' });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected team message to be sent');

      // Now switch to buyer user — the thread is unread (teammate sent it)
      sessionRef.value = {
        user: { id: buyerUser.id, email: buyerUser.email, workspaceId: buyerWs.id, workspaceType: 'buyer' },
      };

      // Mark read
      const markResult = await markTeamThreadReadAction({
        rfpId: rfp.id,
        throughMessageId: r.messageId,
      });
      expect(markResult).toMatchObject({ ok: true });

      // After mark, listInboxForViewer's team item should have unread=false
      const items = await listInboxForViewer();
      const teamItem = items.find((i) => i.kind === 'team' && i.rfpId === rfp.id);
      expect(teamItem).toBeDefined();
      expect(teamItem?.unread).toBe(false);
    });

    it('returns INVALID_INPUT for a non-uuid rfpId', async () => {
      const buyerUser = await seedUser(db, { email: 'buyer3@b.com' });
      const buyerWs = await seedBuyerWorkspace(db);
      await seedMembership(db, buyerWs.id, buyerUser.id, 'admin');
      sessionRef.value = {
        user: { id: buyerUser.id, email: buyerUser.email, workspaceId: buyerWs.id, workspaceType: 'buyer' },
      };

      const r = await markTeamThreadReadAction({
        rfpId: 'not-a-uuid',
        throughMessageId: crypto.randomUUID(),
      });
      expect(r).toEqual({ ok: false, error: 'INVALID_INPUT' });
    });

    it('returns UNAUTHENTICATED without a session', async () => {
      const { randomUUID } = await import('node:crypto');
      sessionRef.value = null;
      const r = await markTeamThreadReadAction({
        rfpId: randomUUID(),
        throughMessageId: randomUUID(),
      });
      expect(r).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    });
  });
});
