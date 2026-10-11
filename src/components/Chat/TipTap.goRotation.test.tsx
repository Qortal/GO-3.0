import { act, cleanup, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { mobileChatComposeActiveAtom } from '../../atoms/global';
import { __setGoLayoutForTests } from '../../layout/goLayout';
import { LAYOUT_SETTLE_MS } from './landscapeComposer';

// The keyboard as the composer sees it, driven by the test.
const keyboard = vi.hoisted(() => {
  let open = false;
  const listeners = new Set<() => void>();
  return {
    get: () => open,
    set(next: boolean) {
      open = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
});
vi.mock('../../hooks/useSoftKeyboardOpen', async () => {
  const { useSyncExternalStore } = await import('react');
  const useSoftKeyboardOpen = () =>
    useSyncExternalStore(keyboard.subscribe, keyboard.get, keyboard.get);
  return { useSoftKeyboardOpen, default: useSoftKeyboardOpen };
});

import Tiptap from './TipTap';

const setPhone = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

// The legacy chat composer, focused, next to an input that holds the real
// focus: a keyboard dismissal blurs whatever is focused.
const renderFocusedComposer = () => {
  render(
    <>
      <input aria-label="focus probe" />
      <Tiptap
        insertFiles={() => undefined}
        insertGif={() => undefined}
        isChat
        isFocusedParent
        onEnter={() => undefined}
        setEditorRef={() => undefined}
        setIsFocusedParent={() => undefined}
      />
    </>
  );
  const probe = screen.getByLabelText('focus probe');
  probe.focus();
  return probe;
};

const composeActive = () => getDefaultStore().get(mobileChatComposeActiveAtom);

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('TipTap keyboard close after a window change', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    setPhone();
    keyboard.set(false);
  });

  afterEach(() => {
    // Unmount before the layout reset notifies the composer.
    cleanup();
    __setGoLayoutForTests(null);
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it('GO tablet rotated with the keyboard up keeps the composer focused', () => {
    __setGoLayoutForTests({ go: true, width: 800, stableHeight: 1280 });
    const probe = renderFocusedComposer();
    vi.useFakeTimers();
    act(() => keyboard.set(true));
    expect(composeActive()).toBe(true);

    // 800x1280 → 1280x800: neither is short. The store re-baselines and
    // reports the keyboard closed for a moment.
    act(() => {
      __setGoLayoutForTests({
        go: true,
        width: 1280,
        stableHeight: 800,
        epoch: 1,
      });
      keyboard.set(false);
    });
    tick(LAYOUT_SETTLE_MS - 100);
    expect(document.activeElement).toBe(probe);
    expect(composeActive()).toBe(true);

    act(() => keyboard.set(true));
    tick(LAYOUT_SETTLE_MS * 2);
    expect(document.activeElement).toBe(probe);
    expect(composeActive()).toBe(true);
  });

  it('GO: a keyboard that is really gone after the rotation is dismissed once settled', () => {
    __setGoLayoutForTests({ go: true, width: 800, stableHeight: 1280 });
    const probe = renderFocusedComposer();
    vi.useFakeTimers();
    act(() => keyboard.set(true));

    act(() => {
      __setGoLayoutForTests({
        go: true,
        width: 1280,
        stableHeight: 800,
        epoch: 1,
      });
      keyboard.set(false);
    });
    tick(LAYOUT_SETTLE_MS - 100);
    expect(document.activeElement).toBe(probe);

    tick(100);
    expect(document.activeElement).not.toBe(probe);
    tick(1);
    expect(composeActive()).toBe(false);
  });

  it('GO: closing the keyboard with no window change blurs right away', () => {
    __setGoLayoutForTests({ go: true, width: 800, stableHeight: 1280 });
    const probe = renderFocusedComposer();
    vi.useFakeTimers();
    act(() => keyboard.set(true));

    act(() => keyboard.set(false));
    expect(document.activeElement).not.toBe(probe);
    tick(1);
    expect(composeActive()).toBe(false);
  });

  it('Hub: closing the keyboard in portrait blurs right away', () => {
    __setGoLayoutForTests({ go: false });
    const probe = renderFocusedComposer();
    vi.useFakeTimers();
    act(() => keyboard.set(true));
    expect(composeActive()).toBe(true);

    act(() => keyboard.set(false));
    expect(document.activeElement).not.toBe(probe);
    tick(1);
    expect(composeActive()).toBe(false);
  });
});
