import { cleanup, render } from '@testing-library/react';
import { atom } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileTabBar } from './MobileTabBar';

vi.mock('../../atoms/global', () => ({
  directChatHasUnreadAtom: atom(false),
  groupChatHasUnreadExcludingMutedAtom: atom(false),
}));
vi.mock('./useMobileTabNavigation', () => ({
  useMobileTabNavigation: () => ({ active: 'chat', go: vi.fn() }),
}));

/** The emotion rules applied to `el` (its css-* classes), as one string. */
const cssFor = (el: Element): string => {
  const sheet = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  return Array.from(el.classList)
    .filter((c) => c.startsWith('css-'))
    .map((c) => {
      const at = sheet.indexOf(`.${c}{`);
      return at < 0 ? '' : sheet.slice(at, sheet.indexOf('}', at) + 1);
    })
    .join('\n');
};

const renderBar = (
  props: {
    covered?: boolean;
    immersive?: Parameters<typeof MobileTabBar>[0]['immersive'];
  } = {}
) => {
  render(
    <MobileTabBar
      desktopViewMode="chat"
      setDesktopViewMode={vi.fn()}
      floating
      {...props}
    />
  );
  // The bar is the buttons' common parent. Hidden while covered, so the
  // buttons have no accessible name then: found by their label instead.
  return document.querySelector('button[aria-label="Home"]')!.parentElement!;
};

const SLID_AWAY = 'transform:translateY(calc(100% + 28px))';

describe('MobileTabBar covered by a panel', () => {
  afterEach(cleanup);

  it('slides off the bottom edge and stops taking taps', () => {
    const css = cssFor(renderBar({ covered: true }));
    expect(css).toContain(SLID_AWAY);
    expect(css).toContain('visibility:hidden');
  });

  it('is in place, ready to glide back, when not covered', () => {
    const css = cssFor(renderBar({ covered: false }));
    expect(css).not.toContain(SLID_AWAY);
    expect(css).toContain('transform:none');
    expect(css).toContain('visibility:visible');
  });

  it('stays away while covered even when immersive mode shows the bars', () => {
    const css = cssFor(
      renderBar({
        covered: true,
        immersive: {
          hidden: false,
          showMs: 280,
          hideMs: 240,
          easing: 'ease',
        },
      })
    );
    expect(css).toContain(SLID_AWAY);
  });
});
