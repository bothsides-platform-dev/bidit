import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, ne, notIlike, sql } from 'drizzle-orm';
import { TEST_PG_NAME_TOKENS } from '@/lib/features/test-pg';
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  workspaceLogoBlobs,
  users as usersTable,
  bizProfiles,
  workspaceNameChangeRequests,
} from '@/lib/db/schema';
import type { WorkspaceNameChangeRequest } from '@/lib/types/workspace-name-change';
import type {
  MemberApprovalStatus,
  Workspace,
  WorkspaceMembershipSummary,
  WorkspaceType,
} from '@/lib/types/workspace';
import type { User } from '@/lib/types/user';
import type { WorkspaceRepo, Tx, TeamMember, WorkspaceDisplay } from '../types';

/** ilike 메타문자 이스케이프 (사용자 입력 q 용). */
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

// 워크스페이스 스위처 정렬: PG 그룹을 먼저, 각 그룹 내부는 이름 가나다순.
const orderByPgThenNameAsc = [
  sql`CASE WHEN ${workspaces.type} = 'pg' THEN 0 ELSE 1 END`,
  asc(workspaces.name),
] as const;

// 알림(인앱/이메일) 수신 대상 판별. 영구 로그인 불가 데모/온보딩 placeholder
// (passwordHash '!' sentinel — createSystemAccount)만 제외하고, 화면에선 숨겨지지만
// 실제 로그인해 알림을 읽는 master/ops 계정(실 해시)은 **포함**한다. 표시용
// surface(teamRoster/findProfileById/search)는 계속 isSystemAccount 로 master 를
// 숨기므로, 알림 수신자에 포함해도 신원/이메일이 다른 멤버에게 노출되지 않는다.
const notifiableAccount = ne(usersTable.passwordHash, '!');

type WsRow = typeof workspaces.$inferSelect;
type MemberRow = typeof workspaceMembers.$inferSelect;
type UserRow = typeof usersTable.$inferSelect;
type BizRow = typeof bizProfiles.$inferSelect;

import { normalizeAvatarColor } from './_avatar-color';

function rowToUser(u: UserRow, m: MemberRow): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarColor: normalizeAvatarColor(u.avatarColor),
    avatarUpdatedAt: u.avatarUpdatedAt
      ? new Date(u.avatarUpdatedAt).toISOString()
      : null,
    role: m.role,
    status: u.status === 'paused' ? 'paused' : 'active',
    emailVerified: u.emailVerified,
    joinedAt: new Date(m.joinedAt).toISOString(),
    lastSeenAt: m.lastSeenAt ? new Date(m.lastSeenAt).toISOString() : undefined,
  };
}

export class DrizzleWorkspaceRepository implements WorkspaceRepo {

  constructor(private readonly _db: Tx) {}

  private h(tx?: Tx): Tx {
    return tx ?? this._db;
  }

  // Hydrate one workspace's members + biz profile with two cheap queries.
  // Inlined twice across finders would invite drift — kept private here.

