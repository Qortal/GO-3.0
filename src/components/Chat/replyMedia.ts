/**
 * What picture (or video, or file) a quoted message carries, for the small
 * thumbnail in a reply: the composer's reply strip and the quote on a sent
 * reply. Pure: it only reads the message row that is already on screen and
 * never names a URL it did not get from the row's own validated `data:image/`
 * value. Everything else is looked up later in the app's local caches (see
 * `ReplyImageThumbnail`).
 */
import { mediaKindOf } from './chatMediaGallery';
import { isLibraryGifImage } from './gifs/libraryGifs';

type ReplyMediaKind = 'image' | 'gif' | 'video' | 'file';

type ReplyMediaSource =
  | { via: 'data'; src: string }
  | { via: 'reticulum'; fileHash: string }
  | { via: 'library-gif'; gif: { name: string; identifier: string } }
  | { via: 'qdn'; qdnKey: string; encrypted: boolean }
  /** An icon only, never a src. */
  | { via: 'none' };

export type ReplyMedia = {
  kind: ReplyMediaKind;
  /** Stable per picture, for remembering a failed load. */
  key: string;
  source: ReplyMediaSource;
};

/**
 * Same as MessageItem's RETICULUM_INLINE_IMAGE_THRESHOLD_BYTES: bigger
 * pictures are download cards there, so they are never read for a thumbnail.
 */
export const REPLY_THUMBNAIL_MAX_RESOURCE_BYTES = 1_000_000;

// Raster pictures only: no SVG, no other types.
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/i;

export const isSafeDataImageUrl = (value: string): boolean =>
  typeof value === 'string' && SAFE_DATA_IMAGE.test(value);

const RETICULUM_RESOURCE_URL_PREFIX = 'qortal-reticulum-resource://-/resource/';

/**
 * A src the thumbnail may load: an object URL (the app's own caches), a
 * validated inline picture, or the desktop's local resource protocol. Never a
 * network address, a file path or script.
 */
export const isSafeReplyThumbnailSrc = (src: unknown): src is string => {
  if (typeof src !== 'string' || !src) return false;
  if (src.startsWith('blob:')) return true;
  if (isSafeDataImageUrl(src)) return true;
  return src.startsWith(RETICULUM_RESOURCE_URL_PREFIX);
};

const LABEL_KEYS: Record<ReplyMediaKind, string> = {
  image: 'core:reply_preview.photo',
  gif: 'core:reply_preview.gif',
  video: 'core:reply_preview.video',
  file: 'core:attachment',
};

/** The word shown in place of text when the quoted message has none. */
export const replyMediaLabelKey = (kind: ReplyMediaKind): string =>
  LABEL_KEYS[kind] ?? LABEL_KEYS.file;

type Row = Record<string, unknown>;

const asRow = (value: unknown): Row | null =>
  value && typeof value === 'object' ? (value as Row) : null;

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const mimeOf = (resource: Row): string => {
  const metadata = asRow(resource.metadata);
  return (
    textOf(resource.mimeType) || textOf(metadata?.originalMimeType)
  ).toLowerCase();
};

const reticulumHashOf = (resource: Row | null): string => {
  if (!resource || resource.reticulumResource !== true) return '';
  const hash = resource.fileHash;
  return typeof hash === 'string' && hash.trim() ? hash : '';
};

const inlineDataUrlOf = (image: Row): string | null => {
  if (typeof image.dataUrl === 'string' && image.dataUrl) return image.dataUrl;
  if (typeof image.base64 === 'string' && image.base64) {
    const mime = textOf(image.mimeType) || 'image/webp';
    return `data:${mime};base64,${image.base64}`;
  }
  return null;
};

/**
 * The quoted message's picture, in the same order MessageItem draws a row's
 * media: a Reticulum picture, a library GIF, an inline picture, a legacy QDN
 * picture, and only then the first Reticulum file attachment.
 */
export function getReplyMedia(message: unknown): ReplyMedia | null {
  const row = asRow(message);
  if (!row || row.deleted === true) return null;

  const images = Array.isArray(row.images) ? row.images : [];
  const first = asRow(images[0]);
  if (first) {
    // Queue rows lack the reticulumChat / reticulumDirect flags, so only the
    // resource itself is checked.
    const hash = reticulumHashOf(first);
    if (hash) {
      const kind: ReplyMediaKind =
        mimeOf(first) === 'image/gif' ? 'gif' : 'image';
      const size = Number(first.sizeBytes);
      const tooBig =
        Number.isFinite(size) && size >= REPLY_THUMBNAIL_MAX_RESOURCE_BYTES;
      return {
        kind,
        key: `rt:${hash}`,
        source:
          tooBig || first.encrypted === true
            ? { via: 'none' }
            : { via: 'reticulum', fileHash: hash },
      };
    }

    if (isLibraryGifImage(first)) {
      const name = String(first.name);
      const identifier = String(first.identifier ?? '');
      return {
        kind: 'gif',
        key: `gif:${name}::${identifier}`,
        source: { via: 'library-gif', gif: { name, identifier } },
      };
    }

    const dataUrl = inlineDataUrlOf(first);
    if (dataUrl !== null) {
      // Trackers, blob:, script and SVG never become a src.
      if (!isSafeDataImageUrl(dataUrl)) return null;
      return {
        kind: /^data:image\/gif;/i.test(dataUrl) ? 'gif' : 'image',
        key: `data:${dataUrl.length}:${dataUrl.slice(-32)}`,
        source: { via: 'data', src: dataUrl },
      };
    }

    // Untrimmed, so the key matches the one Embed stores decrypted pictures
    // under in blobControllerAtom.
    const service = typeof first.service === 'string' ? first.service : '';
    const name = typeof first.name === 'string' ? first.name : '';
    const identifier =
      typeof first.identifier === 'string' ? first.identifier : '';
    if (service.trim() && name.trim() && identifier.trim()) {
      const qdnKey = `${service}-${name}-${identifier}`;
      return {
        kind: 'image',
        key: `qdn:${qdnKey}`,
        source: {
          via: 'qdn',
          qdnKey,
          encrypted: identifier.startsWith('grp-q-manager_0'),
        },
      };
    }
  }

  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  for (const entry of attachments) {
    const attachment = asRow(entry);
    const hash = reticulumHashOf(attachment);
    if (!hash) continue;
    // A picture sent as a file is a file card on the row, so it is a file
    // here too.
    const kind: ReplyMediaKind =
      mediaKindOf(mimeOf(attachment), textOf(attachment.fileName)) === 'video'
        ? 'video'
        : 'file';
    return { kind, key: `att:${hash}`, source: { via: 'none' } };
  }

  return null;
}

/**
 * Reads as plain text so the strip stays one predictable size no matter what
 * the original message contained. Block-level tags become line breaks, which is
 * what makes a multi-paragraph quote readable when it is scrolled.
 */
export function extractReplyPreviewText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed = new DOMParser().parseFromString(raw, 'text/html');
    parsed.body
      .querySelectorAll('br')
      .forEach((element) => element.replaceWith(parsed.createTextNode('\n')));
    parsed.body
      .querySelectorAll('p, div, li, blockquote, pre')
      .forEach((element) => element.append(parsed.createTextNode('\n')));
    return (parsed.body.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return raw.trim();
  }
}

export const hasReplyPreviewText = (raw: unknown): boolean =>
  Boolean(extractReplyPreviewText(raw));
