import { Capacitor, registerPlugin } from '@capacitor/core';
import { atom, getDefaultStore, useAtomValue } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { screenProtectionHolds } from '../../../plugins/ScreenSecurity';

/**
 * Pictures of open Q-Apps and websites for the tab cards (as in a browser's
 * tab switcher). Android copies the frame's pixels from GO's own window
 * (PixelCopy), scaled down to a small JPEG. They live in memory only: never
 * written to disk, dropped with the tab, on account change and on lock.
 * Elsewhere (desktop, web) cards show the app's icon instead.
 */
interface TabSnapshotPlugin {
  capture(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    dpr: number;
    targetWidth: number;
    quality: number;
  }): Promise<{ base64: string; width: number; height: number }>;
}

const TabSnapshotNative =
  registerPlugin<TabSnapshotPlugin>('QortalTabSnapshot');

export type TabSnapshot = { url: string; at: number };

const MAX_SNAPSHOTS = 24;
const TARGET_WIDTH = 360;
const JPEG_QUALITY = 72;

export const tabSnapshotsAtom = atom<Record<string, TabSnapshot>>({});

export const tabSnapshotAtomFamily = atomFamily((tabId: string) =>
  atom((get) => get(tabSnapshotsAtom)[tabId] ?? null)
);

export const useTabSnapshot = (tabId: string | undefined): TabSnapshot | null =>
  useAtomValue(tabSnapshotAtomFamily(tabId || ''));

type Store = ReturnType<typeof getDefaultStore>;

const isAndroidNative = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const tabFrameId = (tabId: string) => `browser-iframe-${tabId}`;

type Box = { left: number; top: number; right: number; bottom: number };

/** The part of a box inside the viewport, or null when too little shows. */
export function visiblePart(
  rect: Box,
  viewport: { width: number; height: number },
  minSide = 48
): { x: number; y: number; width: number; height: number } | null {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.right);
  const bottom = Math.min(viewport.height, rect.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width < minSide || height < minSide) return null;
  return { x: left, y: top, width, height };
}

/**
 * Whether the frame itself is what shows at a few points over it: a dialog,
 * the Tabs panel or a menu on top would end up in the picture.
 */
export function frameIsUncovered(
  frame: Element,
  area: { x: number; y: number; width: number; height: number },
  hitTest: (x: number, y: number) => Element | null = (x, y) =>
    document.elementFromPoint(x, y)
): boolean {
  const xs = [0.25, 0.5, 0.75];
  const ys = [0.2, 0.5, 0.8];
  for (const fx of xs) {
    for (const fy of ys) {
      const hit = hitTest(area.x + area.width * fx, area.y + area.height * fy);
      if (hit !== frame && !(hit && frame.contains(hit))) return false;
    }
  }
  return true;
}

const base64ToObjectUrl = (base64: string): string => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
};

const inFlight = new Set<string>();

/**
 * Takes a picture of an open tab's frame if it is on screen and nothing
 * covers it. Resolves true when a new picture was stored.
 */
export async function captureTabSnapshot(
  tabId: string | null | undefined,
  store: Store = getDefaultStore()
): Promise<boolean> {
  if (!tabId || !isAndroidNative() || inFlight.has(tabId)) return false;
  if (typeof document === 'undefined' || document.hidden) return false;
  // Seed phrase, approval and lock screens never go into a picture.
  if (screenProtectionHolds('secure') > 0) return false;
  const frame = document.getElementById(tabFrameId(tabId));
  if (!frame) return false;
  const area = visiblePart(frame.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  if (!area || !frameIsUncovered(frame, area)) return false;

  inFlight.add(tabId);
  try {
    const result = await TabSnapshotNative.capture({
      ...area,
      dpr: window.devicePixelRatio || 1,
      targetWidth: TARGET_WIDTH,
      quality: JPEG_QUALITY,
    });
    if (!result?.base64) return false;
    const url = base64ToObjectUrl(result.base64);
    store.set(tabSnapshotsAtom, (prev) => {
      const old = prev[tabId];
      if (old) URL.revokeObjectURL(old.url);
      const next = { ...prev, [tabId]: { url, at: Date.now() } };
      const ids = Object.keys(next);
      if (ids.length > MAX_SNAPSHOTS) {
        ids
          .sort((a, b) => next[a].at - next[b].at)
          .slice(0, ids.length - MAX_SNAPSHOTS)
          .forEach((id) => {
            URL.revokeObjectURL(next[id].url);
            delete next[id];
          });
      }
      return next;
    });
    return true;
  } catch {
    // An older shell without the plugin, or a frame that went away.
    return false;
  } finally {
    inFlight.delete(tabId);
  }
}

/** Forgets the pictures of tabs that are no longer open. */
export function pruneTabSnapshots(
  openTabIds: Iterable<string>,
  store: Store = getDefaultStore()
): void {
  const keep = new Set(openTabIds);
  const current = store.get(tabSnapshotsAtom);
  const stale = Object.keys(current).filter((id) => !keep.has(id));
  if (stale.length === 0) return;
  const next = { ...current };
  stale.forEach((id) => {
    URL.revokeObjectURL(next[id].url);
    delete next[id];
  });
  store.set(tabSnapshotsAtom, next);
}

export function clearTabSnapshots(store: Store = getDefaultStore()): void {
  const current = store.get(tabSnapshotsAtom);
  if (Object.keys(current).length === 0) return;
  Object.values(current).forEach((snapshot) =>
    URL.revokeObjectURL(snapshot.url)
  );
  store.set(tabSnapshotsAtom, {});
}

/**
 * Resolves once the tab has a fresh picture, or after `maxWaitMs`, whichever
 * comes first. Used right before the Tabs panel covers the frame.
 */
export function captureTabSnapshotSoon(
  tabId: string | null | undefined,
  maxWaitMs: number,
  freshMs = 1500,
  store: Store = getDefaultStore()
): Promise<void> {
  if (!tabId || !isAndroidNative()) return Promise.resolve();
  const existing = store.get(tabSnapshotsAtom)[tabId];
  if (existing && Date.now() - existing.at < freshMs) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, maxWaitMs);
    void captureTabSnapshot(tabId, store).finally(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}
