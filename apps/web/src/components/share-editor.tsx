'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import {
  AddItemModal,
  type AddItemPayload,
} from '@/components/add-item-modal';
import { GitHubIcon } from '@/components/github-icon';
import { QrModal } from '@/components/qr-modal';
import { TagInput } from '@/components/tag-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
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
// title and a URL — that's what makes them useful as a destination. PDF items
// require `file_url` (set by the upload flow before the item lands here).
const itemSchema = z
  .object({
    _key: z.string(),
    id: z.string().optional(),
    kind: z.enum(['paper', 'repo', 'link', 'pdf']),
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
    file_url: z.string().trim().max(2000).optional().or(z.literal('')),
    thumbnail_url: z.string().trim().max(2000).optional().or(z.literal('')),
    // nonnegative (not positive) — the empty-item placeholder defaults to 0
    // for non-PDF items. Zod's `.positive()` rejects 0 with "too small;
    // expected number to be greater than zero" and the whole share fails
    // to validate. The API enforces ge=1 for real PDF uploads separately.
    file_size_bytes: z.number().int().nonnegative().optional(),
    file_mime: z.string().trim().max(64).optional().or(z.literal('')),
  })
  .refine(
    (it) => {
      if (it.kind === 'paper') return true;
      if (it.kind === 'pdf') return Boolean(it.file_url && it.file_url.length > 0);
      return Boolean(it.url && it.url.length > 0);
    },
    {
      message: 'URL required for repo/link/pdf items',
      path: ['url'],
    },
  );

const shareSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(200),
  description: z.string().trim().optional().or(z.literal('')),
  type: z.enum(['paper', 'collection', 'bundle', 'grant', 'project']),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
});

interface DraftItem {
  _key: string;
  /** Server-assigned UUID. Present for items hydrated from the response,
   *  undefined for items the user is adding fresh in this session. Round-tripped
   *  on PATCH so the backend can merge PDF rows by id (preserves the four
   *  server-managed PDF columns; client must NOT re-send those itself). */
  id?: string;
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
  /** PDF-only fields (PR-C). Empty / 0 on non-PDF items. */
  file_url: string;
  thumbnail_url: string;
  file_size_bytes: number;
  file_mime: string;
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
  file_url: '',
  thumbnail_url: '',
  file_size_bytes: 0,
  file_mime: '',
});

const fromResponseItem = (
  it: ShareResponse['items'][number],
): DraftItem => ({
  _key: newKey(),
  id: it.id,
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
  file_url: it.file_url ?? '',
  thumbnail_url: it.thumbnail_url ?? '',
  file_size_bytes: it.file_size_bytes ?? 0,
  file_mime: it.file_mime ?? '',
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
  file_url: '',
  thumbnail_url: '',
  file_size_bytes: 0,
  file_mime: '',
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
  file_url: '',
  thumbnail_url: '',
  file_size_bytes: 0,
  file_mime: '',
});

