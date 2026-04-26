import { notFound, redirect } from 'next/navigation';

import { ShareEditor } from '@/components/share-editor';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { ShareResponse } from '@/types/share';

export const metadata = { title: 'Edit share' };
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

export default async function EditSharePage({ params }: PageProps) {
  const { id } = await params;

  let share: ShareResponse;
  try {
    share = await serverFetch<ShareResponse>(`/shares/${id}`, {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.isNotFound) notFound();
      if (err.isUnauthorized || err.isForbidden) {
        redirect(`/sign-in?return_to=/dashboard/share/${id}`);
      }
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          /c/{share.short_code}
        </p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          Edit share
        </h1>
      </header>
      <ShareEditor id={id} initial={share} />
    </div>
  );
}
