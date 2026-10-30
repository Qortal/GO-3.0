/**
 * The "WebView JIT is off" bell notice (GO on GrapheneOS only).
 *
 * GrapheneOS can turn WebView JIT off per app (an exploit protection). Then
 * all of GO's JavaScript and the chat database run in an interpreter, which
 * makes chat several times slower. GO tells the user once, calmly, in the
 * bell panel: what it costs, that it is a security setting and their choice,
 * and the short in-app steps. No modal and no outside link.
 *
 * Shown only when the native flag (NativeBcrypt.runtimeInfo
 * webViewJitRestricted, GrapheneOS's own per-app setting) is exactly true;
 * false (allowed) and null (no such OS flag: stock Android, older GrapheneOS)
 * never show it.
 *
 * The rules, so it never nags:
 * - one card per install; it counts 1 in the bell badge until the panel was
 *   seen (closed again) or the card was used;
 * - X, a swipe or Clear all closes it, and it stays closed;
 * - it comes back only if JIT was seen allowed later and is off again (the
 *   setting changed, so the speed did), unless "Don't show again" is ticked;
 * - the tick is persisted; ticking keeps the open card readable until X or
 *   the next app start, whichever comes first.
 *
 * The flag is read once per app start, a few seconds after start so it stays
 * out of the start-up work; the WebView's JIT state only changes with a
 * restart anyway. Started by MobileBackgroundSetup.
 */
import { useSyncExternalStore } from 'react';
import { Preferences } from '@capacitor/preferences';
import {
  canUseNativeBcrypt,
  getNativeBcryptRuntimeInfo,
} from '../../utils/nativeBcrypt';

export const WEBVIEW_JIT_NOTICE_PREFS_KEY = 'go_webview_jit_notice_v1';
/** How long after start the flag is read. */
export const WEBVIEW_JIT_NOTICE_READ_DELAY_MS = 8_000;

/** Persisted per install. */
type WebViewJitNoticeUiState = {
  /** The "Don't show again" tick: no new card, ever. */
  dontShowAgain: boolean;
  /** When the current (or last) card appeared; null: never shown. */
  cardShownAt: number | null;
  /** The card was closed (X, swipe, Clear all) or JIT was allowed since. */
  cardClosed: boolean;
  /** Last time the card was seen or used; clears its badge. */
  ackAt: number | null;
  /** JIT was seen allowed after the last card: "off" again is news. */
  rearmed: boolean;
};

type WebViewJitNoticeCard = {
  shownAt: number;
  /** Counts 1 in the bell badge: not seen since it appeared. */
  badge: boolean;
};

/** The native flag: true = JIT off for GO, false = allowed, null = no flag. */
type WebViewJitFlag = boolean | null;

export const initialWebViewJitNoticeUi = (): WebViewJitNoticeUiState => ({
  dontShowAgain: false,
  cardShownAt: null,
  cardClosed: false,
  ackAt: null,
  rearmed: false,
});

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

/** The stored state, or null when it is not ours (then start fresh). */
export const parseWebViewJitNoticeUi = (
  raw: string
): WebViewJitNoticeUiState | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const stored = value as Record<string, unknown>;
    return {
      dontShowAgain: stored.dontShowAgain === true,
      cardShownAt: finiteOrNull(stored.cardShownAt),
      cardClosed: stored.cardClosed === true,
      ackAt: finiteOrNull(stored.ackAt),
      rearmed: stored.rearmed === true,
    };
  } catch {
    return null;
  }
};

/**
 * What the bell shows for this flag, and the state to keep. Returns the same
 * `ui` object when nothing has to be stored.
 */
