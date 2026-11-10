import type { Metadata } from 'next';

import { SearchResults } from './search-results';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search collections',
  description:
    'Discover published collections, reading lists, and bundles shared on MyEtAl.',
};

export default function SearchPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Search collections"
        description="Discover published collections, reading lists, and bundles."
      />
      <SearchResults />
    </div>
  );
}
