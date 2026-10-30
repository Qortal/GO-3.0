import { Capacitor } from '@capacitor/core';
import { ensureNativeStoragePermission } from '../plugins/FileWriter';
import { Reticulum } from '../plugins/Reticulum';
import { ReticulumReceivedFiles } from '../plugins/ReticulumReceivedFiles';
import { subscribeToEvent, unsubscribeFromEvent } from './events';
import { openFileViewer } from './fileViewerEvents';
import {
  errorCode,
  isPackageOpenRefusal,
  isRefusedForOpen,
  openFileInViewerApp,
} from './nativeFileOpen';
import { cleanFileName } from './receivedFileName';
import { clearStagedShareFiles } from './mobileFileShare';

/**
 * Files a chat peer sent over Reticulum (Q-Chat file transfer) on Android.
 *
 * They stay private to GO (N-22, N-27): the transfer writes them to the app's
 * internal storage and nothing copies them to shared storage. "Open" shows
 * the file in GO's own viewer (ReticulumFileViewer), which can then hand it
 * to another app on a second, explicit tap; a file too large to load there
 * goes to the Android chooser directly, with a type that can never be the
 * package installer's or a browser page (nativeFileOpen). "Save to device"
 * exports one file to Documents/Qortal Go. Logging out deletes them.
 *
 * Builds up to v0.0.14 also copied every received file into public
 * Downloads; the chat still has that copy's content:// uri (`legacyUri`) and
 * falls back to it when the private file is gone.
 */

/**
 * Past this, a received file opens in another app instead of GO's viewer:
 * the viewer holds the whole file in memory, and the bytes cross the bridge
 * as base64 (a few seconds for this much on a mid-range phone).
 */
const RECEIVED_FILE_VIEWER_MAX_BYTES = 32 * 1024 * 1024;
const READ_SLICE_BYTES = 512 * 1024;
/** The viewer reads the blob url as soon as it is asked to open it. */
const VIEWER_URL_LIFETIME_MS = 30_000;

export type ReceivedChatFile = {
  /** App-private path the transfer wrote the file to. */
  path?: string | null;
  /** content:// copy in public Downloads, made by builds up to v0.0.14. */
  legacyUri?: string | null;
  /** The sender's name for the file (cleaned here before use). */
  fileName?: string | null;
};

// Plain shapes rather than unions on `ok`: the project is not compiled with
// strictNullChecks, which such a union needs to narrow.
type ReceivedFileOpenResult = {
  ok: boolean;
  /** Set when ok: where the file opened. */
  via?: 'viewer' | 'app';
  /** Set when not ok. */
  reason?: 'missing' | 'package' | 'failed';
  error?: string;
};

type ReceivedFileSaveResult = {
  ok: boolean;
  /** Set when ok: the saved name, and folder and name to show the user. */
  name?: string;
  location?: string;
  uri?: string;
  /** Set when not ok. */
  reason?: 'missing' | 'already_public' | 'permission' | 'failed';
  error?: string;
};

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const lastSegment = (value: string): string => value.split(/[/\\]/).pop() || '';

/** Folder under GO's internal files directory (ReceivedFilePolicy.java). */
const PRIVATE_RECEIVED_DIR = 'qchat-received';

/**
 * True when GO holds the file only in its private storage: written by this
 * build into the internal received-file folder, with no copy in public
 * Downloads. Builds up to v0.0.14 kept received files in app-specific
 * external storage, which other apps with the storage permission can read
 * on Android 8/9, and copied them into Downloads, so "kept privately" is
 * not true for those.
 */
export function isPrivateReceivedChatFile(file: ReceivedChatFile): boolean {
  if (String(file?.legacyUri || '').trim()) return false;
  const segments = String(file?.path || '').split('/');
  // ".../files/qchat-received/<transfer>/<name>"
  return (
    segments.length >= 3 &&
    segments[segments.length - 3] === PRIVATE_RECEIVED_DIR
  );
}

/** The name GO shows for a received file. */
export function receivedFileDisplayName(file: ReceivedChatFile): string {
  return (
    cleanFileName(file.fileName) ||
    cleanFileName(lastSegment(String(file.path || ''))) ||
    ''
  );
}

/**
 * Whether the private copy is still there: `null` when that cannot be told
 * (not on Android, no path, or the probe failed).
 */
