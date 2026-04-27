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
          <h2 className="font-serif text-xl text-ink">Data controller</h2>
          <p className="mt-2">
            MyEtAl is operated by James Dimonaco. For any privacy-related
            questions or requests, contact{' '}
            <a
              href="mailto:dimonaco.james@gmail.com"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink"
            >
              dimonaco.james@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">What we collect</h2>
          <p className="mt-2">
            When you create an account we store your email address, display name,
            and an optional link to your ORCID profile. When you sign in via
            GitHub or Google we also receive your name and avatar from the
            provider &mdash; we never see your password on those flows.
          </p>
          <p className="mt-2">
            When you create and publish a share, the collection title,
            description, and list of paper metadata you curate are stored and
            displayed publicly.
          </p>
          <p className="mt-2">
            We record anonymous view events on public shares for view-count
            analytics. On the web, views are de-duplicated by a hashed IP
            address that is not stored after dedup. On mobile, a random
            per-device token (<code className="text-sm">X-View-Token</code>) is
            sent for the same purpose.
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
          <h2 className="font-serif text-xl text-ink">Legal basis</h2>
          <p className="mt-2">
            We process your data on the following legal bases under UK GDPR:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Contract</strong> &mdash; processing necessary to provide
              your account and the sharing service you signed up for.
            </li>
            <li>
              <strong>Legitimate interest</strong> &mdash; anonymous view
              tracking and moderation, where our interest does not override your
              rights.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Third parties</h2>
          <p className="mt-2">
            We use the following processors to operate MyEtAl:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Neon</strong> &mdash; managed PostgreSQL database hosting.
            </li>
            <li>
              <strong>Vercel</strong> &mdash; web application hosting and edge
              network.
            </li>
            <li>
              <strong>Cloudflare</strong> &mdash; CDN and DNS.
            </li>
          </ul>
          <p className="mt-2">
            We query <strong>OpenAlex</strong> and <strong> Crossref</strong> to
            look up paper metadata (titles, authors, DOIs). These are outbound
            lookups &mdash; no user personal data is sent to these services.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Cookies</h2>
          <p className="mt-2">
            MyEtAl sets <strong>no tracking cookies</strong> on public pages.
            When you sign in, we set two strictly necessary httpOnly cookies
            (<code className="text-sm">myetal_access</code> and{' '}
            <code className="text-sm">myetal_refresh</code>) to manage your
            authenticated session. These are exempt from consent requirements
            under PECR as they are essential for the service to function.
          </p>
          <p className="mt-2">
            We do not use third-party analytics, trackers, or advertising SDKs.
          </p>
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
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              View records older than 90 days are aggregated and the raw rows
              deleted.
            </li>
            <li>
              Tombstoned (deleted) shares are garbage-collected after 30 days.
            </li>
            <li>Expired refresh tokens are pruned every 24 hours.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Your rights</h2>
          <p className="mt-2">
            Under UK GDPR you have the right to:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Access</strong> &mdash; view your data via the analytics
              dashboard and your profile page.
            </li>
            <li>
              <strong>Deletion</strong> &mdash; delete your account and all
              associated data at any time from your profile page. This cascades
              to shares, views, reports, library entries, and auth tokens.
            </li>
            <li>
              <strong>Rectification</strong> &mdash; update your name, email,
              and profile details via the profile edit page.
            </li>
          </ul>
          <p className="mt-2">
            For any data request, email{' '}
            <a
              href="mailto:dimonaco.james@gmail.com"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink"
            >
              dimonaco.james@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Changes to this policy</h2>
          <p className="mt-2">
            We may update this policy from time to time. Changes will be posted
            on this page with an updated &ldquo;Last updated&rdquo; date.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Contact</h2>
          <p className="mt-2">
            Questions or concerns? Email{' '}
            <a
              href="mailto:dimonaco.james@gmail.com"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink"
            >
              dimonaco.james@gmail.com
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
