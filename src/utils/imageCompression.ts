/**
 * Shared image compression used by the Quitter composer and chat attachments.
 *
 * Nothing leaves here with the photo's EXIF/XMP/IPTC metadata (GPS position,
 * camera make/model, capture time): re-encoded results never carry it, and
 * every path that hands back the original image strips it losslessly first
 * (see stripImageMetadata.ts).
 *
 * On Android `cordova-plugin-file` replaces the global `File` constructor with
 * one that returns a plain object, so `new File([blob], name)` silently yields
 * something that is not a Blob — `URL.createObjectURL` and any size check on it
 * then fail. Everything here goes through `createNamedFile`/`nameBlob`, which
 * is why this path works on device while raw `new File(...)` does not.
 */

import Compressor from 'compressorjs';
import { createNamedFile, nameBlob } from './namedFile';
import { IMAGE_CONTAINER_MIME, stripImageMetadata } from './stripImageMetadata';

interface ImageCompressorOptions {
  quality: number;
  maxWidth: number;
  /** Also cap the height (tall screenshots); unlimited when omitted. */
  maxHeight?: number;
  mimeType: string;
}

/** Compressor.js wrapped in a promise that rejects (rather than silently
 *  resolving with the original) so callers can decide on a fallback. */
const runImageCompressor = (
  file: Blob,
  opts: ImageCompressorOptions
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    new Compressor(file, {
      quality: opts.quality,
      maxWidth: opts.maxWidth,
      ...(opts.maxHeight ? { maxHeight: opts.maxHeight } : {}),
      mimeType: opts.mimeType,
      checkOrientation: true,
      success(result) {
        if (!result || result.size < 32) {
          reject(new Error('Compressed image is empty'));
          return;
        }
        resolve(result);
      },
      error(err) {
        reject(err);
      },
    });
  });

/** Build a real, Blob-backed File with the right extension for its type. */
export function blobToNamedImageFile(
  blob: Blob,
  fileName: string,
  mimeType: string
): File {
  const type = mimeType || blob.type || 'image/webp';
  const name =
    fileName.replace(/\.\w+$/, '') + (type.includes('webp') ? '.webp' : '.jpg');
  const file = createNamedFile([blob], name, { type });
  if (file.size === blob.size && file.size > 0) return file;
  return nameBlob(blob, name);
}

/**
 * Read a file's bytes without assuming it is a well-formed Blob. Android hands
 * us objects from the cordova File shim and from picker realms that fail
 * `instanceof Blob`, which makes Compressor.js reject them outright.
 */
async function readAllBytes(file: Blob): Promise<ArrayBuffer> {
  // `new Response(x)` stringifies anything it does not recognise as a Blob
  // ("[object File]"), so only trust a read whose length matches.
  const expected = typeof file?.size === 'number' ? file.size : -1;
  const plausible = (buffer: ArrayBuffer) =>
    expected < 0 || buffer.byteLength === expected;
  const maybe = file as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybe.arrayBuffer === 'function') {
    try {
      const buffer = await maybe.arrayBuffer();
      if (plausible(buffer)) return buffer;
    } catch {
      /* fall through */
    }
  }
  try {
    const buffer = await new Response(file as BodyInit).arrayBuffer();
    if (plausible(buffer)) return buffer;
  } catch {
    /* fall through */
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file as Blob);
  });
}

/** Re-wrap anything file-like into a Blob owned by this realm. */
async function toSameRealmBlob(file: File): Promise<Blob> {
  if (file instanceof Blob && typeof file.slice === 'function') return file;
  const bytes = await readAllBytes(file);
  return new Blob([bytes], { type: file.type || 'application/octet-stream' });
}

/** A Blob-backed File holding `bytes`, keeping the original file name. */
function bytesToNamedFile(bytes: Uint8Array, name: string, type: string): File {
  const blob = new Blob([bytes as BlobPart], { type });
  const file = createNamedFile([blob], name, { type });
  if (file.size === blob.size && file.size > 0) return file;
  return nameBlob(blob, name);
}

/**
 * The image without its EXIF/XMP/IPTC metadata, losslessly (JPEG, PNG, WebP).
 * Other formats and unreadable files come back unchanged; callers that must
 * be sure nothing leaks re-encode those (compressImageFile does).
 */
export async function stripImageFileMetadata(file: File): Promise<File> {
  if (!file) return file;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readAllBytes(file));
  } catch (err) {
    console.warn('[imageCompression] could not read image metadata', err);
    return file;
  }
  const outcome = stripImageMetadata(bytes);
  if (!outcome.ok || !outcome.changed) return file;
  return bytesToNamedFile(
    outcome.bytes,
    file.name || 'image',
    IMAGE_CONTAINER_MIME[outcome.format]
  );
}

type MetadataFreeImage =
  | { ok: true; file: Blob }
  | { ok: false; reason: 'unsupported' | 'malformed' | 'unreadable' };

