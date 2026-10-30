/**
 * Drives an install from "there is a build on QDN" to "Android is asking
 * whether to install it", and keeps the GO 3.0 Updates screen's view of what
 * is published.
 *
 * Lives outside React so the Updates screen, the account menu's bell and the
 * periodic check all act on one download rather than one each, and so a
 * download keeps going while the screen is closed.
 */
import { Capacitor } from '@capacitor/core';
import { getDefaultStore } from 'jotai';
import { GO_VERSION } from '../appVersion';
import i18n from '../i18n/i18n';
import { QortalAppUpdate } from '../plugins/QortalAppUpdate';
import {
  appUpdateCheckAtom,
  appUpdateDismissedVersionAtom,
  appUpdateFileAtom,
  appUpdateInstalledVersionAtom,
  appUpdateProgressAtom,
  appUpdateReleaseAtom,
  appUpdateReleaseListAtom,
  appUpdateSeenVersionAtom,
  appUpdateTargetAtom,
  appUpdateWindowOpenAtom,
  type AppUpdatePhase,
} from './appUpdateAtoms';
import {
  describeAppUpdateError,
  insecureNodeError,
  isSecureUpdateUrl,
} from './appUpdateSafety';
import {
  buildDownloadRequest,
  compareReleasesNewestFirst,
  compareVersions,
  listPublishedBuilds,
  lookUpLatestPublishedBuild,
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
/** Reopening the Updates screen within this long reuses the version list. */
const RELEASE_LIST_FRESH_MS = 5 * 60 * 1000;

let checkInFlight: Promise<AppRelease | null> | null = null;
let listInFlight: Promise<void> | null = null;
let downloadInFlight = false;

const tr = (key: string, options?: Record<string, unknown>): string =>
  i18n.t(`core:go_updates.${key}`, options) as string;

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
    phase: AppUpdatePhase;
  }>
) => {
  store.set(appUpdateProgressAtom, (current) => ({ ...current, ...update }));
};

/** Only the Android app can download and install a build. */
export const canInstallBuilds = (): boolean => Capacitor.isNativePlatform();

/**
 * versionName from build.gradle, e.g. "0.0.12". The bundle's own version
 * (kept identical to it) stands in when Android cannot be asked, and outside
 * the Android app, so the Updates screen always knows where it is in the list.
 */
export async function readInstalledVersion(): Promise<string> {
  const cached = store.get(appUpdateInstalledVersionAtom);
  if (cached) return cached;
  let version = '';
  if (Capacitor.isNativePlatform()) {
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      version = String(info?.version || '');
    } catch {
      version = '';
    }
  }
  version = version || GO_VERSION;
  store.set(appUpdateInstalledVersionAtom, version);
  return version;
}

const isNewer = (release: AppRelease | null, installed: string): boolean =>
  Boolean(
    release && installed && compareVersions(release.version, installed) > 0
  );

/**
 * Put the newest build on offer when it is newer than what is installed.
 * Silent about everything that is not an update, including a version the user
 * already turned down, unless they went looking for it themselves (`force`).
 */
function offerRelease(
  release: AppRelease | null,
  installed: string,
  force: boolean
): AppRelease | null {
  if (!release || compareVersions(release.version, installed) <= 0) {
    // A build that is no longer newer (it was just installed) stops showing.
    const offered = store.get(appUpdateReleaseAtom);
    if (offered && compareVersions(offered.version, installed) <= 0) {
      store.set(appUpdateReleaseAtom, null);
    }
    return null;
  }
  const dismissed = store.get(appUpdateDismissedVersionAtom);
  if (!force && dismissed && compareVersions(release.version, dismissed) <= 0) {
    return null;
  }
  const current = store.get(appUpdateReleaseAtom);
  // A download already under way for this same build is left alone.
  if (current?.identifier === release.identifier && downloadInFlight) {
    return current;
  }
  store.set(appUpdateReleaseAtom, release);
  return release;
}

/**
 * Look for a newer build (the background check). A node that cannot answer is
 * a "not now", never a "no".
 */