export async function statReceivedChatFile(
  path: string | null | undefined
): Promise<{ exists: boolean; size: number } | null> {
  const value = String(path || '').trim();
  if (!value || !isNative()) return null;
  try {
    const stat = await Reticulum.qchatFileStat({ path: value });
    return { exists: stat?.exists === true, size: Number(stat?.size) || 0 };
  } catch {
    return null;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads a received file into a Blob, a slice per native call (base64 has to
 * cross the bridge, so a slice is kept well under a megabyte).
 */
export async function readReceivedChatFile(
  path: string,
  expectedSize?: number
): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let size = Number(expectedSize) || 0;
  for (;;) {
    const slice = await ReticulumReceivedFiles.qchatReceivedFileRead({
      path,
      offset,
      length: READ_SLICE_BYTES,
    });
    size = Number(slice?.size) || size;
    const bytesRead = Number(slice?.bytesRead) || 0;
    if (bytesRead > 0) {
      parts.push(base64ToBytes(String(slice.dataBase64 || '')));
      offset += bytesRead;
    }
    if (slice?.eof === true || bytesRead <= 0 || offset >= size) break;
  }
  return new Blob(parts as BlobPart[]);
}

async function openInAnotherApp(
  uri: string,
  fileName: string
): Promise<ReceivedFileOpenResult> {
  try {
    await openFileInViewerApp({
      uri,
      ...(fileName ? { fileName } : {}),
    });
    return { ok: true, via: 'app' };
  } catch (error) {
    if (isPackageOpenRefusal(error)) return { ok: false, reason: 'package' };
    return { ok: false, reason: 'failed', error: messageOf(error) };
  }
}

function showInViewer(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  openFileViewer({
    url,
    ...(fileName ? { fileName } : {}),
    fileSize: blob.size,
  });
  window.setTimeout(() => URL.revokeObjectURL(url), VIEWER_URL_LIFETIME_MS);
}

/**
 * The chat's "Open" for a received file: GO's viewer for anything up to
 * {@link RECEIVED_FILE_VIEWER_MAX_BYTES}, the Android chooser beyond that.
 * An app package is never opened.
 */
export async function openReceivedChatFile(
  file: ReceivedChatFile,
  options: { viewerMaxBytes?: number } = {}
): Promise<ReceivedFileOpenResult> {
  const path = String(file.path || '').trim();
  const legacyUri = String(file.legacyUri || '').trim();
  const name = receivedFileDisplayName(file);
  if (
    isRefusedForOpen({ uri: path, fileName: name }) ||
    (!path && isRefusedForOpen({ uri: legacyUri }))
  ) {
    return { ok: false, reason: 'package' };
  }
  const viewerMaxBytes =
    options.viewerMaxBytes ?? RECEIVED_FILE_VIEWER_MAX_BYTES;
  const stat = path ? await statReceivedChatFile(path) : null;
  if (stat?.exists) {
    if (stat.size <= viewerMaxBytes) {
      try {
        showInViewer(await readReceivedChatFile(path, stat.size), name);
        return { ok: true, via: 'viewer' };
      } catch (error) {
        console.warn('[ReceivedFile] in-app viewer read failed:', error);
      }
    }
    return openInAnotherApp(path, name);
  }
  if (legacyUri) return openInAnotherApp(legacyUri, name);
  if (path && stat === null) return openInAnotherApp(path, name);
  return { ok: false, reason: 'missing' };
}

/**
 * "Save to device": exports one received file to Documents/Qortal Go/<type>.
 * `location` is the folder and name to show the user.
 */
export async function saveReceivedChatFile(
  file: ReceivedChatFile
): Promise<ReceivedFileSaveResult> {
  const path = String(file.path || '').trim();
  const legacyUri = String(file.legacyUri || '').trim();
  const gone = (): ReceivedFileSaveResult =>
    legacyUri
      ? { ok: false, reason: 'already_public' }
      : { ok: false, reason: 'missing' };
  if (!isNative()) return { ok: false, reason: 'failed' };
  if (!path) return gone();
  const name = receivedFileDisplayName(file);
  let granted = false;
  try {
    granted = await ensureNativeStoragePermission();
  } catch {
    granted = false;
  }
  if (!granted) return { ok: false, reason: 'permission' };
  try {
    const saved = await ReticulumReceivedFiles.qchatReceivedFileSave({
      path,
      ...(name ? { fileName: name } : {}),
    });
    const savedName = String(saved?.name || name);
    const folder = String(saved?.folder || '').replace(/^\/+|\/+$/g, '');
    return {
      ok: true,
      name: savedName,
      location: folder
        ? `Documents/${folder}/${savedName}`
        : `Documents/${savedName}`,
      uri: String(saved?.uri || ''),
    };
  } catch (error) {
    if (errorCode(error) === 'NOT_FOUND') return gone();
    return { ok: false, reason: 'failed', error: messageOf(error) };
  }
}

/** Deletes every received file GO still holds. Saved copies stay. */
export async function clearReceivedChatFiles(): Promise<number> {
  if (!isNative()) return 0;
  try {
    const result = await ReticulumReceivedFiles.qchatReceivedFilesClear();
    return Number(result?.deleted) || 0;
  } catch (error) {
    console.warn('[ReceivedFile] could not clear received files:', error);
    return 0;
  }
}

let cleanupInstalled = false;

/**
 * Logout removes the received files (App.tsx fires `logout-event` once the
 * logout went through). Installed once, from the Capacitor bridge.
 */
export function installReceivedChatFileCleanup(): () => void {
  if (cleanupInstalled || !isNative()) return () => {};
  cleanupInstalled = true;
  const onLogout = () => {
    void clearReceivedChatFiles();
    // Copies made for Share / "Open with" from the viewer go too.
    void clearStagedShareFiles();
  };
  subscribeToEvent('logout-event', onLogout);
  return () => {
    cleanupInstalled = false;
    unsubscribeFromEvent('logout-event', onLogout);
  };
}
