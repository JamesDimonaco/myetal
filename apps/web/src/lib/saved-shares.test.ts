/**
 * Unit tests for the saved-shares localStorage layer.
 *
 * Runs in the node environment (matching vitest.config.ts), so `window`
 * and `localStorage` are stubbed per-test with a Map-backed fake. That is
 * deliberate: the module guards on `typeof window === 'undefined'` for RSC
 * safety, and the no-window path is part of the contract (first test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSavedShares,
  isShareSaved,
  type SavedShare,
  saveShare,
  unsaveShare,
} from './saved-shares';

const STORAGE_KEY = 'myetal.saved_shares.v1';

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    _dump: () => store.get(STORAGE_KEY),
  };
}

function entry(code: string, overrides: Partial<SavedShare> = {}): Omit<SavedShare, 'saved_at'> {
  return {
    short_code: code,
    name: `Share ${code}`,
    description: null,
    type: 'conference',
    owner_name: 'Ada Lovelace',
    item_count: 3,
    ...overrides,
  };
}

describe('without a window (RSC safety)', () => {
  it('reads as empty and writes as no-ops instead of throwing', () => {
    expect(getSavedShares()).toEqual([]);
    expect(isShareSaved('abc')).toBe(false);
    expect(() => saveShare(entry('abc'))).not.toThrow();
    expect(() => unsaveShare('abc')).not.toThrow();
  });
});

describe('with a window', () => {
  let ls: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    ls = makeLocalStorage();
    vi.stubGlobal('window', { localStorage: ls });
    vi.stubGlobal('localStorage', ls);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('round-trips a saved share with a stamped saved_at', () => {
    saveShare(entry('abc123'));
    const shares = getSavedShares();
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({
      short_code: 'abc123',
      name: 'Share abc123',
      saved_at: '2026-07-06T12:00:00.000Z',
    });
    expect(isShareSaved('abc123')).toBe(true);
    expect(isShareSaved('nope')).toBe(false);
  });

  it('prepends newest first', () => {
    saveShare(entry('first'));
    saveShare(entry('second'));
    expect(getSavedShares().map((s) => s.short_code)).toEqual(['second', 'first']);
  });

  it('dedupes by short_code, moving a re-save to the front with fresh metadata', () => {
    saveShare(entry('aaa', { name: 'Old name' }));
    saveShare(entry('bbb'));
    saveShare(entry('aaa', { name: 'New name' }));
    const shares = getSavedShares();
    expect(shares.map((s) => s.short_code)).toEqual(['aaa', 'bbb']);
    expect(shares[0].name).toBe('New name');
  });

  it('caps the list at 50 entries, evicting the oldest', () => {
    for (let i = 0; i < 55; i++) saveShare(entry(`code-${i}`));
    const shares = getSavedShares();
    expect(shares).toHaveLength(50);
    expect(shares[0].short_code).toBe('code-54');
    expect(shares.at(-1)?.short_code).toBe('code-5');
  });

  it('unsave removes only the matching entry', () => {
    saveShare(entry('keep'));
    saveShare(entry('drop'));
    unsaveShare('drop');
    expect(getSavedShares().map((s) => s.short_code)).toEqual(['keep']);
  });

  it('treats corrupt JSON as empty', () => {
    ls.setItem(STORAGE_KEY, '{not json');
    expect(getSavedShares()).toEqual([]);
  });

  it('treats a non-array payload as empty', () => {
    ls.setItem(STORAGE_KEY, JSON.stringify({ sneaky: true }));
    expect(getSavedShares()).toEqual([]);
  });

  it('filters out malformed entries but keeps valid ones', () => {
    const valid: SavedShare = { ...entry('good'), saved_at: '2026-01-01T00:00:00.000Z' };
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify([valid, { short_code: 42 }, null, 'string', { ...valid, item_count: 'three' }]),
    );
    const shares = getSavedShares();
    expect(shares).toHaveLength(1);
    expect(shares[0].short_code).toBe('good');
  });

  it('swallows storage write failures (quota exceeded)', () => {
    ls.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => saveShare(entry('abc'))).not.toThrow();
    expect(() => unsaveShare('abc')).not.toThrow();
  });
});
