import { atom, getDefaultStore } from 'jotai';
import type { TFunction } from 'i18next';
import {
  QortalMedia,
  type BackgroundPlayerControl,
  type BackgroundPlayerSettings,
  type BackgroundPlayerState,
  type NativeMediaStringKey,
  type SleepTimerMinutes,
} from '../../../plugins/QortalMedia';
import { isCapacitor } from '../../../utils/platform';

/**
 * GO's background player, page side. Android (GoMediaHub) watches every
 * frame's audio and video, shows the player in the notification and on the
 * lock screen, and keeps it playing off screen. Here: the settings window
 * (opened from Settings → System or the gear in the notification), its
 * "Now playing" card, and finding the tab a notification tap belongs to.
 */

export const DEFAULT_BACKGROUND_PLAYER_SETTINGS: BackgroundPlayerSettings = {
  backgroundAudio: true,
  backgroundVideo: true,
  pauseOnScreenLock: false,
  resumeOnReturn: true,
  lockScreen: true,
  logoOnCover: true,
  pauseOnNoisy: true,
  seekStepSec: 10,
  closePausedAfterMin: 30,
};

export const SEEK_STEP_OPTIONS = [5, 10, 30] as const;
export const CLOSE_PAUSED_OPTIONS = [5, 15, 30, 60, 0] as const;
export const SLEEP_TIMER_OPTIONS: SleepTimerMinutes[] = [
  0, 15, 30, 45, 60, 90, -1,
];

const IDLE_STATE: BackgroundPlayerState = {
  active: false,
  sleepMode: 0,
  sleepEndsAt: 0,
};

export const backgroundPlayerWindowOpenAtom = atom(false);
export const backgroundPlayerSettingsAtom = atom<BackgroundPlayerSettings>(
  DEFAULT_BACKGROUND_PLAYER_SETTINGS
);
export const backgroundPlayerStateAtom =
  atom<BackgroundPlayerState>(IDLE_STATE);
/** False until the settings were read from Android once. */
export const backgroundPlayerLoadedAtom = atom(false);

const store = getDefaultStore();

/** The background player exists only in GO on Android. */
export function backgroundPlayerAvailable(): boolean {
  return isCapacitor();
}

export function openBackgroundPlayerWindow(): void {
  store.set(backgroundPlayerWindowOpenAtom, true);
  void refreshBackgroundPlayer();
}

export function closeBackgroundPlayerWindow(): void {
  store.set(backgroundPlayerWindowOpenAtom, false);
}

export async function refreshBackgroundPlayer(): Promise<void> {
  if (!backgroundPlayerAvailable()) return;
  try {
    const [settings, state] = await Promise.all([
      QortalMedia.getSettings(),
      QortalMedia.getState(),
    ]);
    if (settings) {
      store.set(backgroundPlayerSettingsAtom, {
        ...DEFAULT_BACKGROUND_PLAYER_SETTINGS,
        ...settings,
      });
    }
    if (state)
      store.set(backgroundPlayerStateAtom, { ...IDLE_STATE, ...state });
    store.set(backgroundPlayerLoadedAtom, true);
  } catch (error) {
    console.warn('[backgroundPlayer] refresh failed', error);
  }
}

/** Saves at once on screen; Android's answer (normalised values) wins. */
export async function updateBackgroundPlayerSettings(
  patch: Partial<BackgroundPlayerSettings>
): Promise<void> {
  const before = store.get(backgroundPlayerSettingsAtom);
  store.set(backgroundPlayerSettingsAtom, { ...before, ...patch });
  if (!backgroundPlayerAvailable()) return;
  try {
    const saved = await QortalMedia.setSettings(patch);
    if (saved) {
      store.set(backgroundPlayerSettingsAtom, {
        ...DEFAULT_BACKGROUND_PLAYER_SETTINGS,
        ...saved,
      });
    }
  } catch (error) {
    console.warn('[backgroundPlayer] save failed', error);
    store.set(backgroundPlayerSettingsAtom, before);
  }
}

export function controlBackgroundPlayer(action: BackgroundPlayerControl): void {
  if (!backgroundPlayerAvailable()) return;
  // Shown at once; the frame's answer corrects it within a moment.
  if (action === 'play' || action === 'pause' || action === 'toggle') {
    const state = store.get(backgroundPlayerStateAtom);
    if (state.active) {
      const playing = action === 'toggle' ? !state.playing : action === 'play';
      store.set(backgroundPlayerStateAtom, { ...state, playing });
    }
  }
  void QortalMedia.control({ action }).catch((error) =>
    console.warn('[backgroundPlayer] control failed', error)
  );
}

