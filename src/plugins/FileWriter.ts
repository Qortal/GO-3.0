import { Capacitor, registerPlugin } from '@capacitor/core';
import { bytesToBase64 } from '../utils/bytesBase64';

export interface FileWriterPlugin {
  writeChunk(options: {
    filename: string;
    dataBase64: string;
    append?: boolean;
    /** File under a per-type folder (Images / Videos / Audio / …). */
    categorize?: boolean;
    mimeType?: string;
  }): Promise<{ path: string; uri: string }>;
  /** Fetches the URL natively, so the bytes never cross the bridge. */
  downloadToDocuments(options: {
    url: string;
    filename: string;
    categorize?: boolean;
    mimeType?: string;
    /** Set to receive `downloadProgress` events for this download. */
    downloadId?: string;
    /** Sent as X-API-KEY when the node requires a key. */
    apiKey?: string;
  }): Promise<{ path: string; uri: string; bytesWritten: number }>;
  /** Android 8/9 only ask; later versions always answer granted. */
  ensureStoragePermission(): Promise<{ granted: boolean }>;
  /** Document-start script for every frame loaded from now on. */
  installFrameScript(options: {
    script: string;
  }): Promise<{ installed: boolean }>;
  /** GET a URL natively and drop the body — used to kick QDN `?async=true`. */
  probeUrl(options: {
    url: string;
    apiKey?: string;
  }): Promise<{ status: number; ok: boolean }>;
  addListener(
    eventName: 'downloadProgress',
    listener: (event: DownloadProgressEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export type DownloadProgressEvent = {
  downloadId: string;
  bytesWritten: number;
  /** 0 when the server did not say how big the file is. */
  totalBytes: number;
  done: boolean;
};

const FileWriter = registerPlugin<FileWriterPlugin>('FileWriter');

function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result?.toString() ?? '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64 ?? '');
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export type NativeWriteOptions = {
  append?: boolean;
  /** Sort into Images / Videos / Audio / Documents / Apps / Qortino AI. */
  categorize?: boolean;
  mimeType?: string;
  apiKey?: string;
};

function toWriteOptions(
  options: boolean | NativeWriteOptions | undefined
): NativeWriteOptions {
  if (typeof options === 'boolean') return { append: options };
  return options || {};
}

export async function writeNativeDocumentFile(
  filename: string,
  contents: string,
  options: boolean | NativeWriteOptions = false
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  return FileWriter.writeChunk({
    filename,
    dataBase64: utf8ToBase64(contents),
    ...toWriteOptions(options),
  });
}

export async function writeNativeDocumentBlob(
  filename: string,
  blob: Blob,
  options: boolean | NativeWriteOptions = false
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  const opts = toWriteOptions(options);
  return FileWriter.writeChunk({
    filename,
    dataBase64: await blobToBase64(blob),
    mimeType: opts.mimeType || blob.type || undefined,
    ...opts,
  });
}

/**
 * Downloads straight to storage on the native side. Sending the bytes through
 * `writeChunk` instead costs a base64 encode, a bridge crossing and a decode
 * for every chunk, which dominates the save time for large attachments.
 */
export async function probeNativeUrl(
  url: string,
  apiKey?: string
): Promise<{ status: number; ok: boolean }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native HTTP probe is only available on the mobile app.');
  }
  return FileWriter.probeUrl({
    url,
    ...(apiKey ? { apiKey } : {}),
  });
}

export async function downloadNativeDocument(
  filename: string,
  url: string,
  options: NativeWriteOptions = {},
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<{ path: string; uri: string; bytesWritten: number }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  const downloadId = onProgress
    ? `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : undefined;
  const subscription = downloadId
    ? await FileWriter.addListener('downloadProgress', (event) => {
        if (event?.downloadId === downloadId) onProgress?.(event);
      })
    : null;

  try {
    return await FileWriter.downloadToDocuments({
      url,
      filename,
      categorize: options.categorize,
      mimeType: options.mimeType,
      ...(downloadId ? { downloadId } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    });
  } finally {
    await subscription?.remove();
  }
}

export async function writeNativeDocumentBytes(
  filename: string,
  bytes: Uint8Array,
  options: boolean | NativeWriteOptions = false
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  return FileWriter.writeChunk({
    filename,
    // FileReader encodes natively, about six times faster than building the
    // string here (18 ms vs 3 ms per 384 KB on a current phone).
    dataBase64: await blobToBase64(new Blob([bytes as BlobPart])),
    ...toWriteOptions(options),
  });
}

export async function ensureNativeStoragePermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const { granted } = await FileWriter.ensureStoragePermission();
  return granted === true;
}

export async function installNativeFrameScript(
  script: string
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const { installed } = await FileWriter.installFrameScript({ script });
  return installed === true;
}
