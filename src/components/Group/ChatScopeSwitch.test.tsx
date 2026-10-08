import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { act } from 'react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { ChatScopeSwitch, type ChatScopeSwitchHandle } from './ChatScopeSwitch';

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      reticulum: {
        chat_scope: {
          direct_messages: 'DMs',
          groups: 'Groups',
          label: 'Show groups or direct messages',
        },
      },
    },
  },
});

const renderSwitch = (
  props: Partial<Parameters<typeof ChatScopeSwitch>[0]> = {}
) => {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={darkTheme}>
        <ChatScopeSwitch onChange={onChange} value="groups" {...props} />
      </ThemeProvider>
    </I18nextProvider>
  );
  return onChange;
};

describe('ChatScopeSwitch', () => {
  it('shows translated labels on full-height segments', () => {
    renderSwitch();

    expect(
      screen.getByRole('group', { name: 'Show groups or direct messages' })
    ).toBeInTheDocument();
    const groups = screen.getByRole('button', { name: 'Groups' });
    const directs = screen.getByRole('button', { name: 'DMs' });
    expect(groups).toHaveAttribute('aria-pressed', 'true');
    expect(directs).toHaveAttribute('aria-pressed', 'false');
    // The whole segment is the touch target, not just the pill inside it.
    expect(groups).toHaveStyle({ fontSize: '14px', height: '44px' });
    expect(directs).toHaveStyle({ height: '44px' });
    // The track pads only the sides, so its height is all segment.
    const track = groups.parentElement as HTMLElement;
    expect(track).toHaveStyle({ paddingLeft: '2px', paddingRight: '2px' });
    expect(track).not.toHaveStyle({ paddingTop: '2px' });
  });

  it('anchors the onboarding DM step on the DMs segment', () => {
    renderSwitch();

    expect(screen.getByRole('button', { name: 'DMs' })).toHaveAttribute(
      'data-tour',
      'hub-direct-messages'
    );
    expect(screen.getByRole('button', { name: 'Groups' })).not.toHaveAttribute(
      'data-tour'
    );
  });

  it('switches scope only from the inactive segment', () => {
    const onChange = renderSwitch();

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'DMs' }));
    expect(onChange).toHaveBeenCalledWith('directs');
  });

  it('keeps the unread count out of the DMs label', () => {
    renderSwitch({ directHasUnread: true, directUnreadCount: 3 });

    expect(screen.getByRole('button', { name: 'DMs' })).toBeInTheDocument();
  });
  it('slides one pill between the segments when sliding', () => {
    const ref = createRef<ChatScopeSwitchHandle>();
    renderSwitch({ ref, sliding: true });
    const groups = screen.getByRole('button', { name: 'Groups' });
    const directs = screen.getByRole('button', { name: 'DMs' });
    // jsdom lays nothing out: place the segments as a phone would.
    for (const [element, left, width] of [
      [groups, 2, 80],
      [directs, 84, 60],
    ] as const) {
      Object.defineProperty(element, 'offsetLeft', { value: left });
      Object.defineProperty(element, 'offsetWidth', { value: width });
    }
    const track = groups.parentElement as HTMLElement;
    const pill = track.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(pill).not.toBeNull();

    // Not laid out yet: the current segment keeps its own pill.
    expect(track).not.toHaveAttribute('data-chat-scope-pill-ready');

    act(() => ref.current?.setPosition(0.5));
    expect(track).toHaveAttribute('data-chat-scope-pill-ready');
    expect(pill!.style.transform).toBe('translate3d(43px, 0, 0)');
    expect(pill!.style.width).toBe('70px');
    expect(pill!.style.transition).toBe('none');
    expect(track).toHaveAttribute('data-chat-scope-near', 'directs');

    act(() => ref.current?.setPosition(0.4));
    expect(track).toHaveAttribute('data-chat-scope-near', 'groups');

    // A glide only moves and scales the pill (72px wide at 0.4)...
    act(() => ref.current?.setPosition(1, 260, 'ease'));
    expect(pill!.style.transform).toBe(
      'translate3d(84px, 0, 0) scaleX(0.8333)'
    );
    expect(pill!.style.width).toBe('72px');
    expect(pill!.style.transition).toBe('transform 260ms ease');
    // ...and it takes its exact width once it lands.
    const landed = new Event('transitionend');
    Object.defineProperty(landed, 'propertyName', { value: 'transform' });
    act(() => {
      pill!.dispatchEvent(landed);
    });
    expect(pill!.style.transform).toBe('translate3d(84px, 0, 0)');
    expect(pill!.style.width).toBe('60px');
    expect(pill!.style.transition).toBe('none');
    // The pressed state still follows the scope, not the pill.
    expect(groups).toHaveAttribute('aria-pressed', 'true');
  });

  it('lands a glide that never animated, and turns mid-glide', () => {
    vi.useFakeTimers();
    const ref = createRef<ChatScopeSwitchHandle>();
    renderSwitch({ ref, sliding: true });
    const groups = screen.getByRole('button', { name: 'Groups' });
    const directs = screen.getByRole('button', { name: 'DMs' });
    for (const [element, left, width] of [
      [groups, 2, 80],
      [directs, 84, 60],
    ] as const) {
      Object.defineProperty(element, 'offsetLeft', { value: left });
      Object.defineProperty(element, 'offsetWidth', { value: width });
    }
    const pill = (
      groups.parentElement as HTMLElement
    ).querySelector<HTMLElement>('[aria-hidden="true"]')!;
    act(() => ref.current?.setPosition(0));
    expect(pill.style.width).toBe('80px');

    act(() => ref.current?.setPosition(1, 260, 'ease'));
    // Turned back halfway: scaled from the same width, no jump.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => ref.current?.setPosition(0, 200, 'ease'));
    expect(pill.style.transform).toBe('translate3d(2px, 0, 0) scaleX(1)');
    expect(pill.style.width).toBe('80px');

    // No transitionend (a hidden pill never animates): the timer lands it.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(pill.style.transform).toBe('translate3d(2px, 0, 0)');
    expect(pill.style.transition).toBe('none');
    vi.useRealTimers();
  });
});
