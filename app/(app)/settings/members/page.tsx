import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getWorkspaceRepo } from '@/lib/server/repositories/factory';
import { PageEnter } from '@/components/primitives/PageEnter';
import { MembersPanel } from '@/components/settings/MembersPanel';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.workspaceId) {
    redirect('/login?next=/settings/members');
  }

  const wsId = session.user.workspaceId;
  const userRole = (session.user.role as 'admin' | 'member') ?? 'member';

  const workspaceRepo = await getWorkspaceRepo();
  const ws = await workspaceRepo.findById(wsId);
  if (!ws) {
    return (
      <div className="px-8 py-8">
        <p className="md-label-small text-[var(--md-sys-color-on-surface-variant)]">
          워크스페이스를 찾을 수 없습니다.
        </p>
      </div>
    );
  }

  const pendingRows = await workspaceRepo.listPendingInvitations(wsId);

  const pendingInvites = pendingRows.map((r) => ({
    email: r.email,
    createdAt: r.createdAt.toISOString(),
    role: r.role as 'admin' | 'member',
  }));

  return (
    <PageEnter className="px-4 py-6 md:px-8 md:py-8 space-y-8 md:space-y-10">
      <MembersPanel
        workspaceId={wsId}
        workspaceName={ws.name}
        initialMembers={ws.members}
        userRole={userRole}
        initialPendingInvites={pendingInvites}
        currentUserId={session.user.id}
      />
    </PageEnter>
  );
}
