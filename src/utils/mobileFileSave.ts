import { Capacitor } from '@capacitor/core';
import { writeNativeDocumentFile, writeNativeDocumentBlob } from '../plugins/FileWriter';

const QORTAL_DOCUMENTS_FOLDER = 'Qortal Go';

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
