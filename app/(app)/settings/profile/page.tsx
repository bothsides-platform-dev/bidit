import { redirect } from 'next/navigation';
import { Label } from '@/components/primitives/Label';
import { Chip } from '@/components/primitives/Chip';
import { PageEnter } from '@/components/primitives/PageEnter';
import { WorkspaceBizNoForm } from '@/components/settings/WorkspaceBizNoForm';
import { WorkspaceNameForm } from '@/components/settings/WorkspaceNameForm';
import { WorkspaceLogoForm } from '@/components/settings/WorkspaceLogoForm';
import { UserAvatarForm } from '@/components/settings/UserAvatarForm';
import { UserPhoneForm } from '@/components/settings/UserPhoneForm';
import { BizRequiredToast } from '@/components/settings/BizRequiredToast';
import { DeleteAccountSection } from '@/components/settings/DeleteAccountSection';
import { auth } from '@/auth';
import { getMembership, isApprovedAdmin } from '@/lib/auth/active-workspace';
import { isMasterEmail } from '@/lib/auth/master-allowlist';
import {
  getUserRepo,
  getWorkspaceRepo,
} from '@/lib/server/repositories/factory';
import { LocalDate } from '@/components/primitives/LocalTime';
import type { ReactNode } from 'react';
import { MERCHANT_TIER_LABELS } from '@/lib/types/bid';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ biz_required?: string }> };

