import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';

import { SearchResults } from './search-results';

export const metadata: Metadata = {
  title: 'Search collections',
  description:
    'Discover published collections, reading lists, and research posters shared on MyEtAl.',
};

export default function SearchPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10 sm:py-14">
        <div className="text-sm text-ink-muted">
          <Link href="/" className="hover:text-ink">
            &larr; MyEtAl
          </Link>
        </div>

        <h1 className="mt-8 font-serif text-4xl tracking-tight text-ink">
          Search collections
        </h1>
        <p className="mt-3 text-base text-ink-muted">
          Discover published collections, reading lists, and research posters.
        </p>

        <div className="mt-8">
          <SearchResults />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
