'use client';

import { useEffect, useState } from 'react';

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
 * Closes on backdrop click and on Escape so it behaves like every other
 * modal in the world. Body scroll is locked while open so the underlying
 * dashboard doesn't scroll behind the dialog on mobile.
 */
export function QrModal({ shortCode, collectionName, onClose, onKeepEditing }: Props) {
  const qrUrl = `${API_BASE_URL}/public/c/${encodeURIComponent(shortCode)}/qr.png`;
  const shareUrl = `${SITE_URL}/c/${shortCode}`;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked in iframes / insecure contexts; the URL is
      // still visible on screen for manual copy.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-4 py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-rule bg-paper p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2
            id="qr-modal-title"
            className="font-serif text-xl leading-snug text-ink"
          >
            {collectionName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-paper-soft hover:text-ink"
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
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Anyone with a phone can scan this.
        </p>

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

        <div className="mt-6 rounded-md border border-rule bg-paper-soft px-3 py-2 text-center">
          <code className="break-all text-sm text-ink">{shareUrl}</code>
        </div>

        <div className="mt-4 grid gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
            >
              Open
            </a>
          </div>
          {onKeepEditing ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onKeepEditing}
                className="flex-1 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
              >
                Go to dashboard
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
