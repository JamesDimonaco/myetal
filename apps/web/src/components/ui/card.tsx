import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

/**
 * The one card surface: 16px padding, rule border, soft paper fill.
 * `asChild` puts the card styles on a button or link instead of a div.
 */
export function Card({
  asChild = false,
  className,
  ...props
}: ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      className={cn('rounded-lg border border-rule bg-paper-soft p-4', className)}
      {...props}
    />
  );
}
