'use client';

/**
 * TeamThreadView — RFP 팀 채팅(내부 메모) 스레드.
 *
 * ThreadView 와 동일한 시각 언어(말풍선 12px radius·13px 본문·5분 그룹핑·중앙
 * 날짜 구분선·.md-numeric 타임스탬프)를 따르되 표면은 의도적으로 작다:
 * 메시지 + PDF·이미지 첨부 — 타이핑/프레즌스/읽음 없음 (per-bid 메모를 흡수).
 * 내부 스레드이므로 타인 메시지에 멤버 이름+아바타 헤더를 단다. ChatRail 의
 * '팀 채팅' 탭 전용.
 */
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserProfileCard } from '@/components/profile/UserProfileCard';
import { IconButton } from '@/components/primitives/IconButton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Users, Paperclip } from 'lucide-react';
import { ArrowUpIcon } from '@/components/icons';
import { ACCEPT_EXT } from '@/lib/server/storage/constants';
import { sendTeamMessageAction } from '@/lib/server/actions/chat/sendTeamMessageAction';
import { markTeamThreadReadAction } from '@/lib/server/actions/chat/markTeamThreadReadAction';
import { useMarkReadWhileVisible } from '@/lib/hooks/useMarkReadWhileVisible';
import { useOpenThreadRegistration } from '@/lib/chat/open-threads';
import { teamThreadLink } from '@/lib/chat/thread-link';
import { useTeamChannel, type TeamLivePayload } from '@/lib/hooks/useTeamChannel';
import { toast } from '@/lib/toast';
import type { TeamThreadMessage } from '@/lib/server/actions/chat/teamThreadLoader';
import { MessageBubble } from './MessageBubble';
import { ComposerAttachmentChips } from './ComposerAttachmentChips';
import { useComposerAttachments, toReadyMessageAttachments } from './useComposerAttachments';
import { useStickToBottom } from './useStickToBottom';
import { promoteSentMessage, removeMessage, applyLiveEcho } from './optimistic-thread';
import { computeMessageGrouping } from './message-grouping';
import { MorphFlightLayer } from './MorphFlightLayer';
import { useMessageMorph } from './useMessageMorph';
import { useAutoGrowTextarea } from './useAutoGrowTextarea';
import { DateDivider } from './DateDivider';
import { MentionText } from './MentionText';
import { MentionDropdown } from './MentionDropdown';
import { type MentionCandidate } from './mention-input';
import { useMentionPicker } from './useMentionPicker';

type Props = {
  rfpId: string;
  /** Centrifugo 채널 조립용 — loadTeamThread 가 반환한 세션 워크스페이스. */
  workspaceId: string;
  /** 라이브 echo 의 self 판별용 — loadTeamThread 가 반환한 세션 유저 id. */
  viewerUserId: string;
  /** 낙관적 말풍선 아바타 표시용 — loadTeamThread 가 반환한 뷰어 아바타 버전. */
  viewerAvatarUpdatedAt: string | null;
  messages: TeamThreadMessage[];
  teamMembers?: MentionCandidate[];
};


// localKey — tempId→realId 승격에도 React key·morph 타깃 매칭을 고정하는 안정 키.
type LocalMessage = TeamThreadMessage & { pending?: boolean; localKey?: string };

