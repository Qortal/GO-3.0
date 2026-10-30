/**
 * App-wide state for the vendor-freeze notice (native Android only): native
 * facts (freeze records, mode, exemption) plus the persisted UI state, run
 * through vendorFreezeHintPolicy.ts. The bell panel (GeneralNotifications,
 * MobileTopBar's badge) and the Background sync settings read it with
 * `useVendorFreezeHint()` and act through `vendorFreezeHintActions`.
 *
 * Reads native state on start, on every return to GO and on the live
 * 'vendorFreezeDetected' event. No polling. A return is any of Capacitor's
 * App 'resume' (every onResume, also after a system dialog such as the
 * 'Allow in background' prompt, which only pauses GO), window focus, and
 * visibilitychange to visible (which a dialog does not cause). Started once
 * by MobileBackgroundSetup.
 */
import { useSyncExternalStore } from 'react';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  acknowledgeVendorFreezeHint as acknowledgeNativeHint,
  fetchBackgroundSyncState,
  fetchIgnoringBatteryOptimizations,
  isNativeAndroid,
  openVendorBatterySettings,
  requestBatteryExemption,
  subscribeBackgroundSyncEvents,
  type BackgroundSyncMode,
  type VendorBatterySettingsPage,
  type VendorFreezeEvent,
  type VendorFreezeRecord,
} from './backgroundSync';
import {
  normalizeBatteryBrand,
  type VendorBatteryBrand,
} from './vendorBatterySteps';
import {
  acknowledgeUi,
  clampUiToClock,
  closeCardUi,
  decide,
  initialUiState,
  parseUiState,
  recordCardShown,
  setDontShowAgainUi,
  type VendorFreezeBell,
  type VendorFreezeHintUiState,
  type VendorFreezeSettings,
} from './vendorFreezeHintPolicy';

export const VENDOR_FREEZE_HINT_PREFS_KEY = 'go_vendor_freeze_hint_v2';

export type VendorFreezeHintSnapshot = {
  /** Native Android, with the stored UI state and native state both read. */
  ready: boolean;
  /** Build.MANUFACTURER as native reports it (trimmed), '' when unknown. */
  manufacturer: string;
  /** Brand group for vendorBatterySteps / the step texts. */
  brand: VendorBatteryBrand;
  mode: BackgroundSyncMode | null;
  /** GO is exempt from battery optimisation now ('Allow in background'). */
  ignoringBatteryOptimizations: boolean;
  /** Freezes native recorded since install (all, not only significant). */
  freezeCount: number;
  /** The bell card, or null. `bell.badge` adds 1 to the bell badge. */
  bell: VendorFreezeBell | null;
  /** What the Background sync settings show. */
  settings: VendorFreezeSettings;
  /** The "Don't show again" tick. */
  dontShowAgain: boolean;
};

type NativeFacts = {
  mode: BackgroundSyncMode;
  records: VendorFreezeRecord[];
  manufacturer: string;
  ignoring: boolean;
  freezeCount: number;
};

const NOT_READY: VendorFreezeHintSnapshot = {
  ready: false,
  manufacturer: '',
  brand: 'generic',
  mode: null,
  ignoringBatteryOptimizations: false,
  freezeCount: 0,
  bell: null,
  settings: { episodes7d: 0, lastAt: null, variant: 'none' },
  dontShowAgain: false,
};

let facts: NativeFacts | null = null;
let ui: VendorFreezeHintUiState | null = null;
let uiLoad: Promise<VendorFreezeHintUiState | null> | null = null;
let snapshot: VendorFreezeHintSnapshot = NOT_READY;
let snapshotJson = JSON.stringify(NOT_READY);
const listeners = new Set<() => void>();
let readStamp = 0;
let startCount = 0;
let stopRuntime: (() => void) | null = null;
let persistChain: Promise<void> = Promise.resolve();
/**
 * The stored UI state could not be read yet. Until it can, `ui` is a stand-in
 * kept in memory only: no new card (the stored state may hold the tick or the
 * 3-card cap) and no write (it would overwrite that state).
 */
let uiReadFailed = false;

type UiChange = (
  state: VendorFreezeHintUiState,
  now: number
) => VendorFreezeHintUiState;

/** What the user did while uiReadFailed, replayed onto the stored state. */
let pendingChanges: { change: UiChange; at: number }[] = [];

const emit = () => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[vendorFreezeHint] listener failed', error);
    }
  }
};

const setSnapshot = (next: VendorFreezeHintSnapshot) => {
  const json = JSON.stringify(next);
  if (json === snapshotJson) return;
  snapshot = next;
  snapshotJson = json;
  emit();
};

const persist = (state: VendorFreezeHintUiState) => {
  const value = JSON.stringify(state);
  persistChain = persistChain
    .then(() => Preferences.set({ key: VENDOR_FREEZE_HINT_PREFS_KEY, value }))
    .catch((error) => {
      console.warn('[vendorFreezeHint] could not save state', error);
    });
};

