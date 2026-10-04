import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import i18n from '../../i18n/i18n';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import {
  DirectChatHeader,
  type DirectChatHeaderCall,
  type DirectChatHeaderProps,
} from './DirectChatHeader';

// No node: the preview opens with the cached picture alone.
vi.mock('../../utils/globalApi', () => ({ getBaseApiReact: () => '' }));
vi.mock('./AvatarPreviewModal', () => ({
  AvatarPreviewModal: ({ open, src }: { open: boolean; src?: string }) =>
    open ? <div data-testid="avatar-preview" data-src={src} /> : null,
}));

// Keys the integrator adds to the locales; English here so the test reads.
const DM_STRINGS = {
  dm: {
    end_call: 'End call',
    show_avatar: 'Show profile picture',
    start_voice_call: 'Start voice call',
    unhide_user: 'Unhide user',
  },
};

const never = () => new Promise<Response>(() => {});

const settle = () =>
  act(async () => {
    await flushAsync();
  });

const call = (
  overrides: Partial<DirectChatHeaderCall> = {}
): DirectChatHeaderCall => ({
  enabled: true,
  connected: false,
  ringing: false,
  blockedByFriend: false,
  blockedByP2p: false,
  p2pBlockedTooltip: 'Bad connection',
  onStart: vi.fn(),
  onHangUp: vi.fn(),
  ...overrides,
});

const renderHeader = (overrides: Partial<DirectChatHeaderProps> = {}) => {
  const props: DirectChatHeaderProps = {
    isMobile: true,
    reticulumDirectUiEnabled: true,
    isNewChat: false,
    isSelfDirect: false,
    partner: { name: 'Alice', address: 'QAliceAddress' },
    onClose: vi.fn(),
    peerOnline: true,
    peerHidden: false,
    unhideBusy: false,
    onUnhide: vi.fn(),
    isFriend: true,
    friendActionBusy: false,
    onToggleFriend: vi.fn(),
    call: call(),
    ...overrides,
  };
  return { props, ...render(<DirectChatHeader {...props} />) };
};

const button = (name: string) => screen.getByRole('button', { name });

const expectPhoneTarget = (element: HTMLElement) => {
  expect(getComputedStyle(element).height).toBe('44px');
  expect(getComputedStyle(element).width).toBe('44px');
};

const avatarRoot = () =>
  document.querySelector('[data-qdn-avatar]') as HTMLElement;

const pressAndroidBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

/** What Group.tsx registers for an open chat on phones: back closes it. */
const OpenChatBack = ({ onBack }: { onBack: () => boolean }) => {
  useAndroidBack(onBack, { priority: BACK_PRIORITY.detail });
  return null;
};

const withCachedAlice = async () => {
  const h = createAvatarTestHarness({ handler: never });
  setQdnAvatarCacheForTests(h.cache);
  await h.cache.putImage('Alice', PNG_BYTES);
  return h;
};

