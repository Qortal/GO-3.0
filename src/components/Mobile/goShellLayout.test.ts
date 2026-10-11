import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GO_SEARCH_RESULTS_MIN_HEIGHT_PX,
  SEARCH_RESULTS_MIN_HEIGHT_PX,
  computeSearchResultsMaxHeight,
  shouldCollapseForTyping,
  useChatComposerFocus,
  type CollapseForTypingInput,
  type SearchResultsHeightInput,
} from './goShellLayout';

describe('shouldCollapseForTyping', () => {
  const base: CollapseForTypingInput = {
    goShort: true,
    desktopViewMode: 'chat',
    keyboardInset: 200,
    composerFocused: true,
    emojiPanelOpen: false,
    appCovered: false,
  };
  const cases: Array<[string, Partial<CollapseForTypingInput>, boolean]> = [
    ['keyboard up with the composer focused', {}, true],
    [
      'emoji panel open, no keyboard',
      { keyboardInset: 0, composerFocused: false, emojiPanelOpen: true },
      true,
    ],
    ['keyboard up for something else', { composerFocused: false }, false],
    ['composer focused but keyboard closed', { keyboardInset: 0 }, false],
    ['tall screen (or the Hub)', { goShort: false }, false],
    [
      'tall screen with the emoji panel',
      { goShort: false, emojiPanelOpen: true },
      false,
    ],
    ['not in Chat', { desktopViewMode: 'apps' }, false],
    [
      'Home with the emoji panel',
      { desktopViewMode: 'home', emojiPanelOpen: true },
      false,
    ],
    ['lock or fault screen up while typing', { appCovered: true }, false],
    [
      'lock screen over a still-open emoji panel',
      {
        appCovered: true,
        keyboardInset: 0,
        composerFocused: false,
        emojiPanelOpen: true,
      },
      false,
    ],
  ];
  it.each(cases)('%s', (_label, patch, expected) => {
    expect(shouldCollapseForTyping({ ...base, ...patch })).toBe(expected);
  });
});

describe('computeSearchResultsMaxHeight', () => {
  const base: SearchResultsHeightInput = {
    visibleBottom: 873,
    top: 120,
    keyboardInset: 0,
    navInTopBar: false,
    safeBottom: 24,
    go: false,
  };
  const cases: Array<[string, Partial<SearchResultsHeightInput>, number]> = [
    // Hub: today's numbers exactly.
    ['Hub, keyboard closed: above the tab bar', {}, 873 - 120 - (60 + 24 + 10)],
    [
      'Hub, keyboard open: above the keyboard',
      { visibleBottom: 500, keyboardInset: 373 },
      500 - 120 - 10,
    ],
    [
      'Hub keeps its 160 floor under a keyboard',
      { visibleBottom: 220, keyboardInset: 300 },
      SEARCH_RESULTS_MIN_HEIGHT_PX,
    ],
    [
      'Hub ignores navInTopBar',
      { navInTopBar: true },
      873 - 120 - (60 + 24 + 10),
    ],
    // GO phone portrait: same as the Hub while there is room.
    ['GO portrait, keyboard closed', { go: true }, 873 - 120 - (60 + 24 + 10)],
    [
      'GO portrait, keyboard open',
      { go: true, visibleBottom: 500, keyboardInset: 373 },
      500 - 120 - 10,
    ],
    // GO landscape: no bottom bar to clear, and never under the keyboard.
    [
      'GO nav in top bar, keyboard closed: clears the nav bar inset',
      { go: true, navInTopBar: true, visibleBottom: 393, top: 80 },
      393 - 80 - (24 + 10),
    ],
    [
      'GO tablet with a 3-button taskbar, keyboard closed',
      {
        go: true,
        navInTopBar: true,
        visibleBottom: 800,
        top: 80,
        safeBottom: 48,
      },
      800 - 80 - (48 + 10),
    ],
    [
      'GO short landscape, keyboard open',
      {
        go: true,
        navInTopBar: true,
        visibleBottom: 200,
        top: 80,
        keyboardInset: 193,
      },
      200 - 80 - 10,
    ],
    [
      'GO floor is 96, not 160',
      {
        go: true,
        navInTopBar: true,
        visibleBottom: 150,
        top: 80,
        keyboardInset: 243,
      },
      GO_SEARCH_RESULTS_MIN_HEIGHT_PX,
    ],
  ];
  it.each(cases)('%s', (_label, patch, expected) => {
    expect(computeSearchResultsMaxHeight({ ...base, ...patch })).toBe(expected);
  });
});

describe('useChatComposerFocus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mount = () => {
    document.body.innerHTML = `
      <div data-go-section="chat">
        <div class="tiptap-chat-composer"><div contenteditable="true" tabindex="0" id="composer"></div></div>
      </div>
      <div class="tiptap-chat-composer"><input id="elsewhere" /></div>
      <input id="search" />`;
    return (id: string) => document.getElementById(id) as HTMLElement;
  };

  it('follows focus into and out of a Chat composer', async () => {
    const el = mount();
    const { result } = renderHook(() => useChatComposerFocus(true));
    expect(result.current).toBe(false);
    act(() => el('composer').focus());
    expect(result.current).toBe(true);
    act(() => el('search').focus());
    // Focus-out waits a frame so moving between controls does not flicker.
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    expect(result.current).toBe(false);
  });

  it('ignores composers outside the Chat section', () => {
    const el = mount();
    const { result } = renderHook(() => useChatComposerFocus(true));
    act(() => el('elsewhere').focus());
    expect(result.current).toBe(false);
  });

  it('is false and does not listen while disabled', () => {
    const el = mount();
    el('composer').focus();
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useChatComposerFocus(on),
      { initialProps: { on: false } }
    );
    expect(result.current).toBe(false);
    rerender({ on: true });
    expect(result.current).toBe(true);
  });

  it('does not report a stale focus when enabled again', () => {
    const el = mount();
    const seen: boolean[] = [];
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => {
        const focused = useChatComposerFocus(on);
        seen.push(focused);
        return focused;
      },
      { initialProps: { on: true } }
    );
    act(() => el('composer').focus());
    // Disabled (rotated to a tall screen); focus leaves unseen.
    rerender({ on: false });
    el('search').focus();
    seen.length = 0;
    rerender({ on: true });
    expect(seen).not.toContain(true);
  });
});