export default async function ProfilePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id || !session.user.workspaceId) {
    redirect('/login?next=/settings/profile');
  }

  const { biz_required } = await searchParams;
  const userRepo = await getUserRepo();
  const wsRepo = await getWorkspaceRepo();
  // `User` 도메인 타입은 phone 을 싣지 않는다 — 서명 담당자 연락처를 돌려주는
  // 좁은 리드를 쓴다(본인 것을 본인이 읽는 자리라 ACL 문제는 없다).
  const [me, ws, latestNameChangeRequest, myContact] = await Promise.all([
    userRepo.findById(session.user.id),
    wsRepo.findById(session.user.workspaceId),
    wsRepo.findLatestNameChangeRequest(session.user.workspaceId),
    userRepo.findContactById(session.user.id),
  ]);
  if (!me || !ws) {
    return (
      <div className="px-4 py-8 md:px-8 md:py-12">
        <p className="md-label-small text-[var(--md-sys-color-error)]">
          프로필 정보를 불러오지 못했습니다.
        </p>
      </div>
    );
  }

  const biz = ws.bizProfile;
  const grade = biz?.grade;
  const memberMeta = ws.members.find((m) => m.id === me.id);

  // 편집 권한은 **서버 액션과 같은 술어**로 판정한다. `ws.members` 는
  // approvalStatus 를 싣지 않으므로(rowToUser 참조) role 만 보면 승인 대기 admin
  // 에게 버튼을 보여 주고 저장에서만 거부하게 된다 — 이 페이지가 없애려는 바로 그
  // 막다른 길이다. requestWorkspaceNameChangeAction·updateWorkspaceBizProfileAction 둘 다
  // isApprovedAdmin 을 쓰므로 여기서도 같은 함수를 쓴다.
  // 마스터/운영자는 멤버십 row 가 없으므로 액션과 같은 면제를 둔다 —
  // 안 두면 운영자에게만 버튼이 사라져 서버는 허용하는데 UI 가 막는다.
  const canEditWorkspace =
    isMasterEmail(session.user.email) ||
    isApprovedAdmin(await getMembership(me.id, ws.id));

  const wsKvPairs: [string, ReactNode][] = [
    ...(biz
      ? ([
          [
            '업태',
            biz.taxType === 'general'
              ? '일반과세'
              : biz.taxType === 'simple'
                ? '간이과세'
                : '면세',
          ],
          ...(grade
            ? ([['가맹점 등급', MERCHANT_TIER_LABELS[grade]]] as [string, ReactNode][])
            : []),
        ] as [string, ReactNode][])
      : []),
    ['생성일', <LocalDate key="createdAt" iso={ws.createdAt} />],
  ];

  const kvRowClass =
    'py-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4';
  const kvLabelClass =
    'md-label-small text-[var(--md-sys-color-on-surface-variant)]';
  const kvValueClass =
    'text-[13px] text-[var(--md-sys-color-on-surface)] md-numeric break-all sm:break-keep';

  return (
    <PageEnter className="px-4 py-6 md:px-8 md:py-8 space-y-8 md:space-y-10">
      <div>
        <Label size="md" muted={false} as="span" className="block mb-2">SETTINGS · PROFILE</Label>
        <h1 className="text-[26px] font-[700] tracking-[-0.02em] text-[var(--md-sys-color-on-surface)]">
          프로필 설정
        </h1>
      </div>

      {/* User profile — 프로필 사진 업로드/삭제 가능 */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <Label size="md" muted={false}>사용자</Label>
          <div className="flex-1 h-px bg-[var(--md-sys-color-outline-variant)]" />
        </div>
        <div className="flex items-center gap-4 mb-3">
          <UserAvatarForm userId={me.id} name={me.name} avatarUpdatedAt={me.avatarUpdatedAt} />
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">{me.name}</p>
            <p className="md-numeric text-xs text-[var(--md-sys-color-on-surface-variant)] break-all">
              {me.email}
            </p>
          </div>
        </div>
        <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-y border-[var(--md-sys-color-outline-variant)]">
          <UserPhoneForm currentPhone={myContact?.phone ?? null} />
          <div className={kvRowClass}>
            <span className={kvLabelClass}>가입일</span>
            <span className={kvValueClass}><LocalDate iso={memberMeta?.joinedAt ?? me.joinedAt} /></span>
          </div>
        </div>
      </section>

      {/* Workspace + biz profile */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <Label size="md" muted={false}>워크스페이스</Label>
          <Chip label={ws.type === 'buyer' ? '구매사' : 'PG'} color="surface" />
          <div className="flex-1 h-px bg-[var(--md-sys-color-outline-variant)]" />
        </div>

        {/* 권한이 없으면 이 패널 세 행(로고·이름·사업자번호)이 전부 어포던스 0 이
            된다. 행마다 안내를 세 개 두는 대신 패널에 한 줄로 이유를 밝힌다 —
            그러지 않으면 사용자는 왜 아무것도 못 바꾸는지 알 수 없다. */}
        {!canEditWorkspace && (
          <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)] mb-3">
            워크스페이스 정보는 관리자가 바꿀 수 있어요. 변경이 필요하면 관리자에게 요청해 주세요.
          </p>
        )}

        <div className="divide-y divide-[var(--md-sys-color-outline-variant)] border-t border-[var(--md-sys-color-outline-variant)]">
          <WorkspaceLogoForm workspaceId={ws.id} name={ws.name} logoUpdatedAt={ws.logoUpdatedAt} canEdit={canEditWorkspace} />
          <WorkspaceNameForm
            workspaceId={ws.id}
            currentName={ws.name}
            canEdit={canEditWorkspace}
            pendingRequest={latestNameChangeRequest?.status === 'pending'
              ? {
                  requestedName: latestNameChangeRequest.requestedName,
                }
              : null}
            lastRejectedRequest={latestNameChangeRequest?.status === 'rejected' && latestNameChangeRequest.reason
              ? {
                  requestedName: latestNameChangeRequest.requestedName,
                  reason: latestNameChangeRequest.reason,
                }
              : null}
          />

          {/* 사업자번호 (buyer only) */}
          {ws.type === 'buyer' && (
            <div className="py-4 space-y-4">
              {/* 편집 권한이 있을 때만 "등록하면 된다"고 말한다. 권한이 없는 멤버에게
                  이걸 띄우면 바로 아래 안내("관리자만 등록할 수 있어요")와 정면으로
                  어긋나고, 정작 할 수 있는 일은 알려 주지 않는다. */}
              {biz_required === '1' && !biz && canEditWorkspace && (
                <>
                  <BizRequiredToast />
                  <p
                    role="alert"
                    className="md-label-small text-[var(--md-sys-color-error)]"
                  >
                    사업자번호를 등록하면 견적 요청을 보낼 수 있어요.
                  </p>
                </>
              )}
              <WorkspaceBizNoForm
                currentBizNo={biz?.bizNo ?? null}
                returnUrl={biz_required === '1' && !biz ? '/rfp-create' : undefined}
                canEdit={canEditWorkspace}
              />
            </div>
          )}

          {wsKvPairs.map(([k, v]) => (
            <div key={k} className={kvRowClass}>
              <span className={kvLabelClass}>{k}</span>
              <span className={kvValueClass}>{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 계정 탈퇴 */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <Label size="md" muted={false}>위험 영역</Label>
          <div className="flex-1 h-px bg-[var(--md-sys-color-error)]/20" />
        </div>
        <DeleteAccountSection />
      </section>
    </PageEnter>
  );
}
