/**
 * Unified Q-Chat Reticulum file-transfer API.
 *
 * Desktop: thin pass-through to the Electron preload (`window.electronAPI`).
 * Mobile: Capacitor implementation — the system file picker + native staging
 * (ReticulumPlugin.qchatFile*) for file access, and the presence-bridge
 * commands in capacitorBridge for the transfer control protocol. The mobile
 * shell intentionally never defines `window.electronAPI` (that would flip the
 * app into HUB_ELECTRON mode), hence this seam.
 */

import { Capacitor } from '@capacitor/core';
import { Reticulum } from '../plugins/Reticulum';
import {
  fetchMobileReticulumIdentity,
  mobileQchatFileAccept,
  mobileQchatFileOpen,
  mobileQchatFileSend,
  onMobileQchatFileTransferEvent,
} from '../bridge/capacitorBridge';

export type QchatFileSelectResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  file?: { path: string; name: string; size: number; sha256: string };
};

export type QchatFileApi = {
  qchatFileSelect: () => Promise<QchatFileSelectResult>;
  qchatFileChooseSavePath: (fileName: string) => Promise<{
    ok: boolean;
    canceled?: boolean;
    error?: string;
    path?: string;
  }>;
  qchatFileSend: (payload: {
    transferId: string;
    senderAddress?: string;
    allowedRecipientAddress?: string;
    recipientAddress?: string;
    filePath: string;
    fileName: string;
    size: number;
    sha256?: string;
    expiresAt?: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  qchatFileAccept: (payload: {
    transferId: string;
    senderAddress?: string;
    recipientAddress?: string;
    authMessage?: Record<string, unknown>;
    savePath?: string;
    fileName: string;
    size: number;
    sha256?: string;
    senderReticulumDestinationHash?: string;
    senderReticulumIdentityPublicKeyBase64?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onQchatFileTransferEvent: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cb: (payload: any) => void
  ) => (() => void) | undefined;
  /**
   * Mobile only: open a received file in a viewer app. `code` is
   * PACKAGE_ARCHIVE_REFUSED when the file is an app package.
   */
  qchatFileOpen?: (payload: {
    uri: string;
    fileName?: string;
  }) => Promise<{ ok: boolean; error?: string; code?: string }>;
  reticulumGetLocalDestinationHash: () => Promise<{
    destinationHash: string | null;
  }>;
  reticulumGetLocalIdentityPublicKeyBase64: () => Promise<{
    publicKeyBase64: string | null;
  }>;
};

const isNativeMobile = (): boolean => {
  try {
    return Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

const mobileQchatFileSelect = async (): Promise<QchatFileSelectResult> => {
  try {
    const { FilePicker } = await import('@capawesome/capacitor-file-picker');
    const result = await FilePicker.pickFiles({ limit: 1, readData: false });
    const picked = result?.files?.[0];
    if (!picked) return { ok: false, canceled: true };
    const uri = picked.path ?? '';
    if (!uri) return { ok: false, error: 'File picker returned no path' };
    const prepared = await Reticulum.qchatFilePrepare({
      uri,
      ...(picked.name ? { name: picked.name } : {}),
    });
    return {
      ok: true,
      file: {
        path: prepared.path,
        name: prepared.name,
        size: prepared.size,
        sha256: prepared.sha256,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The picker rejects when the user backs out of the system dialog.
    if (/cancel/i.test(message)) return { ok: false, canceled: true };
    console.error('[QchatFile] mobile file select failed:', error);
    return { ok: false, error: message };
  }
};

const mobileApi: QchatFileApi = {
  qchatFileSelect: mobileQchatFileSelect,
  // No save dialog on mobile: received files stay in GO's private storage
  // (N-22); "Save to device" exports one on request.
  qchatFileChooseSavePath: async (fileName: string) => {
    try {
      const { path } = await Reticulum.qchatFileSavePath({
        fileName: fileName || 'received-file',
      });
      return { ok: true, path };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  },
  qchatFileSend: mobileQchatFileSend,
  qchatFileAccept: mobileQchatFileAccept,
  onQchatFileTransferEvent: (cb) => onMobileQchatFileTransferEvent(cb),
  qchatFileOpen: mobileQchatFileOpen,
  reticulumGetLocalDestinationHash: async () => {
    const { destinationHash } = await fetchMobileReticulumIdentity();
    return { destinationHash };
  },
  reticulumGetLocalIdentityPublicKeyBase64: async () => {
    const { identityPublicKeyBase64 } = await fetchMobileReticulumIdentity();
    return { publicKeyBase64: identityPublicKeyBase64 };
  },
};

/**
 * Returns the platform's Q-Chat file transfer API, or null when no transport
 * is available (plain web build).
 */
export const getQchatFileApi = (): QchatFileApi | null => {
  const electronApi = (window as any).electronAPI;
  if (electronApi?.qchatFileSelect) return electronApi as QchatFileApi;
  if (isNativeMobile()) return mobileApi;
  return null;
};
