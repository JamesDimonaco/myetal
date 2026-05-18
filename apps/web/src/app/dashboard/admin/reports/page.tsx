import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { ReportOut } from '@/types/reports';

import { ReportsQueue } from './reports-queue';

export const metadata = { title: 'Admin — Reports' };
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  let reports: ReportOut[];
  try {
    reports = await serverFetch<ReportOut[]>('/admin/reports', {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/admin/reports');
    }
    throw err;
  }

  // The /dashboard/admin layout already provides max-w + horizontal +
  // vertical padding; nesting another mx-auto/max-w/py here used to
  // double-pad the page (visible top-margin gap + inset gutters on
  // desktop). Render content directly.
  return (
    <>
      <div>
        <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          Report queue
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          User-submitted take-down and abuse reports. Review, dismiss, or
          tombstone the underlying share.
        </p>
      </div>

      <div className="mt-10">
        <ReportsQueue initialReports={reports} />
      </div>
    </>
  );
}
