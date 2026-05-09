import { redirect } from 'next/navigation';

import { OrcidSection } from './orcid-section';
import { ProfileActions } from './profile-actions';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

export const metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  let user: UserResponse;

  try {
    user = await serverFetch<UserResponse>('/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/profile');
    }
    throw err;
  }

  // Active-sessions UI removed in Phase 3 — Better Auth owns session
  // management now and the legacy ``/auth/me/sessions`` endpoint is
  // gone. Rebuild on top of BA's session API in a follow-up if users
  // ask for per-device revoke.

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header>
        <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          Profile
        </h1>
      </header>

      <section className="mt-8 rounded-lg border border-rule bg-paper-soft p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-muted">
              Name
            </dt>
            <dd className="mt-1 text-base text-ink">
              {user.name ?? <span className="text-ink-faint">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-muted">
              Email
            </dt>
            <dd className="mt-1 text-base text-ink">
              {user.email ?? <span className="text-ink-faint">Not set</span>}
            </dd>
          </div>
        </dl>
        <div className="mt-6 border-t border-rule pt-4">
          <ProfileActions />
        </div>
      </section>

      <OrcidSection initialOrcidId={user.orcid_id} />
    </div>
  );
}
