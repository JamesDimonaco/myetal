import type { ShareItem } from '@/types/share';

/**
 * A single paper / item in a share. Server component — no interactivity, just
 * renders the card. Author / year / DOI / notes all optional, so the layout
 * gracefully collapses for sparser entries (single-paper shares often only
 * have title + scholar_url).
 */
export function ShareItemCard({ item }: { item: ShareItem }) {
  const meta = [item.authors, item.year ? String(item.year) : null]
    .filter(Boolean)
    .join(' · ');

  const titleNode = item.scholar_url ? (
    <a
      href={item.scholar_url}
      target="_blank"
      rel="noreferrer noopener"
      className="font-serif text-lg leading-snug text-ink underline-offset-4 hover:underline"
    >
      {item.title}
    </a>
  ) : (
    <span className="font-serif text-lg leading-snug text-ink">{item.title}</span>
  );

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
    </article>
  );
}
