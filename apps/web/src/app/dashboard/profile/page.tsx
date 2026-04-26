import { redirect } from 'next/navigation';

import { ProfileActions } from './profile-actions';
import { SessionsList } from './sessions-list';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { SessionResponse, UserResponse } from '@/types/auth';

export const metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  let user: UserResponse;
  let sessions: SessionResponse[] = [];

  try {
    user = await serverFetch<UserResponse>('/auth/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/profile');
    }
    throw err;
  }

  // Sessions are best-effort — if the endpoint hiccups we still want the
  // profile page to render so the user can sign out.
  try {
    sessions = await serverFetch<SessionResponse[]>('/auth/me/sessions', {
      cache: 'no-store',
    });
  } catch {
    sessions = [];
  }

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

      <section className="mt-10">
        <h2 className="font-serif text-xl text-ink">Active sessions</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Each row is a signed-in device. Revoke any you don&apos;t recognise.
        </p>
        <div className="mt-4">
          <SessionsList initialSessions={sessions} />
        </div>
      </section>
    </div>
  );
}
