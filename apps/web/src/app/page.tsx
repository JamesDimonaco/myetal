import Link from 'next/link';

import { HomeBrowseSection } from '@/components/home-browse-section';
import { SavedSharesSection } from '@/components/saved-shares-section';
import { SignOutButton } from '@/components/sign-out-button';
import { SiteFooter } from '@/components/site-footer';
import { UserAvatar } from '@/components/user-avatar';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

/**
 * Marketing landing. Server-rendered. Tries to fetch /me — if the user
 * has a valid session, the header swaps to "Go to dashboard" + sign-out and
 * the hero CTA changes to point at /dashboard. Anonymous users see the
 * original sign-in / try-the-demo flow.
 *
 * Why server-fetch the session? It avoids a client flash where logged-in
 * users briefly see a "Sign in" button before hydration kicks in.
 *
 * Cache opt-out: must be per-request because the page personalises.
 */
export const dynamic = 'force-dynamic';

async function getCurrentUser(): Promise<UserResponse | null> {
  try {
    return await serverFetch<UserResponse>('/me', { cache: 'no-store' });
  } catch {
    // 401/403 (not signed in) or API down — render the anonymous landing
    // rather than breaking the whole homepage.
    return null;
  }
}

export default async function LandingPage() {
  const user = await getCurrentUser();
  const signedIn = user !== null;
  const displayName = user?.name?.trim() || user?.email || null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-16">
      <header className="flex items-center justify-between gap-3">
        <span className="font-serif text-xl tracking-tight text-ink">MyEtAl</span>
        <nav className="flex items-center gap-3 text-sm sm:gap-6">
          {signedIn ? (
            <>
              {/* "Dashboard" hidden on mobile — avatar tap goes to profile,
                  and the hero CTA below already says "Go to dashboard". This
                  keeps the header to avatar + sign-out so the sign-out label
                  doesn't wrap at 375px. */}
              <Link
                href="/dashboard"
                className="hidden whitespace-nowrap text-ink-muted hover:text-ink sm:inline"
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/profile"
                className="transition hover:opacity-80"
                title={displayName ?? 'Profile'}
              >
                <UserAvatar
                  name={user!.name}
                  avatarUrl={user!.avatar_url}
                  size={32}
                />
              </Link>
              <SignOutButton className="whitespace-nowrap text-ink-muted hover:text-ink" />
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md px-2 hover:text-ink sm:px-3"
              >
                Sign in
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md bg-ink px-3 text-paper transition hover:opacity-90"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mt-12 sm:mt-28">
        <h1 className="font-serif text-[clamp(2.25rem,9vw,3rem)] leading-[1.05] tracking-tight text-ink sm:text-6xl">
          Share your research with a QR.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:mt-6 sm:text-lg">
          A paper. A reading list. A poster you&apos;re standing in front of.
          One QR code that resolves to a clean, shareable page — works whether
          the scanner has the app or not.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap">
          {signedIn ? (
            <>
              <Link
                href="/dashboard"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:opacity-90"
              >
                Go to dashboard
              </Link>
              <Link
                href="/dashboard/share/new"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-ink/20 px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40"
              >
                + New share
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:opacity-90"
              >
                Sign in
              </Link>
              <Link
                href="/demo"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-ink/20 px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40"
              >
                Try the demo
              </Link>
              {/* "Search collections" CTA dropped (W-FIX-7) — it deep-linked
                  to /dashboard/search which 401-redirects unauthed users.
                  The <HomeBrowseSection /> below already gives discovery
                  affordances. */}
            </>
          )}
        </div>

        <SavedSharesSection />
      </section>

      <HomeBrowseSection />

      <section className="mt-24 grid gap-8 sm:mt-32 sm:grid-cols-3">
        <Feature
          title="One QR, many papers"
          body="A share is the unit on a QR — one paper or a curated collection. Same flow, same code."
        />
        <Feature
          title="No app required"
          body="Scanned by someone without the app? They land on a fast, server-rendered web page."
        />
        <Feature
          title="ORCID-aware"
          body="Sign in with ORCID, Google, GitHub, or email. Built for the people who actually publish papers."
        />
      </section>

      <div className="mt-auto pt-24" />
      <SiteFooter />
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-serif text-lg text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}
