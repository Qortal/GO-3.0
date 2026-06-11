import { getBaseApiReact } from '../App';

/** QDN group avatar thumbnail path (blocking fetch — avoids empty async bodies). */
export function buildGroupAvatarUrl(
  ownerName: string | null | undefined,
  groupId: string | number | null | undefined
): string | null {
  const name = ownerName?.trim();
  if (!name || groupId == null || groupId === '') return null;
  const base = getBaseApiReact().replace(/\/$/, '');
  return `${base}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_group_avatar_${encodeURIComponent(String(groupId))}`;
}

export function buildGroupAvatarUrlAsyncFallback(
  blockingUrl: string | null
): string | null {
  if (!blockingUrl) return null;
  const separator = blockingUrl.includes('?') ? '&' : '?';
  return `${blockingUrl}${separator}async=true`;
}
