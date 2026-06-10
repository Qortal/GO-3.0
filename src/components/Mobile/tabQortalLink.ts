import { QORTAL_PROTOCOL } from '../../constants/constants';
import type { OpenTab } from './useOpenTabs';

export function buildTabQortalUrl(tab: OpenTab): string {
  if (tab.internal) return `${QORTAL_PROTOCOL}${tab.internal}`;
  const service = String(tab.service || 'APP');
  const name = String(tab.name || '').replace(/ /g, '%20');
  const path = tab.path ? String(tab.path) : '';
  const identifier = tab.identifier
    ? `${path.includes('?') ? '&' : '?'}identifier=${encodeURIComponent(String(tab.identifier))}`
    : '';
  return `${QORTAL_PROTOCOL}${service}/${name}${path}${identifier}`;
}
