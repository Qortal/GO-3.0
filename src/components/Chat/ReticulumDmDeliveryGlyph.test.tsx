import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ReticulumDmDeliveryGlyph } from './ReticulumDmDeliveryGlyph';
import {
  getReticulumDmDeliveryState,
  hasReticulumDmDeliveryState,
  RETICULUM_DM_ONLY_LOCAL_AFTER_MS,
  RETICULUM_DM_PENDING_MAX_AGE_MS,
  reticulumDmDeliveryWaiterCount,
  setReticulumDmDeliveryTrackingSince,
} from './reticulumDmDeliveryState';

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';
const NOW = 1_800_000_000_000;

const own = (overrides: Record<string, unknown> = {}) => ({
  reticulumDirect: true,
  sender: ME,
  recipientAddress: PEER,
  timestamp: NOW,
  reticulumDeliveryStatus: 'pending',
  ...overrides,
});

// Every row in these tests was written after delivery tracking started.
beforeEach(() => {
  setReticulumDmDeliveryTrackingSince(0);
});

describe('getReticulumDmDeliveryState', () => {
  it('shows nothing for pending rows written before tracking started', () => {
    // Upgrade from a build without own-device copy tracking: such a row may
    // have been delivered through the Hub, so no 'Not sent yet' warning.
    setReticulumDmDeliveryTrackingSince(NOW + 1);
    expect(getReticulumDmDeliveryState(own(), ME, NOW + 3_600_000)).toBeNull();
    expect(
      getReticulumDmDeliveryState(
        own({ reticulumDeliveryStatus: 'sent' }),
        ME,
        NOW + 3_600_000
      )
    ).toBe('delivered');
    expect(
      getReticulumDmDeliveryState(own({ timestamp: NOW + 1 }), ME, NOW + 5_000)
    ).toBe('sending');
  });

  it('is Sending for a fresh pending message', () => {
    expect(getReticulumDmDeliveryState(own(), ME, NOW + 5_000)).toBe('sending');
  });

  it('is Only on this phone once pending with no own-device copy for ~30 s', () => {
    expect(
      getReticulumDmDeliveryState(
        own(),
        ME,
        NOW + RETICULUM_DM_ONLY_LOCAL_AFTER_MS
      )
    ).toBe('only_on_this_phone');
  });

  it('is On your other device when an own device pulled it, at any age', () => {
    const copied = own({ reticulumOwnDeviceCopiedAt: NOW + 1_000 });
    expect(getReticulumDmDeliveryState(copied, ME, NOW + 2_000)).toBe(
      'on_other_device'
    );
    expect(getReticulumDmDeliveryState(copied, ME, NOW + 3_600_000)).toBe(
      'on_other_device'
    );
  });

  it('is Delivered when sent, even if an own device also had a copy', () => {
    expect(
      getReticulumDmDeliveryState(
        own({
          reticulumDeliveryStatus: 'sent',
          reticulumOwnDeviceCopiedAt: NOW,
        }),
        ME,
        NOW
      )
    ).toBe('delivered');
  });

  it('shows nothing for a message still pending after the engine gave up on it', () => {
    const eightDaysMs = 8 * 24 * 60 * 60_000;
    expect(RETICULUM_DM_PENDING_MAX_AGE_MS).toBe(7 * 24 * 60 * 60_000);
    expect(getReticulumDmDeliveryState(own(), ME, NOW + eightDaysMs)).toBe(
      null
    );
    expect(
      getReticulumDmDeliveryState(
        own({ reticulumOwnDeviceCopiedAt: NOW }),
        ME,
        NOW + eightDaysMs
      )
    ).toBeNull();
    expect(hasReticulumDmDeliveryState(own(), ME, NOW + eightDaysMs)).toBe(
      false
    );
    // Still shown up to the limit, and 'Delivered' never ages out.
    expect(
      getReticulumDmDeliveryState(
        own(),
        ME,
        NOW + RETICULUM_DM_PENDING_MAX_AGE_MS
      )
    ).toBe('only_on_this_phone');
    expect(
      getReticulumDmDeliveryState(
        own({ reticulumDeliveryStatus: 'sent' }),
        ME,
        NOW + eightDaysMs
      )
    ).toBe('delivered');
  });

  it('shows nothing for incoming, Saved Messages, group or unknown status', () => {
    expect(
      getReticulumDmDeliveryState(own({ sender: PEER }), ME, NOW)
    ).toBeNull();
    expect(
      getReticulumDmDeliveryState(
        own({ recipientAddress: ME, reticulumDeliveryStatus: 'sent' }),
        ME,
        NOW
      )
    ).toBeNull();
    expect(
      getReticulumDmDeliveryState(own({ reticulumDirect: false }), ME, NOW)
    ).toBeNull();
    expect(
      getReticulumDmDeliveryState(
        own({ reticulumDeliveryStatus: 'received' }),
        ME,
        NOW
      )
    ).toBeNull();
    expect(
      getReticulumDmDeliveryState(
        own({ reticulumDeliveryStatus: undefined }),
        ME,
        NOW
      )
    ).toBeNull();
  });
});

