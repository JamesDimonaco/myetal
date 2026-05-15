'use client';

import { useState } from 'react';

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
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard can be blocked in iframes / insecure contexts; the URL is
      // still visible on screen for manual copy.
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(shortCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Same fallback — the code is visible on screen.
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

        {/* Short code + URL */}
        <div className="mt-6 rounded-md border border-rule bg-paper-soft px-3 py-3 text-center">
          <p className="font-mono text-2xl font-semibold tracking-wider text-ink">
            {shortCode}
          </p>
          <p className="mt-1 break-all text-sm text-ink-muted">{shareUrl}</p>
        </div>

        <div className="mt-4 grid gap-2">
          <div className="flex gap-2">
            <Button onClick={handleCopyCode} className="flex-1">
              {copiedCode ? 'Copied!' : 'Copy code'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleCopyLink}
              className="flex-1"
            >
              {copiedLink ? 'Copied!' : 'Copy link'}
            </Button>
            <Button variant="secondary" asChild>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            </Button>
          </div>
          {onKeepEditing ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={onKeepEditing}
                className="flex-1"
              >
                Keep editing
              </Button>
              <Button
                variant="secondary"
                onClick={onClose}
                className="flex-1"
              >
                Go to dashboard
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
