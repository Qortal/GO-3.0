import { atom } from 'jotai';
import { atomWithReset, atomWithStorage } from 'jotai/utils';
import type { AppRelease } from './qdnAppUpdate';

/**
 * Where an update is in its life: found, being fetched off QDN, streaming to
 * the device, waiting for Android's install permission, or handed over to the
 * installer.
 */
export type AppUpdatePhase =
  | 'idle'
  | 'available'
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
export const appUpdateReleaseAtom = atomWithReset<AppRelease | null>(null);

export const appUpdateProgressAtom = atom<AppUpdateProgress>({
  percent: 0,
  phase: 'idle',
});

/** Set once the file is on the device, so installing can be retried. */
export const appUpdateFileAtom = atomWithReset<string | null>(null);

/** The big window; false while it is minimised into the notification. */
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

/** Version whose notification has been looked at, for the bell's unread dot. */
export const appUpdateSeenVersionAtom = atomWithStorage<string | null>(
  'qortal-go-update-seen',
  null
);
