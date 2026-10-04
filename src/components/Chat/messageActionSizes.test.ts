import { describe, expect, it } from 'vitest';
import {
  DESKTOP_MESSAGE_ACTION_SIZES,
  getMessageActionSizes,
  getMessageColumnWidthFromRow,
  getPhoneMessageColumnWidth,
  getPhoneToolbarButtonSize,
  getPhoneToolbarWidth,
  PHONE_AVATAR_HIT_SLOP_BOTTOM_PX,
  PHONE_AVATAR_HIT_SLOP_TOP_PX,
  PHONE_AVATAR_HIT_SLOP_X_PX,
  PHONE_MENU_QUICK_REACTION_PX,
  PHONE_MESSAGE_ACTION_SIZES,
  PHONE_MESSAGE_AVATAR_PX,
  PHONE_MESSAGE_BUTTON_MIN_HEIGHT_PX,
  PHONE_MESSAGE_COLUMN_PX,
  PHONE_RETRY_PILL_MIN_HEIGHT_PX,
  PHONE_TOOLBAR_BUTTON_MAX_PX,
  PHONE_TOOLBAR_BUTTON_MIN_PX,
} from './messageActionSizes';

describe('message action sizes', () => {
  it('picks phone sizes below the md breakpoint and desktop sizes above', () => {
    expect(getMessageActionSizes(true)).toBe(PHONE_MESSAGE_ACTION_SIZES);
    expect(getMessageActionSizes(false)).toBe(DESKTOP_MESSAGE_ACTION_SIZES);
  });

  it('never makes a phone size smaller than the desktop one', () => {
    for (const key of Object.keys(DESKTOP_MESSAGE_ACTION_SIZES)) {
      expect(
        PHONE_MESSAGE_ACTION_SIZES[key],
        `${key} must not shrink on phones`
      ).toBeGreaterThanOrEqual(DESKTOP_MESSAGE_ACTION_SIZES[key]);
    }
  });

  it('keeps the desktop sizes the hover toolbar and menu always had', () => {
    expect(DESKTOP_MESSAGE_ACTION_SIZES).toMatchObject({
      toolbarIconPx: 18,
      toolbarEmojiPx: 18,
      menuItemMinHeightPx: 36,
      reactionChipHeightPx: 28,
      discussionChipHeightPx: 24,
    });
  });

  it('gives phones finger-sized targets', () => {
    expect(
      PHONE_MESSAGE_ACTION_SIZES.menuItemMinHeightPx
    ).toBeGreaterThanOrEqual(44);
    expect(PHONE_MENU_QUICK_REACTION_PX).toBeGreaterThanOrEqual(44);
    expect(
      PHONE_MESSAGE_ACTION_SIZES.reactionChipHeightPx
    ).toBeGreaterThanOrEqual(36);
    expect(
      PHONE_MESSAGE_ACTION_SIZES.discussionChipHeightPx
    ).toBeGreaterThanOrEqual(32);
    expect(PHONE_MESSAGE_ACTION_SIZES.toolbarIconPx).toBeGreaterThanOrEqual(22);
    expect(PHONE_MESSAGE_ACTION_SIZES.menuIconPx).toBeGreaterThanOrEqual(22);
  });
});

