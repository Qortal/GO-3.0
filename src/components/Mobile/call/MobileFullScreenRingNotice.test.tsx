import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ring = vi.hoisted(() => ({
  allowed: false as boolean | null,
  enabledArgs: [] as boolean[],
  open: vi.fn(async () => true),
}));

vi.mock('./callBridgeAdapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./callBridgeAdapters')>();
  return {
    ...actual,
    useFullScreenRingAllowed: (enabled = true) => {
      ring.enabledArgs.push(enabled);
      return enabled ? ring.allowed : null;
    },
    openFullScreenRingSettings: () => ring.open(),
  };
});

import { getDefaultStore } from 'jotai';
import '../../../i18n/i18n';
import {
  mobileChatComposeActiveAtom,
  mobileGroupPanelOpenAtom,
} from '../../../atoms/global';
import {
  FULL_SCREEN_RING_NOTICE_DELAY_MS,
  FULL_SCREEN_RING_NOTICE_OFF_KEY,
  MobileFullScreenRingNotice,
  resetFullScreenRingNoticeForTests,
} from './MobileFullScreenRingNotice';

const waitPastDelay = async () => {
  await act(async () => {
    vi.advanceTimersByTime(FULL_SCREEN_RING_NOTICE_DELAY_MS + 50);
  });
};

describe('MobileFullScreenRingNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resetFullScreenRingNoticeForTests();
    localStorage.removeItem(FULL_SCREEN_RING_NOTICE_OFF_KEY);
    ring.allowed = false;
    ring.enabledArgs = [];
    ring.open.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    getDefaultStore().set(mobileChatComposeActiveAtom, false);
    getDefaultStore().set(mobileGroupPanelOpenAtom, false);
  });

  it('shows a small card a few seconds in, not straight away', async () => {
    render(<MobileFullScreenRingNotice blocked={false} />);
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    await waitPastDelay();
    const card = screen.getByTestId('call-full-screen-notice');
    expect(card.textContent).toContain('Calls over the lock screen');
    // A card, not a dialog: nothing modal.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Allow opens Android and closes the card for this app start', async () => {
    const view = render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    fireEvent.click(screen.getByTestId('call-full-screen-notice-allow'));
    expect(ring.open).toHaveBeenCalledTimes(1);
    view.unmount();
    // Remounted later in the same session: not again.
    render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    // Not saved for good.
    expect(localStorage.getItem(FULL_SCREEN_RING_NOTICE_OFF_KEY)).toBeNull();
  });

  it("Don't show again is saved", async () => {
    const view = render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    fireEvent.click(screen.getByTestId('call-full-screen-notice-never'));
    expect(localStorage.getItem(FULL_SCREEN_RING_NOTICE_OFF_KEY)).toBe('off');
    view.unmount();
    resetFullScreenRingNoticeForTests(); // a new app start
    render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    // Off for good: the permission is not even read.
    expect(ring.enabledArgs[ring.enabledArgs.length - 1]).toBe(false);
  });

  it('X closes it for this app start only', async () => {
    const view = render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    fireEvent.click(screen.getByTestId('call-full-screen-notice-close'));
    expect(localStorage.getItem(FULL_SCREEN_RING_NOTICE_OFF_KEY)).toBeNull();
    view.unmount();
    resetFullScreenRingNoticeForTests();
    render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    expect(screen.getAllByTestId('call-full-screen-notice')).toHaveLength(1);
  });

  it('waits while a call, a ring or a lock is on screen', async () => {
    const view = render(<MobileFullScreenRingNotice blocked />);
    await waitPastDelay();
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    view.rerender(<MobileFullScreenRingNotice blocked={false} />);
    expect(screen.getByTestId('call-full-screen-notice')).toBeTruthy();
  });

  it('waits while the user types or a panel fills the screen', async () => {
    const store = getDefaultStore();
    act(() => store.set(mobileChatComposeActiveAtom, true));
    render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    // Not just above the keyboard, over the composer and its send button.
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    act(() => {
      store.set(mobileChatComposeActiveAtom, false);
      store.set(mobileGroupPanelOpenAtom, true);
    });
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    // The next quiet moment: the card comes up (still once per app start).
    act(() => store.set(mobileGroupPanelOpenAtom, false));
    expect(screen.getByTestId('call-full-screen-notice')).toBeTruthy();
  });

  it('nothing when Android already allows it, or below Android 14', async () => {
    ring.allowed = true;
    const view = render(<MobileFullScreenRingNotice blocked={false} />);
    await waitPastDelay();
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
    ring.allowed = null;
    view.rerender(<MobileFullScreenRingNotice blocked={false} />);
    expect(screen.queryByTestId('call-full-screen-notice')).toBeNull();
  });
});
