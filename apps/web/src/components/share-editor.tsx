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

const SHARE_TYPES: ShareType[] = [
  'paper',
  'collection',
  'poster',
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
  type: z.enum(['paper', 'collection', 'poster', 'grant', 'project']),
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
export function ShareEditor({ initial, id }: Props) {
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
      : [emptyItem()],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedShare, setSavedShare] = useState<ShareResponse | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  };

  /**
   * Append an item from the add-item modal. If the only existing row is the
   * blank seed (no fields filled), replace it — keeps the count honest for a
   * fresh share where the user hadn't manually touched the empty row yet.
   */
  const appendItem = (payload: AddItemPayload) => {
    setItems((prev) => {
      const draft = fromAddPayload(payload);
      const onlySeedRow =
        prev.length === 1 &&
        !prev[0].title.trim() &&
        !prev[0].doi.trim() &&
        !prev[0].scholar_url.trim() &&
        !prev[0].authors.trim() &&
        !prev[0].url.trim() &&
        !prev[0].subtitle.trim();
      return onlySeedRow ? [draft] : [...prev, draft];
    });
  };

  const removeItem = (key: string) => {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((it) => it._key !== key),
    );
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

    const parsed = shareSchema.safeParse({
      name,
      description,
      type: shareType,
      items,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
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
    };

    setSubmitting(true);
    try {
      const saved = isNew
        ? await createMutation.mutateAsync(payload)
        : await updateMutation.mutateAsync(payload);
      setSavedShare(saved);
      setShowQr(true);
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

  const closeQrAndExit = () => {
    setShowQr(false);
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <>
      <form onSubmit={handleSave} className="grid gap-6">
        {/* Name */}
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My ASMS poster"
            required
            maxLength={200}
            className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
          />
        </Field>

        {/* Description */}
        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe what people will find"
            rows={3}
            className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
          />
        </Field>

        {/* Type pills */}
        <Field label="Type">
          <div className="flex flex-wrap gap-2">
            {SHARE_TYPES.map((t) => {
              const active = shareType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setShareType(t)}
                  className={[
                    'rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition',
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
          <div className="flex items-start justify-between gap-4 rounded-md border border-rule bg-paper-soft p-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                Publish to discovery
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                Make this share discoverable in search, similar shares, and
                trending.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={publishedAt !== null}
              disabled={
                publishMutation.isPending || unpublishMutation.isPending
              }
              onClick={async () => {
                try {
                  if (publishedAt) {
                    const updated =
                      await unpublishMutation.mutateAsync();
                    setPublishedAt(updated.published_at);
                  } else {
                    const updated =
                      await publishMutation.mutateAsync();
                    setPublishedAt(updated.published_at);
                  }
                } catch (err) {
                  setError(
                    err instanceof ApiError
                      ? err.detail
                      : 'Failed to update discovery status',
                  );
                }
              }}
              className={[
                'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition disabled:opacity-60',
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

        {/* Items */}
        <div>
          <div className="flex items-end justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
              Items
            </h2>
            <button
              type="button"
              onClick={() => setShowAddItem(true)}
              className="text-sm font-medium text-accent hover:underline"
            >
              + Add item
            </button>
          </div>

          <div className="mt-3 grid gap-3">
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
                      disabled={items.length === 1}
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
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
          <Link
            href="/dashboard"
            className="text-sm text-ink-muted hover:text-ink"
          >
            ← Back to dashboard
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
              disabled={submitting}
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
          onClose={closeQrAndExit}
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
              The QR code will stop working immediately. This cannot be undone.
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs uppercase tracking-wider text-ink-muted">
        {label}
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
      className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
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
