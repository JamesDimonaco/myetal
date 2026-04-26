/**
 * Tiny formatting helpers shared between server and client. Intl.* is fine
 * to call from RSC; we render to a string then ship that down.
 */

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  const abs = Math.abs(seconds);

  const pick: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.34524, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];

  let value = abs;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [step, name] of pick) {
    unit = name;
    if (value < step) break;
    value = Math.floor(value / step);
  }

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return rtf.format(seconds < 0 ? value : -value, unit);
}

export function formatItemCount(n: number): string {
  return `${n} ${n === 1 ? 'paper' : 'papers'}`;
}
