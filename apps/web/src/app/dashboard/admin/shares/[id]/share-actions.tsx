'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { clientApi } from '@/lib/client-api';
import type {
  AdminActionResponse,
  AdminShareDetail,
} from '@/types/admin';

/**
 * Right-rail action panel on the share-detail page.
 *
 * Tombstone confirms via Dialog with a REQUIRED reason input — the API
 * rejects {reason:""} with a 422, but the UI gating gives admins clean
 * feedback before the round-trip. Min length matches the Pydantic
 * model: 3 characters.
 *
 * Restore / unpublish / rebuild-similar are confirm-only — they take
 * no parameters.
 */
export function ShareActions({ detail }: { detail: AdminShareDetail }) {
  const router = useRouter();
  const [active, setActive] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const isTombstoned = detail.deleted_at !== null;
  const isPublished = detail.published_at !== null && !isTombstoned;

  const run = async (kind: ActionKind) => {
    setPending(true);
    try {
      let path = `/admin/shares/${detail.id}/`;
      let json: unknown;
      switch (kind) {
        case 'tombstone':
          path += 'tombstone';
          json = { reason };
          break;
        case 'restore':
          path += 'restore';
          break;
        case 'unpublish':
          path += 'unpublish';
          break;
        case 'rebuild_similar':
          path += 'rebuild-similar';
          break;
      }
      const result = await clientApi<AdminActionResponse>(path, {
        method: 'POST',
        ...(json !== undefined ? { json } : {}),
      });
      toast.success(result.message);
      setActive(null);
      setReason('');
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Something went wrong; please retry.';
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <h2 className="text-sm font-medium text-ink">Actions</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Every action is recorded in the audit log.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActive('unpublish')}
          disabled={pending || !isPublished}
          title={!isPublished ? 'Share is not published' : undefined}
        >
          Force unpublish
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActive('rebuild_similar')}
          disabled={pending}
        >
          Rebuild similar/trending
        </Button>
        {isTombstoned ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActive('restore')}
            disabled={pending}
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setActive('tombstone')}
            disabled={pending}
          >
            Force tombstone
          </Button>
        )}
      </div>

      <ConfirmDialog
        action={active}
        detail={detail}
        reason={reason}
        onReasonChange={setReason}
        pending={pending}
        onClose={() => {
          if (pending) return;
          setActive(null);
          setReason('');
        }}
        onConfirm={() => active && run(active)}
      />
    </div>
  );
}

type ActionKind = 'tombstone' | 'restore' | 'unpublish' | 'rebuild_similar';

function ConfirmDialog({
  action,
  detail,
  reason,
  onReasonChange,
  pending,
  onClose,
  onConfirm,
}: {
  action: ActionKind | null;
  detail: AdminShareDetail;
  reason: string;
  onReasonChange: (s: string) => void;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (action === null) return null;

  const copy: Record<
    ActionKind,
    { title: string; body: string; cta: string }
  > = {
    tombstone: {
      title: 'Force tombstone?',
      body: `Mark /c/${detail.short_code} as deleted. Reason is recorded in the audit log and is required.`,
      cta: 'Tombstone',
    },
    restore: {
      title: 'Restore tombstoned share?',
      body: `Reverse the tombstone on /c/${detail.short_code}. The share will become visible to its owner again; if it was published before the tombstone, the published_at flag is preserved.`,
      cta: 'Restore',
    },
    unpublish: {
      title: 'Force unpublish?',
      body: `Drop /c/${detail.short_code} from discovery (sitemap, similar, trending) while keeping the URL alive. Use when content violates guidelines but the owner deserves a chance to fix it.`,
      cta: 'Unpublish',
    },
    rebuild_similar: {
      title: 'Recompute precompute?',
      body: `Recalculate similar-share + trending rows for /c/${detail.short_code}. Useful for debug after content changes — typically the nightly cron handles this.`,
      cta: 'Recompute',
    },
  };
  const meta = copy[action];
  const reasonValid = action !== 'tombstone' || reason.trim().length >= 3;

  return (
    <Dialog open={action !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <div className="space-y-2">
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.body}</DialogDescription>
        </div>
        {action === 'tombstone' ? (
          <div className="mt-4">
            <label className="block text-sm">
              <span className="font-medium text-ink">
                Reason <span className="text-danger">*</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                required
                minLength={3}
                maxLength={500}
                rows={3}
                placeholder="e.g. DMCA takedown 2026-05-11 — Springer Nature"
                aria-label="Tombstone reason"
                aria-describedby="tombstone-reason-hint"
                className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
              />
            </label>
            <p
              id="tombstone-reason-hint"
              className="mt-1 text-xs text-ink-faint"
            >
              3–500 characters. Stored in the audit log; visible to all
              admins.
            </p>
          </div>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={action === 'tombstone' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={pending || !reasonValid}
          >
            {pending ? 'Working…' : meta.cta}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