describe('ReticulumDmDeliveryGlyph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a static labelled glyph for each state, with no progress indicator', () => {
    const { rerender, container } = render(
      <ReticulumDmDeliveryGlyph message={own()} myAddress={ME} />
    );
    expect(screen.getByRole('img', { name: 'Sending' })).toBeInTheDocument();

    rerender(
      <ReticulumDmDeliveryGlyph
        message={own({ reticulumOwnDeviceCopiedAt: NOW })}
        myAddress={ME}
      />
    );
    expect(
      screen.getByRole('img', { name: 'On your other device' })
    ).toBeInTheDocument();

    rerender(
      <ReticulumDmDeliveryGlyph
        message={own({ reticulumDeliveryStatus: 'sent' })}
        myAddress={ME}
      />
    );
    expect(screen.getByRole('img', { name: 'Delivered' })).toBeInTheDocument();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('turns Sending into Only on this device after ~30 s on one shared timer', () => {
    const { unmount } = render(
      <>
        <ReticulumDmDeliveryGlyph message={own()} myAddress={ME} />
        <ReticulumDmDeliveryGlyph
          message={own({ timestamp: NOW + 10_000 })}
          myAddress={ME}
        />
      </>
    );
    expect(screen.getAllByRole('img', { name: 'Sending' })).toHaveLength(2);
    expect(reticulumDmDeliveryWaiterCount()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(RETICULUM_DM_ONLY_LOCAL_AFTER_MS + 100);
    });
    // Not running inside Capacitor, so the desktop wording is used.
    expect(
      screen.getByRole('img', { name: 'Only on this device' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Sending' })).toHaveLength(1);
    expect(reticulumDmDeliveryWaiterCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getAllByRole('img', { name: 'Only on this device' })
    ).toHaveLength(2);
    expect(reticulumDmDeliveryWaiterCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('releases the shared timer when a sending glyph unmounts', () => {
    const { unmount } = render(
      <ReticulumDmDeliveryGlyph message={own()} myAddress={ME} />
    );
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(reticulumDmDeliveryWaiterCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('arms no timer for states that only change through new events', () => {
    render(
      <>
        <ReticulumDmDeliveryGlyph
          message={own({ timestamp: NOW - 60_000 })}
          myAddress={ME}
        />
        <ReticulumDmDeliveryGlyph
          message={own({ reticulumOwnDeviceCopiedAt: NOW })}
          myAddress={ME}
        />
        <ReticulumDmDeliveryGlyph
          message={own({ reticulumDeliveryStatus: 'sent' })}
          myAddress={ME}
        />
      </>
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the phone wording inside the native app', () => {
    const win = window as unknown as {
      Capacitor?: { isNativePlatform: () => boolean };
    };
    win.Capacitor = { isNativePlatform: () => true };
    try {
      render(
        <ReticulumDmDeliveryGlyph
          message={own({ timestamp: NOW - 60_000 })}
          myAddress={ME}
        />
      );
      expect(
        screen.getByRole('img', { name: 'Only on this phone' })
      ).toBeInTheDocument();
    } finally {
      delete win.Capacitor;
    }
  });

  it('is focusable, describes itself with the hint and keeps taps to itself', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <ReticulumDmDeliveryGlyph
          message={own({ timestamp: NOW - 60_000 })}
          myAddress={ME}
        />
      </div>
    );
    const glyph = screen.getByRole('img', { name: 'Only on this device' });
    expect(glyph).toHaveAttribute('tabindex', '0');
    expect(glyph).toHaveAccessibleDescription(
      'Not sent yet. It will be retried automatically.'
    );
    fireEvent.click(glyph);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders nothing for a message without a delivery state', () => {
    const { container } = render(
      <ReticulumDmDeliveryGlyph
        message={own({ sender: PEER })}
        myAddress={ME}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