export const applyWebViewJitFlag = (
  ui: WebViewJitNoticeUiState,
  flag: WebViewJitFlag,
  now: number
): { ui: WebViewJitNoticeUiState; card: WebViewJitNoticeCard | null } => {
  if (flag !== true) {
    // JIT allowed now: the card has nothing to say any more, and turning it
    // off again later is worth one more card. No flag at all: nothing.
    if (
      flag === false &&
      ui.cardShownAt !== null &&
      (!ui.cardClosed || !ui.rearmed)
    ) {
      return { ui: { ...ui, cardClosed: true, rearmed: true }, card: null };
    }
    return { ui, card: null };
  }
  if (ui.cardShownAt !== null && !ui.cardClosed) {
    return {
      ui,
      card: {
        shownAt: ui.cardShownAt,
        badge: ui.ackAt === null || ui.ackAt < ui.cardShownAt,
      },
    };
  }
  if (ui.dontShowAgain) return { ui, card: null };
  if (ui.cardShownAt === null || ui.rearmed) {
    // Stored times must stay ordered: a card raised now is newer than any
    // acknowledgement, even one written while the clock was ahead.
    const shownAt = Math.max(now, (ui.ackAt ?? 0) + 1);
    return {
      ui: { ...ui, cardShownAt: shownAt, cardClosed: false, rearmed: false },
      card: { shownAt, badge: true },
    };
  }
  return { ui, card: null };
};

/** Seen (the bell panel closed again) or used: the badge goes. */
export const acknowledgeWebViewJitNoticeUi = (
  ui: WebViewJitNoticeUiState,
  now: number
): WebViewJitNoticeUiState => ({
  ...ui,
  ackAt: Math.max(now, ui.cardShownAt ?? 0),
});

/** X, swipe or Clear all: closed for good (see the rules above). */
export const closeWebViewJitNoticeCardUi = (
  ui: WebViewJitNoticeUiState,
  now: number
): WebViewJitNoticeUiState => ({
  ...acknowledgeWebViewJitNoticeUi(ui, now),
  cardClosed: true,
  rearmed: false,
});

export const setWebViewJitNoticeDontShowAgainUi = (
  ui: WebViewJitNoticeUiState,
  value: boolean,
  now: number
): WebViewJitNoticeUiState => ({
  ...(value ? acknowledgeWebViewJitNoticeUi(ui, now) : ui),
  dontShowAgain: value,
});

/**
 * At app start: a card that was ticked "Don't show again" but never closed
 * with X closes now. The tick keeps the open card readable for the rest of
 * that session only, never across starts. Same `ui` when nothing changes.
 */
export const closeTickedWebViewJitNoticeCardOnStartUi = (
  ui: WebViewJitNoticeUiState,
  now: number
): WebViewJitNoticeUiState =>
  ui.dontShowAgain && ui.cardShownAt !== null && !ui.cardClosed
    ? closeWebViewJitNoticeCardUi(ui, now)
    : ui;

export type WebViewJitNoticeSnapshot = {
  /** The flag and the stored state are both read. */
  ready: boolean;
  card: WebViewJitNoticeCard | null;
  dontShowAgain: boolean;
};

const NOT_READY: WebViewJitNoticeSnapshot = {
  ready: false,
  card: null,
  dontShowAgain: false,
};

/** undefined until read this run. */
let flag: WebViewJitFlag | undefined;
let ui: WebViewJitNoticeUiState | null = null;
let uiLoad: Promise<WebViewJitNoticeUiState | null> | null = null;
let snapshot: WebViewJitNoticeSnapshot = NOT_READY;
let snapshotJson = JSON.stringify(NOT_READY);
const listeners = new Set<() => void>();
let startCount = 0;
let readTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

const emit = () => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[webViewJitNotice] listener failed', error);
    }
  }
};

const setSnapshot = (next: WebViewJitNoticeSnapshot) => {
  const json = JSON.stringify(next);
  if (json === snapshotJson) return;
  snapshot = next;
  snapshotJson = json;
  emit();
};

const persist = (state: WebViewJitNoticeUiState) => {
  const value = JSON.stringify(state);
  persistChain = persistChain
    .then(() => Preferences.set({ key: WEBVIEW_JIT_NOTICE_PREFS_KEY, value }))
    .catch((error) => {
      console.warn('[webViewJitNotice] could not save state', error);
    });
};

const recompute = () => {
  if (!ui || flag === undefined) {
    setSnapshot(NOT_READY);
    return;
  }
  const result = applyWebViewJitFlag(ui, flag, Date.now());
  if (result.ui !== ui) {
    ui = result.ui;
    persist(ui);
  }
  setSnapshot({
    ready: true,
    card: result.card,
    dontShowAgain: ui.dontShowAgain,
  });
};

