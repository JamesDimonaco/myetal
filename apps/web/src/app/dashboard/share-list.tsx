'use client';

import Link from 'next/link';
import { useState } from 'react';

import { QrModal } from '@/components/qr-modal';
import { ApiError } from '@/lib/api';
import { useDeleteShare, useShares } from '@/lib/hooks/useShares';
import type { ShareItemKind, ShareResponse } from '@/types/share';

function kindSummary(items: ShareResponse['items']): string {
  if (items.length === 0) return '0 items';
  const counts: Record<ShareItemKind, number> = { paper: 0, repo: 0, link: 0 };
  for (const it of items) {
    const k = (it.kind ?? 'paper') as ShareItemKind;
    counts[k] += 1;
  }
  // Mixed kinds → "3 papers, 1 repo". Single-kind → just "3 papers" (current
  // wording, just plural-aware) so legacy paper-only shares look unchanged.
  const parts: string[] = [];
  if (counts.paper) parts.push(`${counts.paper} ${counts.paper === 1 ? 'paper' : 'papers'}`);
  if (counts.repo) parts.push(`${counts.repo} ${counts.repo === 1 ? 'repo' : 'repos'}`);
  if (counts.link) parts.push(`${counts.link} ${counts.link === 1 ? 'link' : 'links'}`);
  return parts.join(', ');
}

function publicUrlFor(shortCode: string): string {
  // SSR has no `window`, so fall back to the canonical domain. On the client
  // we prefer the live origin so a localhost/staging dashboard copies links
  // that point to itself.
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/c/${shortCode}`;
  }
  return `https://myetal.app/c/${shortCode}`;
}

interface Props {
  initialShares: ShareResponse[];
}

/**
 * Interactive share list. Hydrated with `initialShares` from SSR so it
 * renders immediately; subsequent invalidations (after delete, or after a
 * round-trip from the editor) refetch via TanStack Query.
 *
 * Two pieces of UI state live here: which share we're showing the QR for,
 * and which share is mid-delete-confirm. Both are local-only.
 */
export function ShareList({ initialShares }: Props) {
  const { data, refetch } = useShares(initialShares);
  const deleteShare = useDeleteShare();

  const [qrTarget, setQrTarget] = useState<ShareResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShareResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyLink = async (share: ShareResponse) => {
    const url = publicUrlFor(share.short_code);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can fail in non-secure contexts. Fall back to a
      // throwaway textarea so the user still gets a copy.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore — the visual confirm below would be a lie */
      }
      ta.remove();
    }
    setCopiedId(share.id);
    setTimeout(() => {
      setCopiedId((current) => (current === share.id ? null : current));
    }, 1800);
  };

  const shares = data ?? [];

  if (shares.length === 0) {
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
      <ul className="grid gap-4 sm:grid-cols-2">
        {shares.map((share) => (
          <li
            key={share.id}
            className="flex flex-col rounded-lg border border-rule bg-paper-soft p-5"
          >
            <div className="flex-1">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                /c/{share.short_code}
              </p>
              <h3 className="mt-2 font-serif text-lg leading-snug text-ink">
                {share.name}
              </h3>
              <p className="mt-1 text-sm text-ink-muted">
                {kindSummary(share.items)}
                {share.is_public ? '' : ' · private'}
                {' · '}
                <span className="capitalize">{share.type}</span>
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQrTarget(share)}
                className="rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-soft"
              >
                Show QR
              </button>
              <button
                type="button"
                onClick={() => handleCopyLink(share)}
                aria-label={`Copy link to ${share.name}`}
                className="rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-soft"
              >
                {copiedId === share.id ? 'Copied!' : 'Copy link'}
              </button>
              <Link
                href={`/dashboard/share/${share.id}`}
                className="rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-soft"
              >
                Edit
              </Link>
              <Link
                href={`/c/${share.short_code}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-soft"
              >
                View
              </Link>
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(share);
                }}
                className="ml-auto rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-paper-soft"
              >
                Delete
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
                {deleteShare.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
