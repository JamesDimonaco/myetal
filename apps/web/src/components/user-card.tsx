/**
 * Renders a single user as a discovery card. Surfaced in the user-search
 * block on `/dashboard/search` and `/browse` (PR-B §5). Tappable: links to
 * `/browse?owner_id={id}` so the viewer lands on that user's published
 * shares (Q15-C punts handles to a future ticket).
 *
 * Visual: round avatar + name + share count, deliberately distinct from the
 * rectangular share cards above so the user can tell people from collections
 * at a glance.
 */

import Link from 'next/link';

import { UserAvatar } from '@/components/user-avatar';
import type { UserPublicOut } from '@/types/share';

interface Props {
  user: UserPublicOut;
}

export function UserCard({ user }: Props) {
  return (
    <Link
      href={`/browse?owner_id=${encodeURIComponent(user.id)}`}
      className="group flex items-center gap-3 rounded-md border border-rule bg-paper-soft px-4 py-3 transition hover:border-ink/30"
    >
      <UserAvatar name={user.name} avatarUrl={user.avatar_url} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-base text-ink group-hover:underline">
          {user.name ?? 'Unnamed user'}
        </p>
        <p className="text-xs text-ink-faint">
          {user.share_count}{' '}
          {user.share_count === 1 ? 'published share' : 'published shares'}
        </p>
      </div>
    </Link>
  );
}
