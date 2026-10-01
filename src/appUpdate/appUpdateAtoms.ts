import { atom } from 'jotai';
import { atomWithReset, atomWithStorage } from 'jotai/utils';
import type { AppRelease } from './qdnAppUpdate';

/**
 * Where an install is in its life: being fetched off QDN, streaming to the
 * device, waiting for Android's install permission, or handed over to the
 * installer. `idle` means nothing is being installed.
 */
export type AppUpdatePhase =
  | 'idle'
  | 'preparing'
  | 'downloading'
  | 'needs-permission'
  | 'installing'
  | 'error';

export type AppUpdateProgress = {
  /** Free text under the bar: "12.4 MB of 88 MB", "Fetching from QDN…". */
  detail?: string;
  error?: string;
  /** 0–100, or -1 when the length is unknown and the bar should just move. */
  percent: number;
  phase: AppUpdatePhase;
};

// atomWithReset rather than atom(null): with the project's loose null checks,
// a bare null argument matches jotai's read-only overload and the atom comes
// out unwritable.
/** The newest build when it is newer than this one: the update on offer. */
export const appUpdateReleaseAtom = atomWithReset<AppRelease | null>(null);

/**
 * The build the progress below belongs to: usually the update, but an older
 * build when the person chose to go back to it.
 */
export const appUpdateTargetAtom = atomWithReset<AppRelease | null>(null);

export type AppUpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'unreachable';

/** The last look at QDN for a newer build, for the Updates screen. */
export const appUpdateCheckAtom = atom<{
  checkedAt: number;
  status: AppUpdateCheckStatus;
}>({ checkedAt: 0, status: 'idle' });

/** Every build published under the name, for the version history. */
export const appUpdateReleaseListAtom = atom<{
  loadedAt: number;
  /** Shares the node could not deliver on the last load. */
  missing: number;
  releases: AppRelease[];
  status: 'idle' | 'loading' | 'ready' | 'unreachable';
}>({ loadedAt: 0, missing: 0, releases: [], status: 'idle' });

export const appUpdateProgressAtom = atom<AppUpdateProgress>({
  percent: 0,
  phase: 'idle',
});

/** Set once the file is on the device, so installing can be retried. */
export const appUpdateFileAtom = atomWithReset<string | null>(null);

/** The GO 3.0 Updates screen. Closing it never stops a download. */
export const appUpdateWindowOpenAtom = atom(false);

export const appUpdateInstalledVersionAtom = atom<string>('');

/**
 * Version the user said "later" to. A newer one asks again — being reminded
 * about the update you already refused is the fastest way to be ignored.
 */
export const appUpdateDismissedVersionAtom = atomWithStorage<string | null>(
  'qortal-go-update-dismissed',
  null
);

/** Version the Updates screen has been opened for, for the menu's bell. */
export const appUpdateSeenVersionAtom = atomWithStorage<string | null>(
  'qortal-go-update-seen',
  null
);
