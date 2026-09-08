'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/primitives/Chip';
import { IconButton } from '@/components/primitives/IconButton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { WorkspaceAvatar } from '@/components/primitives/WorkspaceAvatar';
import { UserProfileCard } from '@/components/profile/UserProfileCard';
import { Paperclip } from 'lucide-react';
import { PaperclipIcon, ArrowUpIcon, ArrowDownIcon, ChevronLeftIcon, CheckIcon, EnvelopeIcon } from '@/components/icons';
import { DRAFT_OWNER_ID, ACCEPT_EXT } from '@/lib/server/storage/constants';
import { sendChatMessageAction } from '@/lib/server/actions/chat/sendChatMessageAction';
import { markConversationReadAction } from '@/lib/server/actions/chat/markConversationReadAction';
import { markThreadReadLocal } from '@/lib/hooks/useNotifications';
import { useOpenThreadRegistration } from '@/lib/chat/open-threads';
import { conversationThreadLink } from '@/lib/chat/thread-link';
import { useChatChannel } from '@/lib/hooks/useChatChannel';
import { useConversationReadReceipt } from '@/lib/chat/read-state/client';
import { useWorkspacePresence } from '@/components/presence/WorkspacePresenceProvider';
import { PresenceDot } from '@/components/presence/PresenceDot';
import { toast } from '@/lib/toast';
import { COUNTERPARTY_TYPE_LABEL, type ThreadMessage } from './types';
import { TypingDots } from './TypingDots';
import { DateDivider } from './DateDivider';
import { AttachmentGalleryPanel } from './AttachmentGalleryPanel';
import { MessageBubble } from './MessageBubble';
import { ComposerAttachmentChips } from './ComposerAttachmentChips';
import { ClosedConversationNotice } from './ClosedConversationNotice';
import { ContextPanel } from './ContextPanel';
import { useComposerAttachments, toReadyMessageAttachments } from './useComposerAttachments';
import { ChatComposerTextarea } from './ChatComposerTextarea';
import { useStickToBottom } from './useStickToBottom';
import { useThreadReadTracking } from './useThreadReadTracking';
import { useStringDraft } from './useStringDraft';
import { promoteSentMessage, removeMessage, applyLiveEcho } from './optimistic-thread';
import { computeMessageGrouping } from './message-grouping';
import { MorphFlightLayer } from './MorphFlightLayer';
import { useMessageMorph } from './useMessageMorph';
import { NEW_TAB_NOTICE } from '@/lib/a11y/link-notice';

type Props = {
  conversationId: string;
  counterparty: { workspaceId: string; name: string; type: 'buyer' | 'pg'; logoUpdatedAt: string | null };
  /** 세션 사용자 — 낙관적 self 말풍선이 즉시 자기 이름을 보여줄 때 쓴다. */
  viewer: { userId: string; name: string; avatarUpdatedAt: string | null };
  messages: ThreadMessage[];
  /** rfpId(uuid) → 표시용 코드/제목. 주어진 항목만 RFP 칩을 렌더(uuid 원문 노출 금지). */
  rfpById?: Record<string, { code: string; title: string }>;
  /** 모바일 단일 컬럼에서 대화 목록으로 돌아가는 콜백(데스크톱에선 미노출). */
  onBack?: () => void;
  /**
   * 'rail' = 상세 화면 우측 채팅 레일 임베드(w-96) — w-64 사이드 갤러리가 말풍선
   * 영역을 짓누르므로 갤러리를 목록 위 오버레이로 전환한다. 기본은 'page'.
   * 'tabs' = 채팅·RFP·파일 탭 3개를 가진 풀 페이지 뷰.
   */
  variant?: 'page' | 'rail' | 'tabs';
  /** tabs 변형에서 RFP 탭에 표시할 컨텍스트 정보. */
  rfpContext?: { code: string; title: string; status?: string; deadline?: string | null };
  /** 레일 컨텍스트의 RFP — 컴포저 전송에 이 RFP 태그를 기본 적용한다. */
  defaultRfpId?: string;
  /**
   * 전송 차단(읽기 전용 컴포저) 사유 — `null`(기본) 이면 정상 입력.
   *   - 'closed': 선정이 끝난 견적의 미선정 PG(대화 종료)
   * 사유에 맞는 안내 문구를 컴포저 위에 표시한다.
   */
  sendDisabledReason?: SendDisabledReason | null;
};

