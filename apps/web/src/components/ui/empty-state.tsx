import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** The one empty state: dashed box, short title, one line of help, actions. */
export function EmptyState({
  title,
  description,
  actions,
  icon,
  headingLevel: Heading = 'h2',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed border-rule px-4 py-10 text-center sm:px-8',
        className,
      )}
    >
      {icon ? <div className="mb-3 text-ink-muted">{icon}</div> : null}
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      {description ? (
        <div className="mt-2 max-w-md text-sm text-ink-muted">{description}</div>
      ) : null}
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
