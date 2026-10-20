import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Animations shortened to fades, as with GO's "reduce motion".
vi.mock('./immersive/useImmersiveBars', () => ({
  immersiveMotionReduced: () => true,
}));
vi.mock('../App/QappIcon', () => ({
  QappIcon: ({ name }: { name: string }) => (
    <span data-testid="qapp-icon">{name}</span>
  ),
}));
vi.mock('../Reticulum/reticulumStatus', () => ({
  getDeviceOnline: () => true,
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'https://ext-node.qortal.link',
}));

import '../../i18n/i18n';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import {
  beforePublicNodeOpen,
  checkPublicNodeNow,
  CONFIRM_RETRY_MS,
  getPublicNodeSnapshot,
  isPublicNodeQdnNoticeHidden,
  reportPublicNodeTrouble,
  resetPublicNodeWatchForTests,
} from '../../publicNode/publicNodeWatch';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { PublicNodeDownWindow } from './PublicNodeDownWindow';

let nodeAnswers = false;
const statusFetch = vi.fn(async () => {
  if (!nodeAnswers) throw new TypeError('Failed to fetch');
  return { ok: true, status: 200 } as Response;
});

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS + 50);
  });

async function nodeGoesDown() {
  act(() => {
    void checkPublicNodeNow();
  });
  await settle();
  expect(getPublicNodeSnapshot().health).toBe('down');
}

const pressBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

beforeEach(() => {
  vi.useFakeTimers();
  nodeAnswers = false;
  statusFetch.mockClear();
  vi.stubGlobal('fetch', statusFetch);
  localStorage.clear();
  resetPublicNodeWatchForTests();
});

afterEach(() => {
  resetPublicNodeWatchForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PublicNodeDownWindow', () => {
  it('names the app that waits and offers a private node', async () => {
    const openNodeSettings = vi.fn();
    subscribeToEvent('openNodeSettings', openNodeSettings);
    render(<PublicNodeDownWindow enabled />);
    await nodeGoesDown();

    act(() => {
      beforePublicNodeOpen({ service: 'APP', name: 'Torq', retry: vi.fn() });
    });
    await settle();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Public node unavailable');
    expect(dialog.textContent).toContain('ext-node.qortal.link');
    expect(dialog.textContent).toContain("so Torq can't open");
    expect(screen.getByTestId('public-node-waiting-app').textContent).toContain(
      'Opens when the node is back'
    );
    expect(screen.getByTestId('public-node-check-status').textContent).toMatch(
      /^Checking again in \d+ s$/
    );
    // The window for apps never offers "Don't show again".
    expect(screen.queryByText("Don't show this again")).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Use a private node' }));
    expect(openNodeSettings).toHaveBeenCalledTimes(1);
    expect(getPublicNodeSnapshot().window).toBeNull();
    unsubscribeFromEvent('openNodeSettings', openNodeSettings);
  });

  it('says the node is back and opens the app', async () => {
    render(<PublicNodeDownWindow enabled />);
    await nodeGoesDown();
    const retry = vi.fn();
    act(() => {
      beforePublicNodeOpen({ service: 'APP', name: 'Torq', retry });
    });
    await settle();

    nodeAnswers = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(retry).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('data-phase')).toBe('back');
    expect(dialog.textContent).toContain('Public node is back');
    expect(dialog.textContent).toContain('Opening…');
    expect(screen.queryByRole('button', { name: 'Wait' })).toBeNull();
  });

  it('closes on Android back and keeps waiting', async () => {
    render(<PublicNodeDownWindow enabled />);
    await nodeGoesDown();
    act(() => {
      beforePublicNodeOpen({ service: 'APP', name: 'Torq', retry: vi.fn() });
    });

    expect(pressBack()).toBe(true);
    expect(getPublicNodeSnapshot()).toMatchObject({
      health: 'down',
      window: null,
    });
    expect(pressBack()).toBe(false);
  });

  it('offers "Don\'t show again" when only QDN loads failed', async () => {
    render(<PublicNodeDownWindow enabled />);
    act(() => {
      reportPublicNodeTrouble();
    });
    await settle();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Q-Apps, websites and QDN files can');
    fireEvent.click(screen.getByLabelText("Don't show this again"));
    expect(isPublicNodeQdnNoticeHidden()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(getPublicNodeSnapshot().window).toBeNull();
  });

  it('shows nothing while turned off', async () => {
    render(<PublicNodeDownWindow enabled={false} />);
    act(() => {
      reportPublicNodeTrouble();
    });
    await settle();

    expect(statusFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
