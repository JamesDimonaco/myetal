const STORAGE_KEY = 'myetal.saved_shares.v1';
const MAX_ENTRIES = 50;

export interface SavedShare {
  short_code: string;
  name: string;
  description: string | null;
  type: string;
  owner_name: string | null;
  item_count: number;
  saved_at: string;
}

function isSavedShare(value: unknown): value is SavedShare {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.short_code === 'string' &&
    typeof v.name === 'string' &&
    (typeof v.description === 'string' || v.description === null) &&
    typeof v.type === 'string' &&
    (typeof v.owner_name === 'string' || v.owner_name === null) &&
    typeof v.item_count === 'number' &&
    typeof v.saved_at === 'string'
  );
}

export function getSavedShares(): SavedShare[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedShare);
  } catch {
    return [];
  }
}

export function saveShare(entry: Omit<SavedShare, 'saved_at'>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getSavedShares();
    const newEntry: SavedShare = { ...entry, saved_at: new Date().toISOString() };
    const deduped = current.filter((s) => s.short_code !== entry.short_code);
    const updated = [newEntry, ...deduped].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage full or unavailable — silently fail.
  }
}

export function unsaveShare(shortCode: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getSavedShares();
    const updated = current.filter((s) => s.short_code !== shortCode);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage unavailable — silently fail.
  }
}

export function isShareSaved(shortCode: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return getSavedShares().some((s) => s.short_code === shortCode);
  } catch {
    return false;
  }
}
