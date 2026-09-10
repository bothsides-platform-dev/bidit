import type { BizProfile } from './biz-profile';
import type { User } from './user';

export type WorkspaceType = 'buyer' | 'pg';

/**
 * 워크스페이스를 화면에 그리는 데 필요한 신원 한 덩어리 — id·상호명·유형·로고 버전.
 *
 * **이름과 로고 버전은 항상 함께 옮긴다.** 이 묶음을 풀어 `name` 문자열만 prop 으로
 * 내려보내면 로고가 조용히 사라지는데, 폴백(이니셜)이 정상으로 보여서 타입에도 화면에도
 * 흔적이 남지 않는다 — 딜룸 PG 관리·참여 요청·PG 측 브리프/위저드 4개 화면이 실제로
 * 그렇게 로고를 잃고 있었다. 그래서 `logoUpdatedAt` 은 optional 이 아니라
 * `string | null` 이고(로고 없음과 안 넘김이 구분된다), 표시 계층은 이 객체를 통째로
 * 받는다 — 이름만 받는 prop 을 새로 만들면 같은 구멍이 다시 열린다.
 */
export type WorkspaceDisplay = {
  id: string;
  name: string;
  type: WorkspaceType;
  logoUpdatedAt: string | null;
};

export type Workspace = {
  id: string;
  type: WorkspaceType;
  name: string;
  bizProfile?: BizProfile;
  members: User[];
  logoUpdatedAt: string | null;
  createdAt: string;
};

export type MemberApprovalStatus = 'approved' | 'pending_approval' | 'rejected';

// Lean per-membership summary for the workspace switcher — one row per
// workspace a user belongs to, with that user's role in it.
export type WorkspaceMembershipSummary = {
  id: string;
  name: string;
  type: WorkspaceType;
  status: 'pending' | 'active' | 'suspended';
  role: 'admin' | 'member';
  memberApprovalStatus: MemberApprovalStatus;
  unreadCount: number;
  logoUpdatedAt: string | null;
};
