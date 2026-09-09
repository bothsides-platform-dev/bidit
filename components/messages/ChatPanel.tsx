'use client';

/**
 * ChatPanel — 레이아웃 비종속 채팅 패널. 탭 [상대방 채팅 | 팀 채팅] + 각 페인.
 *
 * ChatRail(sticky aside, open-gate, fixedCounterparty 시드, unmount reset)이 이를
 * 감싸 상세 페이지 우측 레일로 쓰고, 견적 딜룸 모달은 우측 칼럼에 직접 마운트한다
 * (open-gate·sticky·aside 없음 — 모달 안엔 셸 스크롤 컨테이너가 없으므로 높이는
 * 부모가 준다: `h-full min-h-0`).
 *
 * 불변식(레일과 동일):
 *   - 상대방 탭은 wsId→conversationId 를 **읽기 전용** lookupConversationAction 으로
 *     해소한다. 열람만으로 대화를 생성하지 않는다(sealed-bid 관심 신호 차단) —
 *     생성은 첫 전송(sendChatMessageAction)에만 일어난다.
 *   - 팀 탭은 (rfp, 세션 워크스페이스) 내부 스레드. unmount 시 캐시 무효화.
 */
import { Suspense, useState } from 'react';
import Link from 'next/link';

import { conversationThreadLink, teamThreadLink } from '@/lib/chat/thread-link';
import { Tabs } from '@/components/primitives/Tabs';
import { IconButton } from '@/components/primitives/IconButton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Button } from '@/components/ui/button';
import { XIcon, EnvelopeIcon, ChevronRightIcon, ArrowUpIcon } from '@/components/icons';
import { sendChatMessageAction } from '@/lib/server/actions/chat/sendChatMessageAction';
import { toast } from '@/lib/toast';
import {
  useDealRoom,
  type DealRoomCounterparty,
  type DealRoomTab,
} from '@/components/deal-room/DealRoomContext';
import { ThreadPane } from './ThreadPane';
import { ThreadSkeleton } from './ThreadSkeleton';
import { TeamThreadPane } from './TeamThreadPane';
import { ChatComposerTextarea } from './ChatComposerTextarea';
import { ClosedConversationNotice } from './ClosedConversationNotice';
import type { SendDisabledReason } from './ThreadView';
import { useConversationLookup } from './useConversationLookup';

type Props = {
  /** RFP uuid (라우트 param 은 사람용 code — 혼동 주의). */
  rfpId: string;
  rfpCode: string;
  rfpTitle: string;
  /**
   * 선정이 끝나 대화를 닫아야 할 상대(워크스페이스) ID 목록. 포커스된 상대가 이
   * 목록에 있으면 상대방 채팅을 'closed' 사유로 비활성화한다(팀 채팅은 정상).
   */
  closedCounterpartyIds?: string[];
  /** 제공되면 헤더에 닫기 버튼을 렌더(레일용). 모달은 생략한다. */
  onClose?: () => void;
};

const RAIL_TABS = [
  { id: 'counterparty', label: '상대방 채팅' },
  { id: 'team', label: '팀 채팅' },
];

