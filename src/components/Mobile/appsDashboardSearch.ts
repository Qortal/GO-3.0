import { extractComponents } from '../Chat/MessageDisplay';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { officialAppList } from '../Apps/config/officialApps';
import { executeEvent } from '../../utils/events';
import {
  getAppOpenCountKey,
  sortAppsByOpenCount,
  type AppOpenCounts,
} from './mobileAppOpenCounts';

export const MOBILE_APPS_SEARCH_PLACEHOLDER = 'qortal://';

const MAX_SUGGESTIONS = 8;
const MAX_DEFAULT_APPS = 16;

export function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

export function canOpenQueryAsQortalLink(query: string) {
  const normalized = normalizeQortalInput(query);
  if (!normalized) return false;
  return !!extractComponents(normalized);
}

/** True when the query is a bare name (no service/path), e.g. "QWB". */
export function isBareQortalNameQuery(query: string): boolean {
  const trimmed = (query || '').trim();
  if (!trimmed) return false;
  if (/^qortal:\/\//i.test(trimmed)) {
    const rest = trimmed.replace(/^qortal:\/\//i, '').trim();
    return Boolean(rest) && !rest.includes('/');
  }
  return !trimmed.includes('/');
}

export type AppsSearchSuggestion =
  | { type: 'link'; label: string }
  | { type: 'app'; app: any };

function metadataTags(app: any): string[] {
  const tags = app?.metadata?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.toLowerCase());
}

/** Initials of title words — "Qortal Web Builder" → "qwb". */
export function titleAcronym(title: string): string {
  return (title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('');
}

/**
 * Higher score = better match. 0 means no match.
 * Exact name beats title/tag/acronym hits so "QWB" surfaces the QWB app
 * ahead of looser description matches.
 */
export function scoreAppSearchMatch(app: any, query: string): number {
  const q = (query || '').trim().toLowerCase();
  if (!q) return 0;

  const name = String(app?.name ?? '').toLowerCase();
  const title = String(app?.metadata?.title ?? '').toLowerCase();
  const desc = String(app?.metadata?.description ?? '').toLowerCase();
  const tags = metadataTags(app);
  const acronym = titleAcronym(title);

  if (name === q) return 1000;
  if (title === q) return 900;
  if (tags.some((tag) => tag === q)) return 850;
  if (acronym === q) return 800;
  if (name.startsWith(q)) return 700;
  if (title.startsWith(q)) return 650;
  if (name.includes(q)) return 500;
  if (title.includes(q)) return 450;
  if (tags.some((tag) => tag.includes(q))) return 400;
  if (acronym.includes(q) && q.length >= 2) return 350;
  if (desc.includes(q)) return 200;
  return 0;
}

export function appMatchesSearchQuery(app: any, query: string): boolean {
  return scoreAppSearchMatch(app, query) > 0;
}

function sortMatchedApps(
  apps: any[],
  query: string,
  openCounts: AppOpenCounts
): any[] {
  return [...apps].sort((left, right) => {
    const scoreDiff =
      scoreAppSearchMatch(right, query) - scoreAppSearchMatch(left, query);
    if (scoreDiff !== 0) return scoreDiff;
    const countDiff =
      (openCounts[getAppOpenCountKey(right)] || 0) -
      (openCounts[getAppOpenCountKey(left)] || 0);
    if (countDiff !== 0) return countDiff;
    const titleLeft = String(left?.metadata?.title || left?.name || '');
    const titleRight = String(right?.metadata?.title || right?.name || '');
    return titleLeft.localeCompare(titleRight);
  });
}

export function buildAppsSearchSuggestions(
  query: string,
  availableQapps: any[],
  openAsLinkLabel: string,
  openCounts: AppOpenCounts = {}
): AppsSearchSuggestion[] {
  const officialApps = sortAppsByOpenCount(
    availableQapps.filter((app) =>
      officialAppList.includes((app?.name ?? '').toLowerCase())
    ),
    openCounts
  );

  const q = (query || '').trim().toLowerCase();
  if (!q) {
    return officialApps
      .slice(0, MAX_DEFAULT_APPS)
      .map((app) => ({ type: 'app' as const, app }));
  }

  const filteredApps = sortMatchedApps(
    availableQapps.filter((app) => appMatchesSearchQuery(app, q)),
    q,
    openCounts
  );

  const exactNameMatch = filteredApps.some(
    (app) => String(app?.name ?? '').toLowerCase() === q
  );
  // Bare names like "QWB" are also valid qortal://WEBSITE links, which used to
  // steal the top suggestion and hide the real APP. Prefer the matched app.
  const showLinkSuggestion =
    canOpenQueryAsQortalLink(query) &&
    (!isBareQortalNameQuery(query) || !exactNameMatch);

  const list: AppsSearchSuggestion[] = [];
  const appSlots = MAX_SUGGESTIONS - (showLinkSuggestion ? 1 : 0);
  filteredApps.slice(0, Math.max(0, appSlots)).forEach((app) => {
    list.push({ type: 'app', app });
  });
  if (showLinkSuggestion) {
    list.push({ type: 'link', label: openAsLinkLabel });
  }
  return list;
}

export function openAppsSearchApp(app: any) {
  executeEvent('recordAppOpen', { data: app });
  executeEvent('addTab', { data: app });
  executeEvent('open-apps-mode', {});
}

/**
 * Resolve a typed query to a tab. Bare names that match a published APP open
 * as APP (not the default WEBSITE guess from extractComponents).
 */
export function openAppsSearchLink(
  query: string,
  availableQapps: any[] = []
): boolean {
  const normalized = normalizeQortalInput(query);
  const res = extractComponents(normalized);
  if (!res) return false;
  let { service, name, identifier, path } = res;

  if (
    isBareQortalNameQuery(query) &&
    service === 'WEBSITE' &&
    typeof name === 'string' &&
    name
  ) {
    const matchedApp = availableQapps.find(
      (app) =>
        String(app?.service ?? '').toUpperCase() === 'APP' &&
        String(app?.name ?? '').toLowerCase() === name.toLowerCase()
    );
    if (matchedApp) {
      service = 'APP';
      name = matchedApp.name;
    }
  }

  executeEvent('addTab', { data: { service, name, identifier, path } });
  executeEvent('open-apps-mode', {});
  return true;
}
