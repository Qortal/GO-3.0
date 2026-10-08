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
import {
  readReactionPrefs,
  resetReactionPrefsCache,
  setQuickReactionSlot,
} from './reactionPreferences';

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
    resetReactionPrefsCache();
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
    expect(onReact).toHaveBeenCalledWith('🔥', undefined);
    expect(onClose).toHaveBeenCalled();
    expect(readRecentReactions()).toEqual(['🔥']);
  });

  it('marks reactions already given; taking one back is not remembered', () => {
    const { onReact } = renderPopup({ myReactions: ['👍'] });
    const thumbs = screen.getByRole('button', { name: 'React with 👍' });
    expect(thumbs).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(thumbs);
    expect(onReact).toHaveBeenCalledWith('👍', undefined);
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
    expect(onReact).toHaveBeenCalledWith('🎉', undefined);
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

  it('rings the double-tap emoji in blue, thumbs up by default', () => {
    renderPopup({ reactionChatKey: 'group:7' });
    expect(
      screen.getByRole('button', { name: 'React with 👍' })
    ).toHaveAttribute('data-double-tap', 'true');
    expect(
      screen.getByRole('button', { name: 'React with 🔥' })
    ).not.toHaveAttribute('data-double-tap');
  });

  it('makes a long-pressed emoji the double tap for this chat only', () => {
    const { onReact, onClose } = renderPopup({ reactionChatKey: 'group:7' });
    const fire = screen.getByRole('button', { name: 'React with 🔥' });
    // Android reports a long press as a context menu.
    fireEvent.contextMenu(fire);
    expect(fire).toHaveAttribute('data-double-tap', 'true');
    expect(
      screen.getByRole('button', { name: 'React with 👍' })
    ).not.toHaveAttribute('data-double-tap');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Double tap now reacts with 🔥 in this chat'
    );
    expect(readReactionPrefs().doubleTap).toEqual({ 'group:7': '🔥' });
    // Choosing is not reacting, and the popup stays.
    expect(onReact).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the quick reactions the viewer picked', () => {
    setQuickReactionSlot(0, '🎉');
    renderPopup();
    const pill = screen.getByRole('group', { name: 'Quick reactions' });
    expect(within(pill).getAllByRole('button')[0]).toHaveAccessibleName(
      'React with 🎉'
    );
  });

  it('keeps a double-tap emoji long-pressed in the grid in the pill', () => {
    renderPopup({ reactionChatKey: 'group:7' });
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    const recent = screen.getByRole('region', { name: 'Recently used' });
    const party = within(recent).getByRole('button', { name: '🎉' });
    fireEvent.contextMenu(party);
    expect(readReactionPrefs().doubleTap).toEqual({ 'group:7': '🎉' });
    expect(party).toHaveAttribute('data-double-tap', 'true');
    // The click that may follow a long press doesn't react.
    fireEvent.click(party);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    // Not a quick reaction, so it takes the pill's last place.
    expect(pressAndroidBack()).toBe(true);
    const pill = screen.getByRole('group', { name: 'Quick reactions' });
    const buttons = within(pill).getAllByRole('button');
    expect(buttons[buttons.length - 2]).toHaveAccessibleName('React with 🎉');
    expect(buttons[buttons.length - 2]).toHaveAttribute(
      'data-double-tap',
      'true'
    );
  });

  it('opens the reaction settings from the gear and comes back', () => {
    renderPopup({ reactionChatKey: 'direct:QPeer' });
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reaction settings' }));
    expect(screen.getByText('Double tap reaction')).toBeInTheDocument();
    expect(screen.getByText('This chat')).toBeInTheDocument();
    expect(screen.getByText('Other chats')).toBeInTheDocument();
    // Android back: settings → grid → pill.
    expect(pressAndroidBack()).toBe(true);
    expect(
      screen.getByRole('tablist', { name: 'Emoji categories' })
    ).toBeInTheDocument();
    expect(pressAndroidBack()).toBe(true);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('picks this chat’s double-tap emoji from the settings', () => {
    renderPopup({ reactionChatKey: 'direct:QPeer' });
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reaction settings' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Change the double tap reaction for this chat (👍)',
      })
    );
    expect(screen.getByText('Double tap in this chat')).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recently used' });
    fireEvent.click(within(recent).getByRole('button', { name: '🎉' }));
    expect(readReactionPrefs().doubleTap).toEqual({ 'direct:QPeer': '🎉' });
    // Back on the settings, showing the new choice.
    expect(
      screen.getByRole('button', {
        name: 'Change the double tap reaction for this chat (🎉)',
      })
    ).toBeInTheDocument();
  });

  it('swaps a quick reaction and switches to the most used', () => {
    renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reaction settings' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Change quick reaction 2 (💯)' })
    );
    const recent = screen.getByRole('region', { name: 'Recently used' });
    fireEvent.click(within(recent).getByRole('button', { name: '👀' }));
    expect(readReactionPrefs().quickReactions[1]).toBe('👀');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Most used' }));
    expect(readReactionPrefs().quickMode).toBe('most_used');
    expect(
      screen.getByRole('button', { name: 'Change quick reaction 2 (👀)' })
    ).toBeDisabled();
  });

  it('finds emoji by name in the search box', async () => {
    renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search emoji' }), {
      target: { value: 'fire' },
    });
    expect(
      await screen.findByRole('button', { name: '🔥' }, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { hidden: true })).not.toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search emoji' }), {
      target: { value: 'zzzzqqq' },
    });
    expect(screen.getByText('No emoji found')).toBeInTheDocument();
  });

  it('closes on a tap outside', () => {
    const { onClose } = renderPopup();
    const backdrop = document.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalled();
  });
});
