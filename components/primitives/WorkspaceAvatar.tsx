'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getWorkspaceInitials, getWorkspaceColor } from '@/lib/utils/workspace-avatar';

type Props = {
  name: string;
  size?: 'sm' | 'md';
  workspaceId?: string;
  /**
   * 로고 버전(ISO). 있으면 사진 + ?v 캐시 버스트, null 이면 이니셜.
   * **필수다** — optional 이면 배선을 잊어도 이니셜이 정상처럼 보여 누락이 드러나지 않는다.
   */
  logoUpdatedAt: string | null;
  className?: string;
};

const sizeMap = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-7 h-7 text-xs',
};

const imgSizeMap = {
  sm: 'w-6 h-6',
  md: 'w-7 h-7',
};

export function WorkspaceAvatar({ name, size = 'sm', workspaceId, logoUpdatedAt, className }: Props) {
  const [imgError, setImgError] = useState(false);
  const [prevLogoUpdatedAt, setPrevLogoUpdatedAt] = useState(logoUpdatedAt);
  // 로고 버전이 바뀌면 렌더 중 imgError 동기 리셋(React derived-state 패턴).
  if (logoUpdatedAt !== prevLogoUpdatedAt) {
    setPrevLogoUpdatedAt(logoUpdatedAt);
    setImgError(false);
  }

  if (logoUpdatedAt && workspaceId && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- bytes served from our own API route; no external domain needed
      <img
        src={`/api/workspace/${workspaceId}/avatar?v=${Date.parse(logoUpdatedAt)}`}
        alt={name}
        role="img"
        onError={() => setImgError(true)}
        className={cn(
          'inline-block shrink-0 object-cover',
          'rounded-[var(--md-sys-shape-extra-small)]',
          imgSizeMap[size],
          className,
        )}
      />
    );
  }

  const initials = getWorkspaceInitials(name);
  const color = getWorkspaceColor(name);
  return (
    <div
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex items-center justify-center shrink-0',
        'rounded-[var(--md-sys-shape-extra-small)]',
        'font-[number:var(--md-typescale-label-large-weight)] select-none',
        sizeMap[size],
        className,
      )}
      style={{ background: color.bg, color: color.fg }}
    >
      {initials}
    </div>
  );
}
