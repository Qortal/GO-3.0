/**
 * Shared image compression used by the Quitter composer and chat attachments.
 *
 * On Android `cordova-plugin-file` replaces the global `File` constructor with
 * one that returns a plain object, so `new File([blob], name)` silently yields
 * something that is not a Blob — `URL.createObjectURL` and any size check on it
 * then fail. Everything here goes through `createNamedFile`/`nameBlob`, which
 * is why this path works on device while raw `new File(...)` does not.
 */

import Compressor from 'compressorjs';
import { createNamedFile, nameBlob } from './namedFile';

export interface ImageCompressorOptions {
  quality: number;
  maxWidth: number;
  mimeType: string;
}

/** Compressor.js wrapped in a promise that rejects (rather than silently
 *  resolving with the original) so callers can decide on a fallback. */
export const runImageCompressor = (
  file: Blob,
  opts: ImageCompressorOptions
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    new Compressor(file, {
      quality: opts.quality,
      maxWidth: opts.maxWidth,
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
  const maybe = file as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybe.arrayBuffer === 'function') {
    try {
      return await maybe.arrayBuffer();
    } catch {
      /* fall through */
    }
  }
  try {
    return await new Response(file as BodyInit).arrayBuffer();
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

export interface CompressImageOptions {
  /** Skip files at or below this size. Omit to always compress. */
  thresholdBytes?: number;
  first: ImageCompressorOptions;
  /** Applied when the first pass is still above `thresholdBytes`. */
  second?: ImageCompressorOptions;
  /** Used if webp encoding fails, which some WebViews do. */
  fallback?: ImageCompressorOptions;
}

/**
 * Compress an image, always returning a usable File: the compressed result if
 * it is valid and smaller, otherwise the original untouched.
 */
export async function compressImageFile(
  file: File,
  options: CompressImageOptions
): Promise<File> {
  if (file.type === 'image/gif') return file;
  if (!file.type?.startsWith('image/')) return file;
  const threshold = options.thresholdBytes;
  if (threshold !== undefined && file.size <= threshold) return file;

  // Everything below (Compressor.js, and whoever consumes the result) needs a
  // genuine Blob, so normalise once up front instead of failing later.
  let source: Blob;
  try {
    source = await toSameRealmBlob(file);
  } catch (err) {
    console.warn('[imageCompression] could not read source image', err);
    return file;
  }
  const passthrough = (): File =>
    source === (file as unknown as Blob)
      ? file
      : blobToNamedImageFile(source, file.name, file.type);

  try {
    let result = await runImageCompressor(source, options.first);

    if (
      options.second &&
      threshold !== undefined &&
      result.size > threshold
    ) {
      result = await runImageCompressor(result, options.second);
    }

    if (result.size > 0 && result.size < source.size) {
      return blobToNamedImageFile(result, file.name, options.first.mimeType);
    }
    return passthrough();
  } catch (err) {
    console.warn('[imageCompression] compress failed, trying fallback', err);
    if (!options.fallback) return passthrough();
    try {
      const fallback = await runImageCompressor(source, options.fallback);
      if (fallback.size > 0 && fallback.size < source.size) {
        return blobToNamedImageFile(
          fallback,
          file.name,
          options.fallback.mimeType
        );
      }
    } catch {
      /* fall through to the original */
    }
    return passthrough();
  }
}
