import { describe, expect, it } from 'vitest';
import {
  EXPANDED_MAX_HEIGHT_PX,
  getExpandedGridColumns,
  getPillWidth,
  getQuickReactionCount,
  layoutMessageActionsPopup,
  MENU_CARD_WIDTH_PX,
  PILL_HEIGHT_PX,
  POPUP_EDGE_MARGIN_PX,
  POPUP_GAP_PX,
} from './messageActionsPopupLayout';

const PHONE = { viewportWidth: 412, viewportHeight: 860 };
const MENU_HEIGHT = 156; // three 48px rows + padding

const layout = (overrides = {}) =>
  layoutMessageActionsPopup({
    ...PHONE,
    anchorX: 150,
    anchorY: 400,
    bodyHeight: MENU_HEIGHT,
    bodyWidth: MENU_CARD_WIDTH_PX,
    pillWidth: getPillWidth(7),
    ...overrides,
  });

describe('getQuickReactionCount', () => {
  it('fits seven reactions and the chevron on a 412px phone', () => {
    expect(getQuickReactionCount(412, 7)).toBe(7);
    expect(getPillWidth(7)).toBeLessThanOrEqual(412 - 2 * POPUP_EDGE_MARGIN_PX);
  });

  it('drops to six on a 360px phone, still inside the margins', () => {
    expect(getQuickReactionCount(360, 7)).toBe(6);
    expect(getPillWidth(6)).toBeLessThanOrEqual(360 - 2 * POPUP_EDGE_MARGIN_PX);
  });

  it('never offers more than there are, nor fewer than three', () => {
    expect(getQuickReactionCount(1200, 7)).toBe(7);
    expect(getQuickReactionCount(200, 7)).toBe(3);
    expect(getQuickReactionCount(Number.NaN, 7)).toBe(6);
  });
});

describe('getExpandedGridColumns', () => {
  it('uses eight columns in the pill width of a 412px phone', () => {
    expect(getExpandedGridColumns(getPillWidth(7))).toBe(8);
  });

  it('stays readable on narrow and wide panels', () => {
    expect(getExpandedGridColumns(getPillWidth(6))).toBe(7);
    expect(getExpandedGridColumns(100)).toBe(5);
    expect(getExpandedGridColumns(2000)).toBe(9);
  });
});

describe('layoutMessageActionsPopup', () => {
  it('floats the pill above the finger with the menu right under it', () => {
    const result = layout();
    expect(result.pill.top + PILL_HEIGHT_PX).toBeLessThan(400);
    expect(result.body.top).toBe(
      result.pill.top + PILL_HEIGHT_PX + POPUP_GAP_PX
    );
  });

  it('starts at the touch on other people’s messages', () => {
    const result = layout({ anchorX: 150 });
    expect(result.body.left).toBeLessThan(150);
    expect(result.body.left + MENU_CARD_WIDTH_PX).toBeGreaterThan(150);
  });

  it('opens leftward from the touch on your own messages', () => {
    const result = layout({ alignEnd: true, anchorX: 330 });
    expect(result.body.left + MENU_CARD_WIDTH_PX).toBeGreaterThan(330);
    expect(result.body.left).toBeLessThan(330 - MENU_CARD_WIDTH_PX + 60);
  });

  it('keeps every part inside the screen margins', () => {
    for (const anchorX of [0, 20, 206, 400, 412]) {
      for (const alignEnd of [false, true]) {
        const result = layout({ alignEnd, anchorX });
        expect(result.pill.left).toBeGreaterThanOrEqual(POPUP_EDGE_MARGIN_PX);
        expect(result.pill.left + result.pill.width).toBeLessThanOrEqual(
          412 - POPUP_EDGE_MARGIN_PX
        );
        expect(result.body.left).toBeGreaterThanOrEqual(POPUP_EDGE_MARGIN_PX);
        expect(result.body.left + MENU_CARD_WIDTH_PX).toBeLessThanOrEqual(
          412 - POPUP_EDGE_MARGIN_PX
        );
      }
    }
  });

  it('stays below the status bar for a message at the very top', () => {
    const result = layout({ anchorY: 10, topInset: 24 });
    expect(result.pill.top).toBe(24 + POPUP_EDGE_MARGIN_PX);
  });

  it('moves up for a message near the bottom', () => {
    const result = layout({ anchorY: 850, bottomInset: 20 });
    expect(result.body.top + MENU_HEIGHT).toBeLessThanOrEqual(
      860 - 20 - POPUP_EDGE_MARGIN_PX
    );
  });

  it('lets a menu taller than the screen scroll', () => {
    const result = layout({ bodyHeight: 2000 });
    expect(result.pill.top).toBe(POPUP_EDGE_MARGIN_PX);
    expect(result.body.top + result.body.maxHeight).toBe(
      860 - POPUP_EDGE_MARGIN_PX
    );
  });

  it('starts the menu at the top when there is no pill', () => {
    const result = layout({ pillWidth: 0, anchorY: 300 });
    expect(result.body.top).toBe(result.pill.top);
  });

  it('grows the emoji grid down from the pill, up near the bottom', () => {
    const middle = layout({ anchorY: 200 });
    expect(middle.expanded.top).toBe(middle.pill.top);
    expect(middle.expanded.height).toBe(EXPANDED_MAX_HEIGHT_PX);
    expect(middle.expanded.width).toBe(middle.pill.width);

    const low = layout({ anchorY: 840 });
    expect(low.expanded.top + low.expanded.height).toBeLessThanOrEqual(
      860 - POPUP_EDGE_MARGIN_PX
    );
  });

  it('shrinks the grid to fit a short screen (keyboard up)', () => {
    const result = layout({ anchorY: 200, viewportHeight: 330 });
    expect(result.expanded.top).toBe(POPUP_EDGE_MARGIN_PX);
    expect(result.expanded.height).toBe(330 - 2 * POPUP_EDGE_MARGIN_PX);
  });
});
