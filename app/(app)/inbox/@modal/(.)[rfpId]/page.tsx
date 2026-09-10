// PG 견적 딜룸 — 인터셉트 모달(@modal 슬롯). 목록에서 /inbox/<code> 로 soft-nav
// 하면 목록 위 모달로 뜬다. 정식 페이지(app/(app)/inbox/[rfpId]/page.tsx)와 동일한
// auth·loadPgRfpDetail(markOpened 부수효과 포함)을 쓰고 MarkInboxViewed 도 함께
// 마운트해 "열람" 신호를 보존한다.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Chip } from '@/components/primitives/Chip';
import { DealRoomModal } from '@/components/deal-room/DealRoomModal';
import { DealRoomChat } from '@/components/deal-room/DealRoomChat';
import { PgDealRoomBody } from '@/components/deal-room/pg/PgDealRoomBody';
import { MarkInboxViewed } from '@/components/inbox/MarkInboxViewed';
import { loadPgRfpDetail } from '@/lib/server/rfp-detail-loader';
import { pgRequestChip } from '@/lib/rfp/rfp-status';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ rfpId: string }> };

export default async function InboxDealRoomModalPage({ params }: Props) {
  const { rfpId: rfpCode } = await params;

  const session = await auth();
  if (!session?.user?.id || !session.user.workspaceId) {
    redirect(`/login?next=/inbox/${rfpCode}`);
  }

  const data = await loadPgRfpDetail({ code: rfpCode, workspaceId: session.user.workspaceId });
  // 삭제됐거나 접근 불가한 코드 — notFound()는 모달을 넘어 목록까지 날리므로, 닫을
  // 수 있는 모달에 안내를 띄운다.
  if (!data) {
    return (
      <DealRoomModal code={rfpCode} title="견적 요청을 찾을 수 없어요">
        <div className="flex h-full items-center justify-center p-8 text-center">
          <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
            이미 삭제됐거나 접근할 수 없는 견적 요청이에요.
          </p>
        </div>
      </DealRoomModal>
    );
  }

  const chip = pgRequestChip({
    pendingRequote: !!data.pendingRequote,
    hasBid: !!data.myBid,
    awarded: data.rfp.status === 'awarded',
    awardedToMe: data.awardedToMe,
  });

  return (
    <>
      <MarkInboxViewed rfpId={rfpCode} />
      <DealRoomModal
        code={data.rfp.code}
        title={data.rfp.title}
        statusChip={<Chip label={chip.label} color={chip.color} />}
        chat={
          <DealRoomChat
            rfpId={data.rfp.id}
            rfpCode={data.rfp.code}
            rfpTitle={data.rfp.title}
            fixedCounterparty={{
              workspaceId: data.buyer.id,
              name: data.buyer.name,
              type: 'buyer',
              logoUpdatedAt: data.buyer.logoUpdatedAt,
            }}
            closedCounterpartyIds={
              data.rfp.status === 'awarded' && !data.awardedToMe
                ? [data.rfp.buyerWsId]
                : []
            }
          />
        }
      >
        <PgDealRoomBody data={data} />
      </DealRoomModal>
    </>
  );
}
