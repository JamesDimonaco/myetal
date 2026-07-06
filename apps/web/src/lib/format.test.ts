/**
 * Unit tests for the shared formatting helpers.
 *
 * `formatRelativeTime` is pinned with fake timers — it reads `Date.now()`
 * internally, so every case sets a fixed "now" and derives the input ISO
 * string from it. Assertions are against the real `Intl.RelativeTimeFormat`
 * output for `en` (Node ships full ICU), including the `numeric: 'auto'`
 * special-casings ("yesterday", "last month") — those are part of the
 * observable contract, not an implementation detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatBytes, formatItemCount, formatRelativeTime } from './format';

const NOW = new Date('2026-07-06T12:00:00.000Z');

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for unparseable input', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
    expect(formatRelativeTime('')).toBe('');
  });

  it('formats seconds ago', () => {
    expect(formatRelativeTime(isoAgo(30 * SECOND))).toBe('30 seconds ago');
  });

  it('rolls seconds into minutes at the 60s boundary', () => {
    expect(formatRelativeTime(isoAgo(59 * SECOND))).toBe('59 seconds ago');
    expect(formatRelativeTime(isoAgo(90 * SECOND))).toBe('1 minute ago');
  });

  it('formats hours and days', () => {
    expect(formatRelativeTime(isoAgo(3 * HOUR))).toBe('3 hours ago');
    expect(formatRelativeTime(isoAgo(3 * DAY))).toBe('3 days ago');
  });

  it("uses numeric:'auto' phrasing for single units", () => {
    expect(formatRelativeTime(isoAgo(1 * DAY))).toBe('yesterday');
  });

  it('rolls days into weeks past 7 days', () => {
    expect(formatRelativeTime(isoAgo(14 * DAY))).toBe('2 weeks ago');
    // 30 days → floor(30/7) = 4 weeks, still under the 4.34524 week→month step.
    expect(formatRelativeTime(isoAgo(30 * DAY))).toBe('4 weeks ago');
  });

  it('formats months and years', () => {
    expect(formatRelativeTime(isoAgo(65 * DAY))).toBe('2 months ago');
    expect(formatRelativeTime(isoAgo(800 * DAY))).toBe('2 years ago');
  });

  it('formats future timestamps as "in …"', () => {
    const future = new Date(NOW.getTime() + 5 * MINUTE).toISOString();
    expect(formatRelativeTime(future)).toBe('in 5 minutes');
  });
});

describe('formatItemCount', () => {
  it('singularises exactly one', () => {
    expect(formatItemCount(1)).toBe('1 paper');
  });

  it('pluralises zero and many', () => {
    expect(formatItemCount(0)).toBe('0 papers');
    expect(formatItemCount(7)).toBe('7 papers');
  });
});

describe('formatBytes', () => {
  it('special-cases zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('scales precision with magnitude (2dp < 10, 1dp < 100, 0dp above)', () => {
    expect(formatBytes(1)).toBe('1.00 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(10 * 1024)).toBe('10.0 KB');
    expect(formatBytes(100 * 1024)).toBe('100 KB');
  });

  it('stays in bytes just under the 1 KB boundary', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('walks up the unit ladder', () => {
    expect(formatBytes(1024 ** 2)).toBe('1.00 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.00 TB');
  });

  it('caps at TB rather than inventing units', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });
});
