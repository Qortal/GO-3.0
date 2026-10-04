import { describe, expect, it } from 'vitest';
import {
  RETICULUM_PHONE_CHAT_HEADER,
  reticulumPhoneChatHeaderWidths,
} from './reticulumGroupChatHeaderLayout';

// Before the bigger buttons (30px back arrow, 12px channel line) a 360px
// phone gave the channel name about 84px and the group name about 116px.
const OLD_CHANNEL_NAME_PX_AT_360 = 84;
const OLD_GROUP_NAME_PX_AT_360 = 116;

describe('reticulumPhoneChatHeaderWidths', () => {
  it('keeps every header button a full touch target', () => {
    expect(RETICULUM_PHONE_CHAT_HEADER.actionSize).toBeGreaterThanOrEqual(44);
    // Bleeding into the padding never pushes a button off the screen.
    expect(RETICULUM_PHONE_CHAT_HEADER.backBleed).toBeLessThanOrEqual(
      RETICULUM_PHONE_CHAT_HEADER.paddingX
    );
    expect(RETICULUM_PHONE_CHAT_HEADER.actionsBleed).toBeLessThanOrEqual(
      RETICULUM_PHONE_CHAT_HEADER.paddingX
    );
  });

  it('does not take width from the names on a 360px phone', () => {
    const widths = reticulumPhoneChatHeaderWidths(360);
    expect(widths.channelName).toBeGreaterThanOrEqual(
      OLD_CHANNEL_NAME_PX_AT_360
    );
    expect(widths.groupName).toBeGreaterThanOrEqual(OLD_GROUP_NAME_PX_AT_360);
  });

  it('matches the measured layout', () => {
    expect(reticulumPhoneChatHeaderWidths(360)).toEqual({
      channelName: 90,
      groupName: 126,
      opener: 172,
    });
    expect(reticulumPhoneChatHeaderWidths(393).channelName).toBe(123);
  });

  it('gives the names the room of a missing call button', () => {
    expect(reticulumPhoneChatHeaderWidths(360, 2).channelName).toBe(134);
  });

  it('still shows a few characters on a 320px phone', () => {
    expect(reticulumPhoneChatHeaderWidths(320).channelName).toBeGreaterThan(40);
  });
});
