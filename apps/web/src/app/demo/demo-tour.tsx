'use client';

import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';

import { ShareItemCard } from '@/components/share-item-card';
import type { ShareItem, ShareItemKind, ShareType } from '@/types/share';

/**
 * Interactive product tour. Lives entirely client-side — no API calls. The
 * right column is built to look identical to the real /c/[code] viewer
 * (same <ShareItemCard />, same typography), so what the user sees here is
 * what their scanners will see.
 *
 * Seeded with a *project* share (paper + repo + link) so the new mixed-kind
 * UX is visible on first render — no clicking required to discover it.
 */

type DemoItemDraft = {
  id: string;
  kind: ShareItemKind;
  title: string;
  // paper-only
  authors: string;
  year: string;
  doi: string;
  // repo / link
  url: string;
  subtitle: string;
  image_url: string;
  notes: string;
};

const SHARE_TYPES: { value: ShareType; label: string }[] = [
  { value: 'paper', label: 'Paper' },
  { value: 'collection', label: 'Collection' },
  { value: 'poster', label: 'Poster' },
  { value: 'grant', label: 'Grant' },
  { value: 'project', label: 'Project' },
];

const INITIAL_NAME = 'Single-cell mito imaging — project page';
const INITIAL_DESCRIPTION =
  'Everything someone needs to find our work: the paper, the analysis code, and the lab page.';
const INITIAL_TYPE: ShareType = 'project';

const blankFields = {
  authors: '',
  year: '',
  doi: '',
  url: '',
  subtitle: '',
  image_url: '',
  notes: '',
};

const INITIAL_ITEMS: DemoItemDraft[] = [
  {
    id: 'd1',
    kind: 'paper',
    title: 'Mitochondrial fission, fusion, and stress',
    authors: 'Youle & van der Bliek',
    year: '2012',
    doi: '10.1126/science.1219855',
    url: '',
    subtitle: '',
    image_url: '',
    notes: 'The review I send to every new student.',
  },
  {
    id: 'd2',
    kind: 'repo',
    title: 'mito-lab/mito-tools',
    authors: '',
    year: '',
    doi: '',
    url: 'https://github.com/mito-lab/mito-tools',
    subtitle: 'Image-analysis pipeline for live mitochondrial dynamics.',
    image_url: '',
    notes: '',
  },
  {
    id: 'd3',
    kind: 'link',
    title: 'Mito Lab — group page',
    authors: '',
    year: '',
    doi: '',
    url: 'https://example.edu/labs/mito',
    subtitle: 'Members, publications, and current openings.',
    image_url: '',
    notes: '',
  },
];