const isGif = (bytes: Uint8Array) =>
  bytes.length >= 6 &&
  bytes[0] === 0x47 && // G
  bytes[1] === 0x49 && // I
  bytes[2] === 0x46 && // F
  bytes[3] === 0x38 && // 8
  (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 or 9
  bytes[5] === 0x61; // a

/**
 * Last check before an image is published for good. JPEG, PNG and WebP come
 * back without EXIF/XMP/IPTC (stripped again if anything is left) and GIF as
 * it is. Any other format (HEIC, or a file the WebView could not re-encode)
 * cannot be checked, so the caller should refuse to publish it.
 */
export async function ensureImageMetadataFree(
  file: Blob
): Promise<MetadataFreeImage> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readAllBytes(file));
  } catch (err) {
    console.warn('[imageCompression] could not read image to publish', err);
    return { ok: false, reason: 'unreadable' };
  }
  if (isGif(bytes)) return { ok: true, file };
  const outcome = stripImageMetadata(bytes);
  if (outcome.ok === false) return { ok: false, reason: outcome.reason };
  if (!outcome.changed) return { ok: true, file };
  return {
    ok: true,
    file: new Blob([outcome.bytes as BlobPart], {
      type: IMAGE_CONTAINER_MIME[outcome.format],
    }),
  };
}

interface CompressImageOptions {
  /** Skip files at or below this size. Omit to always compress. */
  thresholdBytes?: number;
  first: ImageCompressorOptions;
  /** Applied when the first pass is still above `thresholdBytes`. */
  second?: ImageCompressorOptions;
  /** Used if webp encoding fails, which some WebViews do. */
  fallback?: ImageCompressorOptions;
}

type Reencoded = { blob: Blob; mimeType: string };

/**
 * The original image, minus its metadata. Stripping is lossless for JPEG, PNG
 * and WebP. Anything else (or a file that does not parse) can only be cleaned
 * by a canvas re-encode: the one already made is used even though it is not
 * smaller, or a fresh pass is tried. Only if that fails too does the original
 * go out unchanged.
 */
async function originalWithoutMetadata(
  file: File,
  source: Blob,
  options: CompressImageOptions,
  reencoded?: Reencoded,
  canvasFailed = false
): Promise<File> {
  const untouched = (): File =>
    source === (file as unknown as Blob)
      ? file
      : blobToNamedImageFile(source, file.name, file.type);

  let outcome: ReturnType<typeof stripImageMetadata> | null = null;
  try {
    outcome = stripImageMetadata(new Uint8Array(await readAllBytes(source)));
  } catch (err) {
    console.warn('[imageCompression] could not read image metadata', err);
  }
  if (outcome?.ok) {
    if (!outcome.changed) return untouched();
    return bytesToNamedFile(
      outcome.bytes,
      file.name || 'image',
      IMAGE_CONTAINER_MIME[outcome.format]
    );
  }

  // Compressor.js (strict mode) can hand back its input unchanged; that is
  // the original with its metadata, so it does not count as a re-encode.
  if (reencoded && reencoded.blob !== source && reencoded.blob.size > 0) {
    return blobToNamedImageFile(reencoded.blob, file.name, reencoded.mimeType);
  }
  if (!canvasFailed) {
    for (const pass of [options.first, options.fallback]) {
      if (!pass) continue;
      try {
        const blob = await runImageCompressor(source, pass);
        if (blob !== source) {
          return blobToNamedImageFile(blob, file.name, pass.mimeType);
        }
      } catch {
        /* try the next pass */
      }
    }
  }
  console.warn(
    '[imageCompression] image metadata could not be removed',
    outcome && outcome.ok === false ? outcome.reason : 'unreadable'
  );
  return untouched();
}

/**
 * Compress an image, always returning a usable File: the compressed result if
 * it is valid and smaller, otherwise the original with its metadata removed.
 */
export async function compressImageFile(
  file: File,
  options: CompressImageOptions
): Promise<File> {
  if (file.type === 'image/gif') return file;
  if (!file.type?.startsWith('image/')) return file;

  // Everything below (Compressor.js, and whoever consumes the result) needs a
  // genuine Blob, so normalise once up front instead of failing later.
  let source: Blob;
  try {
    source = await toSameRealmBlob(file);
  } catch (err) {
    console.warn('[imageCompression] could not read source image', err);
    return file;
  }
  const keepOriginal = (reencoded?: Reencoded, canvasFailed = false) =>
    originalWithoutMetadata(file, source, options, reencoded, canvasFailed);

  // Small enough to go out as it is, but never with its GPS/camera metadata.
  const threshold = options.thresholdBytes;
  if (threshold !== undefined && file.size <= threshold) return keepOriginal();

  try {
    let result = await runImageCompressor(source, options.first);

    if (options.second && threshold !== undefined && result.size > threshold) {
      result = await runImageCompressor(result, options.second);
    }

    if (result.size > 0 && result.size < source.size) {
      return blobToNamedImageFile(result, file.name, options.first.mimeType);
    }
    return keepOriginal({ blob: result, mimeType: options.first.mimeType });
  } catch (err) {
    console.warn('[imageCompression] compress failed, trying fallback', err);
    if (!options.fallback) return keepOriginal(undefined, true);
    try {
      const fallback = await runImageCompressor(source, options.fallback);
      if (fallback.size > 0 && fallback.size < source.size) {
        return blobToNamedImageFile(
          fallback,
          file.name,
          options.fallback.mimeType
        );
      }
      return keepOriginal({
        blob: fallback,
        mimeType: options.fallback.mimeType,
      });
    } catch {
      /* fall through to the original */
    }
    return keepOriginal(undefined, true);
  }
}
