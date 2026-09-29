import { Capacitor } from '@capacitor/core';

/**
 * Hands a file the app holds in memory to other Android apps: the share sheet
 * or an "Open with" chooser. Both need a real file behind a FileProvider uri,
 * so the bytes are first written to the app cache (`file_paths.xml` exposes
 * the whole cache dir as `cache-path`). Nothing lands in public storage.
 */

const SHARE_CACHE_FOLDER = 'shared-files';
// Keep under Android Binder's ~1 MiB transaction limit after base64 (~4/3).
const WRITE_SLICE_BYTES = 384 * 1024;

let cacheSwept = false;
let sequence = 0;
const writtenByKey = new Map<string, Promise<string>>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function safeShareName(fileName: string): string {
  // Path separators, characters FileProvider/MediaStore reject, and controls.
  const cleaned = Array.from(String(fileName || '').trim(), (ch) =>
    ch.charCodeAt(0) < 32 || '/\\?%*:|"<>'.includes(ch) ? '_' : ch
  ).join('');
  return cleaned || 'file';
}

async function writeToCache(fileName: string, blob: Blob): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  if (!cacheSwept) {
    // Files from earlier sessions: whichever app they went to has long since
    // read them.
    cacheSwept = true;
    await Filesystem.rmdir({
      path: SHARE_CACHE_FOLDER,
      directory: Directory.Cache,
      recursive: true,
    }).catch(() => {});
  }
  const path = `${SHARE_CACHE_FOLDER}/${Date.now()}-${++sequence}/${safeShareName(fileName)}`;
  let uri = '';
  if (blob.size === 0) {
    uri = (
      await Filesystem.writeFile({
        path,
        data: '',
        directory: Directory.Cache,
        recursive: true,
      })
    ).uri;
    return uri;
  }
  for (let offset = 0; offset < blob.size; offset += WRITE_SLICE_BYTES) {
    const slice = new Uint8Array(
      await blob
        .slice(offset, Math.min(offset + WRITE_SLICE_BYTES, blob.size))
        .arrayBuffer()
    );
    const data = bytesToBase64(slice);
    if (offset === 0) {
      uri = (
        await Filesystem.writeFile({
          path,
          data,
          directory: Directory.Cache,
          recursive: true,
        })
      ).uri;
    } else {
      await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    }
  }
  return uri;
}

/**
 * Writes the file to the app cache once per `key` and returns its `file://`
 * uri. Later calls with the same key reuse the file, so "Share" and then
 * "Open with" don't write it twice.
 */
export function stageMobileFileForSharing(
  key: string,
  fileName: string,
  blob: Blob
): Promise<string> {
  const cacheKey = `${key}\u0000${fileName}`;
  const existing = writtenByKey.get(cacheKey);
  if (existing) return existing;
  const pending = writeToCache(fileName, blob);
  writtenByKey.set(cacheKey, pending);
  pending.catch(() => writtenByKey.delete(cacheKey));
  return pending;
}

/** Opens the Android share sheet for a staged file. */
export async function shareStagedMobileFile(
  uri: string,
  fileName: string
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('shareStagedMobileFile: not running natively');
  }
  const { Share } = await import('@capacitor/share');
  try {
    await Share.share({ files: [uri], title: fileName, dialogTitle: fileName });
  } catch (error) {
    // Dismissing the share sheet rejects with "Share canceled".
    if (
      /cancel/i.test(error instanceof Error ? error.message : String(error))
    ) {
      return;
    }
    throw error;
  }
}

/** Opens a staged file in another app through the Android chooser. */
export async function openStagedMobileFileWith(
  uri: string,
  fileName: string,
  mimeType?: string
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('openStagedMobileFileWith: not running natively');
  }
  const { Reticulum } = await import('../plugins/Reticulum');
  const result = await Reticulum.qchatFileOpen({
    uri,
    fileName,
    ...(mimeType ? { mimeType } : {}),
  });
  if (result?.ok !== true) {
    throw new Error('openStagedMobileFileWith: qchatFileOpen did not succeed');
  }
}
