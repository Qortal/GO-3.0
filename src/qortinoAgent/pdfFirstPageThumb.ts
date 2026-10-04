/**
 * Render page 1 of a QDN PDF into a small blob: URL for media-card thumbnails.
 */
import { looksLikePdf, loadPdfJs } from './pdfJsLoader';
import {
  waitForQdnResourceReady,
  type QdnMediaItem,
} from './qdnMedia';

const THUMB_MAX_EDGE = 360;
const thumbCache = new Map<string, string>();
const thumbInflight = new Map<string, Promise<string | undefined>>();

function cacheKey(item: Pick<QdnMediaItem, 'service' | 'name' | 'identifier'>) {
  return `${item.service}:${item.name}:${item.identifier}`.toLowerCase();
}

/** Cards that should attempt a first-page PDF thumbnail. */
export function itemLooksLikePdfDocument(item: QdnMediaItem): boolean {
  if (item.kind === 'pdf') return true;
  if (item.kind !== 'file' && item.kind !== 'pdf') return false;
  if (
    looksLikePdf({
      kind: item.kind,
      title: item.title,
      identifier: item.identifier,
    })
  ) {
    return true;
  }
  // Documents chip marks most DOCs as `file` without a .pdf cue — still try.
  return item.service === 'DOCUMENT' || item.service === 'FILE';
}

function startsWithPdfMagic(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 5) return false;
  const head = new Uint8Array(bytes, 0, 5);
  return (
    head[0] === 0x25 && // %
    head[1] === 0x50 && // P
    head[2] === 0x44 && // D
    head[3] === 0x46 && // F
    head[4] === 0x2d // -
  );
}

/**
 * Wait for READY, fetch bytes, render page 1, return a blob: object URL.
 * Returns undefined when the resource is not a renderable PDF.
 */
export async function fetchPdfFirstPageThumbObjectUrl(
  item: QdnMediaItem,
  options?: {
    downloadResource?: (r: {
      name: string;
      service: string;
      identifier: string;
    }) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<string | undefined> {
  const key = cacheKey(item);
  const cached = thumbCache.get(key);
  if (cached) return cached;

  const existing = thumbInflight.get(key);
  if (existing) return existing;

  const work = (async () => {
    try {
      const { url } = await waitForQdnResourceReady(item, {
        downloadResource: options?.downloadResource,
        timeoutMs: options?.timeoutMs ?? 45_000,
        signal: options?.signal,
      });
      if (options?.signal?.aborted) return undefined;

      // Skip huge files for card thumbs (full open still works on tap).
      if (typeof item.size === 'number' && item.size > 18 * 1024 * 1024) {
        return undefined;
      }

      const res = await fetch(url, { signal: options?.signal });
      if (!res.ok) return undefined;
      const blob = await res.blob();
      if (!blob.size) return undefined;

      const data = await blob.arrayBuffer();
      if (!startsWithPdfMagic(data)) return undefined;

      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false })
        .promise;
      const page = await doc.getPage(1);
      const unscaled = page.getViewport({ scale: 1 });
      const scale =
        THUMB_MAX_EDGE / Math.max(unscaled.width, unscaled.height);
      const viewport = page.getViewport({
        scale: Math.max(0.25, Math.min(1.4, scale)),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const thumbBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.78)
      );
      if (!thumbBlob) return undefined;
      const objectUrl = URL.createObjectURL(thumbBlob);
      thumbCache.set(key, objectUrl);
      return objectUrl;
    } catch {
      return undefined;
    } finally {
      thumbInflight.delete(key);
    }
  })();

  thumbInflight.set(key, work);
  return work;
}
