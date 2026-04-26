import type { OpenAccessInfo } from '@/lib/openalex';
import type { ShareItem } from '@/types/share';

/**
 * A single paper / item in a share. Server component — no interactivity, just
 * renders the card. Author / year / DOI / notes all optional, so the layout
 * gracefully collapses for sparser entries (single-paper shares often only
 * have title + scholar_url).
 *
 * `oa` is optional: when supplied (only the public viewer hydrates this), we
 * surface a "View PDF" / "Open paper" button group. When absent (e.g. the
 * /demo preview), the card renders as before.
 */
export function ShareItemCard({
  item,
  oa,
}: {
  item: ShareItem;
  oa?: OpenAccessInfo | null;
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
