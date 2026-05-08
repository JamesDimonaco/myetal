'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';

import {
  AddItemModal,
  type AddItemPayload,
} from '@/components/add-item-modal';
import { GitHubIcon } from '@/components/github-icon';
import { QrModal } from '@/components/qr-modal';
import { TagInput } from '@/components/tag-input';
import { ApiError } from '@/lib/api';
import {
  useCreateShare,
  useDeleteShare,
  usePublishShare,
  useShare,
  useUnpublishShare,
  useUpdateShare,
} from '@/lib/hooks/useShares';
import type { Paper } from '@/types/paper';
import type {
  ShareCreateInput,
  ShareItemInput,
  ShareItemKind,
  ShareResponse,
  ShareType,
} from '@/types/share';
import type { PaperOut } from '@/types/works';

const SHARE_TYPES: ShareType[] = [
  'paper',
  'collection',
  'bundle',
  'grant',
  'project',
];

// Per-kind validation. Paper only requires title. Repo and link require both
// title and a URL — that's what makes them useful as a destination.
const itemSchema = z
  .object({
    _key: z.string(),
    kind: z.enum(['paper', 'repo', 'link']),
    title: z.string().trim().min(1, 'Item title required').max(500),
    scholar_url: z.string().trim().max(2000).optional().or(z.literal('')),
    doi: z.string().trim().max(255).optional().or(z.literal('')),
    authors: z.string().trim().optional().or(z.literal('')),
    year: z
      .union([z.string().regex(/^\d{4}$/, '4-digit year'), z.literal('')])
      .optional(),
    notes: z.string().trim().optional().or(z.literal('')),
    url: z.string().trim().max(2000).optional().or(z.literal('')),
    subtitle: z.string().trim().optional().or(z.literal('')),
    image_url: z.string().trim().max(2000).optional().or(z.literal('')),
  })
  .refine((it) => it.kind === 'paper' || (it.url && it.url.length > 0), {
    message: 'URL required for repo/link items',
    path: ['url'],
  });

const shareSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(200),
  description: z.string().trim().optional().or(z.literal('')),
  type: z.enum(['paper', 'collection', 'bundle', 'grant', 'project']),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
});

interface DraftItem {
  _key: string;
  kind: ShareItemKind;
  title: string;
  scholar_url: string;
  doi: string;
  authors: string;
  year: string;
  notes: string;
  url: string;
  subtitle: string;
  image_url: string;
}

let _itemKeySeed = 0;
const newKey = () => `item_${++_itemKeySeed}_${Date.now()}`;

const emptyItem = (): DraftItem => ({
  _key: newKey(),
  kind: 'paper',
  title: '',
  scholar_url: '',
  doi: '',
  authors: '',
  year: '',
  notes: '',
  url: '',
  subtitle: '',
  image_url: '',
});

const fromResponseItem = (
  it: ShareResponse['items'][number],
): DraftItem => ({
  _key: newKey(),
  kind: it.kind ?? 'paper',
  title: it.title,
  scholar_url: it.scholar_url ?? '',
  doi: it.doi ?? '',
  authors: it.authors ?? '',
  year: it.year != null ? String(it.year) : '',
  notes: it.notes ?? '',
  url: it.url ?? '',
  subtitle: it.subtitle ?? '',
  image_url: it.image_url ?? '',
});

const fromPaper = (p: Paper): DraftItem => ({
  _key: newKey(),
  kind: 'paper',
  title: p.title,
  scholar_url: p.scholar_url ?? '',
  doi: p.doi ?? '',
  authors: p.authors ?? '',
  year: p.year != null ? String(p.year) : '',
  notes: '',
  url: '',
  subtitle: '',
  image_url: '',
});

