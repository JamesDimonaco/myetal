'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { QrModal } from '@/components/qr-modal';
import { TagChips } from '@/components/tag-chips';
import { ApiError } from '@/lib/api';
import { useDeleteShare, useShares } from '@/lib/hooks/useShares';
import type { ShareItemKind, ShareResponse } from '@/types/share';

function kindSummary(items: ShareResponse['items']): string {
  if (items.length === 0) return '0 items';
  const counts: Record<ShareItemKind, number> = { paper: 0, repo: 0, link: 0, pdf: 0 };
  for (const it of items) {
    const k = (it.kind ?? 'paper') as ShareItemKind;
    counts[k] += 1;
  }
  const parts: string[] = [];
  if (counts.paper) parts.push(`${counts.paper} ${counts.paper === 1 ? 'paper' : 'papers'}`);
  if (counts.repo) parts.push(`${counts.repo} ${counts.repo === 1 ? 'repo' : 'repos'}`);
  if (counts.link) parts.push(`${counts.link} ${counts.link === 1 ? 'link' : 'links'}`);
  if (counts.pdf) parts.push(`${counts.pdf} ${counts.pdf === 1 ? 'PDF' : 'PDFs'}`);
  return parts.join(', ');
}

function publicUrlFor(shortCode: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/c/${shortCode}`;
  }
  return `https://myetal.app/c/${shortCode}`;
}

/* ---- Inline SVG icons (16px) ---- */

function QrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="1" width="5" height="5" rx="0.5" />
      <rect x="10" y="1" width="5" height="5" rx="0.5" />
      <rect x="1" y="10" width="5" height="5" rx="0.5" />
      <rect x="10" y="10" width="2" height="2" rx="0.25" />
      <path d="M15 10h-2v2" />
      <path d="M13 15h2v-2" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="10" height="11" rx="1" />
      <path d="M2 11V2.5A1.5 1.5 0 0 1 3.5 1H10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
      <path d="M9 2h5v5" />
      <path d="M6 10L14 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 4h12" />
      <path d="M5.333 4V2.667A1.333 1.333 0 0 1 6.667 1.333h2.666A1.333 1.333 0 0 1 10.667 2.667V4" />
      <path d="M3.333 4l.667 9.333A1.333 1.333 0 0 0 5.333 14.667h5.334A1.333 1.333 0 0 0 12 13.333L12.667 4" />
    </svg>
  );
}

const iconBtnClass =
  'rounded-md border border-rule bg-paper p-2 text-ink-muted transition hover:bg-paper-soft hover:text-ink';

interface Props {
  initialShares: ShareResponse[];
  /** Total number of papers in the user's library — used to switch the
   *  empty-state copy when the user has papers but no shares (E3). */
  libraryCount?: number;
}

/**
 * Interactive share list. Cards are clickable (navigate to editor); action
 * buttons are icon-only with tooltips and use stopPropagation so they don't
 * trigger navigation.
 */
