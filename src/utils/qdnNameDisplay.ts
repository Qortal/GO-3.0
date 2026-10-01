/**
 * Q-App and website names as their owner registered them.
 *
 * Names reach GO from URLs and permission keys, lowercased and sometimes
 * still percent-encoded ("simon%20james"). The node's name lookup ignores
 * case and returns the registered spelling ("Simon James"), which is what the
 * person should see.
 */
import { useEffect, useState } from 'react';
import { getBaseApiReact } from './globalApi';

const lookups = new Map<string, Promise<string>>();

/** "simon%20james" → "simon james"; left alone when it is not encoded. */
export function decodeQdnName(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value;
  }
}

/** The registered spelling of a name, or the decoded name if unknown. */
export function resolveRegisteredName(raw: unknown): Promise<string> {
  const decoded = decodeQdnName(raw);
  if (!decoded) return Promise.resolve('');
  const key = decoded.toLowerCase();
  let lookup = lookups.get(key);
  if (!lookup) {
    lookup = fetch(`${getBaseApiReact()}/names/${encodeURIComponent(decoded)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((info) => {
        const name = typeof info?.name === 'string' ? info.name.trim() : '';
        return name && name.toLowerCase() === key ? name : decoded;
      })
      .catch(() => {
        // Try again next time; a node hiccup must not stick.
        lookups.delete(key);
        return decoded;
      });
    lookups.set(key, lookup);
  }
  return lookup;
}

/** Decoded name at once, the registered spelling once the node answers. */
export function useRegisteredName(raw: unknown): string {
  const [name, setName] = useState(() => decodeQdnName(raw));
  useEffect(() => {
    let active = true;
    setName(decodeQdnName(raw));
    void resolveRegisteredName(raw).then((resolved) => {
      if (active && resolved) setName(resolved);
    });
    return () => {
      active = false;
    };
  }, [raw]);
  return name;
}