// Seed from a library entry (PaperOut). Used when the user picks "+ New share
// with this paper" on the library Add-to-share popover — we land on the
// new-share page with the paper already filled in as the first item.
const fromPaperOut = (p: PaperOut): DraftItem => ({
  _key: newKey(),
  kind: 'paper',
  title: p.title,
  scholar_url: '',
  doi: p.doi ?? '',
  authors: p.authors ?? '',
  year: p.year != null ? String(p.year) : '',
  notes: '',
  url: p.url ?? '',
  subtitle: p.subtitle ?? '',
  image_url: p.image_url ?? '',
});

const fromAddPayload = (payload: AddItemPayload): DraftItem => {
  if (payload.kind === 'paper') return fromPaper(payload.paper);
  return {
    _key: newKey(),
    kind: payload.kind,
    title: payload.title,
    scholar_url: '',
    doi: '',
    authors: '',
    year: '',
    notes: '',
    url: payload.url,
    subtitle: payload.subtitle ?? '',
    image_url: payload.image_url ?? '',
  };
};

interface Props {
  /** Existing share — when present, the form is in edit mode. */
  initial?: ShareResponse;
  /** Share id (only used in edit mode). */
  id?: string;
  /**
   * Pre-attach a paper as the first item in CREATE mode. Used by the
   * "+ New share with this paper" path from the library Add-to-share
   * popover. Ignored in edit mode (`initial` takes precedence).
   */
  initialPaper?: PaperOut;
}

/**
 * Create / edit share form. `id` undefined → create mode (POST /shares).
 * `id` set + `initial` hydrated from SSR → edit mode (PATCH /shares/{id}).
 *
 * Form state is plain useState + zod, mirroring the mobile editor at
 * apps/mobile/app/(authed)/share/[id].tsx. Items live in a local draft array
 * so reorder/remove don't round-trip the server until Save.
 *
 * After a successful save we surface the QR via <QrModal>. Closing it bounces
 * back to /dashboard so the new share appears in the list.
 */
