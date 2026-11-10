import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

import { FeedbackForm } from './feedback-form';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Send us feedback' };
export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  let userEmail: string | null = null;

  try {
    const user = await serverFetch<UserResponse>('/me', {
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
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Send us feedback"
        description="Help us make MyEtAl better for your research. Every submission is read by a real human."
      />
      <FeedbackForm userEmail={userEmail} />
    </div>
  );
}
