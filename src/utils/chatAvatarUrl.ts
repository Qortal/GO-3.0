import { sniffImageType } from '../lib/qdnAvatars/imageBytes';

/** Drop `async=true` so the node blocks until the thumbnail is actually fetched. */
function stripAvatarAsyncQuery(url: string): string {
  return url
    .replace(/([?&])async=true(&?)/, (_m, sep, trailing) =>
      trailing ? sep : ''
    )
    .replace(/[?&]$/, '');
}

/** Build avatar URL via createEndpoint so apiKey / node base are included. */
export async function buildChatUserAvatarNotificationUrl(
  createEndpoint: (endpoint: string) => Promise<string>,
  name?: string | null,
  address?: string | null
): Promise<string> {
  const trimmed = name?.trim();
  if (!trimmed) return '';
  const path = `/arbitrary/THUMBNAIL/${encodeURIComponent(trimmed)}/qortal_avatar`;
  let url = await createEndpoint(path);
  const addr = address?.trim();
  const separator = url.includes('?') ? '&' : '?';
  url += `${separator}async=true`;
  if (addr) {
    url += `&_=${encodeURIComponent(addr)}`;
  }
  return url;
}

/** Fetch avatar bytes in JS (WebView) and return a data-URL for native notifications. */
export async function fetchChatAvatarDataUrl(
  iconUrl: string
): Promise<string | undefined> {
  const url = iconUrl?.trim();
  if (!url) return undefined;

  // Prefer the blocking variant: `async=true` can answer 200 with an empty
  // body while the node is still caching the thumbnail.
  const withoutAsync = stripAvatarAsyncQuery(url);
  const candidates = [...new Set([withoutAsync, url])];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.size) continue;
      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      // The node serves thumbnails as octet-stream: trust the magic bytes.
      const type = sniffImageType(head);
      if (!type || type === 'image/avif') continue;
      const dataUrl = await new Promise<string | undefined>(
        (resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(
              typeof reader.result === 'string' ? reader.result : undefined
            );
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }
      );
      if (dataUrl?.startsWith('data:')) {
        return dataUrl;
      }
    } catch {
      // try next candidate
    }
  }

  return undefined;
}
