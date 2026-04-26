/**
 * OpenAlex open-access lookup, called server-side from the public viewer.
 *
 * Why directly from the web app rather than going via FastAPI? It's a public
 * read-only call, the polite-pool requirement is satisfied by passing
 * `mailto`, and Next.js's data cache (`next.revalidate`) is doing the
 * memoisation we'd otherwise need a TTLCache for. Keeps the API surface
 * leaner — no auth-vs-public split needed for a brand-new endpoint.
 */

const OPENALEX_URL = 'https://api.openalex.org/works';
const POLITE_EMAIL = 'team@myetal.app';
const REVALIDATE_SECONDS = 60 * 60; // 1h — OA links are stable

export type OpenAccessInfo = {
  /** Direct .pdf URL when OpenAlex believes it's free-to-read. */
  pdfUrl: string | null;
  /** Landing page (HTML) for the open-access copy. May host the PDF behind
   *  a click. */
  oaUrl: string | null;
};

function nullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Resolve a single DOI to OA info. Returns `null` on any failure — callers
 * just hide the "View PDF" button in that case, never surface an error.
 */
export async function lookupOpenAccess(doi: string): Promise<OpenAccessInfo | null> {
  const trimmed = doi.trim();
  if (!trimmed) return null;

  const url = `${OPENALEX_URL}?filter=doi:${encodeURIComponent(trimmed)}&per_page=1&mailto=${encodeURIComponent(POLITE_EMAIL)}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': `MyEtAl-Web/0.1 (mailto:${POLITE_EMAIL})`,
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        open_access?: { oa_url?: unknown; is_oa?: unknown };
        best_oa_location?: { pdf_url?: unknown; landing_page_url?: unknown };
      }>;
    };

    const work = data.results?.[0];
    if (!work) return null;

    const pdfUrl = nullableString(work.best_oa_location?.pdf_url);
    const oaUrl =
      nullableString(work.open_access?.oa_url) ??
      nullableString(work.best_oa_location?.landing_page_url);

    if (!pdfUrl && !oaUrl) return null;
    return { pdfUrl, oaUrl };
  } catch {
    return null;
  }
}

/**
 * Look up many DOIs in parallel and return a Map keyed by raw DOI. DOIs that
 * resolve to no OA copy are simply absent from the map. Duplicates are
 * de-duped before the network calls so a 5-item collection that all cite the
 * same paper only fires one fetch.
 */
export async function lookupManyOpenAccess(
  dois: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, OpenAccessInfo>> {
  const unique = Array.from(
    new Set(
      dois
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.trim())
        .filter((d) => d.length > 0),
    ),
  );

  const entries = await Promise.all(
    unique.map(async (doi) => [doi, await lookupOpenAccess(doi)] as const),
  );

  const out = new Map<string, OpenAccessInfo>();
  for (const [doi, info] of entries) {
    if (info) out.set(doi, info);
  }
  return out;
}
