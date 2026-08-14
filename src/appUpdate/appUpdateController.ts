/**
 * Drives the update from "there is a newer build on QDN" to "Android is asking
 * whether to install it".
 *
 * Lives outside React so the notification card, the window and the periodic
 * check all act on one download rather than one each, and so a download keeps
 * going while its window is closed.
 */
import { Capacitor } from '@capacitor/core';
import { getDefaultStore } from 'jotai';
import { QortalAppUpdate } from '../plugins/QortalAppUpdate';
import {
  appUpdateDismissedVersionAtom,
  appUpdateFileAtom,
  appUpdateInstalledVersionAtom,
  appUpdateProgressAtom,
  appUpdateReleaseAtom,
  appUpdateWindowOpenAtom,
} from './appUpdateAtoms';
import {
  buildDownloadUrl,
  compareVersions,
  findLatestPublishedBuild,
  readResourceStatus,
  requestResourceBuild,
  type AppRelease,
} from './qdnAppUpdate';

const store = getDefaultStore();

/** How often the node is asked how far along the QDN fetch is. */
const PREPARE_POLL_MS = 3_000;
/** A build that cannot be gathered in this long is not going to be today. */
const PREPARE_TIMEOUT_MS = 15 * 60 * 1000;
/** Chunks stuck at the same percentage this long get another async nudge. */
const PREPARE_NUDGE_MS = 45_000;

let checkInFlight: Promise<AppRelease | null> | null = null;
let downloadInFlight = false;

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const setProgress = (
  update: Partial<{
    detail: string;
    error: string;
    percent: number;
    phase: import('./appUpdateAtoms').AppUpdatePhase;
  }>
) => {
  store.set(appUpdateProgressAtom, (current) => ({ ...current, ...update }));
};

/** versionName from build.gradle, e.g. "3.0.0". */
export async function readInstalledVersion(): Promise<string> {
  const cached = store.get(appUpdateInstalledVersionAtom);
  if (cached) return cached;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    const version = String(info?.version || '');
    if (version) store.set(appUpdateInstalledVersionAtom, version);
    return version;
  } catch {
    return '';
  }
}

/**
 * Look for a newer build. Silent about everything that is not an update: a
 * node that cannot answer, a publish that is not newer, a version the user has
 * already turned down.
 */
