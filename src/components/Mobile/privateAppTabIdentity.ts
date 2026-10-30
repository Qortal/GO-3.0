import type { OpenTab } from './useOpenTabs';

type PrivateAppProperties = {
  service?: string;
  name?: string;
  identifier?: string;
  groupId?: string | number;
  appName?: string;
  logo?: string;
  [key: string]: unknown;
};

/** Identity fields needed to fetch/decrypt a private Q-App. */
type PrivateAppIdentity = {
  service: string;
  name: string;
  identifier: string;
  groupId?: string | number;
  appName?: string;
  logo?: string;
};

function getPrivateAppProperties(
  tab: OpenTab | Record<string, unknown> | null | undefined
): PrivateAppProperties | null {
  const props = tab?.privateAppProperties;
  if (!props || typeof props !== 'object') return null;
  return props as PrivateAppProperties;
}

export function isPrivateAppTab(
  tab: OpenTab | Record<string, unknown> | null | undefined
): boolean {
  if (!tab) return false;
  return tab.isPrivate === true || getPrivateAppProperties(tab) != null;
}

/**
 * Resolve public tab fields, falling back to privateAppProperties.
 * Private opens historically only stored identity inside privateAppProperties.
 */
export function getTabAppIdentity(
  tab: OpenTab | Record<string, unknown> | null | undefined
): {
  service: string;
  name: string;
  identifier?: string;
  label: string;
  path?: string;
} {
  const priv = getPrivateAppProperties(tab);
  const service = String(tab?.service || priv?.service || 'APP');
  const name = String(tab?.name || priv?.name || '');
  const identifierRaw = tab?.identifier ?? priv?.identifier;
  const identifier =
    identifierRaw != null && String(identifierRaw) !== ''
      ? String(identifierRaw)
      : undefined;
  const label = String(
    tab?.label || priv?.appName || priv?.name || tab?.name || name || service
  );
  const path = tab?.path != null ? String(tab.path) : undefined;
  return { service, name, identifier, label, path };
}

/** True when we have enough data to re-open a private app via decrypt/preview. */
export function getPrivateAppIdentity(
  tab: OpenTab | Record<string, unknown> | null | undefined
): PrivateAppIdentity | null {
  const priv = getPrivateAppProperties(tab);
  const identity = getTabAppIdentity(tab);
  const name = String(priv?.name || identity.name || '');
  const service = String(priv?.service || identity.service || 'APP');
  const identifier = String(priv?.identifier || identity.identifier || '');
  if (!name || !identifier) return null;

  const groupId = priv?.groupId ?? (tab as OpenTab)?.groupId;
  return {
    service,
    name,
    identifier,
    ...(groupId != null ? { groupId: groupId as string | number } : {}),
    ...(priv?.appName || identity.label
      ? { appName: String(priv?.appName || identity.label) }
      : {}),
    ...(typeof priv?.logo === 'string'
      ? { logo: priv.logo }
      : typeof (tab as OpenTab)?.logo === 'string'
        ? { logo: String((tab as OpenTab).logo) }
        : {}),
  };
}

/** Persistable privateAppProperties without huge binary logo payloads. */
export function serializePrivateAppProperties(
  tab: OpenTab | Record<string, unknown>
): PrivateAppProperties | undefined {
  const identity = getPrivateAppIdentity(tab);
  if (!identity) {
    const priv = getPrivateAppProperties(tab);
    if (!priv) return undefined;
  }

  const priv = getPrivateAppProperties(tab) || {};
  const resolved = getPrivateAppIdentity(tab);
  if (!resolved) return undefined;

  const logoRaw =
    typeof priv.logo === 'string'
      ? priv.logo
      : typeof (tab as OpenTab).logo === 'string'
        ? String((tab as OpenTab).logo)
        : undefined;
  const logo =
    logoRaw && logoRaw.startsWith('data:') && logoRaw.length <= 250_000
      ? logoRaw
      : undefined;

  return {
    ...priv,
    service: resolved.service,
    name: resolved.name,
    identifier: resolved.identifier,
    ...(resolved.groupId != null ? { groupId: resolved.groupId } : {}),
    ...(resolved.appName ? { appName: resolved.appName } : {}),
    ...(logo ? { logo } : {}),
  };
}
