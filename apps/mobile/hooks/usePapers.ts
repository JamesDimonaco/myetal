/**
 * TanStack Query hooks for the /papers/* endpoints.
 *
 * Both hooks gate themselves on a "meaningful" input — DOI lookup waits until
 * the input parses to a DOI shape; search waits until the user has typed at
 * least 3 characters — so React Query never fires a request the user clearly
 * isn't asking for. The screen layer handles the 300ms debounce upstream.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Paper, PaperSearchResponse } from '@/types/paper';

const DOI_RE = /10\.\d{4,9}\/\S+/;

/** Permissive bare-DOI extractor — strips "doi:" / "https://doi.org/" wrappers. */
export function extractDoi(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(DOI_RE);
  return match ? match[0].replace(/[/.,;:]+$/, '') : null;
}

export function useLookupPaper(identifier: string) {
  const doi = extractDoi(identifier);
  return useQuery({
    queryKey: ['papers', 'lookup', doi ?? ''],
    queryFn: () =>
      api<Paper>('/papers/lookup', {
        method: 'POST',
        json: { identifier: doi },
      }),
    enabled: Boolean(doi),
    staleTime: 60_000,
    // Don't auto-refetch on focus — the result for a DOI is immutable enough.
    refetchOnWindowFocus: false,
  });
}

export function useSearchPapers(query: string) {
  const trimmed = query.trim();
  const enabled = trimmed.length >= 3;
  return useQuery({
    queryKey: ['papers', 'search', trimmed.toLowerCase()],
    queryFn: () =>
      api<PaperSearchResponse>(
        `/papers/search?q=${encodeURIComponent(trimmed)}&limit=10`,
      ),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
