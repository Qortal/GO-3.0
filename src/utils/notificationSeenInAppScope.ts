/**
 * Seen-in-app keys are stored per address across every Q-App, e.g.
 * `RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification-<identifier>`. A Q-App
 * may only learn about its own keys, so this narrows a key list to those under
 * `RESOURCE_PUBLISHED-${appName}-${appService}-`, the prefix
 * markNotificationSeenInApp and getNotificationSeenPrefixKey build.
 */
export function filterSeenInAppKeysForApp(
  keys: string[],
  appName: string,
  appService: string
): string[] {
  if (!Array.isArray(keys)) return [];
  const prefix = `RESOURCE_PUBLISHED-${(appName ?? '').toLowerCase()}-${appService ?? 'APP'}-`;
  return keys.filter((k) => typeof k === 'string' && k.startsWith(prefix));
}