  private async hydrate(db: Tx, ws: WsRow): Promise<Workspace> {
    const memberRows = (await db
      .select({ m: workspaceMembers, u: usersTable })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          // System-managed master accounts are hidden from all UI member lists.
          eq(usersTable.isSystemAccount, false),
        ),
      )) as { m: MemberRow; u: UserRow }[];

    const members: User[] = memberRows.map((r) => rowToUser(r.u, r.m));

    let bizProfile: Workspace['bizProfile'];
    if (ws.bizProfileId) {
      const [biz] = (await db
        .select()
        .from(bizProfiles)
        .where(eq(bizProfiles.id, ws.bizProfileId))
        .limit(1)) as BizRow[];
      if (biz) {
        bizProfile = {
          bizNo: biz.bizNo ?? undefined,
          taxType: biz.taxType ?? undefined,
          status: biz.status ?? undefined,
          grade: biz.grade ?? undefined,
          gradeSource: biz.gradeSource,
          gradeConfirmedBy: biz.gradeConfirmedBy ?? undefined,
          gradeConfirmedAt: biz.gradeConfirmedAt
            ? new Date(biz.gradeConfirmedAt).toISOString()
            : undefined,
        };
      }
    }

    const [logoRow] = await db
      .select({ updatedAt: workspaceLogoBlobs.updatedAt })
      .from(workspaceLogoBlobs)
      .where(eq(workspaceLogoBlobs.workspaceId, ws.id))
      .limit(1);

    return {
      id: ws.id,
      type: ws.type,
      name: ws.name,
      bizProfile,
      members,
      logoUpdatedAt: logoRow?.updatedAt ? new Date(logoRow.updatedAt).toISOString() : null,
      createdAt: new Date(ws.createdAt).toISOString(),
    };
  }

  async save(ws: Workspace, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db
      .insert(workspaces)
      .values({
        id: ws.id,
        type: ws.type,
        name: ws.name,
        bizProfileId: null, // workspace.bizProfile is read-only hydration; updates go through BizProfileRepo + workspaces.bizProfileId
      })
      .onConflictDoUpdate({
        target: workspaces.id,
        set: { name: ws.name },
      });

    // Sync members table — additive (we don't remove members here).
    for (const u of ws.members) {
      await db
        .insert(workspaceMembers)
        .values({
          workspaceId: ws.id,
          userId: u.id,
          role: u.role,
          joinedAt: new Date(u.joinedAt),
          lastSeenAt: u.lastSeenAt ? new Date(u.lastSeenAt) : null,
        })
        .onConflictDoNothing({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        });
    }
  }

  async findById(id: string, tx?: Tx): Promise<Workspace | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);
    return row ? this.hydrate(db, row) : undefined;
  }

  async listForUser(
    userId: string,
    tx?: Tx,
  ): Promise<WorkspaceMembershipSummary[]> {
    const db = this.h(tx);
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        type: workspaces.type,
        status: workspaces.status,
        role: workspaceMembers.role,
        memberApprovalStatus: workspaceMembers.approvalStatus,
        unreadCount: sql<number>`(
          SELECT COALESCE(COUNT(*)::int, 0)
          FROM notifications
          WHERE workspace_id = ${workspaces.id}
            AND user_id = ${userId}
            AND channel = 'in_app'
            AND read_at IS NULL
        )`,
        logoUpdatedAt: workspaces.logoUpdatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(...orderByPgThenNameAsc);
    return rows.map((r: { logoUpdatedAt: Date | null }) => ({
      ...r,
      logoUpdatedAt: r.logoUpdatedAt ? new Date(r.logoUpdatedAt).toISOString() : null,
    })) as WorkspaceMembershipSummary[];
  }

  async listAllWorkspacesForMaster(tx?: Tx): Promise<WorkspaceMembershipSummary[]> {
    const db = this.h(tx);
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        type: workspaces.type,
        status: workspaces.status,
        role: sql<'admin'>`'admin'`,
        memberApprovalStatus: sql<'approved'>`'approved'`,
        unreadCount: sql<number>`0`,
        logoUpdatedAt: workspaces.logoUpdatedAt,
      })
      .from(workspaces)
      .where(eq(workspaces.status, 'active'))
      .orderBy(...orderByPgThenNameAsc)
      .limit(500);
    return rows.map((r: { logoUpdatedAt: Date | null }) => ({
      ...r,
      logoUpdatedAt: r.logoUpdatedAt ? new Date(r.logoUpdatedAt).toISOString() : null,
    })) as WorkspaceMembershipSummary[];
  }

  async isMember(userId: string, workspaceId: string, tx?: Tx): Promise<boolean> {
    const db = this.h(tx);
    const [row] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async memberUserIds(workspaceId: string, tx?: Tx): Promise<string[]> {
    const db = this.h(tx);
    const rows = (await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          notifiableAccount,
        ),
      )) as Pick<MemberRow, 'userId'>[];
    return rows.map((r) => r.userId);
  }

  async teamRoster(workspaceId: string, tx?: Tx): Promise<TeamMember[]> {
    const db = this.h(tx);
    const rows = (await db
      .select({
        userId: workspaceMembers.userId,
        name: usersTable.name,
        joinedAt: workspaceMembers.joinedAt,
        avatarUpdatedAt: usersTable.avatarUpdatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.approvalStatus, 'approved'),
          eq(usersTable.isSystemAccount, false),
        ),
      )
      .orderBy(asc(workspaceMembers.joinedAt))) as {
      userId: string;
      name: string;
      joinedAt: Date;
      avatarUpdatedAt: Date | null;
    }[];
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      joinedAt: new Date(r.joinedAt).toISOString(),
      avatarUpdatedAt: r.avatarUpdatedAt ? new Date(r.avatarUpdatedAt).toISOString() : null,
    }));
  }

  async memberEmails(workspaceId: string, tx?: Tx): Promise<string[]> {
    const db = this.h(tx);
    const rows = (await db
      .select({ email: usersTable.email })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(usersTable.isSystemAccount, false),
        ),
      )) as Pick<UserRow, 'email'>[];
    return rows.map((r) => r.email);
  }

  async listCanonicalPgWorkspaces(): Promise<{ id: string; name: string; canonicalPgKey: string; logoUpdatedAt: string | null }[]> {
    const rows = (await this._db
      .select({ id: workspaces.id, name: workspaces.name, canonicalPgKey: workspaces.canonicalPgKey, logoUpdatedAt: workspaces.logoUpdatedAt })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.type, 'pg'),
          eq(workspaces.status, 'active'),
          isNotNull(workspaces.canonicalPgKey),
        ),
      )
      .orderBy(asc(workspaces.name))) as { id: string; name: string; canonicalPgKey: string | null; logoUpdatedAt: Date | null }[];
    return rows.map((r) => ({
      ...r,
      canonicalPgKey: r.canonicalPgKey!,
      logoUpdatedAt: r.logoUpdatedAt ? new Date(r.logoUpdatedAt).toISOString() : null,
    }));
  }

  async search(
    opts: { type: WorkspaceType; q?: string; includeTest?: boolean },
    tx?: Tx,
  ): Promise<{ id: string; name: string; logoUpdatedAt: string | null }[]> {
    const db = this.h(tx);
    const { type, q, includeTest = false } = opts;
    // status='active' 는 includeTest 와 무관하게 항상 건다 — 피커는 승인된
    // 워크스페이스만 보여준다(심사 대기 PG 가 모든 구매사에게 뜨던 결함 수정).
    const conds = [eq(workspaces.type, type), eq(workspaces.status, 'active')];
    if (q) conds.push(ilike(workspaces.name, `%${escapeIlike(q)}%`));
    if (!includeTest) {
      // 테스트용 PG 숨김. 토큰 단일 출처는 lib/features/test-pg.ts 이고 그쪽
      // isTestPgName 과 동치여야 한다 — 앱 레이어가 아니라 여기서 거르는 이유는
      // 아래 limit 이 필터 이후에 적용돼야 결과 개수가 줄지 않기 때문이다.
      for (const token of TEST_PG_NAME_TOKENS) {
        conds.push(notIlike(workspaces.name, `%${escapeIlike(token)}%`));
      }
    }
    const rows = (await db
      .select({ id: workspaces.id, name: workspaces.name, logoUpdatedAt: workspaces.logoUpdatedAt })
      .from(workspaces)
      .where(and(...conds))
      .limit(q ? 20 : 500)) as { id: string; name: string; logoUpdatedAt: Date | null }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      logoUpdatedAt: r.logoUpdatedAt ? new Date(r.logoUpdatedAt).toISOString() : null,
    }));
  }

  async getName(workspaceId: string, tx?: Tx): Promise<string | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row?.name;
  }

  async getActiveName(workspaceId: string, tx?: Tx): Promise<string | undefined> {
    const db = this.h(tx);
    const [row] = await db.select({ name: workspaces.name }).from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.status, 'active')))
      .limit(1);
    return row?.name;
  }

  async getDisplayInfo(workspaceId: string, tx?: Tx): Promise<WorkspaceDisplay | undefined> {
    const db = this.h(tx);
    const [row] = (await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        type: workspaces.type,
        logoUpdatedAt: workspaces.logoUpdatedAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)) as { id: string; name: string; type: WorkspaceType; logoUpdatedAt: Date | null }[];
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      logoUpdatedAt: row.logoUpdatedAt ? new Date(row.logoUpdatedAt).toISOString() : null,
    };
  }

  async findDisplayInfoByIds(ids: string[], tx?: Tx): Promise<WorkspaceDisplay[]> {
    if (ids.length === 0) return [];
    const db = this.h(tx);
    const rows = (await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        type: workspaces.type,
        logoUpdatedAt: workspaces.logoUpdatedAt,
      })
      .from(workspaces)
      .where(inArray(workspaces.id, ids))) as {
      id: string;
      name: string;
      type: WorkspaceType;
      logoUpdatedAt: Date | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      logoUpdatedAt: row.logoUpdatedAt ? new Date(row.logoUpdatedAt).toISOString() : null,
    }));
  }

  async isMemberOfAny(userId: string, workspaceIds: string[], tx?: Tx): Promise<string | null> {
    if (workspaceIds.length === 0) return null;
    const db = this.h(tx);
    const [row] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          inArray(workspaceMembers.workspaceId, workspaceIds),
        ),
      )
      .limit(1);
    return row?.workspaceId ?? null;
  }

  async approvedMemberRecipients(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ userId: string; email: string }[]> {
    const db = this.h(tx);
    return (await db
      .select({ userId: workspaceMembers.userId, email: usersTable.email })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.approvalStatus, 'approved'),
          notifiableAccount,
        ),
      )) as { userId: string; email: string }[];
  }

  async memberRecipientsBatch(
    wsIds: string[],
    tx?: Tx,
  ): Promise<{ workspaceId: string; userId: string; role: string; email: string }[]> {
    if (wsIds.length === 0) return [];
    const db = this.h(tx);
    return (await db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: usersTable.email,
      })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          inArray(workspaceMembers.workspaceId, wsIds),
          eq(workspaceMembers.approvalStatus, 'approved'),
          notifiableAccount,
        ),
      )) as {
      workspaceId: string;
      userId: string;
      role: string;
      email: string;
    }[];
  }

  async findActiveById(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ id: string; type: WorkspaceType } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ id: workspaces.id, type: workspaces.type })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.status, 'active')))
      .limit(1);
    return row ?? undefined;
  }

  async findActiveCanonicalPgById(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ id: string; name: string; canonicalPgKey: string } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ id: workspaces.id, name: workspaces.name, canonicalPgKey: workspaces.canonicalPgKey })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.type, 'pg'),
          eq(workspaces.status, 'active'),
          isNotNull(workspaces.canonicalPgKey),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    return { id: row.id, name: row.name, canonicalPgKey: row.canonicalPgKey as string };
  }

  async findEarliestActiveWorkspace(
    tx?: Tx,
  ): Promise<{ id: string; type: WorkspaceType } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ id: workspaces.id, type: workspaces.type })
      .from(workspaces)
      .where(eq(workspaces.status, 'active'))
      .orderBy(asc(workspaces.createdAt))
      .limit(1);
    return row ?? undefined;
  }

  async getMembership(
    userId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ role: string; type: WorkspaceType; approvalStatus: MemberApprovalStatus } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({
        role: workspaceMembers.role,
        type: workspaces.type,
        approvalStatus: workspaceMembers.approvalStatus,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row;
  }

  async getMemberApprovalStatus(
    userId: string,
    workspaceId: string,
    tx?: Tx,
  ): Promise<'approved' | 'pending_approval' | 'rejected' | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ approvalStatus: workspaceMembers.approvalStatus })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row?.approvalStatus;
  }

  async findInitialMembership(
    userId: string,
    tx?: Tx,
  ): Promise<
    { workspaceId: string; role: string; type: WorkspaceType; approvalStatus: MemberApprovalStatus } | undefined
  > {
    const db = this.h(tx);
    const [row] = await db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
        type: workspaces.type,
        approvalStatus: workspaceMembers.approvalStatus,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaceMembers.joinedAt))
      .limit(1);
    return row;
  }

  async listMembershipsWithMembers(
    userId: string,
    tx?: Tx,
  ): Promise<
    {
      workspaceId: string;
      name: string;
      role: string;
      approvalStatus: MemberApprovalStatus;
      members: { userId: string; role: string; approvalStatus: MemberApprovalStatus }[];
    }[]
  > {
    const db = this.h(tx);
    // No `as` cast: the inferred projection type IS the contract. If anyone
    // drops `approvalStatus` from either select below, this stops compiling
    // rather than silently yielding `undefined` (which would flip
    // `isApprovedAdmin` to false and fail-open the last-admin block).
    const myMemberships = await db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
        approvalStatus: workspaceMembers.approvalStatus,
        name: workspaces.name,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId));

    const result: {
      workspaceId: string;
      name: string;
      role: string;
      approvalStatus: MemberApprovalStatus;
      members: { userId: string; role: string; approvalStatus: MemberApprovalStatus }[];
    }[] = [];
    for (const m of myMemberships) {
      const members = await db
        .select({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          approvalStatus: workspaceMembers.approvalStatus,
        })
        .from(workspaceMembers)
        .innerJoin(usersTable, eq(usersTable.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, m.workspaceId),
            // Same exclusion `hydrate()` applies to UI member lists. A
            // system-managed account is not a person: it can neither take over
            // the admin role nor be seen by the user being told to hand it
            // over. Counting it made a workspace whose only human is leaving
            // look populated.
            eq(usersTable.isSystemAccount, false),
          ),
        );
      result.push({
        workspaceId: m.workspaceId,
        name: m.name,
        role: m.role,
        approvalStatus: m.approvalStatus,
        members,
      });
    }
    return result;
  }

  async setBizProfilePointer(
    workspaceId: string,
    bizProfileId: string,
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db
      .update(workspaces)
      .set({ bizProfileId })
      .where(eq(workspaces.id, workspaceId));
  }

  async getBizProfileId(workspaceId: string, tx?: Tx): Promise<string | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ bizProfileId: workspaces.bizProfileId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row?.bizProfileId ?? undefined;
  }

  async getBizProfileIdAndName(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ bizProfileId: string | null; name: string } | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ bizProfileId: workspaces.bizProfileId, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!row) return undefined;
    return { bizProfileId: row.bizProfileId ?? null, name: row.name };
  }

  async filterPgIds(ids: string[], tx?: Tx): Promise<string[]> {
    if (ids.length === 0) return [];
    const db = this.h(tx);
    const rows = (await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(inArray(workspaces.id, ids), eq(workspaces.type, 'pg')))) as { id: string }[];
    return rows.map((r) => r.id);
  }

  async createNameChangeRequest(
    input: { workspaceId: string; requestedByUserId: string; currentName: string; requestedName: string },
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db.insert(workspaceNameChangeRequests).values(input);
  }

  async findLatestNameChangeRequest(
    workspaceId: string,
    tx?: Tx,
  ): Promise<WorkspaceNameChangeRequest | undefined> {
    const db = this.h(tx);
    const [row] = await db.select().from(workspaceNameChangeRequests)
      .where(eq(workspaceNameChangeRequests.workspaceId, workspaceId))
      .orderBy(desc(workspaceNameChangeRequests.submittedAt), desc(workspaceNameChangeRequests.id))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row,
      status: row.status as WorkspaceNameChangeRequest['status'],
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    };
  }

  async setLogoUpdatedAt(workspaceId: string, value: Date | null, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db.update(workspaces).set({ logoUpdatedAt: value }).where(eq(workspaces.id, workspaceId));
  }

  async createBare(
    params: { id: string; type: WorkspaceType; name: string; bizProfileId: string | null },
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db.insert(workspaces).values({
      id: params.id,
      type: params.type,
      name: params.name,
      bizProfileId: params.bizProfileId,
    });
  }

  async addMember(
    // `approvalStatus` matches the `WorkspaceRepo` interface exactly — the impl
    // used to widen it to `string`, which let an arbitrary value reach the
    // column and silently flip `isApprovedAdmin` to false for that member.
    params: {
      workspaceId: string;
      userId: string;
      role: string;
      approvalStatus?: MemberApprovalStatus;
    },
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db
      .insert(workspaceMembers)
      .values({
        workspaceId: params.workspaceId,
        userId: params.userId,
        role: params.role as MemberRow['role'],
        approvalStatus: params.approvalStatus ?? 'approved',
      })
      .onConflictDoNothing({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      });
  }

  async listPendingInvitations(
    workspaceId: string,
    tx?: Tx,
  ): Promise<{ email: string; createdAt: Date; role: string }[]> {
    const db = this.h(tx);
    return (await db
      .select({
        email: workspaceInvitations.invitedEmail,
        createdAt: workspaceInvitations.createdAt,
        role: workspaceInvitations.role,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.status, 'pending'),
          gt(workspaceInvitations.expiresAt, new Date()),
        ),
      )) as { email: string; createdAt: Date; role: string }[];
  }

  async findInvitationByTokenHash(
    tokenHash: string,
    tx?: Tx,
  ): Promise<
    | {
        invitedEmail: string;
        status: string;
        expiresAt: Date;
        workspaceName: string;
        workspaceId: string;
      }
    | undefined
  > {
    const db = this.h(tx);
    const [row] = await db
      .select({
        invitedEmail: workspaceInvitations.invitedEmail,
        status: workspaceInvitations.status,
        expiresAt: workspaceInvitations.expiresAt,
        workspaceName: workspaces.name,
        workspaceId: workspaceInvitations.workspaceId,
      })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
      .where(eq(workspaceInvitations.tokenHash, tokenHash))
      .limit(1);
    return row ?? undefined;
  }

  async claimInvitation(
    invitationId: string,
    userId: string,
    tx?: Tx,
  ): Promise<
    | { ok: true; workspaceId: string; role: string }
    | { ok: false; reason: 'expired' }
  > {
    const db = this.h(tx);
    // 조건부 UPDATE — status='pending' AND expires_at>now() 가 원자적 직렬화 지점.
    // 멤버 추가·이메일 인증은 호출부 책임(이 메서드는 초대 전이만 소유).
    const [claimed] = await db
      .update(workspaceInvitations)
      .set({ status: 'accepted', acceptedByUserId: userId })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          eq(workspaceInvitations.status, 'pending'),
          gt(workspaceInvitations.expiresAt, new Date()),
        ),
      )
      .returning({
        workspaceId: workspaceInvitations.workspaceId,
        role: workspaceInvitations.role,
      });
    if (!claimed) return { ok: false, reason: 'expired' };
    return { ok: true, workspaceId: claimed.workspaceId, role: claimed.role };
  }

  async findAdminEmail(workspaceId: string, tx?: Tx): Promise<string | undefined> {
    const db = this.h(tx);
    const [row] = await db
      .select({ email: usersTable.email })
      .from(workspaceMembers)
      .innerJoin(usersTable, eq(workspaceMembers.userId, usersTable.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.role, 'admin'),
        ),
      )
      .limit(1);
    return row?.email;
  }

  async createInvitation(
    params: {
      workspaceId: string;
      invitedEmail: string;
      invitedByUserId: string;
      role: 'admin' | 'member';
      tokenHash: string;
      expiresAt: Date;
    },
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db.insert(workspaceInvitations).values({
      workspaceId: params.workspaceId,
      invitedEmail: params.invitedEmail,
      invitedByUserId: params.invitedByUserId,
      role: params.role,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      status: 'pending',
    });
  }

  async resetPendingInvitationToken(
    params: { workspaceId: string; email: string; tokenHash: string; expiresAt: Date },
    tx?: Tx,
  ): Promise<boolean> {
    const db = this.h(tx);
    const updated = await db
      .update(workspaceInvitations)
      .set({ tokenHash: params.tokenHash, expiresAt: params.expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, params.workspaceId),
          eq(workspaceInvitations.status, 'pending'),
          sql`lower(${workspaceInvitations.invitedEmail}) = ${params.email}`,
        ),
      )
      .returning({ id: workspaceInvitations.id });
    return updated.length > 0;
  }

  async expirePendingInvitation(
    params: { workspaceId: string; email: string },
    tx?: Tx,
  ): Promise<boolean> {
    const db = this.h(tx);
    const updated = await db
      .update(workspaceInvitations)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, params.workspaceId),
          eq(workspaceInvitations.status, 'pending'),
          sql`lower(${workspaceInvitations.invitedEmail}) = ${params.email}`,
        ),
      )
      .returning({ id: workspaceInvitations.id });
    return updated.length > 0;
  }

  async findInvitationClaimByTokenHash(
    tokenHash: string,
    tx?: Tx,
  ): Promise<
    | {
        id: string;
        workspaceId: string;
        role: 'admin' | 'member';
        expiresAt: Date;
        status: string;
        invitedEmail: string;
      }
    | undefined
  > {
    const db = this.h(tx);
    const [row] = await db
      .select({
        id: workspaceInvitations.id,
        workspaceId: workspaceInvitations.workspaceId,
        role: workspaceInvitations.role,
        expiresAt: workspaceInvitations.expiresAt,
        status: workspaceInvitations.status,
        invitedEmail: workspaceInvitations.invitedEmail,
      })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.tokenHash, tokenHash))
      .limit(1);
    return row ?? undefined;
  }

  async countAdmins(workspaceId: string, tx?: Tx): Promise<number> {
    const db = this.h(tx);
    const [{ value }] = await db
      .select({ value: count() })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.role, 'admin'),
          // 미승인(pending_approval/rejected) admin 은 진짜 admin 으로 세지 않는다.
          eq(workspaceMembers.approvalStatus, 'approved'),
        ),
      );
    return value;
  }

  async countApprovedAdminsForUpdate(workspaceId: string, tx?: Tx): Promise<number> {
    const db = this.h(tx);
    // 집계 대신 행을 뽑아 세는 이유: Postgres 는 aggregate 쿼리에 FOR UPDATE 를 허용하지
    // 않는다. 잠금이 목적이므로 admin 행 자체를 잠가야 한다 — READ COMMITTED 에서
    // FOR UPDATE 는 대기 후 술어를 재평가하므로, 앞선 강등이 커밋되면 그 행은
    // role='admin' 조건에서 빠져 카운트가 정확히 줄어든다.
    const rows = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.role, 'admin'),
          eq(workspaceMembers.approvalStatus, 'approved'),
        ),
      )
      .for('update');
    return rows.length;
  }

  async updateMemberRole(
    params: { workspaceId: string; userId: string; role: 'admin' | 'member' },
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db
      .update(workspaceMembers)
      .set({ role: params.role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, params.workspaceId),
          eq(workspaceMembers.userId, params.userId),
        ),
      );
  }

  async removeMember(
    params: { workspaceId: string; userId: string },
    tx?: Tx,
  ): Promise<void> {
    const db = this.h(tx);
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, params.workspaceId),
          eq(workspaceMembers.userId, params.userId),
        ),
      );
  }

  async deleteWorkspaces(ids: string[], tx?: Tx): Promise<void> {
    if (ids.length === 0) return;
    const db = this.h(tx);
    await db.delete(workspaces).where(inArray(workspaces.id, ids));
  }

  async removeAllMembershipsForUser(userId: string, tx?: Tx): Promise<void> {
    const db = this.h(tx);
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  }
}
