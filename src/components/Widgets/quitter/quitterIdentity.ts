/**
 * Quitter identifier helpers — must match qapp-core with:
 *   appName: 'quitter'
 *   publicSalt: 6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=
 *
 * Public post ids look like:
 *   MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-<uid15>-v1
 */

import ShortUniqueId from 'short-unique-id';

export const QUITTER_APP_NAME = 'quitter';
export const QUITTER_PUBLIC_SALT =
  '6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=';
export const QUITTER_ENTITY_POST = 'POST';
export const QUITTER_ENTITY_ROOT = 'ROOT';
export const QTUBE_VIDEO_BASE = 'qtube_vid_';

const uid15 = new ShortUniqueId({ length: 15 });

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const safeBase64 = (base64: string) =>
  base64
    .replace(/\+/g, '.')
    .replace(/\//g, '~')
    .replace(/_/g, '!')
    .replace(/=+$/, '');

export async function quitterHashWord(
  word: string,
  collisionStrength: number,
  publicSalt: string = QUITTER_PUBLIC_SALT
): Promise<string> {
  const saltedWord = publicSalt + word;
  const encoded = new TextEncoder().encode(saltedWord);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return safeBase64(bytesToBase64(new Uint8Array(hashBuffer))).slice(
    0,
    collisionStrength
  );
}

/** HIGH collision strength used by Quitter for @mention description hashes. */
export async function quitterHashString(word: string): Promise<string> {
  return quitterHashWord(word, 14);
}

/**
 * Build a Quitter public post identifier:
 *   {appHash14}-{entityHash6}-{parentHash14}-{uid15}-v1
 */
export async function buildQuitterPostIdentifier(): Promise<string> {
  const [appHash, entityHash, parentHash] = await Promise.all([
    quitterHashWord(QUITTER_APP_NAME, 14),
    quitterHashWord(QUITTER_ENTITY_POST, 6),
    quitterHashWord(QUITTER_ENTITY_ROOT, 14),
  ]);
  return `${appHash}-${entityHash}-${parentHash}-${uid15.rnd()}-v1`;
}
