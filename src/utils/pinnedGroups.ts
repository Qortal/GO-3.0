import { getData, storeData } from './chromeStorage';

const STORAGE_KEY = 'qortalGoPinnedGroupIds';

let cachedPinnedIds: string[] | null = null;
const listeners = new Set<() => void>();

function normalizeId(id: string | number | null | undefined): string {
  if (id == null || id === '') return '';
  return String(id);
}

export async function loadPinnedGroupIds(): Promise<string[]> {
  if (cachedPinnedIds) return cachedPinnedIds;
  const stored = await getData<string[]>(STORAGE_KEY);
  cachedPinnedIds = Array.isArray(stored)
    ? stored.map(normalizeId).filter(Boolean)
    : [];
  return cachedPinnedIds;
}

export function getPinnedGroupIdsSync(): string[] {
  return cachedPinnedIds ? [...cachedPinnedIds] : [];
}

export async function setPinnedGroupIds(ids: string[]): Promise<void> {
  cachedPinnedIds = ids.map(normalizeId).filter(Boolean);
  await storeData(STORAGE_KEY, cachedPinnedIds);
  listeners.forEach((listener) => listener());
}

export async function togglePinnedGroup(
  groupId: string | number
): Promise<boolean> {
  const id = normalizeId(groupId);
  if (!id) return false;
  const current = await loadPinnedGroupIds();
  const isPinned = current.includes(id);
  const next = isPinned
    ? current.filter((item) => item !== id)
    : [id, ...current.filter((item) => item !== id)];
  await setPinnedGroupIds(next);
  return !isPinned;
}

export function isGroupPinned(groupId: string | number | null | undefined): boolean {
  const id = normalizeId(groupId);
  return !!id && (cachedPinnedIds || []).includes(id);
}

/** Pinned groups first (in pin order), then the rest in their existing order. */
export function applyPinnedGroupOrder<T extends { groupId?: string | number }>(
  groups: T[],
  pinnedIds: string[] = getPinnedGroupIdsSync()
): T[] {
  if (!Array.isArray(groups) || !groups.length || !pinnedIds.length) {
    return groups;
  }
  const pinSet = new Set(pinnedIds);
  const pinned: T[] = [];
  for (const id of pinnedIds) {
    const match = groups.find((g) => normalizeId(g.groupId) === id);
    if (match) pinned.push(match);
  }
  const unpinned = groups.filter((g) => !pinSet.has(normalizeId(g.groupId)));
  return [...pinned, ...unpinned];
}

export function subscribePinnedGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Warm the cache early so list sorts can use sync reads.
void loadPinnedGroupIds();