const PUBLIC_HOST = 'myetal.app';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function DemoTour() {
  const [name, setName] = useState(INITIAL_NAME);
  const [description, setDescription] = useState(INITIAL_DESCRIPTION);
  const [shareType, setShareType] = useState<ShareType>(INITIAL_TYPE);
  const [items, setItems] = useState<DemoItemDraft[]>(INITIAL_ITEMS);

  const shortCode = useMemo(() => slugify(name) || 'your-share', [name]);
  const publicUrl = `https://${PUBLIC_HOST}/c/${shortCode}`;

  const previewItems: ShareItem[] = useMemo(
    () =>
      items
        .filter((item) => item.title.trim().length > 0)
        .map((item, index) => ({
          id: item.id,
          position: index,
          kind: item.kind,
          title: item.title.trim(),
          authors: item.authors.trim() || null,
          year: item.year.trim() ? Number(item.year) || null : null,
          doi: item.doi.trim() || null,
          scholar_url: item.doi.trim()
            ? `https://doi.org/${item.doi.trim()}`
            : null,
          notes: item.notes.trim() || null,
          url: item.url.trim() || null,
          subtitle: item.subtitle.trim() || null,
          image_url: item.image_url.trim() || null,
        })),
    [items],
  );

  function updateItem(id: string, patch: Partial<DemoItemDraft>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function addItem(kind: ShareItemKind) {
    setItems((prev) => [
      ...prev,
      {
        id: newId(),
        kind,
        title: '',
        ...blankFields,
      },
    ]);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
      <section aria-labelledby="demo-editor-heading" className="order-2 lg:order-1">
        <h2
          id="demo-editor-heading"
          className="font-mono text-xs uppercase tracking-widest text-ink-faint"
        >
          Editor
        </h2>

        <div className="mt-4 grid gap-5 rounded-lg border border-rule bg-paper-soft p-5">
          <Field label="Share name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-accent"
            />
          </Field>

          <Field label="Type">
            <div className="flex flex-wrap gap-2">
              {SHARE_TYPES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setShareType(opt.value)}
                  aria-pressed={shareType === opt.value}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                    shareType === opt.value
                      ? 'border-ink bg-ink text-paper'
                      : 'border-rule bg-paper text-ink-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <h3 className="mt-8 font-mono text-xs uppercase tracking-widest text-ink-faint">
          Items ({items.length})
        </h3>

        <ul className="mt-4 grid gap-4">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="rounded-lg border border-rule bg-paper-soft p-5"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  Item {index + 1} · {item.kind}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-xs text-ink-muted hover:text-danger"
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                <Field label="Title">
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) =>
                      updateItem(item.id, { title: e.target.value })
                    }
                    className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                </Field>

                {item.kind === 'paper' ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                      <Field label="Authors">
                        <input
                          type="text"
                          value={item.authors}
                          onChange={(e) =>
                            updateItem(item.id, { authors: e.target.value })
                          }
                          placeholder="Smith et al."
                          className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                        />
                      </Field>
                      <Field label="Year">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.year}
                          onChange={(e) =>
                            updateItem(item.id, { year: e.target.value })
                          }
                          placeholder="2024"
                          className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                        />
                      </Field>
                    </div>

                    <Field label="DOI">
                      <input
                        type="text"
                        value={item.doi}
                        onChange={(e) =>
                          updateItem(item.id, { doi: e.target.value })
                        }
                        placeholder="10.1038/nature12985"
                        className="w-full rounded-md border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={item.kind === 'repo' ? 'GitHub URL' : 'URL'}>
                      <input
                        type="url"
                        value={item.url}
                        onChange={(e) =>
                          updateItem(item.id, { url: e.target.value })
                        }
                        placeholder={
                          item.kind === 'repo'
                            ? 'https://github.com/owner/repo'
                            : 'https://...'
                        }
                        className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                    </Field>
                    <Field label="Description">
                      <input
                        type="text"
                        value={item.subtitle}
                        onChange={(e) =>
                          updateItem(item.id, { subtitle: e.target.value })
                        }
                        placeholder="Optional one-liner"
                        className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                    </Field>
                  </>
                )}

                <Field label="Notes">
                  <textarea
                    value={item.notes}
                    onChange={(e) =>
                      updateItem(item.id, { notes: e.target.value })
                    }
                    rows={2}
                    placeholder="Optional context for the reader."
                    className="w-full resize-none rounded-md border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-accent"
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addItem('paper')}
            className="inline-flex items-center gap-2 rounded-md border border-dashed border-rule bg-paper px-3 py-2 text-xs font-medium text-ink-muted transition hover:border-ink/40 hover:text-ink"
          >
            + Paper
          </button>
          <button
            type="button"
            onClick={() => addItem('repo')}
            className="inline-flex items-center gap-2 rounded-md border border-dashed border-rule bg-paper px-3 py-2 text-xs font-medium text-ink-muted transition hover:border-ink/40 hover:text-ink"
          >
            + Repo
          </button>
          <button
            type="button"
            onClick={() => addItem('link')}
            className="inline-flex items-center gap-2 rounded-md border border-dashed border-rule bg-paper px-3 py-2 text-xs font-medium text-ink-muted transition hover:border-ink/40 hover:text-ink"
          >
            + Link
          </button>
        </div>

        <p className="mt-6 text-xs text-ink-faint">
          In the real app, you can paste a DOI or a GitHub URL and the metadata
          is pulled in automatically.
        </p>
      </section>

      <section
        aria-labelledby="demo-preview-heading"
        className="order-1 lg:order-2 lg:sticky lg:top-8 lg:self-start"
      >
        <h2
          id="demo-preview-heading"
          className="font-mono text-xs uppercase tracking-widest text-ink-faint"
        >
          Public scan view
        </h2>

        <div className="mt-4 overflow-hidden rounded-lg border border-rule bg-paper shadow-sm">
          <div className="flex items-center gap-2 border-b border-rule bg-paper-soft px-4 py-2.5 text-xs text-ink-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-ink-faint/60" />
            <span className="inline-block h-2 w-2 rounded-full bg-ink-faint/60" />
            <span className="inline-block h-2 w-2 rounded-full bg-ink-faint/60" />
            <span className="ml-2 truncate font-mono">{publicUrl}</span>
          </div>

          <div className="px-6 py-8">
            <div className="text-xs text-ink-muted">MyEtAl</div>

            <header className="mt-6">
              <h3 className="font-serif text-2xl leading-tight tracking-tight text-ink sm:text-3xl">
                {name || 'Untitled share'}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>by you</span>
                <span aria-hidden>·</span>
                <span>just now</span>
                <span aria-hidden>·</span>
                <span className="uppercase tracking-wide text-ink-faint">
                  {shareType}
                </span>
              </div>
              {description ? (
                <p className="mt-4 text-sm leading-relaxed text-ink">
                  {description}
                </p>
              ) : null}
            </header>

            <div className="mt-6">
              {previewItems.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-muted">
                  Add an item on the left to see it here.
                </p>
              ) : (
                previewItems.map((item) => (
                  <ShareItemCard key={item.id} item={item} />
                ))
              )}
            </div>

            <aside className="mt-10 border-t border-rule pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-serif text-base text-ink">Scan to keep this</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    <code className="text-ink">/c/{shortCode}</code>
                  </p>
                </div>
                <div className="rounded-md border border-rule bg-white p-2">
                  <QRCodeSVG
                    value={publicUrl}
                    size={108}
                    level="M"
                    marginSize={0}
                  />
                </div>
              </div>
            </aside>
          </div>
        </div>

        <p className="mt-4 text-xs text-ink-faint">
          The QR encodes{' '}
          <code className="text-ink">{publicUrl}</code> — try scanning it
          with your phone. (It&apos;s a fake URL for the demo, so it won&apos;t
          resolve. Yours will.)
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
          >
            Make this real →
          </Link>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-widest text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
