import Link from 'next/link';

export const metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-10 sm:py-14">
      <div className="text-sm text-ink-muted">
        <Link href="/" className="hover:text-ink">
          MyEtAl
        </Link>
      </div>

      <h1 className="mt-8 font-serif text-4xl tracking-tight text-ink">
        Terms of Service
      </h1>
      <p className="mt-4 text-sm text-ink-muted">Last updated: 27 April 2026</p>

      <div className="mt-8 space-y-6 text-base leading-relaxed text-ink">
        <section>
          <h2 className="font-serif text-xl text-ink">Acceptable use</h2>
          <p className="mt-2">
            You may use MyEtAl to create and share collections of academic
            papers, repositories, and related research resources. You agree not
            to:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Upload or link to illegal content.</li>
            <li>
              Infringe the copyright of others &mdash; share metadata and links,
              not pirated PDFs.
            </li>
            <li>
              Use the platform to distribute spam, malware, or misleading
              content.
            </li>
            <li>
              Attempt to interfere with the service, its infrastructure, or
              other users&rsquo; access.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">User content</h2>
          <p className="mt-2">
            You retain full ownership of any content you create on MyEtAl
            (collection titles, descriptions, and curated paper lists). By
            publishing a share you grant MyEtAl a non-exclusive, worldwide,
            royalty-free licence to display that content publicly as part of the
            service &mdash; for example, on the public share page and in
            discovery features.
          </p>
          <p className="mt-2">
            You can unpublish or delete your shares at any time. Deleted shares
            are tombstoned and garbage-collected after 30 days.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Takedown</h2>
          <p className="mt-2">
            Every public share page includes a <em>Report</em> button. If you
            believe content violates these terms or infringes your rights, use
            that button or email{' '}
            <a
              href="mailto:dimonaco.james@gmail.com"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink"
            >
              dimonaco.james@gmail.com
            </a>
            . We review reports promptly and will remove content that violates
            these terms.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Account termination</h2>
          <p className="mt-2">
            We reserve the right to suspend or delete accounts that violate
            these terms, engage in abusive behaviour, or remain inactive for an
            extended period. Where possible we will notify you by email before
            taking action.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Disclaimers</h2>
          <p className="mt-2">
            MyEtAl is provided <strong>&ldquo;as is&rdquo;</strong> and{' '}
            <strong>&ldquo;as available&rdquo;</strong>, without warranty of any
            kind, express or implied. We do not guarantee uptime, data accuracy,
            or that the service will meet your specific requirements. Paper
            metadata is sourced from third-party databases (OpenAlex, Crossref)
            and may contain errors.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Limitation of liability</h2>
          <p className="mt-2">
            To the fullest extent permitted by law, MyEtAl and its operators
            shall not be liable for any indirect, incidental, special, or
            consequential damages arising out of or in connection with your use
            of the service. Our total aggregate liability for any claim relating
            to the service is limited to the amount you paid us in the twelve
            months preceding the claim (which, while the service is free, is
            zero).
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Governing law</h2>
          <p className="mt-2">
            These terms are governed by and construed in accordance with the laws
            of England and Wales. Any disputes arising from these terms or your
            use of MyEtAl shall be subject to the exclusive jurisdiction of the
            courts of England and Wales.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Changes to these terms</h2>
          <p className="mt-2">
            We may update these terms from time to time. Changes will be posted
            on this page with an updated &ldquo;Last updated&rdquo; date. Your
            continued use of MyEtAl after changes are posted constitutes
            acceptance of the revised terms.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink">Contact</h2>
          <p className="mt-2">
            Questions about these terms? Email{' '}
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