export function setBackgroundPlayerSleepTimer(
  minutes: SleepTimerMinutes
): void {
  const state = store.get(backgroundPlayerStateAtom);
  store.set(backgroundPlayerStateAtom, {
    ...state,
    sleepMode: minutes,
    sleepEndsAt: minutes > 0 ? Date.now() + minutes * 60_000 : 0,
  });
  if (!backgroundPlayerAvailable()) return;
  void QortalMedia.setSleepTimer({ minutes }).catch((error) =>
    console.warn('[backgroundPlayer] sleep timer failed', error)
  );
}

export function applyBackgroundPlayerState(
  state: BackgroundPlayerState | null | undefined
): void {
  store.set(backgroundPlayerStateAtom, { ...IDLE_STATE, ...(state ?? {}) });
}

// ── Notification tap → the tab that plays ─────────────────────────────────

/** Frames that reported media (go_media_watch.js posts {goMediaFrame}). */
const mediaFrames = new Map<string, MessageEventSource>();
const MAX_MEDIA_FRAMES = 64;

/** window 'message' listener: remembers which window a media frame id is. */
export function rememberMediaFrame(event: MessageEvent): void {
  const id = (event?.data as { goMediaFrame?: unknown } | null)?.goMediaFrame;
  if (typeof id !== 'string' || !id || id.length > 48 || !event.source) {
    return;
  }
  mediaFrames.delete(id);
  mediaFrames.set(id, event.source);
  while (mediaFrames.size > MAX_MEDIA_FRAMES) {
    const oldest = mediaFrames.keys().next().value;
    if (oldest === undefined) break;
    mediaFrames.delete(oldest);
  }
}

/** AppViewerContainer's wrapper frame around each Q-App: `browser-iframe-<tabId>`. */
const TAB_FRAME_ID_PREFIX = 'browser-iframe-';

function tabIdOfFrame(iframe: HTMLIFrameElement): string | null {
  const own = iframe.getAttribute('data-tab-id');
  if (own) return own;
  const holder = iframe.closest('[data-tab-id]')?.getAttribute('data-tab-id');
  if (holder) return holder;
  if (iframe.id.startsWith(TAB_FRAME_ID_PREFIX)) {
    const id = iframe.id.slice(TAB_FRAME_ID_PREFIX.length);
    return id && id !== 'undefined' ? id : null;
  }
  return null;
}

/**
 * The tab whose frame (or a frame inside it) the media plays in: the
 * reporting window and its parents, matched against GO's own iframes. On
 * GO a Q-App's iframe (AppViewer, data-tab-id) sits inside a same-origin
 * wrapper frame named after the tab (AppViewerContainer); either one tells.
 */
export function findTabIdForMediaFrame(
  frameId: string,
  root: Window = window
): string | null {
  const source = mediaFrames.get(frameId) as Window | undefined;
  if (!source) return null;
  const chain: Window[] = [];
  let frame: Window | null = source;
  try {
    for (let i = 0; i < 12 && frame; i++) {
      chain.push(frame);
      const parent: Window | null = frame.parent;
      if (!parent || parent === frame) break;
      frame = parent;
    }
  } catch {
    return null;
  }
  const iframes = root.document.querySelectorAll('iframe');
  for (const iframe of Array.from(iframes)) {
    const win = iframe.contentWindow;
    if (!win || !chain.includes(win)) continue;
    const tabId = tabIdOfFrame(iframe);
    if (tabId) return tabId;
  }
  return null;
}

export function forgetMediaFramesForTests(): void {
  mediaFrames.clear();
}

// ── Notification texts in GO's language ───────────────────────────────────

export function nativeMediaStrings(
  t: TFunction
): Record<NativeMediaStringKey, string> {
  // {{n}} stays for Android to fill with the step (5, 10 or 30).
  const step = { n: '{{n}}', interpolation: { escapeValue: false } };
  return {
    media_action_play: t('core:go_player.notification.play'),
    media_action_pause: t('core:go_player.notification.pause'),
    media_action_previous: t('core:go_player.notification.previous'),
    media_action_next: t('core:go_player.notification.next'),
    media_action_back: t('core:go_player.notification.back', step),
    media_action_forward: t('core:go_player.notification.forward', step),
    media_action_settings: t('core:go_player.notification.settings'),
    media_title_audio: t('core:go_player.notification.audio'),
    media_title_video: t('core:go_player.notification.video'),
    media_settings_hint: t('core:go_player.notification.settings_hint'),
  };
}

export function pushNativeMediaStrings(t: TFunction): void {
  if (!backgroundPlayerAvailable()) return;
  void QortalMedia.setStrings({ strings: nativeMediaStrings(t) }).catch(
    (error) => console.warn('[backgroundPlayer] strings failed', error)
  );
}