/** 컴포저 전송 차단 사유 — ThreadView·ChatPanel 공용 단일 출처. */
export type SendDisabledReason = 'closed';

/** Live `message` event payload published by sendChatMessageAction. */
type LiveMessagePayload = {
  type?: string;
  id?: string;
  body?: string;
  authorWsId?: string;
  authorUserId?: string;
  authorName?: string;
  authorEmail?: string;
  authorAvatarUpdatedAt?: string | null;
  rfpId?: string | null;
  createdAt?: string;
  attachments?: { id: string; name: string; size: number; mimeType: string; url: string }[];
  [k: string]: unknown;
};

// Leading-edge throttle window for typing pings — fire immediately on the first
// keystroke, then suppress for this long. NOT a trailing debounce (which would
// only fire after the user *stops* typing — backwards for a live indicator).
const TYPING_THROTTLE_MS = 2000;



// 낙관적 전송 중에만 쓰는 표시 전용 확장 — 서버 로더 타입(ThreadMessage)에는
// pending 개념이 없으므로 클라이언트 뷰 모델로만 둔다.
// localKey — tempId→realId 승격에도 React key·morph 타깃 매칭을 고정하는 안정 키.
type LocalMessage = ThreadMessage & { pending?: boolean; localKey?: string };

// Capturing group so split keeps the URLs; matched per-part with a
// non-global test (a /g regex carries lastIndex across .test() calls).
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

