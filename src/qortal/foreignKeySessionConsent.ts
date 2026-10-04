/**
 * Remembers, for one open Q-App tab, that the user ticked the "your private key
 * will be sent to the node" warning for ARRR wallet reads. ARRR balance, address,
 * transaction and sync-status reads all send the ARRR seed to the node, and a
 * wallet Q-App makes many of them, so one explicit consent covers that tab until
 * it closes. The consent is tied to the app, the wallet address and the node
 * origin (scheme, host and port), so switching account or node asks again,
 * including a switch to another port on 127.0.0.1, where a different app may be
 * listening.
 *
 * This is kept apart from the general session permissions on purpose: those are
 * granted by a bare "authenticate" or by SESSION_PERMISSIONS, neither of which
 * shows the key warning.
 */

export type ForeignKeyConsentScope = {
  tabId: string;
  appName: string;
  address: string;
  /** Node origin, e.g. "http://127.0.0.1:12391". */
  node: string;
  coin: string;
};

const SEPARATOR = '\u0000';

const granted = new Map<string, ForeignKeyConsentScope>();
const pending = new Map<string, Promise<boolean>>();

function scopeKey(scope: ForeignKeyConsentScope): string {
  return [
    scope.tabId,
    scope.appName.toLowerCase(),
    scope.address,
    scope.node.toLowerCase(),
    scope.coin.toUpperCase(),
  ].join(SEPARATOR);
}

/** Builds a scope, or null when the request did not come from a Q-App tab. */
export function foreignKeyConsentScope(input: {
  tabId?: unknown;
  appName?: unknown;
  address?: unknown;
  node?: unknown;
  coin: string;
}): ForeignKeyConsentScope | null {
  const tabId =
    typeof input.tabId === 'string' || typeof input.tabId === 'number'
      ? String(input.tabId)
      : '';
  const appName = typeof input.appName === 'string' ? input.appName : '';
  const address = typeof input.address === 'string' ? input.address : '';
  const node = typeof input.node === 'string' ? input.node : '';
  if (!tabId || !appName || !address || !node) return null;
  return { tabId, appName, address, node, coin: input.coin };
}

export function hasForeignKeyConsent(
  scope: ForeignKeyConsentScope | null
): boolean {
  return !!scope && granted.has(scopeKey(scope));
}

/**
 * Resolves true once the user has agreed for this scope. Concurrent requests
 * share one prompt; a declined prompt is not remembered. Without a scope the
 * user is asked every time.
 */
export async function ensureForeignKeyConsent(
  scope: ForeignKeyConsentScope | null,
  prompt: () => Promise<boolean>
): Promise<boolean> {
  if (!scope) return prompt();
  const key = scopeKey(scope);
  if (granted.has(key)) return true;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const accepted = await prompt();
      if (accepted) granted.set(key, scope);
      return accepted;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}

export function clearForeignKeyConsentForTab(tabId: unknown): void {
  const id = String(tabId ?? '');
  for (const [key, scope] of granted) {
    if (scope.tabId === id) granted.delete(key);
  }
}

export function clearForeignKeyConsentForApp(
  tabId: unknown,
  appName: unknown
): void {
  const id = String(tabId ?? '');
  const app = String(appName ?? '').toLowerCase();
  for (const [key, scope] of granted) {
    if (scope.tabId === id && scope.appName.toLowerCase() === app) {
      granted.delete(key);
    }
  }
}

export function clearAllForeignKeyConsent(): void {
  granted.clear();
}
