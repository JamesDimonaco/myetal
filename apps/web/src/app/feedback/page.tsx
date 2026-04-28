import Link from 'next/link';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

import { FeedbackForm } from './feedback-form';

export const metadata = { title: 'Send us feedback' };
export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  let userEmail: string | null = null;

  try {
    const user = await serverFetch<UserResponse>('/auth/me', {
      cache: 'no-store',
    });
    userEmail = user.email;
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) {
      userEmail = null;
    } else {
      // Unexpected error — still render the page, just without pre-filled email
      userEmail = null;
    }
  }

  const isSignedIn = userEmail !== null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
      <div className="text-sm text-ink-muted">
        {isSignedIn ? (
          <Link href="/dashboard" className="hover:text-ink">
            &larr; Back to dashboard
          </Link>
        ) : (
          <Link href="/" className="hover:text-ink">
            &larr; MyEtAl
          </Link>
        )}
      </div>

      <h1 className="mt-8 font-serif text-4xl tracking-tight text-ink">
        Send us feedback
      </h1>
      <p className="mt-3 text-base text-ink-muted">
        Help us make MyEtAl better for your research. Every submission is read
        by a real human.
      </p>

      <div className="mt-10">
        <FeedbackForm userEmail={userEmail} />
      </div>

      <footer className="mt-16 text-xs text-ink-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          myetal.app
        </Link>
      </footer>
    </main>
  );
}
