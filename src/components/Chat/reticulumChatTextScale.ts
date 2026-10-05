/**
 * The Q-Chat text size (chat settings → Text size): Small, Default or Large.
 *
 * The chat's root (group chat, DM, thread) carries
 * reticulumChatTextScaleClassName(scale). chat.css turns its modifier into
 * two CSS variables that everything reading-sized multiplies by:
 *
 * - --qchat-text-scale for reading text: message text, sender names, reply
 *   cards, the message box.
 * - --qchat-meta-scale, a gentler step, for the small labels around it
 *   (timestamps, "edited", the typing line), so Small keeps them legible.
 *
 * Default leaves both unset, so it is exactly the size the chat always had.
 * Cards with a fixed layout (files, invitations, link previews), reactions
 * and buttons keep their sizes. Lists sized in script (channel rows, members)
 * use reticulumChatScaledPx with the same factors.
 *
 * No imports: atoms/global.ts reads this file.
 */

export type ReticulumChatTextScale = 'small' | 'default' | 'large';

/** In the order the settings list them. */
export const RETICULUM_CHAT_TEXT_SCALES: readonly ReticulumChatTextScale[] = [
  'small',
  'default',
  'large',
];

/** What --qchat-text-scale is set to (chat.css carries the same numbers). */
export const RETICULUM_CHAT_TEXT_SCALE_FACTOR: Record<
  ReticulumChatTextScale,
  number
> = {
  small: 0.875,
  default: 1,
  large: 1.1875,
};

/** What --qchat-meta-scale is set to (chat.css carries the same numbers). */
export const RETICULUM_CHAT_META_SCALE_FACTOR: Record<
  ReticulumChatTextScale,
  number
> = {
  small: 0.91,
  default: 1,
  large: 1.09,
};

/**
 * Reads a saved value. Builds before Small existed offered Default, Medium
 * and High: both bigger sizes are Large now, anything unknown is Default.
 */
export function normalizeReticulumChatTextScale(
  value: unknown
): ReticulumChatTextScale {
  switch (value) {
    case 'small':
    case 'default':
    case 'large':
      return value;
    case 'medium':
    case 'high':
      return 'large';
    default:
      return 'default';
  }
}

/** The class that hands a scale to everything under it (see chat.css). */
export function reticulumChatTextScaleClassName(scale: ReticulumChatTextScale) {
  return `reticulum-chat-text-scale reticulum-chat-text-scale--${scale}`;
}

/** A CSS font size (or line height) for reading text at the chat's scale. */
export function qchatTextSize(px: number) {
  return `calc(${px}px * var(--qchat-text-scale, 1))`;
}

/** A CSS font size for the small labels around messages (times, "edited"). */
export function qchatMetaTextSize(px: number) {
  return `calc(${px}px * var(--qchat-meta-scale, 1))`;
}

/** A size in script, at the chosen scale, rounded to half a pixel. */
export function reticulumChatScaledPx(
  scale: ReticulumChatTextScale,
  base: number
) {
  return Math.round(base * RETICULUM_CHAT_TEXT_SCALE_FACTOR[scale] * 2) / 2;
}

/** Names in the members lists (group members, Qortal Land): never under 12px. */
export function reticulumMemberNamePx(scale: ReticulumChatTextScale) {
  return Math.max(12, reticulumChatScaledPx(scale, 13));
}
