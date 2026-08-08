/**
 * Hub / Q-App user profile (DOCUMENT/qortal_profile) — bio, tagline, custom links.
 * Used to enrich who-is descriptions when the on-chain name data is empty.
 */
import { getBaseApiReact } from '../utils/globalApi';

export type QortalProfileLink = {
  label: string;
  href: string;
};

export type QortalUserProfile = {
  tagline?: string;
  bio?: string;
  links: QortalProfileLink[];
};

async function apiGetJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function collectLinks(customData: unknown): QortalProfileLink[] {
  if (!customData || typeof customData !== 'object') return [];
  const out: QortalProfileLink[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, pathLabel?: string) => {
    if (!node) return;
    if (typeof node === 'string') {
      const href = node.trim();
      if (!isHttpUrl(href) && !href.toLowerCase().startsWith('qortal://')) return;
      const key = href.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        label: (pathLabel || href).slice(0, 80),
        href,
      });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, pathLabel);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === 'string' && (isHttpUrl(v) || v.toLowerCase().startsWith('qortal://'))) {
          walk(v, k);
        } else {
          walk(v, k);
        }
      }
    }
  };

  walk(customData);
  return out.slice(0, 8);
}

/** Fetch DOCUMENT/{name}/qortal_profile when published. */
export async function fetchQortalUserProfile(
  name: string,
  signal?: AbortSignal
): Promise<QortalUserProfile | null> {
  const n = name.trim();
  if (!n) return null;
  const data = await apiGetJson<Record<string, unknown>>(
    `/arbitrary/DOCUMENT/${encodeURIComponent(n)}/qortal_profile`,
    signal
  );
  if (!data || typeof data !== 'object' || 'error' in data) return null;

  const tagline =
    typeof data.tagline === 'string' && data.tagline.trim()
      ? data.tagline.trim()
      : undefined;
  const bio =
    typeof data.bio === 'string' && data.bio.trim() ? data.bio.trim() : undefined;
  const links = collectLinks(data.customData);

  if (!tagline && !bio && !links.length) return null;
  return { tagline, bio, links };
}

/** Try primary name first, then the looked-up name. */
export async function fetchQortalUserProfileForNames(
  names: string[],
  signal?: AbortSignal
): Promise<QortalUserProfile | null> {
  const seen = new Set<string>();
  for (const raw of names) {
    const n = raw.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = await fetchQortalUserProfile(n, signal);
    if (hit) return hit;
  }
  return null;
}

/** Build a single description line from Hub profile fields. */
export function formatProfileDescriptionBits(
  profile: QortalUserProfile | null | undefined
): string {
  if (!profile) return '';
  const bits: string[] = [];
  if (profile.tagline) bits.push(profile.tagline);
  if (profile.bio) bits.push(profile.bio);
  if (profile.links.length) {
    bits.push(
      `Links: ${profile.links.map((l) => `${l.label} (${l.href})`).join('; ')}`
    );
  }
  return bits.join(' ').trim();
}
