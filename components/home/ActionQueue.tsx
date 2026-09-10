import Link from 'next/link';
import type { ActionGroup } from '@/lib/server/dashboard/buildDashboard';

export function ActionQueue({ groups }: { groups: ActionGroup[] }) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
            {group.label}
            <span className="md-numeric">{group.items.length}</span>
          </h3>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="-mx-3 flex items-center justify-between gap-3 border-b border-[var(--md-sys-color-outline-variant)] px-3 py-2.5 text-[14px] transition-colors hover:bg-[var(--md-sys-color-surface-container)]"
                >
                  <span className="truncate text-[var(--md-sys-color-on-surface)]">{item.title}</span>
                  <span className="md-numeric shrink-0 text-[12px] text-[var(--md-sys-color-on-surface-variant)]">{item.badge}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