/** Runs the policy on the current facts and publishes the result. */
const recompute = () => {
  if (!facts || !ui) {
    setSnapshot(NOT_READY);
    return;
  }
  const now = Date.now();
  // Written while the clock was ahead: fix it once, for good, so time can
  // pass it (vendorFreezeHintPolicy.clampUiToClock).
  const clamped = clampUiToClock(ui, now);
  if (clamped !== ui) {
    ui = clamped;
    if (!uiReadFailed) persist(ui);
  }
  const policyFacts = {
    mode: facts.mode,
    records: facts.records,
    ignoringNow: facts.ignoring,
  };
  // Stored state unknown: raise no new card (it may hold the tick or cap).
  const policyUi = uiReadFailed ? { ...ui, dontShowAgain: true } : ui;
  let decision = decide(policyFacts, policyUi, now);
  if (decision.bell?.isNew && !uiReadFailed) {
    ui = recordCardShown(ui, now);
    persist(ui);
    decision = decide(policyFacts, ui, now);
  }
  setSnapshot({
    ready: true,
    manufacturer: facts.manufacturer,
    brand: normalizeBatteryBrand(facts.manufacturer),
    mode: facts.mode,
    ignoringBatteryOptimizations: facts.ignoring,
    freezeCount: facts.freezeCount,
    bell: decision.bell,
    settings: decision.settings,
    dontShowAgain: ui.dontShowAgain,
  });
};

/**
 * The stored UI state, read once it reads. No stored state yet (first run of
 * this code, including the update from the old always-on hint): start
 * counting now, without the quiet time, and clear the old build's native
 * flag. A failed read leaves a memory-only stand-in (see uiReadFailed) and is
 * tried again on the next return to GO or action.
 */
const loadUi = (): Promise<VendorFreezeHintUiState | null> => {
  if (!isNativeAndroid()) return Promise.resolve(null);
  if (uiLoad) return uiLoad;
  uiLoad = (async () => {
    let stored: VendorFreezeHintUiState | null;
    try {
      const { value } = await Preferences.get({
        key: VENDOR_FREEZE_HINT_PREFS_KEY,
      });
      stored = value ? parseUiState(value) : null;
    } catch (error) {
      console.warn('[vendorFreezeHint] could not read state', error);
      uiReadFailed = true;
      uiLoad = null;
      if (!ui) ui = initialUiState(Date.now());
      recompute();
      return ui;
    }
    const firstRun = !stored;
    let next = stored ?? initialUiState(Date.now());
    // Acknowledgements and the tick from while the read failed still count.
    for (const { change, at } of pendingChanges) next = change(next, at);
    const replayed = pendingChanges.length > 0;
    pendingChanges = [];
    uiReadFailed = false;
    ui = next;
    if (firstRun || replayed) persist(ui);
    if (firstRun) void acknowledgeNativeHint();
    recompute();
    return ui;
  })();
  return uiLoad;
};

/** Reads native state; a newer read or a live event supersedes it. */
const refresh = async (): Promise<void> => {
  if (!isNativeAndroid()) return;
  const stamp = ++readStamp;
  const state = await fetchBackgroundSyncState();
  if (stamp !== readStamp || !state) return;
  let ignoring = state.ignoringBatteryOptimizations;
  if (ignoring == null) {
    // Older native build: ask the separate method.
    ignoring = (await fetchIgnoringBatteryOptimizations()) === true;
    if (stamp !== readStamp) return;
  }
  facts = {
    mode: state.mode,
    records: state.vendorFreezeRecent,
    manufacturer: state.manufacturer,
    ignoring,
    freezeCount: state.vendorFreezeCount,
  };
  recompute();
};

const onVendorFreezeDetected = (event: VendorFreezeEvent) => {
  // Show it at once, then read the authoritative list.
  if (facts && event.gapMs != null) {
    const record: VendorFreezeRecord = {
      at: event.lastAt,
      gapMs: event.gapMs,
      ignoring: event.ignoring ?? facts.ignoring,
      charging: event.charging === true,
    };
    facts = {
      ...facts,
      records: [
        ...facts.records.filter((item) => item.at !== record.at),
        record,
      ].sort((a, b) => a.at - b.at),
      manufacturer: event.manufacturer || facts.manufacturer,
      freezeCount: Math.max(facts.freezeCount, event.count),
    };
    recompute();
  }
  void refresh();
};

/** performance.now() when the native read for a return to GO started. */
let returnReadStartedAt: number | null = null;
/** A read this old may hang across a freeze; start another one anyway. */
const RETURN_READ_STALE_MS = 2_000;

/**
 * GO is back on screen: re-read everything. One return fires several of the
 * signals (resume, focus, visibilitychange); they share one native read.
 */
const onReturn = () => {
  if (uiReadFailed) void loadUi();
  // Time moved on (card expiry, quiet time) even if the read fails.
  recompute();
  const startedAt = performance.now();
  if (
    returnReadStartedAt != null &&
    startedAt - returnReadStartedAt < RETURN_READ_STALE_MS
  ) {
    return;
  }
  returnReadStartedAt = startedAt;
  void refresh().finally(() => {
    if (returnReadStartedAt === startedAt) returnReadStartedAt = null;
  });
};

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') onReturn();
};

