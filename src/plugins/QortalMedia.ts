import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * GO's background player (android GoMediaHub / QortalMediaPlugin). Audio and
 * video playing anywhere in GO (Q-Apps, websites, GO itself) show in the
 * notification and on the lock screen; this is the page's side of it: the
 * settings, the sleep timer, "Now playing" for the settings window, and the
 * notification's taps.
 *
 * Use it through src/components/Mobile/backgroundPlayer/backgroundPlayer.ts
 * (no-op off GO).
 */

export type BackgroundPlayerSettings = {
  /** Audio keeps playing when GO leaves the screen. */
  backgroundAudio: boolean;
  /** Video keeps playing (its sound) when GO leaves the screen. */
  backgroundVideo: boolean;
  /** Pause whatever plays when the screen turns off. */
  pauseOnScreenLock: boolean;
  /** Play again what leaving GO paused, once GO is back on screen. */
  resumeOnReturn: boolean;
  /** The lock screen player shows the title and cover (off: only "Audio" / "Video" and the buttons). */
  lockScreen: boolean;
  /** The small Qortal logo on the cover. */
  logoOnCover: boolean;
  /** Pause when headphones or a Bluetooth speaker disconnect. */
  pauseOnNoisy: boolean;
  /** Back / Forward step: 5, 10 or 30. */
  seekStepSec: number;
  /** A paused player leaves the notification after this many minutes; 0 = never. */
  closePausedAfterMin: number;
};

/** 0 off, -1 at the end of the track, else minutes. */
export type SleepTimerMinutes = 0 | -1 | 15 | 30 | 45 | 60 | 90;

export type BackgroundPlayerState = {
  active: boolean;
  title?: string;
  artist?: string;
  /** The Q-App or website (or the site's host); '' for GO's own page. */
  source?: string;
  service?: string;
  kind?: 'audio' | 'video';
  playing?: boolean;
  canNext?: boolean;
  canPrevious?: boolean;
  seekable?: boolean;
  /** -1 when unknown or live. */
  durationSec?: number;
  positionSec?: number;
  sleepMode: number;
  /** Epoch ms when the sleep timer pauses, 0 = none or end of track. */
  sleepEndsAt: number;
};

export type BackgroundPlayerControl =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'back'
  | 'forward';

/** Keys the page may translate for the native player notification. */
export const NATIVE_MEDIA_STRING_KEYS = [
  'media_action_play',
  'media_action_pause',
  'media_action_previous',
  'media_action_next',
  'media_action_back',
  'media_action_forward',
  'media_action_settings',
  'media_title_audio',
  'media_title_video',
  'media_settings_hint',
] as const;

export type NativeMediaStringKey = (typeof NATIVE_MEDIA_STRING_KEYS)[number];

export interface QortalMediaPlugin {
  getSettings(): Promise<BackgroundPlayerSettings>;
  setSettings(
    options: Partial<BackgroundPlayerSettings>
  ): Promise<BackgroundPlayerSettings>;
  getState(): Promise<BackgroundPlayerState>;
  control(options: { action: BackgroundPlayerControl }): Promise<void>;
  setSleepTimer(options: { minutes: SleepTimerMinutes }): Promise<void>;
  setStrings(options: {
    strings: Partial<Record<NativeMediaStringKey, string>>;
  }): Promise<void>;
  addListener(
    eventName: 'playerChanged',
    listener: (state: BackgroundPlayerState) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'openSettings',
    listener: () => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'openSource',
    listener: (event: { frameId: string; goPage: boolean }) => void
  ): Promise<PluginListenerHandle>;
}

export const QortalMedia = registerPlugin<QortalMediaPlugin>('QortalMedia');