export function ShareList({ initialShares, libraryCount = 0 }: Props) {
  const router = useRouter();
  const { data, refetch } = useShares(initialShares);
  const deleteShare = useDeleteShare();

  const [qrTarget, setQrTarget] = useState<ShareResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShareResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyLink = async (share: ShareResponse, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = publicUrlFor(share.short_code);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setCopiedId(share.id);
    setTimeout(() => {
      setCopiedId((current) => (current === share.id ? null : current));
    }, 1800);
  };

  const allShares = data ?? [];
  // W-FIX-5 (Option B) — hide item-less shares from the listing. The PDF
  // auto-save (W1) creates an empty 'Untitled share' draft on the server the
  // moment the user opens the PDF tab; if they close the modal without
  // uploading, that draft would otherwise linger here. We don't auto-DELETE
  // it (Option A) because the user may have typed a name into the editor and
  // expect the draft to persist. The share is still reachable via its direct
  // URL — only hidden from the dashboard grid.
  const shares = allShares.filter((s) => s.items.length > 0);
  const hiddenDraftCount = allShares.length - shares.length;

  if (shares.length === 0) {
    // E5 — every share is item-less (only drafts in flight). Surface a small
    // note instead of the generic empty state, so the user understands why
    // their dashboard looks empty even though they remember starting a share.
    if (hiddenDraftCount > 0) {
      return (
        <div className="rounded-lg border border-rule bg-paper-soft p-12 text-center">
          <h2 className="font-serif text-xl text-ink">No shares yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            Drafts in progress will appear here once you add an item.
          </p>
          <Link
            href="/dashboard/share/new"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
          >
            Create a share
          </Link>
        </div>
      );
    }
    // E3 — has papers but no shares. Different copy that nudges the user
    // toward the library-driven flow rather than starting from scratch.
    if (libraryCount > 0) {
      return (
        <div className="rounded-lg border border-rule bg-paper-soft p-12 text-center">
          <h2 className="font-serif text-xl text-ink">No shares yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            You have {libraryCount}{' '}
            {libraryCount === 1 ? 'paper' : 'papers'} in your library. Click any
            to add it to a new share — that&apos;s how you get a QR code.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/library"
              className="inline-flex items-center gap-2 rounded-md border border-rule bg-paper px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
            >
              Open library
            </Link>
            <Link
              href="/dashboard/share/new"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
            >
              Create a share
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-rule bg-paper-soft p-12 text-center">
        <h2 className="font-serif text-xl text-ink">No shares yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Create your first share to generate a QR for a poster, a slide, or
          your CV page.
        </p>
        <Link
          href="/dashboard/share/new"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          Create a share
        </Link>
      </div>
    );
  }

  // E4 — drafts-only. Surface a one-liner above the grid so the owner sees
  // their work isn't yet visible in discovery / search. We use `published_at`
  // as the discoverable flag; `is_public` is the legacy "anyone-with-the-link"
  // flag and is true by default.
  const allDrafts = shares.every((s) => s.published_at === null);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteShare.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      refetch();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.detail : 'Delete failed');
    }
  };

  return (
    <>
      {allDrafts ? (
        <div
          role="status"
          className="mb-4 rounded-md border border-rule bg-paper-soft px-4 py-3 text-sm text-ink-muted"
        >
          None of your shares are listed in discovery yet. Open one and toggle{' '}
          <span className="font-medium text-ink">Publish</span> to make it
          findable.
        </div>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {shares.map((share) => (
          <li
            key={share.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/dashboard/share/${share.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                router.push(`/dashboard/share/${share.id}`);
              }
            }}
            className="flex cursor-pointer flex-col rounded-lg border border-rule bg-paper-soft p-5 transition hover:border-ink/30"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                  {share.short_code}
                </p>
                {share.published_at === null ? (
                  <span className="inline-flex items-center rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                    Unlisted
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 font-serif text-lg leading-snug text-ink">
                {share.name}
              </h3>
              <p className="mt-1 text-sm text-ink-muted">
                {kindSummary(share.items)}
                {' \u00b7 '}
                <span className="capitalize">{share.type}</span>
                {' \u00b7 '}
                {share.published_at !== null ? 'Published' : 'Unlisted'}
              </p>
              {share.tags && share.tags.length > 0 ? (
                <div className="mt-2">
                  <TagChips tags={share.tags} max={2} linkPattern="browse" />
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                title="Show QR"
                onClick={(e) => {
                  e.stopPropagation();
                  setQrTarget(share);
                }}
                className={iconBtnClass}
              >
                <QrIcon />
              </button>
              <button
                type="button"
                title={copiedId === share.id ? 'Copied!' : 'Copy link'}
                onClick={(e) => handleCopyLink(share, e)}
                className={iconBtnClass}
              >
                {copiedId === share.id ? <CheckIcon /> : <ClipboardIcon />}
              </button>
              <a
                href={`/c/${share.short_code}`}
                target="_blank"
                rel="noreferrer"
                title="View share"
                onClick={(e) => e.stopPropagation()}
                className={iconBtnClass}
              >
                <ExternalLinkIcon />
              </a>
              <button
                type="button"
                title="Delete share"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteError(null);
                  setDeleteTarget(share);
                }}
                className="ml-auto rounded-md border border-rule bg-paper p-2 text-ink-muted transition hover:bg-paper-soft hover:text-danger"
              >
                <TrashIcon />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {qrTarget ? (
        <QrModal
          shortCode={qrTarget.short_code}
          collectionName={qrTarget.name}
          onClose={() => setQrTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-rule bg-paper p-6 shadow-xl">
            <h2
              id="confirm-delete-title"
              className="font-serif text-xl text-ink"
            >
              Delete this share?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              <span className="text-ink">&quot;{deleteTarget.name}&quot;</span>{' '}
              will be removed. The QR code will stop working immediately. This
              cannot be undone.
            </p>
            {deleteError ? (
              <p className="mt-3 text-sm text-danger">{deleteError}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteShare.isPending}
                className="rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-paper-soft disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteShare.isPending}
                className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
              >
                {deleteShare.isPending ? 'Deleting\u2026' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
