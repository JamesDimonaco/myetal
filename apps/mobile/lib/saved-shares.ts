import AsyncStorage from '@react-native-async-storage/async-storage';

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

export async function getSavedShares(): Promise<SavedShare[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedShare);
  } catch {
    return [];
  }
}

export async function saveShare(entry: Omit<SavedShare, 'saved_at'>): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getSavedShares();

  const filtered = existing.filter((e) => e.short_code !== entry.short_code);
  const next: SavedShare[] = [{ ...entry, saved_at: now }, ...filtered].slice(0, MAX_ENTRIES);

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage failure shouldn't break the viewer; silently drop.
  }
}

export async function unsaveShare(shortCode: string): Promise<void> {
  try {
    const existing = await getSavedShares();
    const next = existing.filter((e) => e.short_code !== shortCode);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export async function isShareSaved(shortCode: string): Promise<boolean> {
  try {
    const existing = await getSavedShares();
    return existing.some((e) => e.short_code === shortCode);
  } catch {
    return false;
  }
}

export async function clearSavedShares(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isSavedShare(value: unknown): value is SavedShare {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.short_code === 'string' &&
    typeof v.name === 'string' &&
    (v.description === null || typeof v.description === 'string') &&
    typeof v.type === 'string' &&
    (v.owner_name === null || typeof v.owner_name === 'string') &&
    typeof v.item_count === 'number' &&
    typeof v.saved_at === 'string'
  );
}
