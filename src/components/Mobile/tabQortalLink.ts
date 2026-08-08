import { QORTAL_PROTOCOL } from '../../constants/constants';
import { getTabAppIdentity } from './privateAppTabIdentity';
import type { OpenTab } from './useOpenTabs';

export function buildTabQortalUrl(tab: OpenTab): string {
  if (tab.internal) return `${QORTAL_PROTOCOL}${tab.internal}`;
  const { service, name, identifier, path } = getTabAppIdentity(tab);
  const encodedName = name.replace(/ /g, '%20');
  const pathPart = path ? String(path) : '';
  const identifierPart = identifier
    ? `${pathPart.includes('?') ? '&' : '?'}identifier=${encodeURIComponent(identifier)}`
    : '';
  return `${QORTAL_PROTOCOL}${service}/${encodedName}${pathPart}${identifierPart}`;
}