describe('DirectChatHeader', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
    i18n.addResourceBundle('en', 'group', DM_STRINGS, true, false);
  });

  afterEach(() => {
    setQdnAvatarCacheForTests(null);
  });

  describe('on phones', () => {
    it('gives back, unhide, friend and call 44px targets with 23px icons', async () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      renderHeader({ peerHidden: true });
      await settle();

      for (const name of [
        'Back',
        'Unhide user',
        'Remove friend',
        'Start voice call',
      ]) {
        const target = button(name);
        expectPhoneTarget(target);
        expect(
          getComputedStyle(target.querySelector('svg') as SVGElement).fontSize
        ).toBe('23px');
      }
    });

    it('uses the group header back: round, with the rounded arrow', async () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      const { props } = renderHeader();
      await settle();

      const back = button('Back');
      expect(back.classList.contains('MuiIconButton-root')).toBe(true);
      expect(
        back.querySelector('[data-testid="ArrowBackRoundedIcon"]')
      ).not.toBeNull();
      expect(getComputedStyle(back).marginLeft).toBe('-8px');
      fireEvent.click(back);
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('shows the cached picture of the partner and opens the preview with it', async () => {
      await withCachedAlice();

      renderHeader();
      await settle();

      expect(screen.getByAltText('Alice').getAttribute('src')).toBe(
        'blob:test/1'
      );
      const open = button('Show profile picture');
      expectPhoneTarget(open);
      fireEvent.click(open);
      expect(
        screen.getByTestId('avatar-preview').getAttribute('data-src')
      ).toBe('blob:test/1');
    });

    it('closes only the picture on Android back, not the chat', async () => {
      await withCachedAlice();
      const closeChat = vi.fn(() => true);
      render(<OpenChatBack onBack={closeChat} />);
      renderHeader();
      await settle();
      fireEvent.click(button('Show profile picture'));
      expect(screen.getByTestId('avatar-preview')).toBeTruthy();

      const first = pressAndroidBack();
      expect(first.defaultPrevented).toBe(true);
      expect(screen.queryByTestId('avatar-preview')).toBeNull();
      expect(closeChat).not.toHaveBeenCalled();

      // With the picture closed, back goes to the chat again.
      pressAndroidBack();
      expect(closeChat).toHaveBeenCalledTimes(1);
    });

    it('falls back to the letter when the WebView cannot show the picture', async () => {
      await withCachedAlice();
      renderHeader();
      await settle();

      fireEvent.error(screen.getByAltText('Alice'));

      expect(avatarRoot().getAttribute('data-qdn-avatar')).toBe('fallback');
      expect(avatarRoot().textContent).toBe('A');
      expect(
        screen.queryByRole('button', { name: 'Show profile picture' })
      ).toBeNull();
    });

    it('shows the first letter while there is no picture, with nothing to tap', async () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      renderHeader({ partner: { name: 'bob', address: 'QBobAddress' } });
      await settle();

      expect(avatarRoot().getAttribute('data-qdn-avatar')).toBe('fallback');
      expect(avatarRoot().textContent).toBe('B');
      expect(
        screen.queryByRole('button', { name: 'Show profile picture' })
      ).toBeNull();
    });

    it('shows the Qortal logo for saved messages, without actions or a lookup', async () => {
      const h = createAvatarTestHarness({ handler: never });
      setQdnAvatarCacheForTests(h.cache);
      renderHeader({
        isSelfDirect: true,
        partner: {
          name: 'Saved Messages',
          address: 'QMe',
          savedMessages: true,
        },
      });
      await settle();

      expect(avatarRoot().querySelector('img[aria-hidden]')).not.toBeNull();
      expect(h.calls).toEqual([]);
      expect(
        screen.queryByRole('button', { name: 'Remove friend' })
      ).toBeNull();
      expect(screen.queryByTestId('direct-header-presence')).toBeNull();
    });

    it('puts the presence under the name', async () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      renderHeader({ peerOnline: false });
      await settle();

      const presence = screen.getByTestId('direct-header-presence');
      expect(presence.textContent).toBe('Offline');
      // A long translation ellipsizes instead of wrapping the 50px bar.
      const label = presence.querySelector('p') as HTMLElement;
      expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
      expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
      expect(getComputedStyle(label).fontSize).toBe('14px');
    });
  });

  describe('calls and friends', () => {
    it('hangs up a connected call', () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      const connected = call({ connected: true });
      renderHeader({ call: connected });

      fireEvent.click(button('End call'));
      expect(connected.onHangUp).toHaveBeenCalledTimes(1);
      expect(connected.onStart).not.toHaveBeenCalled();
    });

    it('starts a call only when the partner can be called', () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      const idle = call();
      const { unmount } = renderHeader({ call: idle });
      fireEvent.click(button('Start voice call'));
      expect(idle.onStart).toHaveBeenCalledTimes(1);
      unmount();

      for (const blocked of [
        { peerOnline: false, call: call() },
        { call: call({ blockedByFriend: true }) },
        { call: call({ blockedByP2p: true }) },
        { call: call({ ringing: true }) },
      ]) {
        const view = renderHeader(blocked);
        expect((button('Start voice call') as HTMLButtonElement).disabled).toBe(
          true
        );
        view.unmount();
      }
    });

    it('toggles the friend and hides the call button when calls are off', () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      const { props } = renderHeader({
        isFriend: false,
        call: call({ enabled: false }),
      });

      fireEvent.click(button('Add friend'));
      expect(props.onToggleFriend).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole('button', { name: 'Start voice call' })
      ).toBeNull();
    });
  });

  describe('on desktop', () => {
    it('keeps the compact buttons, no avatar, and the presence beside the actions', () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      renderHeader({ isMobile: false });

      expect(document.querySelector('[data-qdn-avatar]')).toBeNull();
      expect(screen.queryByTestId('direct-header-presence')).toBeNull();
      expect(screen.getByText('Online')).toBeTruthy();
      // The Reticulum desktop layout has no back button.
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      const friend = button('Remove friend');
      expect(getComputedStyle(friend).height).not.toBe('44px');
      expect(
        getComputedStyle(friend.querySelector('svg') as SVGElement).fontSize
      ).toBe('20px');
      // The partner's address stays under the name.
      expect(screen.getByText('QAliceAddress')).toBeTruthy();
    });

    it('names the hang-up button "End call"', () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      const connected = call({ connected: true });
      renderHeader({ isMobile: false, call: connected });

      const hangUp = button('End call');
      expect((hangUp as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(hangUp);
      expect(connected.onHangUp).toHaveBeenCalledTimes(1);
    });

    it('keeps the labelled close button of the legacy chat', () => {
      setQdnAvatarCacheForTests(
        createAvatarTestHarness({ handler: never }).cache
      );
      const { props } = renderHeader({
        isMobile: false,
        reticulumDirectUiEnabled: false,
      });

      const close = screen.getByRole('button', {
        name: 'Close Direct Chat',
      });
      fireEvent.click(close);
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });
  });
});
