import { Suspense } from 'react';
import { requirePgPage } from '@/lib/auth/page-guards';
import { loadPgInboxData, pgInboxDataToRows } from '@/lib/server/board/pgInbox';
import { MERCHANT_TIER_LABELS } from '@/lib/types/bid';
import { InboxList, InboxListSkeleton } from '@/components/inbox/InboxList';
import { BoardFilterBar } from '@/components/board/BoardFilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { EmptyState } from '@/components/primitives/EmptyState';
import { InboxIcon } from '@/components/icons';
import {
  filterInboxRows,
  type BoardFilterParams,
} from '@/lib/server/board/filterRfps';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'new', label: '신규' },
  { value: 'submitted', label: '견적 보냄' },
  { value: 'closed', label: '마감' },
];
const GRADE_OPTIONS = Object.entries(MERCHANT_TIER_LABELS).map(([value, label]) => ({ value, label }));

type Props = {
  searchParams: Promise<BoardFilterParams>;
};

export default async function InboxPage({ searchParams }: Props) {
  const session = await requirePgPage('/inbox');

  const sp = await searchParams;

  return (
    <div className="flex flex-col h-full">
      <Suspense
        fallback={
          <>
            <PageHeader title="받은 견적 요청" />
            <InboxListSkeleton />
          </>
        }
      >
        <InboxListPageLoader wsId={session.user.workspaceId} params={sp} />
      </Suspense>
    </div>
  );
}

async function InboxListPageLoader({
  wsId,
  params,
}: {
  wsId: string;
  params: BoardFilterParams;
}) {
  const now = new Date();
  // 3-쿼리 조립의 단일 출처 — 목록 행과 대시보드가 같은 분류 데이터를 소비한다.
  const pgData = await loadPgInboxData(wsId);
  const allRows = pgInboxDataToRows(pgData);
  const rows = filterInboxRows(allRows, params, now);

  // 행 클릭은 딜룸 모달(인터셉트 라우트)을 띄운다 — 과거 ?peek 사이드 패널은 제거됨.
  const listContent =
    rows.length === 0 ? (
      <div className="space-y-4 px-6 pt-4">
        <EmptyState
          icon={<InboxIcon size={32} />}
          title="아직 받은 견적 요청이 없어요."
          description="필터를 바꾸면 견적 요청을 볼 수 있어요. 구매사가 초대한 견적 요청이 여기에 표시돼요."
        />
      </div>
    ) : (
      <InboxList rows={rows} />
    );

  return (
    <>
      <PageHeader title="받은 견적 요청" count={rows.length} />
      <div className="border-b border-[var(--md-sys-color-outline-variant)] px-6 py-2">
        <BoardFilterBar statusOptions={STATUS_OPTIONS} gradeOptions={GRADE_OPTIONS} />
      </div>
      {listContent}
    </>
  );
}
