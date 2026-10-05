import { describe, expect, it } from 'vitest';
import {
  DESKTOP_MESSAGE_ACTION_SIZES,
  getMessageActionSizes,
  PHONE_AVATAR_HIT_SLOP_BOTTOM_PX,
  PHONE_AVATAR_HIT_SLOP_TOP_PX,
  PHONE_AVATAR_HIT_SLOP_X_PX,
  PHONE_MESSAGE_ACTION_SIZES,
  PHONE_MESSAGE_AVATAR_PX,
  PHONE_MESSAGE_BUTTON_MIN_HEIGHT_PX,
  PHONE_RETRY_PILL_MIN_HEIGHT_PX,
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
