/**
 * Pin / share Qortino media shelves (localStorage + qortal:// link list).
 */
import { preferredQortalLink } from './qdnAppLinks';
import type { QdnMediaItem } from './qdnMedia';

const STORAGE_KEY = 'qortino.mediaShelves.v1';

export type SavedMediaShelf = {
  id: string;
  title: string;
  savedAt: number;
  items: QdnMediaItem[];
};

function readAll(): SavedMediaShelf[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedMediaShelf[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(shelves: SavedMediaShelf[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shelves.slice(0, 40)));
  } catch {
    /* quota */
  }
}

export function listSavedShelves(): SavedMediaShelf[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveMediaShelf(
  items: QdnMediaItem[],
  title?: string
): SavedMediaShelf | null {
  if (!items.length) return null;
  const shelf: SavedMediaShelf = {
    id: `shelf-${Date.now()}`,
    title:
      title?.trim() ||
      `QDN shelf · ${items.length} item${items.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString()}`,
    savedAt: Date.now(),
    items: items.slice(0, 48),
  };
  const all = readAll().filter((s) => s.id !== shelf.id);
  all.unshift(shelf);
  writeAll(all);
  return shelf;
}

export function qortalLinkForItem(item: QdnMediaItem): string {
  return preferredQortalLink(item);
}

export function formatShelfShareText(shelf: {
  title: string;
  items: QdnMediaItem[];
}): string {
  const lines = shelf.items.map(
    (i, n) => `${n + 1}. ${i.title} — ${qortalLinkForItem(i)}`
  );
  return `${shelf.title}\n\n${lines.join('\n')}`;
}

export function detectSavedShelfIntent(query: string): boolean {
  const t = query.trim().toLowerCase();
  return (
    /\b(saved|pinned)\s+(shelves?|media|grids?)\b/.test(t) ||
    /\b(show|list|open)\s+(my\s+)?(saved|pinned)\b/.test(t) ||
    /\bmy\s+(media\s+)?shelves?\b/.test(t)
  );
}

export function formatSavedShelvesAnswer(shelves: SavedMediaShelf[]): string {
  if (!shelves.length) {
    return 'You have no saved media shelves yet. On any QDN media grid, tap “Save shelf” to pin it here.';
  }
  const lines = shelves.slice(0, 12).map((s, i) => {
    const when = new Date(s.savedAt).toLocaleString();
    return `${i + 1}. ${s.title} (${s.items.length} items · ${when})`;
  });
  return (
    `Your saved QDN media shelves (${shelves.length}):\n${lines.join('\n')}\n\n` +
    `Showing the newest shelf as cards below. Ask to open another by number later if you like.`
  );
}
