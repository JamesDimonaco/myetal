import type { Metadata } from 'next';

import { SearchResults } from './search-results';

export const metadata: Metadata = {
  title: 'Search collections',
  description:
    'Discover published collections, reading lists, and bundles shared on MyEtAl.',
};

export default function SearchPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-6 sm:py-10 sm:py-14">
      <h1 className="font-serif text-4xl tracking-tight text-ink">
        Search collections
      </h1>
      <p className="mt-3 text-base text-ink-muted">
        Discover published collections, reading lists, and bundles.
      </p>

      <div className="mt-8">
        <SearchResults />
      </div>
    </div>
  );
}
