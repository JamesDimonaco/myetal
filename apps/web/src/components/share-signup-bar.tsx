'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { useEffect } from 'react';

import { useSession } from '@/lib/auth-client';

/**
 * Anonymous-viewer signup nudge on public share pages. Signed-in users
 * (including the share owner) never see this — it's purely a growth-loop CTA
 * for people who arrived from a shared link.
 */
export function ShareSignupBar({
  shortCode,
  ownerName,
  ownerId,
}: {
  shortCode: string;
  ownerName: string | null;
  ownerId: string | null;
}) {
  const { data: session, isPending } = useSession();
  const isOwner = session?.user.id === ownerId;

  useEffect(() => {
    if (isPending || isOwner || !posthog.__loaded) return;
    posthog.capture('share_viewed', {
      short_code: shortCode,
      owner_id: ownerId,
      owner_name: ownerName,
    });
  }, [isPending, isOwner, shortCode, ownerId, ownerName]);

  if (isPending || session) return null;

  const copy = ownerName
    ? `${ownerName} made this in about a minute. Sign in with ORCID and we'll import your publications for you.`
    : "Made with MyEtAl. Sign in with ORCID and we'll import your publications automatically.";

  return (
    <div className="sticky bottom-0 border-t border-rule bg-paper">
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-3 px-4 py-4 sm:flex-row sm:px-6">
        <p className="text-sm text-ink-muted">{copy}</p>
        <Link
          href={`/sign-in?from_share=${shortCode}`}
          onClick={() => {
            if (posthog.__loaded) {
              posthog.capture('share_cta_clicked', {
                short_code: shortCode,
                owner_id: ownerId,
              });
            }
          }}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          Make yours &rarr;
        </Link>
      </div>
    </div>
  );
}
