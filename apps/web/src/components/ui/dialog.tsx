'use client';

/**
 * Dialog — shadcn-style wrapper around Radix's Dialog primitive. Replaces
 * the four hand-rolled modals (QrModal, AddItemModal, share-editor delete
 * confirm, share-list delete confirm) so we get focus-trap, Escape, scroll
 * lock and outside-click for free instead of re-implementing them per modal.
 *
 * Classes use our paper/ink/rule tokens (NOT shadcn's default neutral theme)
 * so the modal still looks like MyEtAl. The base layout (max-w, padding) is
 * deliberately minimal — each call site can override via `className` because
 * the modals here differ wildly (a centred QR card vs an overflow-scrolling
 * three-pane add-item flow).
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
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Center the content in the viewport. Use a wrapping flex so long
        // modals (AddItemModal) can scroll inside without breaking the
        // centring on short ones (QrModal, confirm dialogs).
        'fixed inset-0 z-50 flex items-center justify-center px-4 py-8',
        'sm:items-center',
        className,
      )}
      {...props}
    >
      {children}
      {hideCloseButton ? null : (
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            'absolute right-6 top-6 inline-flex h-8 w-8 items-center justify-center',
            'rounded-md text-ink-muted transition hover:bg-paper-soft hover:text-ink',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2',
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