export function ChatPanel({
  rfpId,
  closedCounterpartyIds,
  onClose,
}: Props) {
  const { tab, counterparty, setTab } = useDealRoom();

  // wsId → conversationId 읽기 전용 해소 — 열람만으로 대화를 만들지 않는다(sealed-bid).
  // conversationId: undefined=해소 중, null=대화 없음(새 대화 컴포저), string=해소됨.
  const activeWsId = counterparty?.workspaceId;
  const { conversationId, resolveFailed, retry, markCreated } = useConversationLookup(
    activeWsId,
    tab === 'counterparty',
  );

  // 상대방 채팅 전송 차단 사유 — 선정 종료(미선정 PG). 팀 탭 무관.
  const counterpartyClosed =
    !!activeWsId && (closedCounterpartyIds?.includes(activeWsId) ?? false);
  const sendDisabledReason: SendDisabledReason | null = counterpartyClosed ? 'closed' : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--md-sys-color-surface)]">
      <div className="flex shrink-0 items-center border-b border-[var(--md-sys-color-outline-variant)] pr-1.5">
        <Tabs
          className="flex-1 border-b-0"
          tabs={RAIL_TABS}
          active={tab}
          onChange={(id) => setTab(id as DealRoomTab)}
        />
        {onClose && (
          <IconButton label="채팅 패널 닫기" size="sm" onClick={onClose}>
            <XIcon />
          </IconButton>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'counterparty' ? (
          !counterparty ? (
            <EmptyState
              icon={<EnvelopeIcon />}
              title="대화할 상대를 선택해 주세요"
              description="견적을 선택하면 해당 PG와 바로 대화할 수 있어요."
              className="py-12"
            />
          ) : resolveFailed ? (
            <EmptyState
              icon={<EnvelopeIcon />}
              title="대화를 불러오지 못했어요"
              description="네트워크 상태를 확인하고 다시 시도해 주세요."
              className="py-12"
              action={
                <Button size="sm" onClick={retry}>
                  다시 시도
                </Button>
              }
            />
          ) : conversationId === undefined ? (
            <ThreadSkeleton />
          ) : conversationId === null ? (
            <NewConversationPane
              counterparty={counterparty}
              rfpId={rfpId}
              sendDisabledReason={sendDisabledReason}
              onCreated={markCreated}
            />
          ) : (
            <>
              <div className="min-h-0 flex-1">
                <Suspense key={conversationId} fallback={<ThreadSkeleton />}>
                  <ThreadPane
                    conversationId={conversationId}
                    counterpartyFallback={counterparty}
                    variant="rail"
                    defaultRfpId={rfpId}
                    sendDisabledReason={sendDisabledReason}
                  />
                </Suspense>
              </div>
              <div className="flex shrink-0 justify-end border-t border-[var(--md-sys-color-outline-variant)] px-3 py-1.5">
                <Link
                  href={conversationThreadLink(conversationId)}
                  className="inline-flex items-center gap-0.5 text-[12px] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:text-[var(--md-sys-color-on-surface)]"
                >
                  메시지함에서 열기
                  <ChevronRightIcon size={13} />
                </Link>
              </div>
            </>
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <TeamThreadPane rfpId={rfpId} />
            </div>
            <div className="flex shrink-0 justify-end border-t border-[var(--md-sys-color-outline-variant)] px-3 py-1.5">
              <Link
                href={teamThreadLink(rfpId)}
                className="inline-flex items-center gap-0.5 text-[12px] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:text-[var(--md-sys-color-on-surface)]"
              >
                메시지함에서 열기
                <ChevronRightIcon size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 새 대화 컴포저 — 아직 페어 대화가 없는 상대용. 첫 메시지를 보내는 순간에만
 * 대화가 생성된다. 열람만으로는 어떤 행도 만들지 않는다(sealed-bid 핵심).
 */
function NewConversationPane({
  counterparty,
  rfpId,
  onCreated,
  sendDisabledReason = null,
}: {
  counterparty: DealRoomCounterparty;
  rfpId: string;
  onCreated: (wsId: string, conversationId: string) => void;
  sendDisabledReason?: SendDisabledReason | null;
}) {
  const sendDisabled = sendDisabledReason != null;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend(): Promise<void> {
    const body = draft.trim();
    if (body.length === 0 || sending || sendDisabled) return;
    setSending(true);
    let result: Awaited<ReturnType<typeof sendChatMessageAction>>;
    try {
      result = await sendChatMessageAction({
        counterpartyWorkspaceId: counterparty.workspaceId,
        body,
        rfpId,
        attachmentIds: [],
      });
    } catch {
      result = { ok: false, error: 'NETWORK' };
    }
    setSending(false);
    if (result.ok) {
      onCreated(counterparty.workspaceId, result.conversationId);
    } else {
      toast('메시지를 보내지 못했어요. 다시 시도해 주세요.', { type: 'error' });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={<EnvelopeIcon />}
          title="메시지를 보내면 대화가 시작돼요"
          description={`${counterparty.name}에 보낼 첫 메시지를 입력해 주세요.`}
          className="py-12"
        />
      </div>
      {sendDisabledReason === 'closed' && <ClosedConversationNotice />}
      <div className="shrink-0 border-t border-[var(--md-sys-color-outline-variant)] px-3 py-2">
        <div className="flex items-end gap-2">
          <ChatComposerTextarea
            value={draft}
            onChange={setDraft}
            onSubmit={() => void handleSend()}
            disabled={sendDisabled}
            placeholder="메시지를 입력하세요…"
            maxLength={4000}
            className="min-h-8 flex-1 resize-none rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] bg-transparent px-2.5 py-2 text-[13px] leading-4 text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)] focus-visible:border-[var(--md-sys-color-primary)] disabled:opacity-60"
          />
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={sendDisabled || sending || draft.trim().length === 0}
            aria-label="보내기"
          >
            <ArrowUpIcon size={16} />
            보내기
          </Button>
        </div>
      </div>
    </div>
  );
}
