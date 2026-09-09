import { cn } from '@/lib/utils';

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-20 text-center px-6', className)}>
      {icon && (
        <div className="[&_svg]:size-12 [&_svg]:stroke-[1.5px] text-[var(--md-sys-color-on-surface-variant)]">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-[length:var(--md-typescale-title-large-size)] font-[number:var(--md-typescale-title-large-weight)] text-[var(--md-sys-color-on-surface)]">
          {title}
        </p>
        {description && (
          <p className="text-[length:var(--md-typescale-body-medium-size)] text-[var(--md-sys-color-on-surface-variant)] max-w-sm">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
