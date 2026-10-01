import { Capacitor } from '@capacitor/core';
import i18n from 'i18next';
import {
  writeNativeDocumentFile,
  writeNativeDocumentBlob,
  writeNativeDocumentBytes,
  downloadNativeDocument,
  ensureNativeStoragePermission,
  type DownloadProgressEvent,
} from '../plugins/FileWriter';
import {
  hasNativeFileSink,
  NativeFileSinkUnavailableError,
  readBlobSlices,
  writeToNativeFileSink,
} from './nativeFileSink';

const QORTAL_DOCUMENTS_FOLDER = 'Qortal Go';
/** Coalesce small network chunks before each native write (MediaStore opens
 *  the output stream per call, so per-fetch-chunk writes would be very slow). */
// Keep under Android Binder's ~1 MiB transaction limit after base64 (~4/3).
const STREAM_WRITE_BUFFER_BYTES = 384 * 1024;

/**
 * Per-type folders under Documents/Qortal Go. Mirrors SaveCategory.java —
 * keep both in sync so a file lands in the same place however it was saved.
 */
export const SAVE_CATEGORY_FOLDERS = {
  images: 'Images',
  videos: 'Videos',
  audio: 'Audio',
  documents: 'Documents',
  apps: 'Apps',
  qortino: 'Qortino AI',
} as const;

const EXTENSION_CATEGORY: Record<string, string> = {
  apk: SAVE_CATEGORY_FOLDERS.apps,
  aab: SAVE_CATEGORY_FOLDERS.apps,
  apks: SAVE_CATEGORY_FOLDERS.apps,
  gguf: SAVE_CATEGORY_FOLDERS.qortino,
  jpg: SAVE_CATEGORY_FOLDERS.images,
  jpeg: SAVE_CATEGORY_FOLDERS.images,
  png: SAVE_CATEGORY_FOLDERS.images,
  gif: SAVE_CATEGORY_FOLDERS.images,
  webp: SAVE_CATEGORY_FOLDERS.images,
  bmp: SAVE_CATEGORY_FOLDERS.images,
  heic: SAVE_CATEGORY_FOLDERS.images,
  heif: SAVE_CATEGORY_FOLDERS.images,
  svg: SAVE_CATEGORY_FOLDERS.images,
  avif: SAVE_CATEGORY_FOLDERS.images,
  tif: SAVE_CATEGORY_FOLDERS.images,
  tiff: SAVE_CATEGORY_FOLDERS.images,
  mp4: SAVE_CATEGORY_FOLDERS.videos,
  mov: SAVE_CATEGORY_FOLDERS.videos,
  webm: SAVE_CATEGORY_FOLDERS.videos,
  mkv: SAVE_CATEGORY_FOLDERS.videos,
  avi: SAVE_CATEGORY_FOLDERS.videos,
  m4v: SAVE_CATEGORY_FOLDERS.videos,
  '3gp': SAVE_CATEGORY_FOLDERS.videos,
  mpg: SAVE_CATEGORY_FOLDERS.videos,
  mpeg: SAVE_CATEGORY_FOLDERS.videos,
  ts: SAVE_CATEGORY_FOLDERS.videos,
  mp3: SAVE_CATEGORY_FOLDERS.audio,
  m4a: SAVE_CATEGORY_FOLDERS.audio,
  wav: SAVE_CATEGORY_FOLDERS.audio,
  ogg: SAVE_CATEGORY_FOLDERS.audio,
  oga: SAVE_CATEGORY_FOLDERS.audio,
  opus: SAVE_CATEGORY_FOLDERS.audio,
  flac: SAVE_CATEGORY_FOLDERS.audio,
  aac: SAVE_CATEGORY_FOLDERS.audio,
  wma: SAVE_CATEGORY_FOLDERS.audio,
  mid: SAVE_CATEGORY_FOLDERS.audio,
  midi: SAVE_CATEGORY_FOLDERS.audio,
};

