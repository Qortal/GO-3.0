import { Capacitor, registerPlugin } from '@capacitor/core';

export interface FileWriterPlugin {
  writeChunk(options: {
    filename: string;
    dataBase64: string;
    append?: boolean;
  }): Promise<{ path: string; uri: string }>;
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

export async function writeNativeDocumentFile(
  filename: string,
  contents: string,
  append = false
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  return FileWriter.writeChunk({
    filename,
    dataBase64: utf8ToBase64(contents),
    append,
  });
}

export async function writeNativeDocumentBlob(
  filename: string,
  blob: Blob,
  append = false
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  return FileWriter.writeChunk({
    filename,
    dataBase64: await blobToBase64(blob),
    append,
  });
}

export async function writeNativeDocumentBytes(
  filename: string,
  bytes: Uint8Array,
  append = false
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native file writer is only available on the mobile app.');
  }

  return FileWriter.writeChunk({
    filename,
    dataBase64: bytesToBase64(bytes),
    append,
  });
}
