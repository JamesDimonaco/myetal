import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ceteris.recent_shares.v1';
const MAX_ENTRIES = 20;

export interface RecentShare {
  short_code: string;
  name: string;
  owner_name: string | null;
  item_count: number;
  viewed_at: string;
}

export async function getRecentShares(): Promise<RecentShare[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentShare);
  } catch {
    return [];
  }
}

export async function trackRecentShare(entry: Omit<RecentShare, 'viewed_at'>): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getRecentShares();

  // Dedup by short_code, refresh the timestamp, move to front, cap length
  const filtered = existing.filter((e) => e.short_code !== entry.short_code);
  const next: RecentShare[] = [{ ...entry, viewed_at: now }, ...filtered].slice(0, MAX_ENTRIES);

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage failure shouldn't break the viewer; silently drop.
  }
}

export async function clearRecentShares(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isRecentShare(value: unknown): value is RecentShare {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.short_code === 'string' &&
    typeof v.name === 'string' &&
    (v.owner_name === null || typeof v.owner_name === 'string') &&
    typeof v.item_count === 'number' &&
    typeof v.viewed_at === 'string'
  );
}