function extensionOf(filename: string): string {
  const base =
    String(filename || '')
      .split('/')
      .pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Folder name a file will be saved into, e.g. "Images". */
export function categorizeSaveFile(
  filename: string,
  mimeType?: string
): string {
  const ext = extensionOf(filename);
  const byExt = EXTENSION_CATEGORY[ext];
  if (byExt) return byExt;
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('android.package-archive'))
    return SAVE_CATEGORY_FOLDERS.apps;
  if (mime.startsWith('image/')) return SAVE_CATEGORY_FOLDERS.images;
  if (mime.startsWith('video/')) return SAVE_CATEGORY_FOLDERS.videos;
  if (mime.startsWith('audio/')) return SAVE_CATEGORY_FOLDERS.audio;
  return SAVE_CATEGORY_FOLDERS.documents;
}

/** User-facing location of saved files, for snackbars/dialogs. */
export const MOBILE_SAVE_LOCATION_LABEL = `Documents/${QORTAL_DOCUMENTS_FOLDER}`;

/** Where a specific file will end up, e.g. "Documents/Qortal Go/Images". */
export function mobileSaveLocationLabelFor(
  filename: string,
  mimeType?: string
): string {
  return `${MOBILE_SAVE_LOCATION_LABEL}/${categorizeSaveFile(filename, mimeType)}`;
}

/**
 * .bin files are written as a side effect of other work rather than as a
 * download the user asked for, so announcing them is just noise.
 */
export function isSilentSaveFile(filename: string): boolean {
  return extensionOf(filename) === 'bin';
}

export function buildQortalBackupFileName(qortAddress: string): string {
  return `qortal_backup_${qortAddress}.json`;
}

function assertNative() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      'Mobile document save is only available on the native app.'
    );
  }
}

let storageAccess: Promise<void> | null = null;

/**
 * Android 8/9 need the storage permission at runtime before anything can be
 * written to Documents; later versions answer at once. Asked once per run.
 */
async function ensureStorageAccess(): Promise<void> {
  if (!storageAccess) {
    storageAccess = ensureNativeStoragePermission().then((granted) => {
      if (!granted) {
        storageAccess = null;
        throw new Error(i18n.t('core:file_transfer.storage_permission'));
      }
    });
  }
  return storageAccess;
}