export function TeamThreadView({ rfpId, workspaceId, viewerUserId, viewerAvatarUpdatedAt, messages, teamMembers = [] }: Props) {
  const [draft, setDraft] = useState('');
  const {
    rows: attachments,
    setRows: setAttachments,
    addFiles,
    removeRow,
    readyRows,
    anyUploading,
  } = useComposerAttachments({ ownerKind: 'team_message', ownerId: rfpId });
  const [sending, setSending] = useState(false);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>(messages);
  const { ref: textareaRef, resize: resizeTextarea } = useAutoGrowTextarea(draft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastIsOwn = localMessages[localMessages.length - 1]?.isSelf ?? false;
  const { listRef, bottomRef } = useStickToBottom({
    count: localMessages.length,
    isOwnLast: lastIsOwn,
  });

  // 전송 morph — 입력 텍스트가 말풍선으로 변신. 측정 effect 가 자동 스크롤 뒤에
  // 실행돼야 하므로 useStickToBottom *뒤*에 선언한다(listRef 의존이 이를 강제).
  // 출발 위치는 textareaRef(입력창)를 직접 측정.
  const morph = useMessageMorph({ listRef });

  const mention = useMentionPicker({ teamMembers, viewerUserId, textareaRef, draft, setDraft });
  // 안정적 렌더러 — MessageBubble(memo)이 컴포저 입력마다 리렌더되지 않도록 ref 고정.
  const renderTeamBody = useCallback(
    (body: string) => (
      <MentionText body={body} nameById={mention.nameById} viewerUserId={viewerUserId} />
    ),
    [mention.nameById, viewerUserId],
  );

  // 스레드가 열려 보이는 동안 읽음 처리를 이어간다 — ThreadView 와 같은 훅.
  // 마운트 1회였을 때는 켜 둔 채 동료 메시지를 받으면 배지가 남았다.
  const markRead = useMarkReadWhileVisible({
    key: rfpId,
    run: (id) => void markTeamThreadReadAction({ rfpId: id }),
  });

  // 이 스레드를 보고 있는 동안에는 같은 스레드의 알림 토스트를 띄우지 않는다.
  useOpenThreadRegistration(teamThreadLink(rfpId));

  useTeamChannel(rfpId, workspaceId, {
    onMessage: (data: TeamLivePayload) => {
      if (!data.id || typeof data.body !== 'string' || !data.createdAt) return;
      const id = data.id;
      const isSelf = data.authorUserId === viewerUserId;
      // 내 echo 로는 읽음을 갱신하지 않는다 — 동료가 쓴 것만 "봤다"의 대상이다.
      if (!isSelf) markRead();
      // 재전달·승격 선행 케이스는 dedup. 본인 echo 면 tempId 로 정확 매칭 후
      // 확정 승격(append 하면 중복, 낙관적 첨부 보존), 아니면 새로 append.
      setLocalMessages(
        (prev) =>
          applyLiveEcho(prev, id, isSelf, data.createdAt as string, data.tempId as string | undefined) ?? [
            ...prev,
            {
              id,
              authorUserId: data.authorUserId ?? '',
              authorName: data.authorName ?? '',
              authorAvatarUpdatedAt: data.authorAvatarUpdatedAt ?? null,
              body: data.body as string,
              createdAt: data.createdAt as string,
              isSelf,
              attachments: data.attachments ?? [],
            },
          ],
      );
    },
  });

  async function handleSend(): Promise<void> {
    if (sending) return;
    const body = mention.resolveBody(draft).trim();
    if (body.length === 0 && readyRows.length === 0) return;
    setSending(true);

    // 전송 시점의 첨부 스냅샷(reload 불필요) — 낙관적 말풍선 표시용.
    const optimisticAttachments = toReadyMessageAttachments(attachments);

    const tempId = `pending-${Math.random().toString(36).slice(2, 10)}`;
    const restoreDraft = draft;
    const restoreAttachments = attachments;
    // morph 예약 — 텍스트가 아직 입력창에 있는 지금(append/clear 전) 출발 위치를 잰다.
    morph.scheduleFlight(textareaRef.current, tempId, body);
    setLocalMessages((prev) => [
      ...prev,
      {
        id: tempId,
        localKey: tempId,
        authorUserId: viewerUserId,
        authorName: '',
        authorAvatarUpdatedAt: viewerAvatarUpdatedAt,
        body,
        createdAt: new Date().toISOString(),
        isSelf: true,
        attachments: optimisticAttachments,
        pending: true,
      },
    ]);
    setDraft('');
    mention.reset();
    setAttachments([]);
    // 높이 리셋은 useAutoGrowTextarea 가 draft='' 효과로 처리한다.

    let result: Awaited<ReturnType<typeof sendTeamMessageAction>>;
    try {
      result = await sendTeamMessageAction({
        rfpId,
        body,
        attachmentIds: readyRows.map((a) => a.id),
        tempId,
      });
    } catch {
      result = { ok: false, error: 'NETWORK' };
    }
    setSending(false);
    if (result.ok) {
      // pending 말풍선을 확정 교체. 서버 첨부로 갈아끼우고, 라이브 echo 가 먼저
      // 같은 실제 id 를 추가했다면 임시 행은 버린다(중복 방지).
      const serverAttachments = result.attachments ?? optimisticAttachments;
      setLocalMessages((prev) =>
        promoteSentMessage(prev, tempId, result.messageId, result.createdAt, {
          attachments: serverAttachments,
        }),
      );
    } else {
      setLocalMessages((prev) => removeMessage(prev, tempId));
      morph.endFlight(tempId); // 진행 중인 morph 클론도 함께 정리(롤백된 말풍선과 짝).
      setDraft(restoreDraft);
      setAttachments(restoreAttachments);
      toast('메모를 남기지 못했어요. 다시 시도해 주세요.', { type: 'error' });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mention.onKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      // 한글 IME 조합 확정 Enter(keyCode 229)는 전송이 아니다.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      void handleSend();
    }
  }

  const canSend =
    !sending &&
    !anyUploading &&
    (draft.trim().length > 0 || readyRows.length > 0);

  // 날짜 구분선·묶음 파생 — ThreadView 와 공유하는 단일 출처(드리프트 방지).
  const grouping = computeMessageGrouping(localMessages);

  return (
    <>
    {/* data-morph-bounds — 전송 morph 클론을 가둘 경계(ThreadView 와 동일 계약).
        클론은 최상위 z 로 body 에 portal 되므로, 이 표시가 없으면 딜룸 모달 헤더 같은
        바깥 크롬 위를 가로지른다. */}
    <div data-morph-bounds className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* 말풍선 목록 */}
      <div
        ref={listRef}
        data-message-list
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {localMessages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Users strokeWidth={1.5} />}
              title="아직 팀 메시지가 없어요"
              description="우리 팀에게만 보이는 메모를 남겨보세요."
            />
          </div>
        )}
        {localMessages.map((m, i) => {
          // 날짜 구분선·묶음 판정은 computeMessageGrouping 단일 출처(ThreadView 공유).
          // 내부 스레드라 self 헤더는 숨긴다(상대 메시지에만 작성자 표시).
          const { showDivider, dayLabel, groupedWithPrev } = grouping[i];
          const showAuthorHeader = !m.isSelf && !groupedWithPrev;
          const rowKey = m.localKey ?? m.id; // 승격에도 불변(React key·morph 타깃)

          return (
            <div key={rowKey} className="flex flex-col gap-3">
              {showDivider && <DateDivider label={dayLabel} />}

              <div
                data-message-row
                data-sender={m.isSelf ? 'self' : 'other'}
                className={cn('flex flex-col gap-1', m.isSelf ? 'items-end' : 'items-start')}
              >
                {showAuthorHeader && (
                  <div className="flex items-center gap-1.5">
                    <UserProfileCard name={m.authorName} size="sm" color="surface" userId={m.authorUserId} avatarUpdatedAt={m.authorAvatarUpdatedAt} />
                    <span className="text-[12px] font-medium text-[var(--md-sys-color-on-surface)]">
                      {m.authorName}
                    </span>
                  </div>
                )}

                {/* morph 진행 중인 self 말풍선은 숨김 — 떠오르는 클론으로 대체(안착 후 복귀). */}
                <div className={cn('w-full', m.isSelf && morph.isMorphing(rowKey) && 'opacity-0')}>
                  <MessageBubble
                    isSelf={m.isSelf}
                    pending={m.pending}
                    createdAt={m.createdAt}
                    body={m.body}
                    attachments={m.attachments}
                    renderBody={renderTeamBody}
                    bubbleKey={rowKey}
                  />
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} aria-hidden />
      </div>

      {/* 첨부 칩 리스트 */}
      <ComposerAttachmentChips rows={attachments} onRemove={removeRow} />

      {/* 컴포저 — 첨부 + textarea + 보내기 */}
      <div className="shrink-0 border-t border-[var(--md-sys-color-outline-variant)] px-3 py-2">
        <div className="relative flex items-end gap-2">
          {mention.dropdownVisible && (
            <MentionDropdown
              items={mention.items}
              activeIndex={mention.activeIndex}
              duplicateNames={mention.duplicateNames}
              onPick={mention.pick}
              onHover={mention.onHover}
            />
          )}
          <IconButton
            label="파일 첨부"
            size="sm"
            variant="standard"
            className="shrink-0"
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
          {/* min-w-0 flex-1 — ThreadView 컴포저와 동일. 레일 폭에서 textarea 가 가로 공간을
              끝까지 쓰게 하고, placeholder 는 truncate 로 한 줄 유지(두 줄 잘림 방지). */}
          <div className="flex min-w-0 flex-1">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              maxLength={4000}
              placeholder="우리 팀에게만 보이는 메모를 남겨보세요…"
              onChange={(e) => {
                const value = e.target.value;
                setDraft(value);
                resizeTextarea();
                mention.onTextChange(value, e.target.selectionStart ?? value.length);
              }}
              onKeyDown={handleKeyDown}
              className="box-border max-h-40 min-h-8 w-full flex-1 resize-none rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] bg-transparent px-2.5 py-2 text-[13px] leading-4 text-[var(--md-sys-color-on-surface)] outline-none placeholder:truncate placeholder:text-[var(--md-sys-color-on-surface-variant)] focus-visible:border-[var(--md-sys-color-primary)]"
            />
          </div>
          <Button
            className="shrink-0"
            size="sm"
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-label="보내기"
          >
            <ArrowUpIcon size={16} />
            보내기
          </Button>
        </div>
      </div>
    </div>
    <MorphFlightLayer {...morph.layerProps} renderText={renderTeamBody} />
    </>
  );
}
