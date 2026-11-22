import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  getState: vi.fn(),
  control: vi.fn(async () => undefined),
  setSleepTimer: vi.fn(async () => undefined),
  setStrings: vi.fn(async () => undefined),
  addListener: vi.fn(),
}));

vi.mock('../../../plugins/QortalMedia', () => ({ QortalMedia: plugin }));
vi.mock('../../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/platform')>()),
  isCapacitor: () => true,
}));
import '../../../i18n/i18n';

import {
  DEFAULT_BACKGROUND_PLAYER_SETTINGS,
  backgroundPlayerSettingsAtom,
  backgroundPlayerStateAtom,
  backgroundPlayerWindowOpenAtom,
} from './backgroundPlayer';
import { BackgroundPlayerWindow } from './BackgroundPlayerWindow';
import { BackgroundPlayerSetting } from './BackgroundPlayerSetting';

const store = getDefaultStore();
const idle = { active: false, sleepMode: 0, sleepEndsAt: 0 };

describe('Background player window', () => {
  beforeEach(() => {
    Object.values(plugin).forEach((fn) => fn.mockReset());
    plugin.getSettings.mockResolvedValue(DEFAULT_BACKGROUND_PLAYER_SETTINGS);
    plugin.getState.mockResolvedValue(idle);
    plugin.setSettings.mockImplementation(async (patch) => ({
      ...DEFAULT_BACKGROUND_PLAYER_SETTINGS,
      ...patch,
    }));
    plugin.control.mockResolvedValue(undefined);
    plugin.setSleepTimer.mockResolvedValue(undefined);
    store.set(backgroundPlayerSettingsAtom, DEFAULT_BACKGROUND_PLAYER_SETTINGS);
    store.set(backgroundPlayerStateAtom, idle);
    store.set(backgroundPlayerWindowOpenAtom, false);
  });

  it('opens from the Settings → System row', async () => {
    render(
      <>
        <BackgroundPlayerSetting />
        <BackgroundPlayerWindow />
      </>
    );
    fireEvent.click(screen.getByTestId('background-player-setting'));
    expect(await screen.findByTestId('background-player-window')).toBeTruthy();
    expect(screen.getByTestId('background-player-idle').textContent).toContain(
      'Nothing is playing'
    );
    await act(async () => {});
    expect(plugin.getSettings).toHaveBeenCalled();
  });

  it('starts with audio and video playing on in the background', async () => {
    store.set(backgroundPlayerWindowOpenAtom, true);
    render(<BackgroundPlayerWindow />);
    await act(async () => {});
    const audio = within(
      screen.getByTestId('background-player-audio')
    ).getByRole('checkbox') as HTMLInputElement;
    const video = within(
      screen.getByTestId('background-player-video')
    ).getByRole('checkbox') as HTMLInputElement;
    expect(audio.checked).toBe(true);
    expect(video.checked).toBe(true);
    const lock = within(
      screen.getByTestId('background-player-pause-on-lock')
    ).getByRole('checkbox') as HTMLInputElement;
    expect(lock.checked).toBe(false);
  });

  it('saves a switch to Android', async () => {
    store.set(backgroundPlayerWindowOpenAtom, true);
    render(<BackgroundPlayerWindow />);
    await act(async () => {});
    const video = within(
      screen.getByTestId('background-player-video')
    ).getByRole('checkbox');
    await act(async () => {
      fireEvent.click(video);
    });
    expect(plugin.setSettings).toHaveBeenCalledWith({ backgroundVideo: false });
    expect(store.get(backgroundPlayerSettingsAtom).backgroundVideo).toBe(false);
  });

  it('picks the skip step and when a paused player closes', async () => {
    store.set(backgroundPlayerWindowOpenAtom, true);
    render(<BackgroundPlayerWindow />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByTestId('background-player-seek-30'));
    });
    expect(plugin.setSettings).toHaveBeenCalledWith({ seekStepSec: 30 });
    await act(async () => {
      fireEvent.click(screen.getByTestId('background-player-close-0'));
    });
    expect(plugin.setSettings).toHaveBeenCalledWith({ closePausedAfterMin: 0 });
  });

  it('shows what plays with Play / Pause and the skip buttons', async () => {
    const playing = {
      active: true,
      title: 'Night Drive',
      artist: '',
      source: 'Q-Tube',
      service: 'APP',
      kind: 'video' as const,
      playing: true,
      canNext: false,
      canPrevious: false,
      seekable: true,
      durationSec: 200,
      positionSec: 50,
      sleepMode: 0,
      sleepEndsAt: 0,
    };
    plugin.getState.mockResolvedValue(playing);
    store.set(backgroundPlayerStateAtom, playing);
    store.set(backgroundPlayerWindowOpenAtom, true);
    render(<BackgroundPlayerWindow />);
    await act(async () => {});
    const card = screen.getByTestId('background-player-now-playing');
    expect(card.textContent).toContain('Night Drive');
    expect(card.textContent).toContain('Q-Tube · Video');
    expect(within(card).getByLabelText('Back 10 s')).toBeTruthy();
    expect(within(card).getByLabelText('Forward 10 s')).toBeTruthy();
    fireEvent.click(screen.getByTestId('background-player-toggle'));
    expect(plugin.control).toHaveBeenCalledWith({ action: 'toggle' });
    expect(store.get(backgroundPlayerStateAtom).playing).toBe(false);
  });

  it('sets the sleep timer', async () => {
    store.set(backgroundPlayerWindowOpenAtom, true);
    render(<BackgroundPlayerWindow />);
    await act(async () => {});
    fireEvent.click(screen.getByTestId('background-player-sleep--1'));
    expect(plugin.setSleepTimer).toHaveBeenCalledWith({ minutes: -1 });
    expect(screen.getByText('Pauses when this track ends')).toBeTruthy();
  });
});
