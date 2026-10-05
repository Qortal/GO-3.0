import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import {
  MessageActionsDetailRow,
  MessageActionsPopup,
  type MessageActionsPopupProps,
} from './MessageActionsPopup';
import { readRecentReactions } from './reactionEmojiData';

const pressAndroidBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

const renderPopup = (props: Partial<MessageActionsPopupProps> = {}) => {
  const onClose = vi.fn();
  const onReact = vi.fn();
  const onReply = vi.fn();
  const view = render(
    <MessageActionsPopup
      actions={[
        { icon: <span />, key: 'reply', label: 'Reply', onSelect: onReply },
        {
          destructive: true,
          icon: <span />,
          key: 'delete',
          label: 'Delete',
          onSelect: vi.fn(),
        },
      ]}
      anchor={{ x: 120, y: 400 }}
      onClose={onClose}
      onReact={onReact}
      open
      {...props}
    />
  );
  return { ...view, onClose, onReact, onReply };
};

describe('MessageActionsPopup', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('shows the quick reactions, the chevron and the menu', () => {
    renderPopup();
    const pill = screen.getByRole('group', { name: 'Quick reactions' });
    expect(
      within(pill).getByRole('button', { name: 'React with 👍' })
    ).toBeInTheDocument();
    expect(
      within(pill).getByRole('button', { name: 'More reactions' })
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Reply', 'Delete']);
  });

  it('closes before running a menu action', () => {
    const { onClose, onReply } = renderPopup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('reacts from the pill and remembers the emoji', () => {
    const { onClose, onReact } = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'React with 🔥' }));
    expect(onReact).toHaveBeenCalledWith('🔥');
    expect(onClose).toHaveBeenCalled();
    expect(readRecentReactions()).toEqual(['🔥']);
  });

  it('marks reactions already given; taking one back is not remembered', () => {
    const { onReact } = renderPopup({ myReactions: ['👍'] });
    const thumbs = screen.getByRole('button', { name: 'React with 👍' });
    expect(thumbs).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(thumbs);
    expect(onReact).toHaveBeenCalledWith('👍');
    expect(readRecentReactions()).toEqual([]);
  });

  it('grows into the emoji grid and reacts from it', () => {
    const { onReact } = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    expect(
      screen.getByRole('tablist', { name: 'Emoji categories' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recently used' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // The menu steps back while the grid is open.
    expect(
      screen.queryByRole('button', { name: 'React with 👍' })
    ).not.toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recently used' });
    fireEvent.click(within(recent).getByRole('button', { name: '🎉' }));
    expect(onReact).toHaveBeenCalledWith('🎉');
  });

  it('collapses the grid on Android back first, then closes', () => {
    const { onClose } = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    expect(pressAndroidBack()).toBe(true);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(pressAndroidBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no pill where reacting is not possible', () => {
    renderPopup({ onReact: undefined });
    expect(
      screen.queryByRole('group', { name: 'Quick reactions' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('shows the details card under the menu', () => {
    renderPopup({
      details: (
        <>
          <MessageActionsDetailRow
            icon={<span />}
            label="Sent"
            value="Oct 4, 2026"
          />
          <MessageActionsDetailRow
            icon={<span />}
            label="Message expires"
            tone="warning"
            value="Oct 7, 2026"
          />
        </>
      ),
    });
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Oct 7, 2026')).toBeInTheDocument();
  });

  it('moves up to stay on screen for a message near the bottom', () => {
    // jsdom has no layout: give the menu the height a phone would measure.
    const menuHeight = 300;
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.messageActionsBody === 'true' ? menuHeight : 0;
      });
    try {
      renderPopup({ anchor: { x: 120, y: window.innerHeight - 20 } });
      const body = document.querySelector(
        '[data-message-actions-body="true"]'
      ) as HTMLElement;
      const bodyTop = Number.parseFloat(
        getComputedStyle(body.parentElement as HTMLElement).top
      );
      expect(bodyTop + menuHeight).toBeLessThanOrEqual(window.innerHeight - 8);
      // The pill stays right above the menu, not left behind at the finger.
      const pill = screen.getByRole('group', { name: 'Quick reactions' });
      const pillTop = Number.parseFloat(getComputedStyle(pill).top);
      expect(pillTop).toBe(bodyTop - 52 - 8);
    } finally {
      offsetHeight.mockRestore();
    }
  });

  it('closes on a tap outside', () => {
    const { onClose } = renderPopup();
    const backdrop = document.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalled();
  });
});
