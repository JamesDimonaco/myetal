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

/** Filesystem-safe slug for the QR download filename. */
function slugForFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip combining diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'share'
  );
}

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
  const qrDownloadName = `${slugForFilename(collectionName)}-qr.png`;

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

  const handleCopyCitation = async () => {
    const md = `[${collectionName}](${shareUrl})`;
    try {
      await navigator.clipboard.writeText(md);
      toast.success('Citation copied');
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const handleNativeShare = async () => {
    // Feature-detect at click time to avoid SSR/hydration mismatch — checking
    // `'share' in navigator` at render time would either differ between server
    // and client (hydration error) or require a `useEffect` setState dance.
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      toast.error("This browser can't open the system share sheet — use one of the other options.");
      return;
    }
    try {
      await navigator.share({
        title: collectionName,
        text: `${collectionName} — myetal.app`,
        url: shareUrl,
      });
    } catch (err) {
      // User-cancelled `share()` rejects with AbortError — don't surface that
      // as a failure. Anything else is a real problem.
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Share failed');
      }
    }
  };

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    collectionName,
  )}&url=${encodeURIComponent(shareUrl)}`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(
    collectionName,
  )}&body=${encodeURIComponent(`${collectionName}\n\n${shareUrl}`)}`;

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

        {/* Quick-share toolbar. Five destinations covering the gestures users
            already know: save the QR image, hand off via the native share
            sheet, copy a markdown citation for Slack/Notion, intent links for
            X and email. The print-poster PDF (qr-poster-pdf.md) will slot in
            here as a sixth tile when the API endpoint lands. */}
        <div className="mt-6 border-t border-rule pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
            Share
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <a
              href={qrUrl}
              download={qrDownloadName}
              className={shareTileClass}
              aria-label="Download QR image"
            >
              <DownloadIcon />
              <span className="mt-1.5 text-[11px] text-ink-muted">QR image</span>
            </a>
            <button
              type="button"
              onClick={handleNativeShare}
              className={shareTileClass}
              aria-label="Open system share sheet"
            >
              <ShareIcon />
              <span className="mt-1.5 text-[11px] text-ink-muted">Share…</span>
            </button>
            <button
              type="button"
              onClick={handleCopyCitation}
              className={shareTileClass}
              aria-label="Copy markdown citation"
            >
              <CitationIcon />
              <span className="mt-1.5 text-[11px] text-ink-muted">Citation</span>
            </button>
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={shareTileClass}
              aria-label="Share on X"
            >
              <XIcon />
              <span className="mt-1.5 text-[11px] text-ink-muted">Post on X</span>
            </a>
            <a
              href={mailUrl}
              className={shareTileClass}
              aria-label="Email this share"
            >
              <MailIcon />
              <span className="mt-1.5 text-[11px] text-ink-muted">Email</span>
            </a>
          </div>
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

const shareTileClass =
  'group flex flex-col items-center justify-center rounded-md border border-rule bg-paper px-2 py-3 text-ink-muted transition hover:border-ink/30 hover:bg-paper-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2';

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

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M9 2v9m0 0l-3.5-3.5M9 11l3.5-3.5M3 13v1.5A1.5 1.5 0 0 0 4.5 16h9a1.5 1.5 0 0 0 1.5-1.5V13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M9 11.5V2.5m0 0l-3 3m3-3l3 3M3 11v3.5A1.5 1.5 0 0 0 4.5 16h9a1.5 1.5 0 0 0 1.5-1.5V11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CitationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M5 4.5h4M5 8h8M5 11.5h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2.5 2.5h11A1.5 1.5 0 0 1 15 4v8.5a1.5 1.5 0 0 1-1.5 1.5h-6L4 17v-3H2.5A1.5 1.5 0 0 1 1 12.5V4a1.5 1.5 0 0 1 1.5-1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon() {
  // Canonical X (formerly Twitter) wordmark path. Drawn at 24x24 so the
  // stroke weight reads as a brand glyph, then rendered at 16x16 to sit
  // comfortably alongside the 18x18 line icons in the same row.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect
        x="2"
        y="3.5"
        width="14"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.5 4.5l6.5 5 6.5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
