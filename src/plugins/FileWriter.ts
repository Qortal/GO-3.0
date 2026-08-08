import { Capacitor, registerPlugin } from '@capacitor/core';

export interface FileWriterPlugin {
  writeChunk(options: {
    filename: string;
    dataBase64: string;
    append?: boolean;
    /** File under a per-type folder (Images / Videos / Audio / …). */
    categorize?: boolean;
    mimeType?: string;
  }): Promise<{ path: string; uri: string }>;
  /** Remove stale files of one extension from a folder. */
  pruneFolder(options: {
    subFolder: string;
    extension: string;
    keepName?: string;
  }): Promise<{ deleted: number }>;
}

const FileWriter = registerPlugin<FileWriterPlugin>('FileWriter');

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Convert in 32 KiB slices: String.fromCharCode(...whole) overflows the
  // argument limit for large files.
  const SLICE = 0x8000;
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
}

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
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export type NativeWriteOptions = {
  append?: boolean;
  /** Sort into Images / Videos / Audio / Documents / Apps / GO state. */
  categorize?: boolean;
  mimeType?: string;
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
    dataBase64: bytesToBase64(bytes),
    ...toWriteOptions(options),
  });
}

/** Delete older files of one extension in a Documents subfolder. */
export async function pruneNativeDocumentFolder(options: {
  subFolder: string;
  extension: string;
  keepName?: string;
}): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;
  try {
    const res = await FileWriter.pruneFolder(options);
    return res?.deleted ?? 0;
  } catch {
    return 0;
  }
}
