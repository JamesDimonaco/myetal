'use client';

/**
 * Dialog — shadcn-style wrapper around Radix's Dialog primitive. Replaces
 * the four hand-rolled modals (QrModal, AddItemModal, share-editor delete
 * confirm, share-list delete confirm) so we get focus-trap, Escape, scroll
 * lock and outside-click for free instead of re-implementing them per modal.
 *
 * Classes use our paper/ink/rule tokens (NOT shadcn's default neutral theme)
 * so the modal still looks like MyEtAl. `DialogContent` is the visible card
 * itself — fixed-centered, bordered, with sensible padding. Wide modals
 * (AddItemModal) override `max-w-*` and add their own inner scroll container.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { cn } from '@/lib/cn';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-ink/50', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Hide the default X button — useful when the call site renders its own. */
    hideCloseButton?: boolean;
  }
>(({ className, children, hideCloseButton, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    {/* Use a fixed full-screen flex wrapper to centre the card. This lets
        long content (AddItemModal) live inside its own scroll container
        without us having to fight `position: fixed` + `transform`. The
        wrapper itself is non-interactive — Radix's outside-click handler is
        on `Content` and fires when the user clicks outside the card. */}
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4 py-8 sm:items-center">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'pointer-events-auto relative w-full max-w-md rounded-xl border border-rule bg-paper p-6 shadow-2xl',
          'focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {hideCloseButton ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              'absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center',
              'rounded-md text-ink-muted transition hover:bg-paper-soft hover:text-ink',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
            )}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-serif text-xl leading-snug text-ink', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-ink-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
};