describe('getPhoneToolbarButtonSize', () => {
  it('uses 44px when the bar has room (messages from other people)', () => {
    // 4 quick reactions + emoji picker + reply.
    expect(getPhoneToolbarButtonSize(6)).toBe(44);
    // Own message that can be deleted but not edited (e.g. a file).
    expect(getPhoneToolbarButtonSize(7)).toBe(44);
  });

  it('drops to 40px for the full own-message bar on a 360px phone', () => {
    // + edit + delete.
    expect(getPhoneToolbarButtonSize(8)).toBe(40);
  });

  it('keeps every toolbar on one line of a 360px phone', () => {
    for (let count = 1; count <= 8; count += 1) {
      const size = getPhoneToolbarButtonSize(count);
      expect(getPhoneToolbarWidth(count, size)).toBeLessThanOrEqual(
        PHONE_MESSAGE_COLUMN_PX
      );
    }
  });

  it('never goes below 40px or above 44px', () => {
    expect(getPhoneToolbarButtonSize(20)).toBe(PHONE_TOOLBAR_BUTTON_MIN_PX);
    expect(getPhoneToolbarButtonSize(1)).toBe(PHONE_TOOLBAR_BUTTON_MAX_PX);
    expect(getPhoneToolbarButtonSize(8, 320 - 28)).toBe(
      PHONE_TOOLBAR_BUTTON_MIN_PX
    );
    expect(getPhoneToolbarButtonSize(8, 412 - 28)).toBe(
      PHONE_TOOLBAR_BUTTON_MAX_PX
    );
  });

  it('treats a bad count as an empty bar', () => {
    expect(getPhoneToolbarButtonSize(0)).toBe(PHONE_TOOLBAR_BUTTON_MAX_PX);
    expect(getPhoneToolbarButtonSize(Number.NaN)).toBe(
      PHONE_TOOLBAR_BUTTON_MAX_PX
    );
  });
});

describe('getPhoneMessageColumnWidth', () => {
  it('takes the message row padding off the viewport width', () => {
    expect(getPhoneMessageColumnWidth(360)).toBe(PHONE_MESSAGE_COLUMN_PX);
    expect(getPhoneMessageColumnWidth(412)).toBe(384);
  });

  it('falls back to the 360px column without a usable width', () => {
    expect(getPhoneMessageColumnWidth(0)).toBe(PHONE_MESSAGE_COLUMN_PX);
    expect(getPhoneMessageColumnWidth(Number.NaN)).toBe(
      PHONE_MESSAGE_COLUMN_PX
    );
  });

  it('lets a 412px phone keep 44px buttons on the full bar', () => {
    expect(getPhoneToolbarButtonSize(8, getPhoneMessageColumnWidth(412))).toBe(
      44
    );
  });
});

describe('getMessageColumnWidthFromRow', () => {
  it('takes the row padding off the measured row', () => {
    expect(getMessageColumnWidthFromRow(330, 412)).toBe(302);
  });

  it('beats the viewport when the host is narrower than the screen', () => {
    // A 412px viewport alone would allow 44px on the full bar.
    expect(
      getPhoneToolbarButtonSize(8, getMessageColumnWidthFromRow(330, 412))
    ).toBe(PHONE_TOOLBAR_BUTTON_MIN_PX);
  });

  it('falls back to the viewport while the row is unmeasured', () => {
    expect(getMessageColumnWidthFromRow(0, 412)).toBe(384);
    expect(getMessageColumnWidthFromRow(undefined, 412)).toBe(384);
    expect(getMessageColumnWidthFromRow(null, 360)).toBe(
      PHONE_MESSAGE_COLUMN_PX
    );
    expect(getMessageColumnWidthFromRow(Number.NaN, 360)).toBe(
      PHONE_MESSAGE_COLUMN_PX
    );
    // Narrower than its own padding: nothing usable to measure.
    expect(getMessageColumnWidthFromRow(20, 360)).toBe(PHONE_MESSAGE_COLUMN_PX);
  });
});

describe('phone in-message targets', () => {
  it('turns the 30px sender avatar into a 44px target', () => {
    expect(
      PHONE_MESSAGE_AVATAR_PX +
        PHONE_AVATAR_HIT_SLOP_TOP_PX +
        PHONE_AVATAR_HIT_SLOP_BOTTOM_PX
    ).toBe(44);
    expect(PHONE_MESSAGE_AVATAR_PX + 2 * PHONE_AVATAR_HIT_SLOP_X_PX).toBe(44);
  });

  it('keeps file-offer buttons and the retry pill finger-sized', () => {
    expect(PHONE_MESSAGE_BUTTON_MIN_HEIGHT_PX).toBeGreaterThanOrEqual(44);
    expect(PHONE_RETRY_PILL_MIN_HEIGHT_PX).toBeGreaterThanOrEqual(40);
  });
});
