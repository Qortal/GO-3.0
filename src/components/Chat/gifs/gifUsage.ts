import { libraryGifKey, type LibraryGif } from './libraryGifs';

const STORAGE_KEY = 'qortal-gif-usage-v1';
const MAX_ENTRIES = 40;

type GifUsageEntry = {
  count: number;
  description?: string;
  identifier: string;
  lastUsed: number;
  name: string;
  service: string;
};

const readUsage = (): Record<string, GifUsageEntry> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, GifUsageEntry>;
  } catch {
    return {};
  }
};

const writeUsage = (map: Record<string, GifUsageEntry>) => {
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries
        .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
        .slice(MAX_ENTRIES)
        .forEach(([key]) => {
          delete map[key];
        });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
};

export const recordGifUse = (gif: LibraryGif) => {
  const key = libraryGifKey(gif);
  const map = readUsage();
  const prev = map[key];
  map[key] = {
    count: (prev?.count || 0) + 1,
    description: gif.description || prev?.description,
    identifier: gif.identifier,
    lastUsed: Date.now(),
    name: gif.name,
    service: gif.service || 'IMAGE',
  };
  writeUsage(map);
};

export const mostUsedGifs = (limit = 8): LibraryGif[] =>
  Object.values(readUsage())
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map((entry) => ({
      description: entry.description,
      identifier: entry.identifier,
      name: entry.name,
      service: entry.service || 'IMAGE',
    }));
