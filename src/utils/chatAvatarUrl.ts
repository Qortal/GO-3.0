/** Thumbnail URL for a Qortal user's chat avatar (works in background + UI). */
export function buildChatUserAvatarUrl(
  apiBase: string,
  name?: string | null,
  address?: string | null
): string {
  const trimmed = name?.trim();
  if (!apiBase || !trimmed) return '';
  const base = `${apiBase.replace(/\/$/, '')}/arbitrary/THUMBNAIL/${encodeURIComponent(trimmed)}/qortal_avatar?async=true`;
  const addr = address?.trim();
  return addr ? `${base}&_=${encodeURIComponent(addr)}` : base;
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

/**
 * The node serves avatar thumbnails as `application/octet-stream`, so the
 * declared MIME type is useless — sniff the magic bytes instead.
 */
function looksLikeImageBytes(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  // PNG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return true;
  }
  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
  // GIF
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return true;
  // BMP
  if (head[0] === 0x42 && head[1] === 0x4d) return true;
  // WebP: RIFF....WEBP
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Fetch avatar bytes in JS (WebView) and return a data-URL for native notifications. */
export async function fetchChatAvatarDataUrl(
  iconUrl: string
): Promise<string | undefined> {
  const url = iconUrl?.trim();
  if (!url) return undefined;

  // Prefer the blocking variant: `async=true` can answer 200 with an empty
  // body while the node is still caching the thumbnail.
  const withoutAsync = url
    .replace(/([?&])async=true(&?)/, (_m, sep, trailing) =>
      trailing ? sep : ''
    )
    .replace(/[?&]$/, '');
  const candidates = [...new Set([withoutAsync, url])];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.size) continue;
      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      if (!looksLikeImageBytes(head)) continue;
      const dataUrl = await new Promise<string | undefined>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(typeof reader.result === 'string' ? reader.result : undefined);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      if (dataUrl?.startsWith('data:')) {
        return dataUrl;
      }
    } catch {
      // try next candidate
    }
  }

  return undefined;
}
