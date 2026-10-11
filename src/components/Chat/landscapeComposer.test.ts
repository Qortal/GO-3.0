import { describe, expect, it } from 'vitest';
import {
  composerFabModeFor,
  LANDSCAPE_LIST_PAD_PX,
  LAYOUT_SETTLE_MS,
  landscapeListPadFor,
  layoutSettleWaitMs,
  legacyComposerCompactFor,
  type LandscapeComposerInput,
} from './landscapeComposer';

// [go, isMobile, isLandscape] → FAB mode. Only the Hub's phone landscape.
const TABLE: Array<[LandscapeComposerInput, boolean]> = [
  [{ go: false, isMobile: true, isLandscape: true }, true],
  [{ go: false, isMobile: true, isLandscape: false }, false],
  [{ go: false, isMobile: false, isLandscape: true }, false],
  [{ go: false, isMobile: false, isLandscape: false }, false],
  [{ go: true, isMobile: true, isLandscape: true }, false],
  [{ go: true, isMobile: true, isLandscape: false }, false],
  [{ go: true, isMobile: false, isLandscape: true }, false],
  [{ go: true, isMobile: false, isLandscape: false }, false],
];

describe('landscapeComposer', () => {
  it.each(TABLE)('composerFabModeFor(%o) is %s', (input, expected) => {
    expect(composerFabModeFor(input)).toBe(expected);
  });

  it.each(TABLE)('landscapeListPadFor(%o) follows the FAB', (input, fab) => {
    expect(landscapeListPadFor(input)).toBe(fab ? LANDSCAPE_LIST_PAD_PX : 0);
  });

  it('keeps the Hub pad at 96 px', () => {
    expect(LANDSCAPE_LIST_PAD_PX).toBe(96);
  });

  it('legacy compact row equals the old Hub rule for every input', () => {
    for (let bits = 0; bits < 16; bits++) {
      const isMobile = Boolean(bits & 1);
      const isLandscape = Boolean(bits & 2);
      const isFocusedParent = Boolean(bits & 4);
      const keyboardOpen = Boolean(bits & 8);
      const fab = composerFabModeFor({ go: false, isMobile, isLandscape });
      // The Hub passes the orientation query as shortLandscape.
      expect(
        legacyComposerCompactFor({
          isMobile,
          shortLandscape: isLandscape,
          isFocusedParent,
          keyboardOpen,
        })
      ).toBe(isMobile && !fab && isFocusedParent && !keyboardOpen);
    }
  });

  it('GO short landscape keeps the expanded row, like TipTap', () => {
    const focusedNoKeyboard = { isFocusedParent: true, keyboardOpen: false };
    // 873x393: TipTap stays expanded, so the row must not go compact.
    expect(
      legacyComposerCompactFor({
        isMobile: true,
        shortLandscape: true,
        ...focusedNoKeyboard,
      })
    ).toBe(false);
    // 393x873 and tablets: compact once the keyboard is down.
    expect(
      legacyComposerCompactFor({
        isMobile: true,
        shortLandscape: false,
        ...focusedNoKeyboard,
      })
    ).toBe(true);
    expect(
      legacyComposerCompactFor({
        isMobile: true,
        shortLandscape: false,
        isFocusedParent: true,
        keyboardOpen: true,
      })
    ).toBe(false);
  });

  it('waits out the settle window after a window change only', () => {
    const changedAt = 10_000;
    expect(layoutSettleWaitMs(changedAt, changedAt)).toBe(LAYOUT_SETTLE_MS);
    expect(layoutSettleWaitMs(changedAt + 300, changedAt)).toBe(
      LAYOUT_SETTLE_MS - 300
    );
    expect(layoutSettleWaitMs(changedAt + LAYOUT_SETTLE_MS, changedAt)).toBe(0);
    expect(layoutSettleWaitMs(changedAt + 5_000, changedAt)).toBe(0);
    // Never changed since mount.
    expect(layoutSettleWaitMs(Date.now(), 0)).toBe(0);
    // Longer than the keyboard store's 700 ms quiet window plus its recheck.
    expect(LAYOUT_SETTLE_MS).toBeGreaterThan(716);
  });
});
