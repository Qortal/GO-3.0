/**
 * Geometry of a group's channel list: the sidebar on desktop and the drawer
 * that slides over the chat on phones.
 *
 * Phones get thumb-sized rows (44px at the default text scale, growing with
 * the Q-Chat text-scale setting), category headers that hold a 40px "Create
 * channel" button, a wider drawer and one level of side padding instead of
 * two. Desktop keeps the compact sizes it always had.
 *
 * The onboarding tour points at a fixed box drawn over the first channel row
 * (data-tour="hub-onboarding-channel"); reticulumOnboardingChannelAnchor
 * derives it from the same numbers so the spotlight cannot drift off the row
 * when a size changes.
 */

import {
  reticulumChatScaledPx,
  type ReticulumChatTextScale,
} from './reticulumChatTextScale';

export type ReticulumTextScale = ReticulumChatTextScale;

/** Font size for a Q-Chat text-scale setting, as the chat itself scales. */
export const reticulumScaledTextSize = reticulumChatScaledPx;

/**
 * Row height per text-scale step, so bigger text keeps its padding. Phone
 * rows never drop under the 44px touch target, so Small only tightens them on
 * desktop.
 */
const ROW_HEIGHT_STEP_PX: Record<ReticulumTextScale, number> = {
  small: -2,
  default: 0,
  large: 6,
};

/** Phone channel rows at the default text scale. */
const RETICULUM_CHANNEL_ROW_PHONE_MIN_PX = 44;
const RETICULUM_CHANNEL_ROW_DESKTOP_MIN_PX = 30;

type ReticulumChannelRowMetrics = {
  /** The clock shown on channels whose messages auto-delete. */
  autoDeleteIconSize: number;
  badgeFontSize: number;
  /** Mention and reply count badges. */
  badgeSize: number;
  /** The plain "unread" dot. */
  dotSize: number;
  fontSize: number;
  /** The channel-type glyph before the name. */
  iconSize: number;
  minHeight: number;
  paddingLeft: number;
  paddingRight: number;
};

export function reticulumChannelRowMetrics(
  scale: ReticulumTextScale,
  phone: boolean
): ReticulumChannelRowMetrics {
  const step = ROW_HEIGHT_STEP_PX[scale] ?? 0;
  if (!phone) {
    return {
      autoDeleteIconSize: 13,
      badgeFontSize: 11,
      badgeSize: 18,
      dotSize: 8,
      fontSize: reticulumScaledTextSize(scale, 14),
      iconSize: 18,
      minHeight: RETICULUM_CHANNEL_ROW_DESKTOP_MIN_PX + step,
      paddingLeft: 12,
      paddingRight: 6,
    };
  }
  return {
    autoDeleteIconSize: 15,
    badgeFontSize: 12,
    badgeSize: 20,
    dotSize: 9,
    fontSize: reticulumScaledTextSize(scale, 15),
    iconSize: 20,
    minHeight: RETICULUM_CHANNEL_ROW_PHONE_MIN_PX + Math.max(0, step),
    paddingLeft: 12,
    paddingRight: 10,
  };
}

type ReticulumCategoryHeaderMetrics = {
  chevronSize: number;
  /** The admin "Create channel" button; null keeps desktop's small one. */
  createButtonSize: number | null;
  createIconSize: number;
  fontSize: number;
  letterSpacing: string;
  /** Includes the 1px border: the 40px button fits inside it on phones. */
  minHeight: number;
};

export function reticulumCategoryHeaderMetrics(
  phone: boolean
): ReticulumCategoryHeaderMetrics {
  if (!phone) {
    return {
      chevronSize: 14,
      createButtonSize: null,
      createIconSize: 16,
      fontSize: 10,
      letterSpacing: '0.08em',
      minHeight: 32,
    };
  }
  return {
    chevronSize: 20,
    createButtonSize: 40,
    createIconSize: 22,
    fontSize: 12,
    letterSpacing: '0.06em',
    minHeight: 42,
  };
}

/** Space between a category header and its first channel. */
export const RETICULUM_CATEGORY_CONTENT_GAP_PX = 7;
/** The same gap when the default category's header is hidden. */
export const RETICULUM_HIDDEN_CATEGORY_CONTENT_GAP_PX = 2;
/** The drawer's group-name bar above the list (desktop sidebar too). */
export const RETICULUM_CHANNEL_LIST_HEADER_PX = 50;

/** Side padding of the list and, inside it, of each category's channels. */
export function reticulumChannelListPadding(phone: boolean) {
  return phone ? { inner: 0, outer: 8 } : { inner: 8, outer: 8 };
}

/** The phone drawer: wider than the old 264px, but never past 85%. */
export const RETICULUM_CHANNEL_DRAWER_PHONE_WIDTH_PX = 288;
export const RETICULUM_CHANNEL_DRAWER_PHONE_MAX_WIDTH = '85%';

/**
 * The onboarding tour's box over the first channel row, in the drawer's
 * coordinates.
 */
export function reticulumOnboardingChannelAnchor({
  defaultCategoryHidden,
  phone,
  scale,
}: {
  defaultCategoryHidden: boolean;
  phone: boolean;
  scale: ReticulumTextScale;
}) {
  const padding = reticulumChannelListPadding(phone);
  const top =
    RETICULUM_CHANNEL_LIST_HEADER_PX +
    (defaultCategoryHidden
      ? RETICULUM_HIDDEN_CATEGORY_CONTENT_GAP_PX
      : reticulumCategoryHeaderMetrics(phone).minHeight +
        RETICULUM_CATEGORY_CONTENT_GAP_PX);
  return {
    height: reticulumChannelRowMetrics(scale, phone).minHeight,
    inset: padding.outer + padding.inner,
    top,
  };
}
