import { ShareEditor } from '@/components/share-editor';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { WorkResponse } from '@/types/works';

export const metadata = { title: 'New share' };
export const dynamic = 'force-dynamic';

/**
 * New-share page. Optionally accepts `?paper_id=<uuid>` to pre-attach a paper
 * from the user's library — this is the "+ New share with this paper" path
 * from the library Add-to-share popover. We fetch the paper server-side and
 * pass it to the client editor as `initialPaper`. If the paper isn't in the
 * user's library we silently fall through to the empty editor — no error.
 */
export default async function NewSharePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPaperId = Array.isArray(params.paper_id)
    ? params.paper_id[0]
    : params.paper_id;
  const paperId =
    typeof rawPaperId === 'string' && rawPaperId.length > 0 ? rawPaperId : null;

  let initialPaper: WorkResponse['paper'] | undefined;
  if (paperId) {
    try {
      const work = await serverFetch<WorkResponse>(`/me/works/${paperId}`, {
        cache: 'no-store',
      });
      initialPaper = work.paper;
    } catch (err) {
      // Paper not in library / 404 / unauthorised — treat as no-op so the user
      // still gets a usable editor. Don't surface a backend error here; the
      // popover-driven flow is best-effort.
      if (!(err instanceof ApiError)) throw err;
    }
  }

  const headline = initialPaper ? 'New share with this paper' : 'Create a share';
  const lede = initialPaper
    ? 'We pre-filled the first item from your library. Add more items, give the share a name, and save.'
    : 'One QR code, one collection. Add papers, repos, links — whatever your audience needs.';

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-ink-muted">New</p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          {headline}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{lede}</p>
      </header>
      <ShareEditor initialPaper={initialPaper} />
    </div>
  );
}
