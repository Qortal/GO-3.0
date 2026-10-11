import { cleanup, render, screen } from '@testing-library/react';
import { atom } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setGoLayoutForTests } from '../../layout/goLayout';
import { MobileTabBar } from './MobileTabBar';

vi.mock('../../atoms/global', () => ({
  directChatHasUnreadAtom: atom(false),
  groupChatHasUnreadExcludingMutedAtom: atom(false),
}));
vi.mock('./useMobileTabNavigation', () => ({
  useMobileTabNavigation: () => ({ active: 'home', go: vi.fn() }),
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

const CLUSTER = 'padding-inline:max(0px, calc((100% - 440px) / 2))';

const renderBar = (props: { floating?: boolean } = {}) => {
  render(
    <MobileTabBar
      desktopViewMode="home"
      setDesktopViewMode={vi.fn()}
      {...props}
    />
  );
  // The bar is the buttons' common parent.
  return screen.getByRole('button', { name: 'Home' }).parentElement!;
};

describe('MobileTabBar centred cluster (GO)', () => {
  afterEach(() => {
    // Unmount first: resetting the store notifies mounted subscribers.
    cleanup();
    __setGoLayoutForTests(null);
  });

  it.each([
    ['GO tablet portrait (medium)', { width: 673, stableHeight: 841 }],
    ['GO tablet portrait (expanded)', { width: 840, stableHeight: 900 }],
  ])('centres the buttons on %s', (_label, size) => {
    __setGoLayoutForTests({ go: true, ...size });
    expect(cssFor(renderBar())).toContain(CLUSTER);
  });

  it('centres the floating glass buttons too', () => {
    __setGoLayoutForTests({ go: true, width: 800, stableHeight: 1280 });
    expect(cssFor(renderBar({ floating: true }))).toContain(CLUSTER);
  });

  it('keeps space-around on GO phones in portrait', () => {
    __setGoLayoutForTests({ go: true, width: 393, stableHeight: 873 });
    const css = cssFor(renderBar({ floating: true }));
    expect(css).not.toContain('padding-inline');
    expect(css).toContain('justify-content:space-around');
  });

  it('never applies on the Hub, at any width', () => {
    __setGoLayoutForTests({ go: false });
    expect(cssFor(renderBar())).not.toContain('padding-inline');
  });
});