const sanitizeName = (filename: string | null | undefined) => {
  const raw = String(filename ?? '').trim();
  const cleaned = (raw || 'download').replace(/[/\\?%*:|"<>]/g, '_');
  return cleaned || 'download';
};

export async function saveTextToMobileDocuments(
  filename: string,
  contents: string
): Promise<{ path: string; uri: string }> {
  assertNative();
  await ensureStorageAccess();
  const safeName = sanitizeName(filename);
  const result = await writeNativeDocumentFile(
    `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`,
    contents,
    { categorize: true }
  );
  return result;
}

/**
 * Reading a blob whole means holding it whole. Past this size it is read a
 * slice at a time instead, which is the difference between a save that works
 * and one that takes the app down with it.
 */
const BLOB_SINGLE_WRITE_MAX_BYTES = 4 * 1024 * 1024;

export async function saveBlobToMobileDocuments(
  filename: string,
  blob: Blob,
  onProgress?: (bytesWritten: number, totalBytes: number) => void
): Promise<{ path: string; uri: string }> {
  assertNative();
  await ensureStorageAccess();
  const safeName = sanitizeName(filename);

  if (hasNativeFileSink()) {
    try {
      return await writeToNativeFileSink(
        `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`,
        readBlobSlices(blob),
        { categorize: true, mimeType: blob.type || undefined },
        onProgress ? (written) => onProgress(written, blob.size) : undefined
      );
    } catch (error) {
      if (!(error instanceof NativeFileSinkUnavailableError)) throw error;
    }
  }

  // A blob crosses to the native side as base64 text, which costs a third
  // again in size on both sides of the bridge at once. For a file of any real
  // size that is hundreds of megabytes of string, and Android kills the app
  // long before the save finishes — so anything large goes over in slices.
  if (blob.size > BLOB_SINGLE_WRITE_MAX_BYTES) {
    return await writeStreamThroughPlugin(
      `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`,
      readBlobSlices(blob, STREAM_WRITE_BUFFER_BYTES),
      blob.type || undefined,
      onProgress ? (written) => onProgress(written, blob.size) : undefined
    );
  }

  const result = await writeNativeDocumentBlob(
    `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`,
    blob,
    { categorize: true, mimeType: blob.type || undefined }
  );
  onProgress?.(blob.size, blob.size);
  return result;
}

/**
 * Hands a saved file to whichever app on the device can display it. Accepts the
 * `content://` uri MediaStore hands back from a save.
 */
export async function openSavedMobileFile(
  uri: string,
  filename?: string,
  mimeType?: string
): Promise<boolean> {
  if (!uri || !Capacitor.isNativePlatform()) return false;
  try {
    const { Reticulum } = await import('../plugins/Reticulum');
    const result = await Reticulum.qchatFileOpen({
      uri,
      ...(filename ? { fileName: filename } : {}),
      ...(mimeType ? { mimeType } : {}),
    });
    return result?.ok === true;
  } catch (error) {
    console.error('[MobileSave] failed to open saved file:', error);
    return false;
  }
}

/**
 * Downloads a URL directly into Documents/Qortal Go/<category>/<filename>.
 *
 * Prefer this over pumping the response through
 * {@link saveStreamToMobileDocuments}: the bytes stay native, so a large file
 * costs one storage write instead of a base64 encode/decode and a bridge
 * crossing per chunk. Only usable when the content needs no in-app processing
 * (no client-side decryption).
 */
export async function downloadUrlToMobileDocuments(
  filename: string,
  url: string,
  mimeType?: string,
  onProgress?: (event: DownloadProgressEvent) => void,
  apiKey?: string
): Promise<{ path: string; uri: string; bytesWritten: number }> {
  assertNative();
  await ensureStorageAccess();
  const safeName = sanitizeName(filename);
  return downloadNativeDocument(
    `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`,
    url,
    { categorize: true, mimeType, apiKey },
    onProgress
  );
}

/**
 * Streams chunks into Documents/Qortal Go/<category>/<filename> without
 * buffering the whole file in memory. Used by QDN downloads on Android, where
 * neither the File System Access API nor anchor-tag downloads work inside the
 * Capacitor WebView.
 */
export async function saveStreamToMobileDocuments(
  filename: string,
  chunks: AsyncIterable<Uint8Array>,
  mimeType?: string,
  onProgress?: (bytesWritten: number) => void
): Promise<{ path: string; uri: string; bytesWritten: number }> {
  assertNative();
  await ensureStorageAccess();

  const safeName = sanitizeName(filename);
  const target = `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`;

  if (hasNativeFileSink()) {
    // The source can only be read once. If the sink never opened, nothing was
    // read from it and the plugin path below can still have all of it.
    let started = false;
    const tracked = (async function* () {
      for await (const chunk of chunks) {
        started = true;
        yield chunk;
      }
    })();
    try {
      return await writeToNativeFileSink(
        target,
        tracked,
        { categorize: true, mimeType },
        onProgress
      );
    } catch (error) {
      if (!(error instanceof NativeFileSinkUnavailableError) || started) {
        throw error;
      }
    }
  }

  return writeStreamThroughPlugin(target, chunks, mimeType, onProgress);
}

/** The base64 plugin path, for WebViews without the binary sink. */
async function writeStreamThroughPlugin(
  target: string,
  chunks: AsyncIterable<Uint8Array>,
  mimeType?: string,
  onProgress?: (bytesWritten: number) => void
): Promise<{ path: string; uri: string; bytesWritten: number }> {
  let buffer: Uint8Array[] = [];
  let buffered = 0;
  let bytesWritten = 0;
  let firstWriteDone = false;
  let lastResult: { path: string; uri: string } | null = null;

  const flush = async (): Promise<void> => {
    if (buffered === 0) return;
    const merged = new Uint8Array(buffered);
    let offset = 0;
    for (const part of buffer) {
      merged.set(part, offset);
      offset += part.length;
    }
    buffer = [];
    buffered = 0;
    lastResult = await writeNativeDocumentBytes(target, merged, {
      append: firstWriteDone,
      categorize: true,
      mimeType,
    });
    firstWriteDone = true;
    bytesWritten += merged.length;
    onProgress?.(bytesWritten);
  };

  for await (const chunk of chunks) {
    if (!chunk || chunk.length === 0) continue;
    buffer.push(chunk);
    buffered += chunk.length;
    if (buffered >= STREAM_WRITE_BUFFER_BYTES) {
      await flush();
    }
  }
  await flush();

  if (!lastResult) {
    throw new Error('Download produced no data');
  }

  return { ...(lastResult as { path: string; uri: string }), bytesWritten };
}