/** Capacitor's App 'resume'; null where the App plugin is missing. */
const listenForResume = (): Promise<PluginListenerHandle | null> => {
  try {
    return Promise.resolve(App.addListener('resume', onReturn)).catch(
      () => null
    );
  } catch {
    return Promise.resolve(null);
  }
};

/**
 * Starts reading native state (native Android only; a no-op elsewhere).
 * Counted: the returned stop only ends the listeners after the last caller
 * stopped.
 */
export const startVendorFreezeHintStore = (): (() => void) => {
  if (!isNativeAndroid()) return () => {};
  startCount += 1;
  if (startCount === 1) {
    void loadUi();
    void refresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onReturn);
    const resumeHandle = listenForResume();
    const unsubscribe = subscribeBackgroundSyncEvents({
      onVendorFreezeDetected,
    });
    stopRuntime = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onReturn);
      void resumeHandle.then((handle) => handle?.remove()).catch(() => {});
      unsubscribe();
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    startCount = Math.max(0, startCount - 1);
    if (startCount === 0) {
      stopRuntime?.();
      stopRuntime = null;
    }
  };
};

const subscribeVendorFreezeHint = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getVendorFreezeHintSnapshot = (): VendorFreezeHintSnapshot =>
  snapshot;

export const useVendorFreezeHint = (): VendorFreezeHintSnapshot =>
  useSyncExternalStore(
    subscribeVendorFreezeHint,
    getVendorFreezeHintSnapshot,
    getVendorFreezeHintSnapshot
  );

/** What the notice adds to the bell badge: 0 or 1. */
export const useVendorFreezeBellBadge = (): number =>
  useVendorFreezeHint().bell?.badge ? 1 : 0;

/**
 * shownAt of the newest card the bell popped for. It starts at page load, so
 * a card an earlier run raised (shown again on a cold start) does not pop.
 */
let cardPoppedAt = Date.now();

/**
 * For the bell's pop animation (MobileTopBar): true once per new card, given
 * the shownAt of the unacknowledged card (null when there is none). Module
 * scope, so a remounted top bar does not pop for the same card again.
 */
export const claimVendorFreezeCardPop = (shownAt: number | null): boolean => {
  if (shownAt == null || !(shownAt > cardPoppedAt)) return false;
  cardPoppedAt = shownAt;
  return true;
};

const updateUi = async (change: UiChange): Promise<boolean> => {
  const loaded = await loadUi();
  if (!loaded || !ui) return false;
  const now = Date.now();
  ui = change(ui, now);
  if (uiReadFailed) {
    pendingChanges.push({ change, at: now });
  } else {
    persist(ui);
  }
  recompute();
  return true;
};

/** Clears the badge and starts the 14-day quiet time; the card stays up. */
const acknowledge = async (): Promise<void> => {
  if (await updateUi(acknowledgeUi)) {
    // Harmless on new builds; clears an old build's pending flag.
    void acknowledgeNativeHint();
  }
};

/** X on the bell card: acknowledges and removes the card. */
const closeCard = async (): Promise<void> => {
  if (await updateUi(closeCardUi)) void acknowledgeNativeHint();
};

/** The "Don't show again" tick. Ticking also acknowledges. */
const setDontShowAgain = async (value: boolean): Promise<void> => {
  if (
    (await updateUi((state, now) => setDontShowAgainUi(state, value, now))) &&
    value
  ) {
    void acknowledgeNativeHint();
  }
};

/**
 * 'Allow GO in background': acknowledges, then opens Android's exemption
 * dialog. The new value is read on the App 'resume' (or window focus) when
 * the dialog closes. False when the dialog could not open.
 */
const allowInBackground = async (): Promise<boolean> => {
  await acknowledge();
  return requestBatteryExemption();
};

/**
 * 'Open battery settings': acknowledges, then opens the phone's battery page
 * (vivo / iQOO) or GO's App info page. Null when nothing opened.
 */
const openBatterySettings =
  async (): Promise<VendorBatterySettingsPage | null> => {
    await acknowledge();
    return openVendorBatterySettings();
  };

/** Expanding the steps counts as seeing the notice. */
const expandSteps = async (): Promise<void> => {
  await acknowledge();
};

export const vendorFreezeHintActions = {
  acknowledge,
  closeCard,
  setDontShowAgain,
  allowInBackground,
  openBatterySettings,
  expandSteps,
  /** Re-read native state now, e.g. right after the mode was changed. */
  refresh,
};

/** Test helper: forget everything this module holds. */
export const resetVendorFreezeHintStoreForTests = () => {
  stopRuntime?.();
  stopRuntime = null;
  startCount = 0;
  facts = null;
  ui = null;
  uiLoad = null;
  uiReadFailed = false;
  pendingChanges = [];
  returnReadStartedAt = null;
  cardPoppedAt = Date.now();
  readStamp = 0;
  persistChain = Promise.resolve();
  snapshot = NOT_READY;
  snapshotJson = JSON.stringify(NOT_READY);
  listeners.clear();
};
