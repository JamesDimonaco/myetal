import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => [
    { short_code: 'aaa', updated_at: '2026-05-01T00:00:00Z', owner_slug: 'alice' },
    { short_code: 'bbb', updated_at: '2026-06-01T00:00:00Z', owner_slug: 'alice' },
    { short_code: 'ccc', updated_at: '2026-04-01T00:00:00Z', owner_slug: 'bob' },
  ]),
}));

import sitemap, { revalidate } from './sitemap';

describe('sitemap', () => {
  // Harm prevented: the sitemap freezing at build time, so new shares and
  // profiles never reach search engines until the next deploy.
  it('revalidates hourly', () => {
    expect(revalidate).toBe(3600);
  });

  // Harm prevented: researcher profile pages missing from the sitemap.
  it('lists each profile once, dated by its newest share', async () => {
    const entries = await sitemap();
    const profiles = entries.filter((e) => e.url.includes('/u/'));

    expect(profiles.map((e) => [e.url, e.lastModified])).toEqual([
      ['https://myetal.app/u/alice', new Date('2026-06-01T00:00:00Z')],
      ['https://myetal.app/u/bob', new Date('2026-04-01T00:00:00Z')],
    ]);
  });
});
