import { registerPlugin } from '@capacitor/core';
import { isAndroidApp } from '../utils/androidApp';

/**
 * Private Q-Apps built on the phone (Android only).
 *
 * A private Q-App is a zip that a group admin encrypted with the group's key.
 * GO downloads and decrypts it in the page. Hub then has the node build it
 * (POST /arbitrary/APP/<name>/zip?preview=true), but Core allows that only
 * with the node's API key: a public node refuses it, and any node would see
 * the decrypted app. On Android GO hands the zip to its own native side
 * instead (PrivateQappPlugin), which keeps it in memory and serves it at
 * `<node>/render/hash/<id>`, the address the node's own preview would have,
 * with the same additions (q-apps.js) and policies. Nothing goes to the node
 * and nothing is written to disk.
 */
interface PrivateQappHostPlugin {
  begin(options: { nodeUrl: string }): Promise<{ upload: string }>;
  append(options: { upload: string; chunk: string }): Promise<void>;
  finish(options: { upload: string }): Promise<{ id: string; files: number }>;
  retain(options: { ids: string[] }): Promise<void>;
  clear(): Promise<void>;
}

const PrivateQappHost =
  registerPlugin<PrivateQappHostPlugin>('PrivateQappHost');

/** Base64 characters per bridge message: a multiple of 4, so each piece decodes on its own. */
export const PRIVATE_APP_CHUNK_CHARS = 2 * 1024 * 1024;

const RENDER_PATH = /^\/render\/hash\/([1-9A-HJ-NP-Za-km-z]{32,64})\/?$/;

/** True where GO builds private Q-Apps itself (the Android app). */
export const canBuildPrivateAppsOnDevice = (): boolean => isAndroidApp();

/** The zip's base64 without a data: prefix or whitespace. */
export function cleanZipBase64(value: string): string {
  const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
  return (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s+/g, '');
}

/** The address of an app built on the phone, on the node it was opened from. */
export function privateAppUrl(nodeUrl: string, id: string): string {
  return `${nodeUrl.replace(/\/+$/, '')}/render/hash/${id}`;
}

/** The id from such an address (a tab's url), or null for any other address. */
export function privateAppIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return RENDER_PATH.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Hands the decrypted zip (base64) to the native side in pieces and returns
 * the app's id and address. Rejects when the zip is not one the node would
 * take either (no files, an entry outside the zip, too large).
 */
export async function buildPrivateAppOnDevice(
  nodeUrl: string,
  zipBase64: string
): Promise<{ id: string; url: string }> {
  const zip = cleanZipBase64(zipBase64);
  if (!zip) throw new Error('empty app');
  const { upload } = await PrivateQappHost.begin({ nodeUrl });
  for (let start = 0; start < zip.length; start += PRIVATE_APP_CHUNK_CHARS) {
    await PrivateQappHost.append({
      upload,
      chunk: zip.slice(start, start + PRIVATE_APP_CHUNK_CHARS),
    });
  }
  const { id } = await PrivateQappHost.finish({ upload });
  return { id, url: privateAppUrl(nodeUrl, id) };
}

const quietly = (call: () => Promise<unknown>): void => {
  try {
    Promise.resolve(call()).catch(() => {
      // An older native shell without the plugin: nothing is kept there.
    });
  } catch {
    // Same.
  }
};

/**
 * Lets the native side drop every app no open tab shows. Apps added in the
 * last minute stay, so a tab still opening keeps its app.
 */
export function retainPrivateAppsOnDevice(ids: string[]): void {
  if (!canBuildPrivateAppsOnDevice()) return;
  quietly(() => PrivateQappHost.retain({ ids }));
}

/**
 * The page's script starts with no tabs, so nothing the native side kept for
 * an earlier page in this activity (a reload, a crash recovery) is shown any
 * more. Sent once per page; Capacitor runs plugin calls in order, so this
 * lands before the page's first app.
 */
const PAGE_RESET_MARK = '__qortalPrivateQappHostPageReset';

function clearOncePerPage(): void {
  if (!canBuildPrivateAppsOnDevice()) return;
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[PAGE_RESET_MARK]) return;
  scope[PAGE_RESET_MARK] = true;
  quietly(() => PrivateQappHost.clear());
}

clearOncePerPage();