export function ShareEditor({ initial, id, initialPaper }: Props) {
  const router = useRouter();
  const isNew = !id;

  // Seed the TanStack cache with the SSR copy so an invalidate-after-save
  // doesn't cold-load the share. We don't read this back into local form
  // state — keeping the form decoupled from refetches avoids clobbering
  // unsaved edits.
  useShare(id, initial);
  const createMutation = useCreateShare();
  const updateMutation = useUpdateShare(id ?? '');
  const deleteMutation = useDeleteShare();
  const publishMutation = usePublishShare(id ?? '');
  const unpublishMutation = useUnpublishShare(id ?? '');

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [shareType, setShareType] = useState<ShareType>(initial?.type ?? 'paper');
  const [publishedAt, setPublishedAt] = useState<string | null>(
    initial?.published_at ?? null,
  );
  const [items, setItems] = useState<DraftItem[]>(
    initial && initial.items.length
      ? initial.items.map(fromResponseItem)
      : initialPaper && !initial
        ? [fromPaperOut(initialPaper)]
        : [],
  );
  const [tags, setTags] = useState<string[]>(
    initial?.tags?.map((t) => t.slug) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [savedShare, setSavedShare] = useState<ShareResponse | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  };

  /** Append an item from the add-item modal. */
  const appendItem = (payload: AddItemPayload) => {
    const draft = fromAddPayload(payload);
    setItems((prev) => [...prev, draft]);
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((it) => it._key !== key));
  };

  const moveItem = (key: string, direction: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it._key === key);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = shareSchema.safeParse({
      name,
      description,
      type: shareType,
      items,
    });
    if (!parsed.success) {
      // Map zod issues to field-level errors for inline display.
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      // Scroll error into view so the user sees what went wrong.
      setTimeout(() => {
        document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }

    const apiItems: ShareItemInput[] = parsed.data.items.map((it) => ({
      kind: it.kind,
      title: it.title,
      scholar_url: it.scholar_url ? it.scholar_url : null,
      doi: it.doi ? it.doi : null,
      authors: it.authors ? it.authors : null,
      year: it.year ? Number(it.year) : null,
      notes: it.notes ? it.notes : null,
      url: it.url ? it.url : null,
      subtitle: it.subtitle ? it.subtitle : null,
      image_url: it.image_url ? it.image_url : null,
    }));

    const payload: ShareCreateInput = {
      name: parsed.data.name,
      description: parsed.data.description ? parsed.data.description : null,
      type: parsed.data.type,
      items: apiItems,
      tags,
    };

    setSubmitting(true);
    try {
      const saved = isNew
        ? await createMutation.mutateAsync(payload)
        : await updateMutation.mutateAsync(payload);
      setSavedShare(saved);
      setShowQr(true);
      // Flash a brief "saved" confirmation that persists after QR closes.
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!id || isNew) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync(id);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Delete failed');
      setConfirmingDelete(false);
    }
  };

  const closeQrAndGoToDashboard = () => {
    setShowQr(false);
    router.push('/dashboard');
    router.refresh();
  };

  const closeQrAndKeepEditing = () => {
    setShowQr(false);
    // If this was a new share, navigate to the edit URL so refreshing
    // the browser doesn't land on /share/new again.
    if (isNew && savedShare) {
      router.replace(`/dashboard/share/${savedShare.id}`);
    }
  };

  return (
    <>
      {/* Success toast — shown briefly after save */}
      {justSaved && !showQr ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Share saved successfully.</span>
        </div>
      ) : null}

      <form onSubmit={handleSave} className="grid gap-6">
        {/* Name */}
        <Field label="Name" hint={`${name.length}/200`}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My ASMS 2026 bundle"
            required
            maxLength={200}
            className={[
              'rounded-md border bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent',
              fieldErrors['name'] ? 'border-danger' : 'border-rule',
            ].join(' ')}
          />
          {fieldErrors['name'] ? (
            <span className="text-xs text-danger">{fieldErrors['name']}</span>
          ) : null}
        </Field>

        {/* Description */}
        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe what people will find when they scan your QR code"
            rows={3}
            className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
          />
        </Field>

        {/* Tags — topical labels, max 5 (Q10). Slugs only on the wire. */}
        <Field
          label="Tags (optional)"
          hint="What topics? E.g. virology, microbiome"
        >
          <TagInput value={tags} onChange={setTags} />
        </Field>

        {/* Type pills */}
        <Field label="Type" hint="What kind of content is this?">
          <div className="flex flex-wrap gap-2">
            {SHARE_TYPES.map((t) => {
              const active = shareType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setShareType(t)}
                  className={[
                    'rounded-full border px-4 py-2 text-sm font-medium capitalize transition',
                    active
                      ? 'border-ink bg-ink text-paper'
                      : 'border-rule bg-paper text-ink hover:bg-paper-soft',
                  ].join(' ')}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Publish to discovery toggle — only shown for existing shares */}
        {!isNew ? (
          <div
            className={[
              'flex items-start justify-between gap-4 rounded-md border p-4 transition-colors',
              publishedAt
                ? 'border-accent bg-accent-soft'
                : 'border-rule bg-paper-soft',
            ].join(' ')}
          >
            <div>
              <p className="text-sm font-semibold text-ink">
                {publishedAt ? 'Published' : 'Publish to discovery'}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {publishedAt
                  ? 'Visible in search, similar shares, and Google.'
                  : 'Make this share searchable and visible on Google.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={publishedAt !== null}
              onClick={() => {
                // Optimistic update — toggle immediately, revert on error
                const previousValue = publishedAt;
                const newValue = publishedAt
                  ? null
                  : new Date().toISOString();
                setPublishedAt(newValue);

                const mutation = newValue
                  ? publishMutation
                  : unpublishMutation;
                mutation.mutateAsync().then(
                  () => {
                    // Optimistic value is already correct
                  },
                  (err) => {
                    setPublishedAt(previousValue);
                    setError(
                      err instanceof ApiError
                        ? err.detail
                        : 'Failed to update discovery status',
                    );
                  },
                );
              }}
              className={[
                'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition',
                publishedAt ? 'bg-accent' : 'bg-ink-faint',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-5 w-5 transform rounded-full bg-paper shadow transition',
                  publishedAt ? 'translate-x-5' : 'translate-x-0.5',
                ].join(' ')}
              />
            </button>
          </div>
        ) : null}

        {/* Quick-access QR button — edit mode only, lets you view the QR
            without re-saving. */}
        {!isNew && initial ? (
          <div className="flex items-center gap-3 rounded-md border border-rule bg-paper-soft p-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">QR Code</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                View or share the QR code for this share.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSavedShare(initial);
                setShowQr(true);
              }}
              className="rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
            >
              Show QR
            </button>
          </div>
        ) : null}

        {/* Items */}
        <div>
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
                Items
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                {items.length} {items.length === 1 ? 'item' : 'items'} -- use the arrows to reorder
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddItem(true)}
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper px-3 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add item
            </button>
          </div>

          {fieldErrors['items'] ? (
            <p className="mt-2 text-xs text-danger">{fieldErrors['items']}</p>
          ) : null}

          <div className="mt-3 grid gap-3">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-rule py-12 text-ink-muted">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="text-sm font-medium text-ink">No items yet</p>
                <p className="text-xs text-ink-faint">
                  Add papers, repos, or links to include in this share.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddItem(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Add item
                </button>
              </div>
            ) : null}

            {items.map((it, idx) => (
              <div
                key={it._key}
                className="rounded-md border border-rule bg-paper-soft p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
                      #{idx + 1}
                    </span>
                    <KindBadge kind={it.kind} />
                  </div>
                  <div className="flex items-center gap-1">
                    <IconBtn
                      label="Move up"
                      disabled={idx === 0}
                      onClick={() => moveItem(it._key, -1)}
                    >
                      <ArrowIcon direction="up" />
                    </IconBtn>
                    <IconBtn
                      label="Move down"
                      disabled={idx === items.length - 1}
                      onClick={() => moveItem(it._key, 1)}
                    >
                      <ArrowIcon direction="down" />
                    </IconBtn>
                    <IconBtn
                      label="Remove item"
                      onClick={() => removeItem(it._key)}
                    >
                      <TrashIcon />
                    </IconBtn>
                  </div>
                </div>

                <div className="mt-3 grid gap-3">
                  {it.kind === 'paper' ? (
                    <PaperFields item={it} onChange={(p) => updateItem(it._key, p)} />
                  ) : it.kind === 'repo' ? (
                    <RepoFields item={it} onChange={(p) => updateItem(it._key, p)} />
                  ) : (
                    <LinkFields item={it} onChange={(p) => updateItem(it._key, p)} />
                  )}
                  <ItemField
                    label="Notes"
                    value={it.notes}
                    onChange={(v) => updateItem(it._key, { notes: v })}
                    placeholder="Why this matters"
                    multiline
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-4 py-3" role="alert">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-0.5 flex-shrink-0 text-danger">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-danger">
              {error}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-ink-muted transition hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to dashboard
          </Link>
          <div className="flex gap-3">
            {!isNew ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-danger transition hover:bg-paper-soft"
              >
                Delete share
              </button>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? 'Saving…'
                : isNew
                  ? 'Create share'
                  : 'Save changes'}
            </button>
          </div>
        </div>
      </form>

      {showAddItem ? (
        <AddItemModal
          onClose={() => setShowAddItem(false)}
          onPick={(payload) => {
            appendItem(payload);
            setShowAddItem(false);
          }}
        />
      ) : null}

      {savedShare && showQr ? (
        <QrModal
          shortCode={savedShare.short_code}
          collectionName={savedShare.name}
          onClose={closeQrAndGoToDashboard}
          onKeepEditing={closeQrAndKeepEditing}
        />
      ) : null}

      {confirmingDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmingDelete(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-rule bg-paper p-6 shadow-xl">
            <h3 className="font-serif text-xl text-ink">Delete this share?</h3>
            <p className="mt-2 text-sm text-ink-muted">
              <span className="font-medium text-ink">&quot;{name}&quot;</span>{' '}
              will be permanently removed. The QR code will stop working
              immediately and anyone who scans it will see an error. This cannot
              be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-paper-soft"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// --- per-kind field groups ---

function PaperFields({
  item,
  onChange,
}: {
  item: DraftItem;
  onChange: (p: Partial<DraftItem>) => void;
}) {
  return (
    <>
      <ItemField
        label="Title"
        value={item.title}
        onChange={(v) => onChange({ title: v })}
        placeholder="Paper title"
      />
      <ItemField
        label="Scholar URL"
        value={item.scholar_url}
        onChange={(v) => onChange({ scholar_url: v })}
        placeholder="https://scholar.google.com/..."
        type="url"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ItemField
          label="DOI"
          value={item.doi}
          onChange={(v) => onChange({ doi: v })}
          placeholder="10.1000/xyz123"
        />
        <ItemField
          label="Year"
          value={item.year}
          onChange={(v) =>
            onChange({ year: v.replace(/[^0-9]/g, '').slice(0, 4) })
          }
          placeholder="2026"
          inputMode="numeric"
        />
      </div>
      <ItemField
        label="Authors"
        value={item.authors}
        onChange={(v) => onChange({ authors: v })}
        placeholder="Lovelace A, Babbage C"
      />
    </>
  );
}

function RepoFields({
  item,
  onChange,
}: {
  item: DraftItem;
  onChange: (p: Partial<DraftItem>) => void;
}) {
  return (
    <>
      <ItemField
        label="Title (owner/repo)"
        value={item.title}
        onChange={(v) => onChange({ title: v })}
        placeholder="owner/repo"
      />
      <ItemField
        label="GitHub URL"
        value={item.url}
        onChange={(v) => onChange({ url: v })}
        placeholder="https://github.com/owner/repo"
        type="url"
      />
      <ItemField
        label="Description"
        value={item.subtitle}
        onChange={(v) => onChange({ subtitle: v })}
        placeholder="One-liner from the repo's About"
      />
      <ItemField
        label="Image URL"
        value={item.image_url}
        onChange={(v) => onChange({ image_url: v })}
        placeholder="https://avatars.githubusercontent.com/..."
        type="url"
      />
    </>
  );
}

function LinkFields({
  item,
  onChange,
}: {
  item: DraftItem;
  onChange: (p: Partial<DraftItem>) => void;
}) {
  return (
    <>
      <ItemField
        label="Title"
        value={item.title}
        onChange={(v) => onChange({ title: v })}
        placeholder="What is this?"
      />
      <ItemField
        label="URL"
        value={item.url}
        onChange={(v) => onChange({ url: v })}
        placeholder="https://..."
        type="url"
      />
      <ItemField
        label="Description"
        value={item.subtitle}
        onChange={(v) => onChange({ subtitle: v })}
        placeholder="Optional one-liner"
      />
      <ItemField
        label="Image URL"
        value={item.image_url}
        onChange={(v) => onChange({ image_url: v })}
        placeholder="https://..."
        type="url"
      />
    </>
  );
}

function KindBadge({ kind }: { kind: ShareItemKind }) {
  if (kind === 'repo') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
        <GitHubIcon size={11} />
        Repo
      </span>
    );
  }
  if (kind === 'link') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
        Link
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
      Paper
    </span>
  );
}

// --- small presentational helpers ---

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        {hint ? (
          <span className="text-[11px] tabular-nums text-ink-faint">
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function ItemField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'url';
  inputMode?: 'numeric';
  multiline?: boolean;
}) {
  const sharedClass =
    'rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent';
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={sharedClass}
        />
      ) : (
        <input
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={sharedClass}
        />
      )}
    </label>
  );
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-muted transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ArrowIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d={direction === 'up' ? 'M3 9l4-4 4 4' : 'M3 5l4 4 4-4'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8h6l.5-8M6 6.5v3.5M8 6.5v3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
