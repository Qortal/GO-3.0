/**
 * Node API helpers shared by the Qortino QDN lookups. Only depends on
 * utils/globalApi, so importing it never pulls in other Qortino modules.
 */
import { getBaseApiReact, getBaseApiReactForAvatar } from '../utils/globalApi';

/** GET a node API path as JSON. Null on a non-OK status or any error. */
export async function apiGetJson<T>(
  path: string,
  signal?: AbortSignal
): Promise<T | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** A name's QDN avatar thumbnail; `address` adds a per-address cache key. */
export function avatarUrlFor(name: string, address?: string): string {
  // HTTP on local HTTPS so Capacitor WebView <img> avatars actually load.
  const base = getBaseApiReactForAvatar().replace(/\/$/, '');
  let url = `${base}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
  if (address) url += `&_=${encodeURIComponent(address)}`;
  return url;
}
