import Link from 'next/link';

export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
      <div className="text-sm text-ink-muted">
        <Link href="/" className="hover:text-ink">
          MyEtAl
        </Link>
      </div>

      <h1 className="mt-8 font-serif text-4xl tracking-tight text-ink">
        Privacy Policy
      </h1>
      <p className="mt-4 text-sm text-ink-muted">Last updated: 27 April 2026</p>

      <div className="mt-8 space-y-6 text-base leading-relaxed text-ink">
        <section>
          <h2 className="font-serif text-xl text-ink">What we collect</h2>
          <p className="mt-2">
            When you create an account we store your email address, display name,
            and an optional link to your ORCID profile. When you sign in via
            GitHub or Google we also receive your name and avatar from the
            provider — we never see your password on those flows.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">How we use it</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>To authenticate you and manage your sessions.</li>
            <li>To display your name on public shares you choose to publish.</li>
            <li>To track anonymous, de-duplicated view counts on public shares.</li>
            <li>
              To operate a moderation queue so we can act on abuse reports
              promptly.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">View tracking</h2>
          <p className="mt-2">
            We record one view per share per visitor per 24-hour window.
            Mobile app installs send a random per-device token for de-duplication;
            web visitors are de-duplicated by hashed IP. We do not use
            third-party analytics, trackers, or advertising SDKs.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Data retention</h2>
          <p className="mt-2">
            Expired refresh tokens are pruned every 24 hours. View records older
            than 90 days are aggregated and the raw rows deleted. Tombstoned
            (deleted) shares are garbage-collected after 30 days.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Your rights</h2>
          <p className="mt-2">
            You can delete your account and all associated data at any time from
            your profile page. For questions or data requests, email{' '}
            <a
              href="mailto:privacy@myetal.app"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink"
            >
              privacy@myetal.app
            </a>
            .
          </p>
        </section>
      </div>

      <footer className="mt-16 text-xs text-ink-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          myetal.app
        </Link>
      </footer>
    </main>
  );
}
