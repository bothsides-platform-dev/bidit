'use client';

import { Chip } from '@/components/primitives/Chip';
import { rfpStatusChip } from '@/lib/rfp/rfp-status';
import { AttachmentGalleryPanel } from './AttachmentGalleryPanel';

type RfpContext = {
  code: string;
  title: string;
  status?: string;
  deadline?: string | null;
};

type Props = {
  conversationId: string;
  rfpContext?: RfpContext;
};

function RfpContextCard({ rfpContext }: { rfpContext: RfpContext }) {
  const chip = rfpContext.status ? rfpStatusChip(rfpContext.status) : undefined;
  return (
    <section className="border-b border-[var(--md-sys-color-outline-variant)] p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--md-sys-color-on-surface-variant)]">
        견적 요청
      </p>
      <div className="rounded-[var(--md-sys-shape-small)] border border-[var(--md-sys-color-outline-variant)] p-2.5">
        <p className="md-numeric text-xs text-[var(--md-sys-color-primary)]">
          {rfpContext.code}
        </p>
        <p className="mt-1 text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
          {rfpContext.title}
        </p>
        {rfpContext.status && (
          <div className="mt-2">
            <Chip
              label={chip?.label ?? rfpContext.status}
              color={chip?.color ?? 'surface'}
            />
          </div>
        )}
        {rfpContext.deadline && (
          <p className="mt-1.5 text-xs text-[var(--md-sys-color-on-surface-variant)]">
            마감{' '}
            <span className="md-numeric">
              {new Date(rfpContext.deadline).toLocaleDateString('ko-KR', {
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

export function ContextPanel({ conversationId, rfpContext }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {rfpContext && <RfpContextCard rfpContext={rfpContext} />}
      <section className="flex-1 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--md-sys-color-on-surface-variant)]">
          공유 파일
        </p>
        <AttachmentGalleryPanel conversationId={conversationId} />
      </section>
    </div>
  );
}
