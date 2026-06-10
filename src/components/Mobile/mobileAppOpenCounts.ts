import { getData, storeData } from '../../utils/chromeStorage';
import { getOpenTabKey } from './mobileTabOrganization';
import type { OpenTab } from './useOpenTabs';

const STORAGE_PREFIX = 'hub_mobile_app_open_counts_';

export type AppOpenCounts = Record<string, number>;

export function getAppOpenCountKey(appOrTab: OpenTab | Record<string, unknown>): string {
  return getOpenTabKey(appOrTab as OpenTab);
}

export async function loadAppOpenCounts(
  walletAddress: string | undefined | null
): Promise<AppOpenCounts> {
  if (!walletAddress) return {};
  const stored = await getData<AppOpenCounts>(
    `${STORAGE_PREFIX}${walletAddress}`
  );
  if (!stored || typeof stored !== 'object') return {};
  return Object.fromEntries(
    Object.entries(stored).filter(
      ([key, value]) => key && typeof value === 'number' && value > 0
    )
  );
}

export async function saveAppOpenCounts(
  walletAddress: string | undefined | null,
  counts: AppOpenCounts
): Promise<void> {
  if (!walletAddress) return;
  await storeData(`${STORAGE_PREFIX}${walletAddress}`, counts);
}

export function sortAppsByOpenCount<T extends Record<string, unknown>>(
  apps: T[],
  counts: AppOpenCounts
): T[] {
  return [...apps].sort((a, b) => {
    const countDiff =
      (counts[getAppOpenCountKey(b)] ?? 0) - (counts[getAppOpenCountKey(a)] ?? 0);
    if (countDiff !== 0) return countDiff;

    const titleA = String(a?.metadata?.title || a?.name || '').toLowerCase();
    const titleB = String(b?.metadata?.title || b?.name || '').toLowerCase();
    return titleA.localeCompare(titleB);
  });
}

export function incrementAppOpenCount(
  counts: AppOpenCounts,
  appOrTab: OpenTab | Record<string, unknown>
): AppOpenCounts {
  const key = getAppOpenCountKey(appOrTab);
  if (!key) return counts;
  return {
    ...counts,
    [key]: (counts[key] ?? 0) + 1,
  };
}
