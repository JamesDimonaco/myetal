import Link from 'next/link';
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
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <ShareEditor
        id={id}
        initial={share}
        header={{
          eyebrow: `/c/${share.short_code}`,
          title: 'Edit share',
          description: (
            <Link
              href={`/dashboard/share/${id}/analytics`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-accent transition hover:opacity-80 sm:min-h-0"
            >
              View analytics &rarr;
            </Link>
          ),
        }}
      />
    </div>
  );
}
