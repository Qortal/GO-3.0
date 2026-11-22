import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  getState: vi.fn(),
  control: vi.fn(async () => undefined),
  setSleepTimer: vi.fn(async () => undefined),
  setStrings: vi.fn(async () => undefined),
  addListener: vi.fn(),
}));
const platform = vi.hoisted(() => ({ native: true }));
const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));

vi.mock('../../../plugins/QortalMedia', () => ({ QortalMedia: plugin }));
vi.mock('../../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/platform')>()),
  isCapacitor: () => platform.native,
}));
vi.mock('../../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/events')>()),
  executeEvent: events.executeEvent,
}));

import i18n from '../../../i18n/i18n';
import {
  DEFAULT_BACKGROUND_PLAYER_SETTINGS,
  backgroundPlayerSettingsAtom,
  backgroundPlayerStateAtom,
  controlBackgroundPlayer,
  findTabIdForMediaFrame,
  forgetMediaFramesForTests,
  nativeMediaStrings,
  rememberMediaFrame,
  setBackgroundPlayerSleepTimer,
  updateBackgroundPlayerSettings,
} from './backgroundPlayer';
import { openMediaSource } from './useBackgroundPlayerBridge';

const store = getDefaultStore();

function tabFrame(tabId: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-tab-id', tabId);
  document.body.appendChild(iframe);
  return iframe;
}

function announce(frameId: string, source: Window | null) {
  rememberMediaFrame(
    new MessageEvent('message', { data: { goMediaFrame: frameId }, source })
  );
}

