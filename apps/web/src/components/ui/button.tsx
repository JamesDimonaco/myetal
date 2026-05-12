'use client';

/**
 * Button — shadcn-style CVA button primitive, sized + variant-ed for MyEtAl's
 * paper/ink palette. We picked just the variants the app actually uses today
 * — `primary` (ink-on-paper CTA), `secondary` (paper-on-paper with rule
 * border), and `ghost` (text-only, for tertiary actions inside dialogs).
 *
 * Applied surgically on modal CTAs (QrModal, AddItemModal, share confirm
 * dialogs) so the buttons there are reach-from-one-place consistent. We
 * deliberately did NOT migrate every `<button>` in the app — that would be
 * gold-plating; most of those buttons live inside form contexts where the
 * existing classes are already correct.
 *
 * `asChild` (Radix Slot) lets us style anchors / Links with the same look —
 * e.g. the "Open" link in QrModal — without a `<button>` wrapping the `<a>`.
 */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ),
  {
    variants: {
      variant: {
        primary: 'bg-ink text-paper hover:opacity-90',
        secondary:
          'border border-rule bg-paper text-ink hover:bg-paper-soft',
        ghost: 'text-ink-muted hover:bg-paper-soft hover:text-ink',
        danger:
          'border border-danger/40 bg-danger text-paper hover:opacity-90',
      },
      size: {
        sm: 'h-9 px-3',
        md: 'h-10 px-4 py-2.5',
        icon: 'h-8 w-8 -m-1',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        // Slot composes onto an anchor / Link, so `type` only applies when
        // we're rendering a native button. Default to `button` so we don't
        // accidentally submit forms.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