export async function checkForAppUpdate(options?: {
  force?: boolean;
}): Promise<AppRelease | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    try {
      const installed = await readInstalledVersion();
      // Without knowing what is installed there is nothing to compare against,
      // and offering someone the build they are already running is worse than
      // saying nothing.
      if (!installed) return null;
      const release = await findLatestPublishedBuild();
      if (!release) return null;
      if (compareVersions(release.version, installed) <= 0) return null;
      // Asking again for a version already turned down, unless the user went
      // looking for it themselves.
      const dismissed = store.get(appUpdateDismissedVersionAtom);
      if (
        !options?.force &&
        dismissed &&
        compareVersions(release.version, dismissed) <= 0
      ) {
        return null;
      }

      const current = store.get(appUpdateReleaseAtom);
      // A download already under way for this same build is left alone.
      if (current?.identifier === release.identifier && downloadInFlight) {
        return current;
      }
      store.set(appUpdateReleaseAtom, release);
      if (store.get(appUpdateProgressAtom).phase === 'idle') {
        setProgress({
          detail: undefined,
          error: undefined,
          percent: 0,
          phase: 'available',
        });
      }
      return release;
    } catch {
      return null;
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

/**
 * Gather the file on the node. Until every chunk has been found among peers
 * there is nothing to stream, and on a cold node that is the slow part, so it
 * gets its own phase and its own percentage.
 */
async function prepareOnNode(release: AppRelease): Promise<void> {
  setProgress({
    detail: 'Fetching from the Qortal network',
    percent: 0,
    phase: 'preparing',
  });
  await requestResourceBuild(release.service, release.identifier);

  const startedAt = Date.now();
  let lastPercent = -1;
  let lastMovedAt = Date.now();

  for (;;) {
    if (Date.now() - startedAt > PREPARE_TIMEOUT_MS) {
      throw new Error('The network did not deliver the update in time');
    }
    await new Promise((resolve) => setTimeout(resolve, PREPARE_POLL_MS));

    const status = await readResourceStatus(
      release.service,
      release.identifier
    );
    if (!status) continue;

    if (status.status === 'READY') {
      setProgress({ percent: 100 });
      return;
    }
    if (status.status === 'DOWNLOADED') {
      // Chunks are all here; the node still has to put them back together.
      setProgress({ detail: 'Assembling the update', percent: 100 });
      const built = await readResourceStatus(
        release.service,
        release.identifier,
        { build: true }
      );
      if (built?.status === 'READY') return;
      continue;
    }

    const percent = Math.max(0, Math.round(status.percentLoaded));
    if (percent !== lastPercent) {
      lastPercent = percent;
      lastMovedAt = Date.now();
      setProgress({
        detail: 'Fetching from the Qortal network',
        percent,
      });
    } else if (Date.now() - lastMovedAt > PREPARE_NUDGE_MS) {
      // Peers come and go; re-asking restarts the search for what is missing.
      lastMovedAt = Date.now();
      await requestResourceBuild(release.service, release.identifier);
    }
  }
}

/** Stream the assembled file to the device, then hand it to the installer. */
export async function startAppUpdateDownload(): Promise<void> {
  const release = store.get(appUpdateReleaseAtom);
  if (!release || downloadInFlight) return;
  downloadInFlight = true;
  store.set(appUpdateFileAtom, null);

  let listener: { remove: () => void } | null = null;
  try {
    await prepareOnNode(release);

    setProgress({
      detail: 'Downloading',
      percent: 0,
      phase: 'downloading',
    });
    listener = await QortalAppUpdate.addListener(
      'downloadProgress',
      ({ bytes, percent, total }) => {
        setProgress({
          detail: total
            ? `${formatBytes(bytes)} of ${formatBytes(total)}`
            : formatBytes(bytes),
          percent,
        });
      }
    );

    const url = await buildDownloadUrl(
      release.service,
      release.identifier,
      release.filename
    );
    const { path } = await QortalAppUpdate.download({
      filename: release.filename,
      url,
    });
    store.set(appUpdateFileAtom, path);

    await installDownloadedUpdate();
  } catch (error) {
    setProgress({
      error:
        error instanceof Error
          ? error.message
          : 'The update could not be fetched',
      phase: 'error',
    });
  } finally {
    listener?.remove();
    downloadInFlight = false;
  }
}

/**
 * Hand the downloaded file to Android. The system asks the user to confirm, so
 * nothing is installed behind their back; if the app is not yet trusted to ask,
 * the user is pointed at the screen where that is granted.
 */
export async function installDownloadedUpdate(): Promise<void> {
  const path = store.get(appUpdateFileAtom);
  if (!path) return;
  const { allowed } = await QortalAppUpdate.canInstall();
  if (!allowed) {
    setProgress({
      detail: 'Android needs your permission to install apps from Qortal GO',
      percent: 100,
      phase: 'needs-permission',
    });
    return;
  }
  setProgress({
    detail: 'Android will ask you to confirm',
    percent: 100,
    phase: 'installing',
  });
  await QortalAppUpdate.install({ path });
}

/**
 * Install if Android now allows it, ask for the permission if it does not.
 * The button says "Open settings", but by the time it is pressed a second time
 * the permission has usually just been granted, and sending someone back to a
 * screen where the switch is already on is how you make them think it did not
 * work.
 */
export async function continueInstall(): Promise<void> {
  try {
    const { allowed } = await QortalAppUpdate.canInstall();
    if (allowed) {
      await installDownloadedUpdate();
      return;
    }
  } catch {
    /* fall through to asking */
  }
  await QortalAppUpdate.requestInstallPermission();
}

/**
 * Coming back from the settings screen. Android does not tell the page that
 * the permission changed, so the app looks again the moment it is back in
 * front, and carries on where it left off if the answer is now yes.
 */
export async function refreshInstallPermission(): Promise<void> {
  if (store.get(appUpdateProgressAtom).phase !== 'needs-permission') return;
  if (!store.get(appUpdateFileAtom)) return;
  try {
    const { allowed } = await QortalAppUpdate.canInstall();
    if (allowed) await installDownloadedUpdate();
  } catch {
    /* still not allowed, or no native side to ask */
  }
}

export function openAppUpdateWindow(): void {
  store.set(appUpdateWindowOpenAtom, true);
}

export function minimizeAppUpdateWindow(): void {
  store.set(appUpdateWindowOpenAtom, false);
}

/** "Later": keep quiet about this version until a newer one is published. */
export function dismissAppUpdate(): void {
  const release = store.get(appUpdateReleaseAtom);
  if (release) store.set(appUpdateDismissedVersionAtom, release.version);
  store.set(appUpdateWindowOpenAtom, false);
  store.set(appUpdateReleaseAtom, null);
  store.set(appUpdateProgressAtom, { percent: 0, phase: 'idle' });
}

/** Give up on a failed attempt without hiding the update itself. */
export function resetAppUpdateProgress(): void {
  store.set(appUpdateProgressAtom, { percent: 0, phase: 'available' });
  store.set(appUpdateFileAtom, null);
}
