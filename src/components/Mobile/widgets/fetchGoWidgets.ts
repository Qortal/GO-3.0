import {
  GO_WIDGET_IDENTIFIER_PREFIX,
  goWidgetKey,
  toGoWidgetListing,
  type GoWidgetListing,
  type QdnAppResource,
} from './goWidgets';

/**
 * The widgets published on QDN, for the picker. Two searches, side by side:
 *
 * - by identifier prefix (`go-widget…`): Core filters it on the node, so the
 *   answer holds widgets only and is small and quick;
 * - every APP resource with its metadata, filtered here by the `go-widget`
 *   tag (Core's search has no tag filter). About 500 apps today, 150 KB.
 *
 * Either one failing still shows what the other found. Blocked names are left
 * out by the node (excludeblocked). Kept for a few minutes per node, so the
 * picker opening again shows the list at once.
 */
const CACHE_MS = 10 * 60_000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const cache = new Map<string, { at: number; widgets: GoWidgetListing[] }>();

export const goWidgetSearchUrls = (baseUrl: string) => {
  const common =
    'service=APP&mode=ALL&limit=0&includemetadata=true&excludeblocked=true';
  return {
    byIdentifier: `${baseUrl}/arbitrary/resources/search?${common}&identifier=${encodeURIComponent(
      GO_WIDGET_IDENTIFIER_PREFIX
    )}&prefix=true`,
    byTag: `${baseUrl}/arbitrary/resources/search?${common}`,
  };
};

const fetchList = async (
  fetcher: Fetcher,
  url: string,
  signal?: AbortSignal
): Promise<QdnAppResource[]> => {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
};

/** Newest first; one entry per widget (the newest version). */
export const mergeGoWidgetResults = (
  ...lists: Array<readonly QdnAppResource[]>
): GoWidgetListing[] => {
  const byKey = new Map<string, GoWidgetListing>();
  for (const list of lists) {
    for (const resource of list) {
      const listing = toGoWidgetListing(resource);
      if (!listing) continue;
      const key = goWidgetKey(listing);
      const known = byKey.get(key);
      if (!known || listing.updated > known.updated) byKey.set(key, listing);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.updated - a.updated || a.title.localeCompare(b.title)
  );
};

export async function fetchGoWidgets(
  baseUrl: string,
  {
    fetcher = (url, init) => fetch(url, init),
    signal,
    fresh = false,
    now = Date.now(),
  }: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    /** Ask the node again even if a recent answer is kept. */
    fresh?: boolean;
    now?: number;
  } = {}
): Promise<GoWidgetListing[]> {
  const cached = cache.get(baseUrl);
  if (!fresh && cached && now - cached.at < CACHE_MS) return cached.widgets;

  const urls = goWidgetSearchUrls(baseUrl);
  const [byIdentifier, byTag] = await Promise.allSettled([
    fetchList(fetcher, urls.byIdentifier, signal),
    fetchList(fetcher, urls.byTag, signal),
  ]);
  if (byIdentifier.status === 'rejected' && byTag.status === 'rejected') {
    throw byTag.reason ?? byIdentifier.reason;
  }
  const widgets = mergeGoWidgetResults(
    byIdentifier.status === 'fulfilled' ? byIdentifier.value : [],
    byTag.status === 'fulfilled' ? byTag.value : []
  );
  // Only a full answer with widgets in it is kept: a half one, or none yet
  // (a widget published a minute ago), is asked again next time.
  if (
    byIdentifier.status === 'fulfilled' &&
    byTag.status === 'fulfilled' &&
    widgets.length > 0
  ) {
    cache.set(baseUrl, { at: now, widgets });
  }
  return widgets;
}

export const clearGoWidgetCacheForTests = () => cache.clear();