/** 평문 본문 — 줄바꿈은 whitespace-pre-wrap, URL 은 자동 링크. */
function renderBody(body: string): React.ReactNode {
  const parts = body.split(URL_SPLIT);
  return parts.map((part, i) =>
    isUrl(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:opacity-80"
      >
        {part}
        <span className="sr-only">{NEW_TAB_NOTICE}</span>
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function ThreadView({
  conversationId,
  counterparty,
  viewer,
  messages,
  rfpById,
  onBack,
  variant = 'page',
  rfpContext,
  defaultRfpId,
  sendDisabledReason = null,
}: Props) {
  const sendDisabled = sendDisabledReason != null;
  // 대화별 초안 보존 — 대화 전환(remount) 시에도 작성 중이던 내용을 잃지 않는다.
  const draftKey = `chat-draft:${conversationId}`;
  const [draft, setDraft] = useStringDraft(draftKey);
  const {
    rows: attachments,
    setRows: setAttachments,
    addFiles,
    removeRow,
    readyRows,
    anyUploading,
  } = useComposerAttachments({ ownerKind: 'chat', ownerId: DRAFT_OWNER_ID });
  const [sending, setSending] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'rfp' | 'files'>('chat');

  // Local copy so live receives + optimistic sends append without a refetch.
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>(messages);
  // Track the messages prop identity to resync local state when it changes
  // (MessageInbox renders [] first, then the loaded thread for the SAME
  // conversationId — no remount). setState during render causes React to
  // restart the render immediately with no extra committed paint.
  // 리싱크 자체는 아래 morph 훅 선언 뒤에서 수행한다(clearFlights 를 함께 불러야 하고,
  // useMessageMorph 는 useStickToBottom 뒤라는 선언 순서 불변식이 있다).
  const [prevMessages, setPrevMessages] = useState<ThreadMessage[]>(messages);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentAt = useRef(0);
  // 새 메시지 append 시 하단 자동 추적. 위로 올려 과거 글 읽는 중엔 점프하지 않고
  // "새 메시지" pill 만 띄운다(useStickToBottom).
  const lastIsOwn = localMessages[localMessages.length - 1]?.sender === 'self';
  const { listRef, bottomRef, showNewMessagePill, scrollToBottom, onListScroll } =
    useStickToBottom({ count: localMessages.length, isOwnLast: lastIsOwn, withPill: true });

  // 전송 morph — 입력 텍스트가 말풍선으로 변신. 측정 effect 가 자동 스크롤 뒤에
  // 실행돼야 하므로 useStickToBottom *뒤*에 선언한다(listRef 의존이 이를 강제).
  const morph = useMessageMorph({ listRef });
  const composerRef = useRef<HTMLDivElement>(null);

  // messages prop 리싱크(위 prevMessages 선언 참조). setState during render 라 React 가
  // 추가 페인트 없이 렌더를 즉시 재시작한다. 교체된 서버 행에는 localKey 가 없어 morph
  // 타깃 키가 끊기므로, 진행 중인 클론을 함께 거둬야 실 말풍선과 겹치지 않는다
  // (clearFlights 는 비어 있으면 같은 참조를 돌려줘 렌더 중 호출해도 루프가 없다).
  if (prevMessages !== messages) {
    setPrevMessages(messages);
    setLocalMessages(messages);
    morph.clearFlights();
  }

  // Live presence — driven by WorkspacePresenceProvider (not useChatChannel).
  const { online } = useWorkspacePresence(counterparty.workspaceId);
  const readReceipt = useConversationReadReceipt({
    conversationId,
    counterpartyWorkspaceId: counterparty.workspaceId,
    messages: localMessages,
  });

  // Mark-read while the thread is open and visible: clears my unread and
  // publishes a read receipt to the counterparty. Fires on open, on every
  // counterparty message that lands while visible, and once on returning from a
  // hidden tab — 예전에는 마운트 1회뿐이라 대화창을 켜 둔 채 메시지를 받으면
  // 배지도 읽음 영수증도 그대로였다(VoC).
  const markRead = useThreadReadTracking({
    threadKey: conversationId,
    listRef,
    bottomRef,
    run: (id) => {
      // 서버가 같은 행을 곧바로 지우지만, 스토어는 마운트 1회만 hydrate 하므로
      // 로컬에서도 내려야 사이드바 배지가 새로고침 전에 꺼진다.
      markThreadReadLocal(conversationThreadLink(id));
      void markConversationReadAction({ conversationId: id });
    },
  });

  // 이 대화를 보고 있는 동안에는 같은 대화의 알림 토스트를 띄우지 않는다 —
  // 메시지는 이미 눈앞에 말풍선으로 도착한다(VoC "대화에 사용자가 있는데도 알림").
  useOpenThreadRegistration(conversationThreadLink(conversationId));

  // Live channel — graceful no-op when realtime is unconfigured (dev/tests):
  // typingUserIds empty, onMessage/onRead never fire, and the thread runs
  // entirely off the static loader + optimistic local append.
  const { typingUserIds, sendTyping, connected } = useChatChannel(conversationId, {
    onMessage: (data: LiveMessagePayload) => {
      if (!data.id || typeof data.body !== 'string' || !data.createdAt) return;
      const id = data.id;
      const sender: ThreadMessage['sender'] =
        data.authorWsId === counterparty.workspaceId ? 'other' : 'self';
      // 내 echo 로는 읽음을 갱신하지 않는다 — 상대가 보낸 것만 "봤다"의 대상이다.
      if (sender === 'other') markRead();
      // Centrifugo recovery can redeliver, and handleSend may have already
      // promoted the pending bubble to this id → dedup. 본인 echo 면 tempId 로
      // 정확 매칭 후 확정 승격(append 하면 중복), 아니면 새로 append.
      setLocalMessages(
        (prev) =>
          applyLiveEcho(prev, id, sender === 'self', data.createdAt as string, data.tempId as string | undefined) ?? [
            ...prev,
            {
              id,
              authorUserId: data.authorUserId ?? '',
              authorName: data.authorName ?? '',
              authorEmail: data.authorEmail ?? '',
              authorAvatarUpdatedAt: data.authorAvatarUpdatedAt ?? null,
              sender,
              body: data.body as string,
              rfpId: data.rfpId ?? null,
              createdAt: data.createdAt as string,
              readByCounterparty: false,
              attachments: data.attachments ?? [],
            },
          ],
      );
    },
    onRead: readReceipt.accept,
  });

  const totalAttachmentCount = useMemo(
    () => localMessages.reduce((sum, m) => sum + m.attachments.length, 0),
    [localMessages],
  );

  // 날짜 구분선·묶음 파생 — TeamThreadView 와 공유하는 단일 출처(드리프트 방지).
  const grouping = useMemo(() => computeMessageGrouping(localMessages), [localMessages]);

  async function handleSend(): Promise<void> {
    const body = draft.trim();
    if (sending || sendDisabled) return;
    // 업로드가 끝난(ready) 첨부만 전송한다 — 임시(uploading) 행의 tempId 가
    // 서버로 새지 않도록 (readyRows = useComposerAttachments 가 파생).
    if (body.length === 0 && readyRows.length === 0) return;
    setSending(true);

    // 전송 시점의 첨부를 표시용으로 스냅샷(reload 불필요).
    const optimisticAttachments = toReadyMessageAttachments(attachments);
    // 낙관적 말풍선을 *전송 전*에 'pending' 으로 올려 "전송 중"을 즉시 보여준다.
    const tempId = `pending-${Math.random().toString(36).slice(2, 10)}`;
    const restoreDraft = draft;
    const restoreAttachments = attachments;
    // morph 예약 — 텍스트가 아직 입력창에 있는 지금(append/clear 전) 출발 위치를 잰다.
    morph.scheduleFlight(composerRef.current, tempId, body);
    setLocalMessages((prev) => [
      ...prev,
      {
        id: tempId,
        localKey: tempId,
        authorUserId: viewer.userId,
        authorName: viewer.name,
        authorEmail: '',
        authorAvatarUpdatedAt: viewer.avatarUpdatedAt,
        sender: 'self',
        body,
        rfpId: defaultRfpId ?? null,
        createdAt: new Date().toISOString(),
        readByCounterparty: false,
        attachments: optimisticAttachments,
        pending: true,
      },
    ]);
    // 컴포저는 즉시 비운다(표준 메신저 동작). 실패하면 아래에서 되돌린다.
    setDraft('');
    setAttachments([]);

    let result: Awaited<ReturnType<typeof sendChatMessageAction>>;
    try {
      result = await sendChatMessageAction({
        conversationId,
        body,
        attachmentIds: readyRows.map((a) => a.id),
        rfpId: defaultRfpId,
        tempId,
      });
    } catch {
      setSending(false);
      setLocalMessages((prev) => removeMessage(prev, tempId));
      morph.endFlight(tempId); // 진행 중인 morph 클론도 함께 정리(롤백된 말풍선과 짝).
      setDraft(restoreDraft);
      setAttachments(restoreAttachments);
      toast('메시지를 보내지 못했어요. 다시 시도해 주세요.', { type: 'error' });
      return;
    }
    setSending(false);
    if (result.ok) {
      // pending 말풍선을 확정으로 교체(실서버 id + pending 해제). 라이브 echo 가
      // 먼저 같은 실제 id 를 추가했다면 임시 행은 버린다(중복 방지).
      setLocalMessages((prev) => promoteSentMessage(prev, tempId, result.messageId, result.createdAt));
    } else {
      // 실패: 낙관적 말풍선을 제거하고 입력·첨부를 복원해 다시 보낼 수 있게 한다.
      setLocalMessages((prev) => removeMessage(prev, tempId));
      morph.endFlight(tempId); // 진행 중인 morph 클론도 함께 정리(롤백된 말풍선과 짝).
      setDraft(restoreDraft);
      setAttachments(restoreAttachments);
      toast('메시지를 보내지 못했어요. 다시 시도해 주세요.', { type: 'error' });
    }
  }

  // Leading-edge throttle: ping typing on the first keystroke, then suppress
  // repeats for the window. Avoids one publish per keystroke.
  const handleTyping = useCallback((): void => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    sendTyping();
  }, [sendTyping]);

  return (
    <>
    <div className="flex h-full min-h-0 min-w-0 flex-1">
    {/* data-morph-bounds — 전송 morph 클론을 가둘 경계. 클론은 최상위 z 로 body 에
        portal 되므로(목록 overflow 회피), 이 표시가 없으면 딜룸 모달 헤더 같은 바깥
        크롬 위를 가로지른다. 출발(입력창)·도착(목록) 두 끝점을 모두 품어야 한다. */}
    <div data-morph-bounds className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* 헤더 — 상대 워크스페이스 + 타입 + 프레즌스 + 타이핑 */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--md-sys-color-outline-variant)] px-4 py-3">
        {onBack && (
          <button
            type="button"
            aria-label="대화 목록"
            onClick={onBack}
            className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--md-sys-shape-small)] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-surface-container)] md:hidden"
          >
            <ChevronLeftIcon size={18} />
          </button>
        )}
        <div className="relative">
          <WorkspaceAvatar name={counterparty.name} size="md" workspaceId={counterparty.workspaceId} logoUpdatedAt={counterparty.logoUpdatedAt} />
          <PresenceDot activity={online ? 'active' : 'offline'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">
              {counterparty.name}
            </span>
            <Chip label={COUNTERPARTY_TYPE_LABEL[counterparty.type]} color="surface" />
            {online && (
              <>
                <span aria-hidden className="text-xs text-[var(--md-sys-color-on-surface-variant)]">·</span>
                <span className="text-xs font-medium text-[var(--md-sys-color-tertiary)]">온라인</span>
              </>
            )}
          </div>
          {typingUserIds.length > 0 ? (
            <TypingDots className="mt-1" />
          ) : variant !== 'tabs' && rfpContext?.code ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--md-sys-color-on-surface-variant)]">
              <span className="md-numeric font-medium text-[var(--md-sys-color-primary)]">{rfpContext.code}</span>
              {rfpContext.title && <span className="truncate">· {rfpContext.title}</span>}
            </div>
          ) : null}
        </div>
        {variant === 'rail' && totalAttachmentCount > 0 && (
          <button
            type="button"
            onClick={() => setShowGallery((v) => !v)}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-[var(--md-sys-shape-small)] px-2 py-1 text-[12px] transition-colors',
              showGallery
                ? 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]'
                : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)]',
            )}
          >
            <PaperclipIcon size={13} />
            <span className="md-numeric">파일 {totalAttachmentCount}</span>
          </button>
        )}
        {variant === 'tabs' && (
          <div role="tablist" className="ml-auto flex items-center gap-0.5">
            {(['chat', 'rfp', 'files'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'rounded-[var(--md-sys-shape-small)] px-2.5 py-1 text-xs transition-colors',
                  activeTab === tab
                    ? 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)]'
                    : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-low)]',
                )}
              >
                {tab === 'chat' ? '채팅' : tab === 'rfp' ? 'RFP' : '파일'}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* 탭 변형: RFP 컨텍스트 패널 */}
      {variant === 'tabs' && activeTab === 'rfp' && (
        <div className="flex-1 overflow-y-auto">
          <ContextPanel conversationId={conversationId} rfpContext={rfpContext} />
        </div>
      )}

      {/* 탭 변형: 파일 패널 */}
      {variant === 'tabs' && activeTab === 'files' && (
        <div className="flex-1 overflow-y-auto p-3">
          <AttachmentGalleryPanel conversationId={conversationId} />
        </div>
      )}

      {/* 말풍선 목록 — tabs 변형에서는 채팅 탭일 때만 표시 */}
      {(variant !== 'tabs' || activeTab === 'chat') && (<>
      <div className="relative flex-1 overflow-hidden">
      <div
        ref={listRef}
        data-message-list
        onScroll={onListScroll}
        className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {localMessages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<EnvelopeIcon />}
              title="아직 주고받은 메시지가 없어요"
              description="첫 메시지를 보내 대화를 시작해보세요."
            />
          </div>
        )}
        {localMessages.map((m, i) => {
          const isSelf = m.sender === 'self';
          const rowKey = m.localKey ?? m.id; // 승격에도 불변(React key·morph 타깃)
          // 날짜 구분선·묶음 판정은 computeMessageGrouping 단일 출처(TeamThreadView 공유).
          // 양쪽(self·other) 모두 작성자 헤더를 단다 — 같은 회사라도 담당자가 다르면
          // 묶음·헤더를 분리한다(authorUserId 기준).
          const { showDivider, dayLabel, groupedWithPrev } = grouping[i];
          const showAuthorHeader = !groupedWithPrev;
          const rfp = m.rfpId ? rfpById?.[m.rfpId] : undefined;
          // Receipt only on the last self message covered by the projection.
          const showReceipt = m.id === readReceipt.receiptMessageId;

          return (
            <div key={rowKey} className="flex flex-col gap-3">
              {showDivider && <DateDivider label={dayLabel} />}

              <div
                data-message-row
                data-sender={m.sender}
                className={cn('flex flex-col gap-1', isSelf ? 'items-end' : 'items-start')}
              >
                {showAuthorHeader && (
                  <div className="flex items-center gap-1.5">
                    <UserProfileCard name={m.authorName} size="sm" color={isSelf ? 'primary' : 'surface'} userId={m.authorUserId} avatarUpdatedAt={m.authorAvatarUpdatedAt} />
                    <span
                      title={m.authorEmail || undefined}
                      className="text-[12px] font-medium text-[var(--md-sys-color-on-surface)]"
                    >
                      {m.authorName}
                    </span>
                  </div>
                )}

                {rfp && (
                  <div className="w-full">
                    <Chip
                      color="surface"
                      icon={<span className="md-numeric">{rfp.code}</span>}
                      label={rfp.title}
                      className="max-w-[78%]"
                    />
                  </div>
                )}

                {/* morph 진행 중인 self 말풍선은 숨김 — 떠오르는 클론으로 대체(안착 후 복귀). */}
                <div className={cn('w-full', isSelf && morph.isMorphing(rowKey) && 'opacity-0')}>
                  <MessageBubble
                    isSelf={isSelf}
                    pending={m.pending}
                    createdAt={m.createdAt}
                    body={m.body}
                    attachments={m.attachments}
                    renderBody={renderBody}
                    bubbleKey={rowKey}
                  />
                </div>

                {showReceipt && (
                  <span className="flex items-center gap-0.5 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                    <CheckIcon size={12} />
                    읽음
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} data-message-bottom aria-hidden />
      </div>

      {showNewMessagePill && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[var(--md-sys-shape-full)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] px-3 py-1.5 text-[12px] text-[var(--md-sys-color-on-surface)] shadow-[var(--md-sys-elevation-2)] transition-colors hover:bg-[var(--md-sys-color-surface-container-highest)]"
        >
          <ArrowDownIcon size={13} />
          새 메시지
        </button>
      )}

      {/* 레일 변형 갤러리 — w-64 사이드 패널이 좁은 레일을 짓누르므로 목록 위
          오버레이로 전환(기능 동일, 폭 손실 없음). */}
      {variant === 'rail' && showGallery && (
        <div
          data-gallery-overlay
          className="absolute inset-0 z-10 overflow-y-auto bg-[var(--md-sys-color-surface)] p-3"
        >
          <AttachmentGalleryPanel conversationId={conversationId} />
        </div>
      )}
      </div>

      {/* 연결 끊김 배너 */}
      {connected === false && (
        <div
          role="status"
          className="shrink-0 px-4 py-1.5 text-[12px] text-[var(--md-sys-color-on-surface-variant)] bg-[var(--md-sys-color-surface-container-low)] border-b border-[var(--md-sys-color-outline-variant)]"
        >
          채팅 서버와 연결이 끊겼습니다. 재연결 중…
        </div>
      )}

      {/* 첨부 칩 리스트 */}
      <ComposerAttachmentChips rows={attachments} onRemove={removeRow} />

      {/* 전송 차단 안내 — 선정 종료(미선정 PG 대화 닫힘) */}
      {sendDisabledReason === 'closed' && <ClosedConversationNotice />}

      {/* 하단 인라인 컴포저 */}
      <div className="flex shrink-0 items-end gap-2 border-t border-[var(--md-sys-color-outline-variant)] px-3 py-2">
        <IconButton
          label="파일 첨부"
          size="sm"
          variant="standard"
          className="shrink-0"
          disabled={sendDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={16} />
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_EXT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {/* composerRef — morph 출발 위치(텍스트 박스) 측정 타깃. 래퍼는 flex-1 슬롯 유지. */}
        <div ref={composerRef} className="flex min-w-0 flex-1">
          <ChatComposerTextarea
            value={draft}
            onChange={(v) => {
              setDraft(v);
              handleTyping();
            }}
            onSubmit={handleSend}
            disabled={sendDisabled}
            placeholder="메시지를 입력하세요…"
            className="max-h-40 min-h-8 box-border flex-1 resize-none rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] px-3 py-2 text-[13px] leading-4 text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)] focus-visible:border-[var(--md-sys-color-primary)] disabled:opacity-60"
          />
        </div>
        <Button
          className="shrink-0"
          onClick={handleSend}
          disabled={
            sendDisabled ||
            sending ||
            anyUploading ||
            (draft.trim().length === 0 && readyRows.length === 0)
          }
          aria-label="보내기"
        >
          <ArrowUpIcon size={16} />
          보내기
        </Button>
      </div>
      </>)}
    </div>
    </div>
    <MorphFlightLayer {...morph.layerProps} renderText={renderBody} />
    </>
  );
}