const fromAddPayload = (payload: AddItemPayload): DraftItem => {
  if (payload.kind === 'paper') return fromPaper(payload.paper);
  if (payload.kind === 'pdf') {
    // PDF upload already happened — the modal hands us the materialised URLs
    // and metadata. The editor PATCH/POST below echoes these back so the
    // ShareItem row carries kind='pdf' + the four PDF fields.
    return {
      _key: newKey(),
      kind: 'pdf',
      title: payload.title,
      scholar_url: '',
      doi: '',
      authors: '',
      year: '',
      notes: '',
      url: '',
      subtitle: '',
      image_url: '',
      file_url: payload.file_url,
      thumbnail_url: payload.thumbnail_url,
      file_size_bytes: payload.file_size_bytes,
      file_mime: payload.file_mime,
    };
  }
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
    file_url: '',
    thumbnail_url: '',
    file_size_bytes: 0,
    file_mime: '',
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

  // `effectiveId` mirrors `id` until an auto-save (W1 — PDF tab on a brand-new
  // share) creates a draft on the server, at which point we flip to PATCH mode
  // without navigating the URL. `isNew` is derived from `effectiveId` so the
  // submit button copy and POST/PATCH branching update too.
  const [effectiveId, setEffectiveId] = useState<string | undefined>(id);
  const isNew = !effectiveId;

  // Seed the TanStack cache with the SSR copy so an invalidate-after-save
  // doesn't cold-load the share. We don't read this back into local form
  // state — keeping the form decoupled from refetches avoids clobbering
  // unsaved edits.
  useShare(id, initial);
  const createMutation = useCreateShare();
  const updateMutation = useUpdateShare(effectiveId ?? '');
  const deleteMutation = useDeleteShare();
  const publishMutation = usePublishShare(effectiveId ?? '');
  const unpublishMutation = useUnpublishShare(effectiveId ?? '');

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
  // Distinguishes the post-save celebratory QR (close → dashboard) from the
  // quick-access "Show QR" button on the edit page (close → stay here).
  // Without this, closing the quick-access modal navigated the user away
  // from the share they were editing.
  const [qrMode, setQrMode] = useState<'post-save' | 'quick-access'>(
    'post-save',
  );
  const [showAddItem, setShowAddItem] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Unsaved-changes guard. `isDirty` flips true the first time any tracked
  // form field changes after mount; flips back to false on successful save
  // or explicit discard. Used by both the beforeunload listener and the
  // in-editor "Back to dashboard" confirmation.
  const [isDirty, setIsDirty] = useState(false);
  const mountedRef = useRef(false);
  const [pendingDiscardHref, setPendingDiscardHref] = useState<string | null>(
    null,
  );

  // Mark the form dirty whenever a tracked field changes (skipping the
  // initial mount-time set). The deep-equal check on items/tags isn't
  // necessary because we only flip true; a clean revert would still mark
  // dirty, but that's safer than the opposite.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setIsDirty(true);
  }, [name, description, shareType, items, tags]);

  // Browser-level guard: tab close, refresh, external nav. App-level
  // intra-MyEtAl nav is intercepted by the discard dialog below.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the custom string and show their own
      // confirmation. Setting returnValue is required for legacy support.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

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

  // dnd-kit sensors — pointer for mouse/touch, keyboard for accessibility.
  // PointerSensor's activation distance keeps the up/down icon buttons and
  // form inputs click-targets usable; a drag only kicks in once the cursor
  // has moved a few pixels.
  const dragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const fromIdx = prev.findIndex((it) => it._key === active.id);
      const toIdx = prev.findIndex((it) => it._key === over.id);
      if (fromIdx < 0 || toIdx < 0) return prev;
      return arrayMove(prev, fromIdx, toIdx);
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

    const apiItems: ShareItemInput[] = parsed.data.items.map((it) => {
      // PDF round-trip path: backend rejects `kind=pdf` from clients
      // (forgery defense). For an existing PDF row we hand the server only
      // the editable text fields plus `id`; update_share merges by id and
      // preserves the four server-managed PDF columns (file_url, etc).
      if (it.kind === 'pdf' && it.id) {
        return {
          id: it.id,
          title: it.title,
          subtitle: it.subtitle ? it.subtitle : null,
          notes: it.notes ? it.notes : null,
        };
      }
      // Non-PDF items: serialise as before. Include `id` for existing rows
      // so the server keeps a stable identity across edits.
      return {
        ...(it.id ? { id: it.id } : {}),
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
      };
    });

    const payload: ShareCreateInput = {
      name: parsed.data.name,
      description: parsed.data.description ? parsed.data.description : null,
      type: parsed.data.type,
      items: apiItems,
      tags,
    };

    setSubmitting(true);
    try {
      let saved = isNew
        ? await createMutation.mutateAsync(payload)
        : await updateMutation.mutateAsync(payload);

      // First-save auto-publish: the create endpoint produces a draft
      // (published_at = NULL), which makes both /c/{code} and the QR PNG
      // return 404 — i.e. the share's URL "doesn't exist" the moment the
      // user celebrates having saved it. Users overwhelmingly expect Save to
      // produce a live, shareable share; the discovery toggle on the edit
      // page is for opting OUT later. So when creating a new share, publish
      // it in the same flow before opening the QR modal.
      if (isNew && saved.published_at === null) {
        try {
          saved = await clientApi<typeof saved>(
            `/shares/${saved.id}/publish`,
            { method: 'POST' },
          );
        } catch (publishErr) {
          // Don't fail the whole save if publish hiccups — the share row
          // exists, the user can toggle Publish from the edit page. Surface
          // a non-fatal warning instead.
          setError(
            publishErr instanceof ApiError
              ? `Saved as draft — publish failed: ${publishErr.detail}`
              : 'Saved as draft — publish failed',
          );
        }
      }

      setSavedShare(saved);
      setQrMode('post-save');
      setShowQr(true);
      // Save succeeded — wipe the dirty flag so the discard guard doesn't
      // fire on the post-save navigation to dashboard.
      setIsDirty(false);
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
    if (!effectiveId) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync(effectiveId);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Delete failed');
      setConfirmingDelete(false);
    }
  };

  /**
   * Auto-save a draft share — invoked when the user opens the PDF tab on a
   * brand-new (unsaved) share. Backend now allows empty `items: []` saves
   * (PR-C round-2 W1), so we POST whatever the user has typed so far (or
   * sensible defaults) and flip to PATCH mode for subsequent saves.
   *
   * The URL stays at /dashboard/share/new — the editor just knows its own
   * `effectiveId` now. A "Saving draft…" indicator in the modal covers the
   * 1-2s round-trip on the Pi. If the network blips, we surface an error
   * and let the user retry; we never silently leave the picker disabled.
   *
   * Side effect: a draft share will appear in the user's dashboard immediately
   * (since the row exists server-side). That's intentional — they can come
   * back to it if they close the modal mid-flow.
   */
  const autoSaveDraft = useCallback(async (): Promise<string> => {
    if (effectiveId) return effectiveId;
    // Backend's ShareCreate requires `name` min_length=1, but at this point
    // the user has only clicked the PDF tab — they may not have typed a name
    // yet. Auto-fill 'Untitled share' so the POST doesn't 422; the user can
    // rename in the editor (manual save still enforces a non-empty name via
    // the zod schema, so they can't publish without one).
    const autoSaveName = name.trim() || 'Untitled share';
    const draft: ShareCreateInput = {
      name: autoSaveName,
      description: description.trim() ? description.trim() : null,
      type: shareType,
      items: [],
      tags,
    };
    const created = await createMutation.mutateAsync(draft);
    setEffectiveId(created.id);
    // Carry over any tags / published_at the server returned (server may
    // canonicalise tags). Items are empty so nothing to merge there.
    if (created.tags) setTags(created.tags.map((t) => t.slug));
    // Sync the URL to the new id so refresh doesn't drop the user back on a
    // fresh /share/new form. Use window.history.replaceState rather than
    // router.replace because /dashboard/share/new and /dashboard/share/[id]
    // are separate route segments in App Router — router.replace would
    // unmount the entire editor tree, including the Add Item modal the user
    // just opened. history.replaceState updates the URL bar without
    // touching React; refresh still correctly loads the [id] route.
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/dashboard/share/${created.id}`);
    }
    return created.id;
  }, [
    effectiveId,
    name,
    description,
    shareType,
    tags,
    createMutation,
    router,
  ]);

  const closeQrAndGoToDashboard = () => {
    setShowQr(false);
    router.push('/dashboard');
    router.refresh();
  };

  const closeQrAndKeepEditing = () => {
    setShowQr(false);
    // If this share was created in this session (either via the normal
    // POST path or the W1 auto-save draft), the URL is still /share/new.
    // Replace it so a refresh doesn't land back on the create page.
    if (!id && savedShare) {
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
              'min-h-[44px] rounded-md border bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent',
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
                    'inline-flex min-h-[40px] items-center rounded-full border px-4 py-2 text-sm font-medium capitalize transition',
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
                setQrMode('quick-access');
                setShowQr(true);
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
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
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-rule bg-paper px-3 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
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
                  A bundle gathers papers, repos, and PDFs behind one QR. Start
                  by adding an item.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddItem(true)}
                  className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Add item
                </button>
              </div>
            ) : null}

            <DndContext
              sensors={dragSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((it) => it._key)}
                strategy={verticalListSortingStrategy}
              >
                {items.map((it, idx) => (
                  <SortableItemRow
                    key={it._key}
                    item={it}
                    idx={idx}
                    total={items.length}
                    onMove={moveItem}
                    onRemove={removeItem}
                    onUpdate={updateItem}
                  />
                ))}
              </SortableContext>
            </DndContext>
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
            onClick={(e) => {
              // Guard against silent loss of unsaved edits. The guard is
              // intentionally NOT applied to the publish toggle, save
              // submission, delete, or the post-save QR — only this
              // explicit "leave the editor without saving" surface.
              if (isDirty) {
                e.preventDefault();
                setPendingDiscardHref('/dashboard');
              }
            }}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-ink-muted transition hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to dashboard
          </Link>
          <div className="flex flex-wrap gap-3">
            {!isNew ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-danger transition hover:bg-paper-soft"
              >
                Delete share
              </button>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
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
          shareId={effectiveId}
          onAutoSaveDraft={autoSaveDraft}
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
          onClose={
            qrMode === 'post-save'
              ? closeQrAndGoToDashboard
              : closeQrAndKeepEditing
          }
          // The secondary "Keep editing" button only makes sense on the
          // celebratory post-save modal — there's no "go to dashboard"
          // alternative to differentiate from when the user is already
          // editing.
          onKeepEditing={
            qrMode === 'post-save' ? closeQrAndKeepEditing : undefined
          }
        />
      ) : null}

      {/* Delete-confirm — migrated from hand-rolled overlay to shadcn Dialog
          so the focus-trap, Escape and outside-click logic comes from Radix
          rather than this file. */}
      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
      >
        <DialogContent hideCloseButton>
          <DialogTitle>Delete this share?</DialogTitle>
          <DialogDescription className="mt-2">
            <span className="font-medium text-ink">&quot;{name}&quot;</span>{' '}
            will be permanently removed. The QR code will stop working
            immediately and anyone who scans it will see an error. This cannot
            be undone.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discard-changes guard — fires when the user clicks an in-editor
          nav surface (today: "Back to dashboard") while `isDirty`. The
          beforeunload listener covers tab close / refresh separately. */}
      <Dialog
        open={pendingDiscardHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscardHref(null);
        }}
      >
        <DialogContent hideCloseButton>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription className="mt-2">
            You have unsaved edits on this share. Leaving now will lose them.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setPendingDiscardHref(null)}
            >
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = pendingDiscardHref;
                setIsDirty(false);
                setPendingDiscardHref(null);
                if (target) router.push(target);
              }}
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- sortable item row ---

/**
 * One row of the items list. `useSortable` wires up the drag transform
 * for dnd-kit. The drag handle is only visible on hover at sm+ widths;
 * touch devices keep the up/down arrow buttons as the reorder path.
 *
 * Extracted so we can call the hook (which can't run inside a .map).
 */
function SortableItemRow({
  item,
  idx,
  total,
  onMove,
  onRemove,
  onUpdate,
}: {
  item: DraftItem;
  idx: number;
  total: number;
  onMove: (key: string, direction: -1 | 1) => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, patch: Partial<DraftItem>) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item._key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // Lift the dragged card visually so it reads as detached.
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border border-rule bg-paper-soft p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Drag handle — sm:flex hides on phones, where arrow buttons
              and a11y keyboard sortable cover reordering instead. */}
          <button
            type="button"
            aria-label={`Drag to reorder item ${idx + 1}`}
            className="hidden h-8 w-6 cursor-grab touch-none items-center justify-center text-ink-faint transition hover:text-ink active:cursor-grabbing sm:flex"
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
          <span className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
            #{idx + 1}
          </span>
          <KindBadge kind={item.kind} />
        </div>
        <div className="flex items-center gap-1">
          <IconBtn
            label="Move up"
            disabled={idx === 0}
            onClick={() => onMove(item._key, -1)}
          >
            <ArrowIcon direction="up" />
          </IconBtn>
          <IconBtn
            label="Move down"
            disabled={idx === total - 1}
            onClick={() => onMove(item._key, 1)}
          >
            <ArrowIcon direction="down" />
          </IconBtn>
          <IconBtn label="Remove item" onClick={() => onRemove(item._key)}>
            <TrashIcon />
          </IconBtn>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {item.kind === 'paper' ? (
          <PaperFields
            item={item}
            onChange={(p) => onUpdate(item._key, p)}
          />
        ) : item.kind === 'repo' ? (
          <RepoFields item={item} onChange={(p) => onUpdate(item._key, p)} />
        ) : item.kind === 'pdf' ? (
          <PdfFields item={item} onChange={(p) => onUpdate(item._key, p)} />
        ) : (
          <LinkFields item={item} onChange={(p) => onUpdate(item._key, p)} />
        )}
        <ItemField
          label="Notes"
          value={item.notes}
          onChange={(v) => onUpdate(item._key, { notes: v })}
          placeholder="Why this matters"
          multiline
        />
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg
      width="12"
      height="16"
      viewBox="0 0 12 16"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="3.5" cy="3" r="1.25" />
      <circle cx="8.5" cy="3" r="1.25" />
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8.5" cy="8" r="1.25" />
      <circle cx="3.5" cy="13" r="1.25" />
      <circle cx="8.5" cy="13" r="1.25" />
    </svg>
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
  if (kind === 'pdf') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
        PDF
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
      Paper
    </span>
  );
}

function PdfFields({
  item,
  onChange,
}: {
  item: DraftItem;
  onChange: (p: Partial<DraftItem>) => void;
}) {
  const sizeLabel = item.file_size_bytes
    ? `${(item.file_size_bytes / (1024 * 1024)).toFixed(1)} MB`
    : null;
  return (
    <>
      <ItemField
        label="Title"
        value={item.title}
        onChange={(v) => onChange({ title: v })}
        placeholder="As it'll appear on the share"
      />
      {item.thumbnail_url || item.file_url ? (
        <div className="flex items-start gap-3 rounded-md border border-rule bg-paper p-3">
          {item.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnail_url}
              alt=""
              width={64}
              height={84}
              className="h-20 w-16 flex-shrink-0 rounded border border-rule bg-paper-soft object-cover"
            />
          ) : (
            <div className="flex h-20 w-16 flex-shrink-0 items-center justify-center rounded border border-rule bg-paper-soft text-ink-muted">
              <span className="text-[9px] font-semibold uppercase">PDF</span>
            </div>
          )}
          <div className="min-w-0 flex-1 text-xs text-ink-muted">
            <p className="font-medium text-ink">Uploaded</p>
            {sizeLabel ? <p className="mt-0.5">{sizeLabel}</p> : null}
            {item.file_url ? (
              <a
                href={item.file_url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block text-ink-muted underline-offset-2 hover:underline"
              >
                Open file ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
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
      className="inline-flex h-10 w-10 items-center justify-center rounded text-ink-muted transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8"
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
