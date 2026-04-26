/**
 * Tiny "X ago" formatter. We avoid date-fns for now to keep the bundle small;
 * swap it in if formatting needs grow (locales, "in 2h" future phrasing, etc.).
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffSeconds = Math.max(0, (now - then) / 1000);

  if (diffSeconds < 60) return 'just now';
  if (diffSeconds < 3600) {
    const m = Math.floor(diffSeconds / 60);
    return `${m} min${m === 1 ? '' : 's'} ago`;
  }
  if (diffSeconds < 86_400) {
    const h = Math.floor(diffSeconds / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (diffSeconds < 604_800) {
    const d = Math.floor(diffSeconds / 86_400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
