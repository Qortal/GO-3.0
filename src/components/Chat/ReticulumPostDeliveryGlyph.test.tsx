import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import {
  applyOwnPostDeliveryUpdates,
  resetOwnPostDeliveryStoreForTests,
} from '../../reticulumChat/ownPostDeliveryStore';
import { ReticulumPostDeliveryGlyph } from './ReticulumPostDeliveryGlyph';
import {
  RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS,
  RETICULUM_POST_SENDING_MS,
  reticulumPostDeliveryWaiterCount,
} from './reticulumPostDeliveryState';

const ME = 'QMeAddress';
const NOW = 1_800_000_000_000;

const post = (overrides: Record<string, unknown> = {}) => ({
  signature: 'post-1',
  sender: ME,
  reticulumChat: true,
  reticulumPostDeliverySince: NOW,
  ...overrides,
});

const savedMessage = (overrides: Record<string, unknown> = {}) =>
  post({
    signature: 'saved-1',
    reticulumDirect: true,
    recipientAddress: ME,
    reticulumDeliveryStatus: 'sent',
    ...overrides,
  });

const describedBy = (element: HTMLElement) =>
  document.getElementById(element.getAttribute('aria-describedby') || '')
    ?.textContent;

describe('ReticulumPostDeliveryGlyph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetOwnPostDeliveryStoreForTests();
    delete (window as any).reticulumChat;
  });

  it('renders a still labelled glyph for each group state', () => {
    const { container, rerender } = render(
      <ReticulumPostDeliveryGlyph message={post()} myAddress={ME} />
    );
    const sending = screen.getByRole('img', { name: 'Sending' });
    expect(sending).toHaveAttribute('data-delivery-kind', 'post');
    expect(sending).toHaveAttribute('data-delivery-state', 'sending');
    expect(sending).toHaveAccessibleDescription(
      "Members' nodes that are online usually fetch it within a few seconds."
    );

    rerender(
      <ReticulumPostDeliveryGlyph
        message={post({ reticulumPostDeliverySince: NOW - 60_000 })}
        myAddress={ME}
      />
    );
    expect(
      screen.getByRole('img', { name: 'Not picked up yet' })
    ).toHaveAttribute('data-delivery-state', 'not_picked_up');

    rerender(
      <ReticulumPostDeliveryGlyph
        message={post({ reticulumPostMemberAt: NOW })}
        myAddress={ME}
      />
    );
    const member = screen.getByRole('img', { name: 'Delivered' });
    expect(describedBy(member)).toBe(
      "A group member's node fetched it from this phone. This does not mean anyone has read it."
    );

    rerender(
      <ReticulumPostDeliveryGlyph
        message={post({ reticulumPostOwnDeviceAt: NOW })}
        myAddress={ME}
      />
    );
    expect(describedBy(screen.getByRole('img', { name: 'Delivered' }))).toBe(
      'Your other device (like Your Hub) fetched it from this phone.'
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('uses the Saved Messages wording for a self-DM', () => {
    const { rerender } = render(
      <ReticulumPostDeliveryGlyph message={savedMessage()} myAddress={ME} />
    );
    expect(describedBy(screen.getByRole('img', { name: 'Sending' }))).toBe(
      'Your other devices that are online usually fetch it within a few seconds.'
    );
    rerender(
      <ReticulumPostDeliveryGlyph
        message={savedMessage({ reticulumPostDeliverySince: NOW - 60_000 })}
        myAddress={ME}
      />
    );
    expect(
      describedBy(screen.getByRole('img', { name: 'Not picked up yet' }))
    ).toMatch(/^None of Your other devices has fetched it/);
    rerender(
      <ReticulumPostDeliveryGlyph
        message={savedMessage({ reticulumPostOwnDeviceAt: NOW })}
        myAddress={ME}
      />
    );
    expect(screen.getByRole('img', { name: 'Delivered' })).toBeInTheDocument();
  });

  it('turns Sending into Not picked up yet after 12 s on the shared timer', () => {
    const { unmount } = render(
      <ReticulumPostDeliveryGlyph message={post()} myAddress={ME} />
    );
    expect(reticulumPostDeliveryWaiterCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(RETICULUM_POST_SENDING_MS - 1_000);
    });
    expect(screen.getByRole('img', { name: 'Sending' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(
      screen.getByRole('img', { name: 'Not picked up yet' })
    ).toBeInTheDocument();
    // No timer for the max age.
    expect(reticulumPostDeliveryWaiterCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('shows a proof from the engine that arrives after the row was read', () => {
    let listener: ((payload: unknown) => void) | null = null;
    (window as any).reticulumChat = {
      onOwnPostDelivery: (cb: (payload: unknown) => void) => {
        listener = cb;
        return () => {};
      },
    };
    render(
      <ReticulumPostDeliveryGlyph
        message={post({ reticulumPostDeliverySince: NOW - 60_000 })}
        myAddress={ME}
      />
    );
    expect(
      screen.getByRole('img', { name: 'Not picked up yet' })
    ).toBeInTheDocument();
    act(() => {
      listener!({
        updates: [
          { eventId: 'post-1', scope: 'group', groupId: 1, ownDeviceAt: NOW },
        ],
      });
    });
    expect(screen.getByRole('img', { name: 'Delivered' })).toBeInTheDocument();
  });

  it('renders nothing past the max age, but still shows a late proof', () => {
    const old = post({
      reticulumPostDeliverySince: NOW - RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS,
    });
    const { container } = render(
      <ReticulumPostDeliveryGlyph message={old} myAddress={ME} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      applyOwnPostDeliveryUpdates({
        updates: [{ eventId: 'post-1', scope: 'group', memberAt: NOW }],
      });
    });
    expect(screen.getByRole('img', { name: 'Delivered' })).toBeInTheDocument();
  });

  it('is focusable and keeps taps to itself', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <ReticulumPostDeliveryGlyph message={post()} myAddress={ME} />
      </div>
    );
    const glyph = screen.getByRole('img', { name: 'Sending' });
    expect(glyph).toHaveAttribute('tabindex', '0');
    fireEvent.click(glyph);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders nothing for an untracked post', () => {
    const { container } = render(
      <ReticulumPostDeliveryGlyph
        message={post({ reticulumPostDeliverySince: undefined })}
        myAddress={ME}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
