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
  } catch {
    // Any error (401, network, etc.) — render without pre-filled email.
    // The dashboard layout already redirects unauthed users, so this is
    // mostly defensive.
    userEmail = null;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
      <h1 className="font-serif text-4xl tracking-tight text-ink">
        Send us feedback
      </h1>
      <p className="mt-3 text-base text-ink-muted">
        Help us make MyEtAl better for your research. Every submission is read
        by a real human.
      </p>

      <div className="mt-10">
        <FeedbackForm userEmail={userEmail} />
      </div>
    </div>
  );
}
