'use client';

import { WorkspaceAvatar } from '@/components/primitives/WorkspaceAvatar';
import { useWorkspacePresence } from '@/components/presence/WorkspacePresenceProvider';
import { PresenceDot } from '@/components/presence/PresenceDot';

type Props = {
  name: string;
  workspaceId: string;
  logoUpdatedAt: string | null;
  size?: 'sm' | 'md';
};

/**
 * WorkspaceAvatar wrapped in a `relative` container with a live PresenceDot
 * driven by `useWorkspacePresence`. Shared by ConversationList and
 * RecentMessagesPanel to avoid duplicating the avatar+dot markup.
 */
export function AvatarWithPresence({ name, workspaceId, logoUpdatedAt, size = 'md' }: Props) {
  const { online } = useWorkspacePresence(workspaceId);
  return (
    <div className="relative shrink-0">
      <WorkspaceAvatar name={name} workspaceId={workspaceId} logoUpdatedAt={logoUpdatedAt} size={size} />
      <PresenceDot activity={online ? 'active' : 'offline'} />
    </div>
  );
}