/**
 * The stored state. A failed read leaves it unknown (it may hold the tick),
 * so no card this time; the next action or start tries again.
 */
const loadUi = (): Promise<WebViewJitNoticeUiState | null> => {
  if (uiLoad) return uiLoad;
  uiLoad = (async () => {
    try {
      const { value } = await Preferences.get({
        key: WEBVIEW_JIT_NOTICE_PREFS_KEY,
      });
      const stored =
        (value ? parseWebViewJitNoticeUi(value) : null) ??
        initialWebViewJitNoticeUi();
      ui = closeTickedWebViewJitNoticeCardOnStartUi(stored, Date.now());
      if (ui !== stored) persist(ui);
    } catch (error) {
      console.warn('[webViewJitNotice] could not read state', error);
      uiLoad = null;
      return null;
    }
    recompute();
    return ui;
  })();
  return uiLoad;
};

/** Reads the native flag (and the stored state, if not read yet). */
const refreshWebViewJitNotice = async (): Promise<void> => {
  if (!canUseNativeBcrypt()) return;
  const [info] = await Promise.all([
    getNativeBcryptRuntimeInfo().catch(() => null),
    loadUi(),
  ]);
  const value = info?.webViewJitRestricted;
  flag = value === true ? true : value === false ? false : null;
  recompute();
};

/**
 * Starts the notice (native Android only; a no-op elsewhere). Counted: the
 * returned stop only cancels the pending read after the last caller stopped.
 */
export const startWebViewJitNoticeStore = (
  delayMs = WEBVIEW_JIT_NOTICE_READ_DELAY_MS
): (() => void) => {
  if (!canUseNativeBcrypt()) return () => {};
  startCount += 1;
  if (startCount === 1 && flag === undefined && readTimer === null) {
    readTimer = setTimeout(() => {
      readTimer = null;
      void refreshWebViewJitNotice();
    }, delayMs);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    startCount = Math.max(0, startCount - 1);
    if (startCount === 0 && readTimer !== null) {
      clearTimeout(readTimer);
      readTimer = null;
    }
  };
};

const subscribeWebViewJitNotice = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getWebViewJitNoticeSnapshot = (): WebViewJitNoticeSnapshot =>
  snapshot;

export const useWebViewJitNotice = (): WebViewJitNoticeSnapshot =>
  useSyncExternalStore(
    subscribeWebViewJitNotice,
    getWebViewJitNoticeSnapshot,
    getWebViewJitNoticeSnapshot
  );

/** What the notice adds to the bell badge: 0 or 1. */
export const useWebViewJitNoticeBellBadge = (): number =>
  useWebViewJitNotice().card?.badge ? 1 : 0;

const updateUi = async (
  change: (
    state: WebViewJitNoticeUiState,
    now: number
  ) => WebViewJitNoticeUiState
): Promise<boolean> => {
  const loaded = await loadUi();
  if (!loaded || !ui) return false;
  ui = change(ui, Date.now());
  persist(ui);
  recompute();
  return true;
};

export const webViewJitNoticeActions = {
  /** The bell panel was seen with the card in it: clears the badge only. */
  acknowledge: async (): Promise<void> => {
    if (!snapshot.card?.badge) return;
    await updateUi(acknowledgeWebViewJitNoticeUi);
  },
  closeCard: async (): Promise<void> => {
    await updateUi(closeWebViewJitNoticeCardUi);
  },
  setDontShowAgain: async (value: boolean): Promise<void> => {
    await updateUi((state, now) =>
      setWebViewJitNoticeDontShowAgainUi(state, value, now)
    );
  },
};

/** Test helper: forget everything this module holds. */
export const resetWebViewJitNoticeStoreForTests = () => {
  if (readTimer !== null) clearTimeout(readTimer);
  readTimer = null;
  startCount = 0;
  flag = undefined;
  ui = null;
  uiLoad = null;
  persistChain = Promise.resolve();
  snapshot = NOT_READY;
  snapshotJson = JSON.stringify(NOT_READY);
  listeners.clear();
};
