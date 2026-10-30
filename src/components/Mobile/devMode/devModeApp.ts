import { atomWithStorage } from 'jotai/utils';
import { localJsonStorage } from '../../../utils/localJsonStorage';
import {
  buildPrivateAppOnDevice,
  canBuildPrivateAppsOnDevice,
  cleanZipBase64,
} from '../../../plugins/PrivateQappHost';

/**
 * Dev Mode (GO phones): a Q-App developer picks the app's .zip from the
 * phone and it opens in a tab, the way the node would serve it once it is
 * published. GO builds it itself, like a private Q-App (PrivateQappHost): the
 * zip stays in memory on the phone and no node sees it, so it works on a
 * public node too.
 */

/** Device-wide: off until turned on in Settings → System. */
export const goDevModeEnabledAtom = atomWithStorage<boolean>(
  'go_dev_mode_enabled',
  false,
  localJsonStorage<boolean>(),
  { getOnInit: true }
);

/** True where Dev Mode can open a zip (the Android app). */
export const canOpenDevZips = (): boolean => canBuildPrivateAppsOnDevice();

/** The native side takes at most this much zip (PrivateQappPlugin.MAX_ZIP_BYTES). */
export const DEV_ZIP_MAX_BYTES = 64 * 1024 * 1024;

/** What the file picker offers. */
export const DEV_ZIP_ACCEPT =
  '.zip,application/zip,application/x-zip-compressed,application/x-zip';

/**
 * A dev app's name starts with this. Q-App permissions, notifications and
 * saves are kept per app name, so a zip called "Q-Wallets.zip" must not get
 * what the real Q-Wallets was allowed.
 */
const DEV_APP_NAME_PREFIX = 'Dev: ';

const MAX_LABEL_LENGTH = 40;

/** "Downloads/my-app_v2.zip" → "my-app_v2"; "app" when nothing is left. */
export function devAppLabelFromFileName(fileName: string): string {
  const base = Array.from(
    String(fileName || '')
      .split(/[\\/]/)
      .pop()!
      .replace(/\.zip$/i, '')
  )
    // No control characters, and nothing that would end the name in a
    // qortal:// link or a /render address.
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f || '?#%'.includes(char) ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(base).slice(0, MAX_LABEL_LENGTH).join('').trim() || 'app';
}

export const devAppName = (label: string): string =>
  `${DEV_APP_NAME_PREFIX}${label}`;

/** A tab opened from a zip in Dev Mode. */
export const isDevZipTab = (tab: unknown): boolean =>
  Boolean(tab) &&
  typeof tab === 'object' &&
  (tab as Record<string, unknown>).isDevZip === true;

/**
 * True when the base64 starts like a zip: a local file header ("PK\3\4") or
 * the end record of an empty one ("PK\5\6").
 */
export function looksLikeZipBase64(base64: string): boolean {
  let head = '';
  try {
    head = atob(base64.slice(0, 8));
  } catch {
    return false;
  }
  if (head.charCodeAt(0) !== 0x50 || head.charCodeAt(1) !== 0x4b) return false;
  const [third, fourth] = [head.charCodeAt(2), head.charCodeAt(3)];
  return (third === 3 && fourth === 4) || (third === 5 && fourth === 6);
}

/** The file's bytes as base64 (no data: prefix). */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(
        typeof reader.result === 'string' ? cleanZipBase64(reader.result) : ''
      );
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export type DevZipProblem = 'not_zip' | 'too_large' | 'unreadable' | 'build';

export class DevZipError extends Error {
  constructor(readonly problem: DevZipProblem) {
    super(problem);
  }
}

/**
 * Reads the zip and builds it on the phone. Returns the address the app is
 * served at, on the node GO uses (`<node>/render/hash/<id>`).
 */
export async function buildDevZip(
  nodeUrl: string,
  file: Blob
): Promise<string> {
  if (file.size > DEV_ZIP_MAX_BYTES) throw new DevZipError('too_large');
  let base64: string;
  try {
    base64 = await readFileAsBase64(file);
  } catch {
    throw new DevZipError('unreadable');
  }
  if (!base64 || !looksLikeZipBase64(base64)) throw new DevZipError('not_zip');
  try {
    return (await buildPrivateAppOnDevice(nodeUrl, base64)).url;
  } catch (error) {
    console.warn('Dev Mode zip not built', error);
    throw new DevZipError('build');
  }
}
