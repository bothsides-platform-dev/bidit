import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/primitives/Button';
import { EmptyState } from '@/components/primitives/EmptyState';
import { FileTextIcon, PlusIcon } from '@/components/icons';
import { RfpListTable, RfpListTableSkeleton } from '@/components/rfp/RfpListTable';
import { BoardFilterBar } from '@/components/board/BoardFilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { requireBuyerPage } from '@/lib/auth/page-guards';
import { getRfpRepo } from '@/lib/server/repositories/factory';
import { filterRfps, type BoardFilterParams } from '@/lib/server/board/filterRfps';
import { MERCHANT_TIER_LABELS } from '@/lib/types/bid';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'active', label: '진행중' },
  { value: 'closed', label: '마감' },
];
const GRADE_OPTIONS = Object.entries(MERCHANT_TIER_LABELS).map(([value, label]) => ({ value, label }));

type Props = {
  searchParams: Promise<BoardFilterParams>;
};

export default async function RfpListPage({ searchParams }: Props) {
  const session = await requireBuyerPage('/rfp');

  const sp = await searchParams;
  const wsId = session.user.workspaceId;

  const newRfpAction = (
    <Link href="/rfp-create">
      <Button size="sm" icon={<PlusIcon />}>
        견적 요청하기
      </Button>
    </Link>
  );

  return (
    <div className="flex flex-col h-full">
      <Suspense
        fallback={
          <>
            <PageHeader title="견적 요청" action={newRfpAction} />
            <RfpListTableSkeleton />
          </>
        }
      >
        <RfpListPageLoader wsId={wsId} params={sp} newRfpAction={newRfpAction} />
      </Suspense>
    </div>
  );
}

async function RfpListPageLoader({
  wsId,
  params,
  newRfpAction,
}: {
  wsId: string;
  params: BoardFilterParams;
  newRfpAction: React.ReactNode;
}) {
  const now = new Date();
  const allRfps = await (await getRfpRepo()).findByBuyerWs(wsId);
  const rfps = filterRfps(allRfps, params, now);

  // 행 클릭은 딜룸 모달(인터셉트 라우트)을 띄운다 — 과거 ?peek 사이드 패널은 제거됨.
  const listContent =
    rfps.length === 0 ? (
      <div className="space-y-4 px-6 pt-4">
        <EmptyState
          icon={<FileTextIcon size={32} />}
          title="아직 보낸 견적 요청이 없어요."
          description="필터를 바꾸거나 첫 견적 요청을 보내보세요."
        />
      </div>
    ) : (
      <RfpListTable rfps={rfps} />
    );

  return (
    <>
      <PageHeader title="견적 요청" count={rfps.length} action={newRfpAction} />
      <div className="border-b border-[var(--md-sys-color-outline-variant)] px-6 py-2">
        <BoardFilterBar statusOptions={STATUS_OPTIONS} gradeOptions={GRADE_OPTIONS} />
      </div>
      {listContent}
    </>
  );
}