describe('background player (page side)', () => {
  beforeEach(() => {
    Object.values(plugin).forEach((fn) => fn.mockReset());
    plugin.control.mockResolvedValue(undefined);
    plugin.setSleepTimer.mockResolvedValue(undefined);
    events.executeEvent.mockClear();
    platform.native = true;
    store.set(backgroundPlayerSettingsAtom, DEFAULT_BACKGROUND_PLAYER_SETTINGS);
    store.set(backgroundPlayerStateAtom, {
      active: false,
      sleepMode: 0,
      sleepEndsAt: 0,
    });
    forgetMediaFramesForTests();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps audio and video playing off screen by default', () => {
    expect(DEFAULT_BACKGROUND_PLAYER_SETTINGS.backgroundAudio).toBe(true);
    expect(DEFAULT_BACKGROUND_PLAYER_SETTINGS.backgroundVideo).toBe(true);
    expect(DEFAULT_BACKGROUND_PLAYER_SETTINGS.pauseOnScreenLock).toBe(false);
  });

  it('saves a setting at once and takes Android’s answer', async () => {
    plugin.setSettings.mockResolvedValue({
      ...DEFAULT_BACKGROUND_PLAYER_SETTINGS,
      backgroundVideo: false,
      seekStepSec: 30,
    });
    const saving = updateBackgroundPlayerSettings({ backgroundVideo: false });
    expect(store.get(backgroundPlayerSettingsAtom).backgroundVideo).toBe(false);
    await saving;
    expect(plugin.setSettings).toHaveBeenCalledWith({ backgroundVideo: false });
    expect(store.get(backgroundPlayerSettingsAtom).seekStepSec).toBe(30);
  });

  it('puts a setting back when Android refuses it', async () => {
    plugin.setSettings.mockRejectedValue(new Error('no'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await updateBackgroundPlayerSettings({ lockScreen: false });
    expect(store.get(backgroundPlayerSettingsAtom).lockScreen).toBe(true);
    warn.mockRestore();
  });

  it('shows Play / Pause at once and sends it', () => {
    store.set(backgroundPlayerStateAtom, {
      active: true,
      playing: true,
      sleepMode: 0,
      sleepEndsAt: 0,
    });
    controlBackgroundPlayer('toggle');
    expect(store.get(backgroundPlayerStateAtom).playing).toBe(false);
    expect(plugin.control).toHaveBeenCalledWith({ action: 'toggle' });
  });

  it('sets the sleep timer', () => {
    const before = Date.now();
    setBackgroundPlayerSleepTimer(30);
    const state = store.get(backgroundPlayerStateAtom);
    expect(state.sleepMode).toBe(30);
    expect(state.sleepEndsAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(plugin.setSleepTimer).toHaveBeenCalledWith({ minutes: 30 });
    setBackgroundPlayerSleepTimer(-1);
    expect(store.get(backgroundPlayerStateAtom).sleepEndsAt).toBe(0);
  });

  it('does nothing natively off GO', () => {
    platform.native = false;
    controlBackgroundPlayer('play');
    expect(plugin.control).not.toHaveBeenCalled();
  });

  it('finds the tab a media frame belongs to', () => {
    const a = tabFrame('tab-a');
    const b = tabFrame('tab-b');
    announce('fa', a.contentWindow);
    announce('fb', b.contentWindow);
    expect(findTabIdForMediaFrame('fa')).toBe('tab-a');
    expect(findTabIdForMediaFrame('fb')).toBe('tab-b');
    expect(findTabIdForMediaFrame('unknown')).toBeNull();
  });

  it('finds the tab for a frame inside a Q-App’s own frame', () => {
    const outer = tabFrame('tab-outer');
    const inner = outer.contentDocument!.createElement('iframe');
    outer.contentDocument!.body.appendChild(inner);
    announce('nested', inner.contentWindow);
    expect(findTabIdForMediaFrame('nested')).toBe('tab-outer');
  });

  it('finds the tab through GO’s wrapper frame around a Q-App', () => {
    // AppViewerContainer: <iframe id="browser-iframe-<tabId>" srcdoc> with
    // the Q-App's own iframe inside it.
    const wrapper = document.createElement('iframe');
    wrapper.id = 'browser-iframe-tab-w';
    document.body.appendChild(wrapper);
    const app = wrapper.contentDocument!.createElement('iframe');
    wrapper.contentDocument!.body.appendChild(app);
    announce('wrapped', app.contentWindow);
    expect(findTabIdForMediaFrame('wrapped')).toBe('tab-w');
  });

  it('ignores messages that are not media frame ids', () => {
    const a = tabFrame('tab-a');
    rememberMediaFrame(
      new MessageEvent('message', { data: 'x', source: a.contentWindow })
    );
    rememberMediaFrame(
      new MessageEvent('message', {
        data: { goMediaFrame: 5 },
        source: a.contentWindow,
      })
    );
    rememberMediaFrame(
      new MessageEvent('message', {
        data: { goMediaFrame: 'y'.repeat(100) },
        source: a.contentWindow,
      })
    );
    expect(findTabIdForMediaFrame('x')).toBeNull();
    expect(findTabIdForMediaFrame('y'.repeat(100))).toBeNull();
  });

  it('a notification tap opens the tab that plays', () => {
    const frame = tabFrame('tab-q');
    announce('fq', frame.contentWindow);
    const tab = { tabId: 'tab-q', name: 'Q-Tube', service: 'APP' };
    expect(openMediaSource('fq', false, [tab])).toBe(true);
    expect(events.executeEvent).toHaveBeenCalledWith('setSelectedTab', {
      data: tab,
    });
    expect(events.executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('a tap on media in GO’s own page just opens GO', () => {
    expect(openMediaSource('any', true, [])).toBe(false);
    expect(events.executeEvent).not.toHaveBeenCalledWith(
      'setSelectedTab',
      expect.anything()
    );
  });

  it('hands Android the notification texts with {{n}} for the step', async () => {
    await i18n.changeLanguage('en');
    const strings = nativeMediaStrings(i18n.t.bind(i18n));
    expect(strings.media_action_back).toBe('Back {{n}} s');
    expect(strings.media_action_forward).toBe('Forward {{n}} s');
    expect(strings.media_action_settings).toBe('Player settings');
  });
});
