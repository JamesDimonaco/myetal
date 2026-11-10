import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The one page title style. Detail pages pass `back`, which sits above the
 * eyebrow and title. `actions` (e.g. a primary button) sit to the right on
 * wide screens and wrap below on phones.
 */
export function PageHeader({
  back,
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  back?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-8', className)}>
      {back ? <div className="mb-4">{back}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 font-mono text-sm text-ink-muted">{eyebrow}</p>
          ) : null}
          <h1 className="break-words font-serif text-3xl leading-tight tracking-tight text-ink sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <div className="mt-2 text-base text-ink-muted">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

export function BackLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        'inline-flex min-h-11 items-center gap-1 text-sm text-ink-muted transition hover:text-ink sm:min-h-8',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">&larr;</span> {children}
    </Link>
  );
}

/** The one section heading style: 18px semibold, sentence case. */
export function SectionHeading({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-lg font-semibold text-ink', className)} {...props} />;
}