export async function checkForAppUpdate(): Promise<AppRelease | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    try {
      const installed = await readInstalledVersion();
      // Without knowing what is installed there is nothing to compare against,
      // and offering someone the build they are already running is worse than
      // saying nothing.
      if (!installed) return null;
      const { reachable, release } = await lookUpLatestPublishedBuild();
      if (!reachable) {
        store.set(appUpdateCheckAtom, {
          checkedAt: Date.now(),
          status: 'unreachable',
        });
        return null;
      }
      const offered = offerRelease(release, installed, false);
      store.set(appUpdateCheckAtom, {
        checkedAt: Date.now(),
        status: isNewer(release, installed) ? 'available' : 'up-to-date',
      });
      return offered;
    } catch {
      return null;
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

/** One entry per version, `next` winning, newest first. */
const mergeReleases = (
  previous: AppRelease[],
  next: AppRelease[]
): AppRelease[] => {
  const byVersion = new Map(
    previous.map((release) => [release.version, release])
  );
  next.forEach((release) => byVersion.set(release.version, release));
  return Array.from(byVersion.values()).sort(compareReleasesNewestFirst);
};

/**
 * Read every published build for the version history. The newest one is also
 * what the check looks for, so a full load doubles as a check; `force` (the
 * Check for updates button) also brings back a version put off with Later.
 */
export function loadPublishedReleases(options?: {
  force?: boolean;
}): Promise<void> {
  if (listInFlight) return listInFlight;
  const current = store.get(appUpdateReleaseListAtom);
  if (
    !options?.force &&
    current.status === 'ready' &&
    Date.now() - current.loadedAt < RELEASE_LIST_FRESH_MS
  ) {
    return Promise.resolve();
  }

  store.set(appUpdateReleaseListAtom, (list) => ({
    ...list,
    status: 'loading',
  }));
  store.set(appUpdateCheckAtom, (check) => ({ ...check, status: 'checking' }));

  listInFlight = (async () => {
    try {
      const installed = await readInstalledVersion();
      // A reload keeps what is already listed and fills in over it, so the
      // list does not shrink to the first document back and grow again.
      const result = await listPublishedBuilds((releases) => {
        store.set(appUpdateReleaseListAtom, (list) => ({
          ...list,
          releases: mergeReleases(list.releases, releases),
        }));
      });
      const now = Date.now();
      if (!result.reachable) {
        store.set(appUpdateReleaseListAtom, (list) => ({
          ...list,
          status: 'unreachable',
        }));
        store.set(appUpdateCheckAtom, {
          checkedAt: now,
          status: 'unreachable',
        });
        return;
      }
      store.set(appUpdateReleaseListAtom, (list) => ({
        loadedAt: now,
        missing: result.missing,
        // A share the node could not deliver this time is still published.
        releases: result.missing
          ? mergeReleases(list.releases, result.releases)
          : result.releases,
        status: 'ready',
      }));
      const newest = store.get(appUpdateReleaseListAtom).releases[0] ?? null;
      if (installed) {
        offerRelease(newest, installed, Boolean(options?.force));
      }
      store.set(appUpdateCheckAtom, {
        checkedAt: now,
        status: isNewer(newest, installed) ? 'available' : 'up-to-date',
      });
    } catch {
      store.set(appUpdateReleaseListAtom, (list) => ({
        ...list,
        status: 'unreachable',
      }));
      store.set(appUpdateCheckAtom, {
        checkedAt: Date.now(),
        status: 'unreachable',
      });
    } finally {
      listInFlight = null;
    }
  })();

  return listInFlight;
}

/** The Check for updates button: always asks QDN again. */
export function checkForUpdatesNow(): Promise<void> {
  return loadPublishedReleases({ force: true });
}

/**
 * Gather the file on the node. Until every chunk has been found among peers
 * there is nothing to stream, and on a cold node that is the slow part, so it
 * gets its own phase and its own percentage.
 */
async function prepareOnNode(release: AppRelease): Promise<void> {
  setProgress({
    detail: tr('progress.fetching'),
    percent: 0,
    phase: 'preparing',
  });
  await requestResourceBuild(release.service, release.identifier);

  const startedAt = Date.now();
  let lastPercent = -1;
  let lastMovedAt = Date.now();

  for (;;) {
    if (Date.now() - startedAt > PREPARE_TIMEOUT_MS) {
      throw new Error(tr('error.timeout'));
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
      setProgress({ detail: tr('progress.assembling'), percent: 100 });
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
      setProgress({ detail: tr('progress.fetching'), percent });
    } else if (Date.now() - lastMovedAt > PREPARE_NUDGE_MS) {
      // Peers come and go; re-asking restarts the search for what is missing.
      lastMovedAt = Date.now();
      await requestResourceBuild(release.service, release.identifier);
    }
  }
}

/**
 * Stream a build to the device, then hand it to the installer. Without an
 * argument it is the update on offer. Only a build newer than this one is
 * installed: Android refuses to put an older version over a newer one.
 */
export async function startAppUpdateDownload(
  requested?: AppRelease
): Promise<void> {
  const release = requested ?? store.get(appUpdateReleaseAtom);
  if (!release || downloadInFlight || !canInstallBuilds()) return;
  if (!isNewer(release, await readInstalledVersion())) return;
  if (downloadInFlight) return;
  downloadInFlight = true;
  store.set(appUpdateTargetAtom, release);
  store.set(appUpdateFileAtom, null);
  setProgress({ detail: undefined, error: undefined });

  let listener: { remove: () => void } | null = null;
  try {
    const request = await buildDownloadRequest(
      release.service,
      release.identifier,
      release.filename
    );
    // The plugin refuses plain HTTP to a node that is not on this phone; say
    // so now rather than after QDN has spent minutes gathering the build.
    if (!isSecureUpdateUrl(request.url)) throw insecureNodeError();

    await prepareOnNode(release);

    setProgress({
      detail: tr('progress.downloading'),
      percent: 0,
      phase: 'downloading',
    });
    listener = await QortalAppUpdate.addListener(
      'downloadProgress',
      ({ bytes, percent, total }) => {
        setProgress({
          detail: total
            ? tr('progress.bytes_of_total', {
                done: formatBytes(bytes),
                total: formatBytes(total),
              })
            : formatBytes(bytes),
          percent,
        });
      }
    );

    // The key travels beside the URL and goes out as an X-API-KEY header.
    const downloadOptions = {
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
      filename: release.filename,
      url: request.url,
    };
    const { path } = await QortalAppUpdate.download(downloadOptions);
    store.set(appUpdateFileAtom, path);

    await installDownloadedUpdate();
  } catch (error) {
    setProgress({
      error: describeAppUpdateError(error, tr),
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
 *
 * The plugin checks the file once more first (GO's package, the installed
 * GO's signing key, a newer versionCode); a refusal ends the attempt with the
 * reason on screen.
 */
export async function installDownloadedUpdate(): Promise<void> {
  const path = store.get(appUpdateFileAtom);
  if (!path) return;
  const { allowed } = await QortalAppUpdate.canInstall();
  if (!allowed) {
    setProgress({
      detail: tr('progress.needs_permission'),
      percent: 100,
      phase: 'needs-permission',
    });
    return;
  }
  setProgress({
    detail: tr('progress.confirm_in_android'),
    percent: 100,
    phase: 'installing',
  });
  try {
    await QortalAppUpdate.install({ path });
  } catch (error) {
    store.set(appUpdateFileAtom, null);
    setProgress({
      detail: undefined,
      error: describeAppUpdateError(error, tr),
      phase: 'error',
    });
  }
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

/** The update on offer counts as seen once the Updates screen has shown it. */
export function markAppUpdateSeen(): void {
  const release = store.get(appUpdateReleaseAtom);
  if (release) store.set(appUpdateSeenVersionAtom, release.version);
}

export function openAppUpdateWindow(): void {
  store.set(appUpdateWindowOpenAtom, true);
  markAppUpdateSeen();
  void loadPublishedReleases();
}

export function closeAppUpdateWindow(): void {
  store.set(appUpdateWindowOpenAtom, false);
}

/** "Later": keep quiet about this version until a newer one is published. */
export function dismissAppUpdate(): void {
  const release = store.get(appUpdateReleaseAtom);
  if (!release) return;
  store.set(appUpdateDismissedVersionAtom, release.version);
  store.set(appUpdateReleaseAtom, null);
  const target = store.get(appUpdateTargetAtom);
  if (target?.identifier === release.identifier && !downloadInFlight) {
    resetAppUpdateProgress();
  }
}

/** Give up on a finished or failed attempt; the builds stay listed. */
export function resetAppUpdateProgress(): void {
  if (downloadInFlight) return;
  store.set(appUpdateProgressAtom, { percent: 0, phase: 'idle' });
  store.set(appUpdateFileAtom, null);
  store.set(appUpdateTargetAtom, null);
}

/** Test hook. */
export function resetAppUpdateControllerForTests(): void {
  checkInFlight = null;
  listInFlight = null;
  downloadInFlight = false;
}
