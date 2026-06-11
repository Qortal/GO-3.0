import { Capacitor } from '@capacitor/core';
import {
  writeNativeDocumentFile,
  writeNativeDocumentBlob,
  writeNativeDocumentBytes,
} from '../plugins/FileWriter';

const QORTAL_DOCUMENTS_FOLDER = 'Qortal Go';
/** Coalesce small network chunks before each native write (MediaStore opens
 *  the output stream per call, so per-fetch-chunk writes would be very slow). */
const STREAM_WRITE_BUFFER_BYTES = 1024 * 1024;

/** User-facing location of saved files, for snackbars/dialogs. */
export const MOBILE_SAVE_LOCATION_LABEL = `Documents/${QORTAL_DOCUMENTS_FOLDER}`;

export function buildQortalBackupFileName(qortAddress: string): string {
  return `qortal_backup_${qortAddress}.json`;
}

export async function saveTextToMobileDocuments(
  filename: string,
  contents: string
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Mobile document save is only available on the native app.');
  }

  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '_');
  return writeNativeDocumentFile(`${QORTAL_DOCUMENTS_FOLDER}/${safeName}`, contents);
}

export async function saveBlobToMobileDocuments(
  filename: string,
  blob: Blob
): Promise<{ path: string; uri: string }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Mobile document save is only available on the native app.');
  }

  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '_');
  return writeNativeDocumentBlob(`${QORTAL_DOCUMENTS_FOLDER}/${safeName}`, blob);
}

/**
 * Streams chunks into Documents/Qortal Go/<filename> without buffering the
 * whole file in memory. Used by QDN downloads on Android, where neither the
 * File System Access API nor anchor-tag downloads work inside the Capacitor
 * WebView.
 */
export async function saveStreamToMobileDocuments(
  filename: string,
  chunks: AsyncIterable<Uint8Array>
): Promise<{ path: string; uri: string; bytesWritten: number }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Mobile document save is only available on the native app.');
  }

  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '_');
  const target = `${QORTAL_DOCUMENTS_FOLDER}/${safeName}`;

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
    lastResult = await writeNativeDocumentBytes(target, merged, firstWriteDone);
    firstWriteDone = true;
    bytesWritten += merged.length;
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
