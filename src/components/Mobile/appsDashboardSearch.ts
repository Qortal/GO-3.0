import { extractComponents } from '../Chat/MessageDisplay';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { officialAppList } from '../Apps/config/officialApps';
import { executeEvent } from '../../utils/events';
import { sortAppsByOpenCount, type AppOpenCounts } from './mobileAppOpenCounts';

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

export type AppsSearchSuggestion =
  | { type: 'link'; label: string }
  | { type: 'app'; app: any };

export function buildAppsSearchSuggestions(
  query: string,
  availableQapps: any[],
  openAsLinkLabel: string,
  openCounts: AppOpenCounts = {}
): AppsSearchSuggestion[] {
  const canOpenAsLink = canOpenQueryAsQortalLink(query);

  const officialApps = sortAppsByOpenCount(
    availableQapps.filter((app) =>
      officialAppList.includes((app?.name ?? '').toLowerCase())
    ),
    openCounts
  );

  const q = (query || '').trim().toLowerCase();
  const filteredApps = sortAppsByOpenCount(
    !q
      ? officialApps.slice(0, MAX_DEFAULT_APPS)
      : availableQapps.filter((app) => {
          const name = (app?.name ?? '').toLowerCase();
          const title = (app?.metadata?.title ?? '').toLowerCase();
          const desc = (app?.metadata?.description ?? '').toLowerCase();
          return name.includes(q) || title.includes(q) || desc.includes(q);
        }),
    openCounts
  );

  const list: AppsSearchSuggestion[] = [];
  if (canOpenAsLink && query.trim()) {
    list.push({ type: 'link', label: openAsLinkLabel });
  }
  filteredApps
    .slice(0, MAX_SUGGESTIONS - list.length)
    .forEach((app) => list.push({ type: 'app', app }));

  if (!query.trim()) {
    return filteredApps.map((app) => ({ type: 'app', app }));
  }
  return list;
}

export function openAppsSearchApp(app: any) {
  executeEvent('recordAppOpen', { data: app });
  executeEvent('addTab', { data: app });
  executeEvent('open-apps-mode', {});
}

export function openAppsSearchLink(query: string) {
  const normalized = normalizeQortalInput(query);
  const res = extractComponents(normalized);
  if (!res) return false;
  const { service, name, identifier, path } = res;
  executeEvent('addTab', { data: { service, name, identifier, path } });
  executeEvent('open-apps-mode', {});
  return true;
}
