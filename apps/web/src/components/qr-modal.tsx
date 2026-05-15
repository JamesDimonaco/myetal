'use client';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/lib/api';

interface Props {
  shortCode: string;
  collectionName: string;
  onClose: () => void;
  /** If provided, shows a secondary "Keep editing" button instead of only "Done → dashboard". */
  onKeepEditing?: () => void;
}

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app'
).replace(/\/$/, '');

/**
 * Centred overlay showing the QR PNG (served by the API) plus the canonical
 * share link. Mirrors the mobile QrModal's intent — celebratory, focused,
 * one-job — but stripped down to a single web-friendly card.
 *
 * Migrated from a hand-rolled `role="dialog"` div to Radix's Dialog (via our
 * shadcn-ui wrapper). Radix handles focus-trap, Escape, outside-click and
 * body scroll lock automatically, so this file no longer needs the
 * `useEffect`-driven keydown listener and `document.body.style.overflow`
 * dance it used to carry.
 */
export function QrModal({ shortCode, collectionName, onClose, onKeepEditing }: Props) {
  const qrUrl = `${API_BASE_URL}/public/c/${encodeURIComponent(shortCode)}/qr.png`;
  const shareUrl = `${SITE_URL}/c/${shortCode}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied');
    } catch {
      // Clipboard can be blocked in iframes / insecure contexts; the URL is
      // still visible on screen for manual copy.
      toast.error("Couldn't copy — copy from the field above");
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(shortCode);
      toast.success('Code copied');
    } catch {
      toast.error("Couldn't copy — copy from the field above");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="pr-8">{collectionName}</DialogTitle>
        <DialogDescription className="mt-1">
          Anyone with a phone can scan this.
        </DialogDescription>

        <div className="mt-6 flex items-center justify-center">
          <div className="rounded-lg border border-rule bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={`QR code for "${collectionName}"`}
              width={240}
              height={240}
              className="h-60 w-60"
            />
          </div>
        </div>

        {/* Short code + URL with inline copy affordances. Compact replaces
            the previous Copy code / Copy link / Open button row — the code
            and URL themselves are the click target now. */}
        <div className="mt-6 grid gap-2">
          <button
            type="button"
            onClick={handleCopyCode}
            className="group flex items-center justify-between rounded-md border border-rule bg-paper-soft px-3 py-2.5 text-left transition hover:border-ink/40"
            aria-label="Copy share code"
          >
            <span className="font-mono text-xl font-semibold tracking-wider text-ink">
              {shortCode}
            </span>
            <CopyIcon />
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="group flex items-center justify-between gap-3 rounded-md border border-rule bg-paper-soft px-3 py-2.5 text-left transition hover:border-ink/40"
            aria-label="Copy share link"
          >
            <span className="break-all text-sm text-ink-muted">
              {shareUrl}
            </span>
            <CopyIcon />
          </button>
        </div>

        {/* Primary action row. Post-save modal gets the two-CTA layout;
            quick-access (no onKeepEditing) shows a single Done button. */}
        <div className="mt-5 flex gap-2">
          {onKeepEditing ? (
            <>
              <Button
                variant="secondary"
                onClick={onKeepEditing}
                className="flex-1"
              >
                Keep editing
              </Button>
              <Button onClick={onClose} className="flex-1">
                Done
              </Button>
            </>
          ) : (
            <Button onClick={onClose} className="flex-1">
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="flex-shrink-0 text-ink-faint transition group-hover:text-ink"
    >
      <rect
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M2 7V2.5A.5.5 0 0 1 2.5 2H7"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
