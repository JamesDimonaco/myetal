import { GitHubIcon } from '@/components/github-icon';
import type { RepoInfo } from '@/lib/github';
import type { OpenAccessInfo } from '@/lib/openalex';
import type { ShareItem } from '@/types/share';

/**
 * A single item in a share. Server component — no interactivity, just renders
 * the card. Discriminates on `item.kind`:
 *
 * - `paper` (default for back-compat): existing layout, optionally augmented
 *   with OpenAlex `oa` info from the public viewer.
 * - `repo`: GitHub mark + owner/repo, description, ★stars · language · license
 *   meta hydrated by the public viewer via the `repo` prop.
 * - `link`: optional thumbnail, title + host, description, "Open ↗" button.
 *
 * `oa` and `repo` are optional — when absent (e.g. /demo preview, or hydration
 * failed) the card just renders without the augmented bits.
 */
export function ShareItemCard({
  item,
  oa,
  repo,
}: {
  item: ShareItem;
  oa?: OpenAccessInfo | null;
  repo?: RepoInfo | null;
}) {
  if (item.kind === 'repo') return <RepoCard item={item} repo={repo ?? null} />;
  if (item.kind === 'link') return <LinkCard item={item} />;
  return <PaperCard item={item} oa={oa ?? null} />;
}

// --------------------------------------------------------------------------

function PaperCard({
  item,
  oa,
}: {
  item: ShareItem;
  oa: OpenAccessInfo | null;
}) {
  const meta = [item.authors, item.year ? String(item.year) : null]
    .filter(Boolean)
    .join(' · ');

  // Title is wrapped in an anchor whenever we have *any* destination. Always
  // visibly underlined so it reads as a link without the user having to hover.
  const titleHref = oa?.pdfUrl ?? oa?.oaUrl ?? item.scholar_url ?? null;

  const titleNode = titleHref ? (
    <a
      href={titleHref}
      target="_blank"
      rel="noreferrer noopener"
      className="font-serif text-lg leading-snug text-ink underline decoration-rule decoration-1 underline-offset-4 transition hover:decoration-ink"
    >
      {item.title}
      <span aria-hidden className="ml-1 text-ink-faint">↗</span>
    </a>
  ) : (
    <span className="font-serif text-lg leading-snug text-ink">{item.title}</span>
  );

  // Avoid a duplicate "Open paper" button when the only OA URL we have is the
  // same as the scholar fallback baked into the title.
  const oaUrlForButton =
    oa?.oaUrl && oa.oaUrl !== oa.pdfUrl ? oa.oaUrl : null;

  const showActions = Boolean(oa?.pdfUrl || oaUrlForButton);

  return (
    <article className="border-t border-rule py-5 first:border-t-0">
      {titleNode}
      {meta ? <p className="mt-1 text-sm text-ink-muted">{meta}</p> : null}
      {item.doi ? (
        <p className="mt-1 text-xs text-ink-faint">
          DOI{' '}
          <a
            href={`https://doi.org/${item.doi}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:underline"
          >
            {item.doi}
          </a>
        </p>
      ) : null}
      {item.notes ? (
        <p className="mt-3 text-sm leading-relaxed text-ink">{item.notes}</p>
      ) : null}

      {showActions ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {oa?.pdfUrl ? (
            <a
              href={oa.pdfUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90"
            >
              View PDF <span aria-hidden>↗</span>
            </a>
          ) : null}
          {oaUrlForButton ? (
            <a
              href={oaUrlForButton}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40"
            >
              Open paper <span aria-hidden>↗</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// --------------------------------------------------------------------------

function RepoCard({
  item,
  repo,
}: {
  item: ShareItem;
  repo: RepoInfo | null;
}) {
  // Prefer hydrated metadata where we have it (full_name, description),
  // otherwise fall back to whatever the owner saved.
  const titleText = repo?.fullName ?? item.title;
  const description = repo?.description ?? item.subtitle;
  const href = repo?.htmlUrl ?? item.url ?? null;

  const meta = [
    repo ? `★ ${repo.stars.toLocaleString()}` : null,
    repo?.language,
    repo?.license,
  ].filter(Boolean) as string[];

  const titleNode = href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-2 font-serif text-lg leading-snug text-ink underline decoration-rule decoration-1 underline-offset-4 transition hover:decoration-ink"
    >
      <GitHubIcon size={18} className="text-ink-muted" />
      {titleText}
      <span aria-hidden className="text-ink-faint">↗</span>
    </a>
  ) : (
    <span className="inline-flex items-center gap-2 font-serif text-lg leading-snug text-ink">
      <GitHubIcon size={18} className="text-ink-muted" />
      {titleText}
    </span>
  );

  return (
    <article className="border-t border-rule py-5 first:border-t-0">
      {titleNode}
      {description ? (
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      ) : null}
      {meta.length ? (
        <p className="mt-1 text-xs text-ink-faint">{meta.join(' · ')}</p>
      ) : null}
      {item.notes ? (
        <p className="mt-3 text-sm leading-relaxed text-ink">{item.notes}</p>
      ) : null}

      {href ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90"
          >
            View on GitHub <span aria-hidden>↗</span>
          </a>
        </div>
      ) : null}
    </article>
  );
}

// --------------------------------------------------------------------------

function safeHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function LinkCard({ item }: { item: ShareItem }) {
  const host = safeHost(item.url);
  const href = item.url;

  const titleNode = href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-serif text-lg leading-snug text-ink underline decoration-rule decoration-1 underline-offset-4 transition hover:decoration-ink"
    >
      {item.title}
      <span aria-hidden className="ml-1 text-ink-faint">↗</span>
    </a>
  ) : (
    <span className="font-serif text-lg leading-snug text-ink">{item.title}</span>
  );

  return (
    <article className="flex gap-4 border-t border-rule py-5 first:border-t-0">
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 flex-shrink-0 rounded-md border border-rule bg-paper-soft object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        {titleNode}
        {host ? (
          <p className="mt-1 text-xs text-ink-faint">{host}</p>
        ) : null}
        {item.subtitle ? (
          <p className="mt-1 text-sm text-ink-muted">{item.subtitle}</p>
        ) : null}
        {item.notes ? (
          <p className="mt-3 text-sm leading-relaxed text-ink">{item.notes}</p>
        ) : null}

        {href ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90"
            >
              Open <span aria-hidden>↗</span>
            </a>
          </div>
        ) : null}
      </div>
    </article>
  );
}
