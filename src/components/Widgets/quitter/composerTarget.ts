/**
 * Quitter or Torq: the app the Home composer posts to. The rest of Home
 * follows the same choice — the feed, the Featured Q-Apps tile and the
 * Android share-sheet entry — so a Torq user never lands in Quitter.
 */
import { atom, getDefaultStore, useAtomValue } from 'jotai';
import { ShareReceiver } from '../../../plugins/ShareReceiver';

export type ComposerTarget = 'quitter' | 'torq';
export type ComposerAppName = 'Quitter' | 'Torq';

const TARGET_STORAGE_KEY = 'go-home-composer-target';

/** Until the user picks one; a saved Quitter stays Quitter. */
const DEFAULT_COMPOSER_TARGET: ComposerTarget = 'torq';

/** Quitter or Torq, as the user last chose it (survives restarts). */
export function readComposerTarget(): ComposerTarget {
  try {
    const stored = localStorage.getItem(TARGET_STORAGE_KEY);
    return stored === 'quitter' || stored === 'torq'
      ? stored
      : DEFAULT_COMPOSER_TARGET;
  } catch {
    return DEFAULT_COMPOSER_TARGET;
  }
}

function writeComposerTarget(target: ComposerTarget): void {
  try {
    localStorage.setItem(TARGET_STORAGE_KEY, target);
  } catch {
    // private mode / quota — the choice just won't persist
  }
}

export const composerTargetAtom = atom<ComposerTarget>(readComposerTarget());

export const composerAppName = (target: ComposerTarget): ComposerAppName =>
  target === 'torq' ? 'Torq' : 'Quitter';

/** Both apps, the chosen one first (the composer's switch order). */
export const composerTargetOrder = (
  target: ComposerTarget
): ComposerTarget[] =>
  target === 'torq' ? ['torq', 'quitter'] : ['quitter', 'torq'];

/** Swap Quitter for Torq in an app list when Torq is the chosen app. */
export function substituteComposerApp<T extends string>(
  apps: readonly T[],
  target: ComposerTarget
): (T | ComposerAppName)[] {
  if (target !== 'torq') return [...apps];
  return apps.map((app) => (app === 'Quitter' ? 'Torq' : app));
}

/** Choose Quitter or Torq everywhere: Home, the feed and the share sheet. */
export function setComposerTarget(target: ComposerTarget): void {
  writeComposerTarget(target);
  getDefaultStore().set(composerTargetAtom, target);
  void ShareReceiver.setShareTarget(target);
}

/** Point the Android share-sheet entry at the stored choice (once per boot). */
export function syncComposerShareTarget(): void {
  void ShareReceiver.setShareTarget(getDefaultStore().get(composerTargetAtom));
}

export function useComposerTarget(): ComposerTarget {
  return useAtomValue(composerTargetAtom);
}
