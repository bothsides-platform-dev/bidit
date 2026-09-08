'use client';

import { memo, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatTime } from './format';
import { MessageAttachmentGrid } from './MessageAttachmentGrid';

type Attachments = ComponentProps<typeof MessageAttachmentGrid>['attachments'];

// 말풍선 표면(배경·여백·모양·최대폭). pending(전송 중)은 살짝 투명.
function bubbleSurfaceClass(isSelf: boolean, pending = false): string {
  return cn(
    'max-w-[78%] whitespace-pre-wrap break-words rounded-[var(--md-sys-shape-medium)] px-3 py-2 text-[13px] leading-relaxed',
    isSelf
      ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
      : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)]',
    pending && 'opacity-60',
  );
}

// 메시지 말풍선 행(상대방·팀 채팅 공용) — 좌우 정렬 + 말풍선 + 첨부 + 타임스탬프/전송중 점.
// 본문은 renderBody 슬롯으로 주입한다(ThreadView=URL 자동링크, TeamThreadView=MentionText).
// 발신자 헤더·날짜 구분선·rfp 칩·읽음 표시 등 화면별 요소는 호출처가 이 컴포넌트 밖에서 그린다.
//
// React.memo — 컴포저 입력(draft) 변경마다 메시지 리스트 전체가 리렌더되지 않도록 한다.
// 이게 성립하려면 renderBody 가 안정적이어야 한다(모듈 레벨 함수 또는 useCallback) — 호출처가
// 보장한다. attachments/body/createdAt/isSelf/pending 은 메시지 객체에서 파생돼 메시지가
// 바뀌지 않는 한 안정적이다.
export const MessageBubble = memo(function MessageBubble({
  isSelf,
  pending = false,
  createdAt,
  body,
  attachments,
  renderBody,
}: {
  isSelf: boolean;
  pending?: boolean;
  createdAt: string;
  body: string;
  attachments: Attachments;
  renderBody: (body: string) => ReactNode;
}) {
  return (
    <div className={cn('flex w-full items-end gap-1.5', isSelf && 'flex-row-reverse')}>
      <div className={bubbleSurfaceClass(isSelf, pending)}>
        {renderBody(body)}
        {attachments.length > 0 && <MessageAttachmentGrid attachments={attachments} />}
      </div>
      {pending ? (
        <span
          aria-label="전송 중"
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--md-sys-color-on-surface-variant)]"
        />
      ) : (
        <span className="md-numeric shrink-0 text-xs text-[var(--md-sys-color-on-surface-variant)]">
          {formatTime(createdAt)}
        </span>
      )}
    </div>
  );
});
