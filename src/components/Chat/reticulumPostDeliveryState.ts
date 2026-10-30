/**
 * Delivery states for the user's own Reticulum group posts and Saved
 * Messages (self-DMs) written on this device. GO only: the chat engine
 * tracks them when its host turns on trackOwnPostDelivery. Desktop rows never
 * carry the fields, so nothing shows there.
 *
 * - delivered: a node fetched the post from this device, and the bridge
 *   reported that transfer complete ('sent', set once the receiver's
 *   Reticulum stack proved it got the bytes; it does not prove the other app
 *   stored or showed it). For a group post, either a member's node
 *   (memberAt) or one of the user's own devices like the home Hub
 *   (ownDeviceAt). For Saved Messages only an own device can. Never by age.
 * - sending: no fetch yet, published here less than 12 s ago. Nodes that are
 *   online usually fetch it within a few seconds.
 * - not_picked_up: no fetch yet, older than that, and still inside the
 *   window in which this device keeps offering it (29 d for groups, 48 h for
 *   Saved Messages).
 *
 * Rows without the engine's fields show nothing: posts from before this
 * build, posts this account wrote on another device, other people's posts
 * and the optimistic copy shown before the engine echo. DMs to someone else
 * keep their own states (reticulumDmDeliveryState). A post nobody fetched
 * within its window shows nothing either: this device no longer offers it.
 * States only move forward: a proof is never taken back.
 */
import {
  waitForReticulumDmDeliveryBoundary,
  reticulumDmDeliveryWaiterCount,
} from './reticulumDmDeliveryState';

type ReticulumPostDeliveryScope = 'group' | 'self_dm';

export type ReticulumPostDeliveryState =
  | 'sending'
  | 'not_picked_up'
  | 'delivered';

type ReticulumPostDelivery = {
  scope: ReticulumPostDeliveryScope;
  state: ReticulumPostDeliveryState;
  /** Who fetched it, for 'delivered' only. */
  via: 'member' | 'own_device' | null;
};

/** A proof the engine reported after the row was read (ownPostDeliveryStore). */
type ReticulumPostDeliveryProof = {
  ownDeviceAt?: number;
  memberAt?: number;
};

/** Groups and Saved Messages. DMs to someone else keep their 30 s. */
export const RETICULUM_POST_SENDING_MS = 12_000;
/** Matches RETICULUM_CHAT_SERVE_MAX_AGE_MS in the chat engine. */
export const RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS = 29 * 24 * 60 * 60_000;
/** Matches RETICULUM_CHAT_SELF_DM_RECOVERY_WINDOW_MS in the chat engine. */
export const RETICULUM_SELF_DM_POST_PENDING_MAX_AGE_MS = 48 * 60 * 60_000;

type PostDeliveryMessageFields = {
  reticulumChat?: unknown;
  reticulumDirect?: unknown;
  sender?: unknown;
  recipientAddress?: unknown;
  signature?: unknown;
  eventId?: unknown;
  id?: unknown;
  reticulumPostDeliverySince?: unknown;
  reticulumPostOwnDeviceAt?: unknown;
  reticulumPostMemberAt?: unknown;
};

const positiveMs = (value: unknown): number => {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

/**
 * The engine's local fields (eventForRenderer, the DM row builder) as chat
 * item fields. Only set ones are copied, so untracked rows stay as they were.
 */
export const reticulumPostDeliveryItemFields = (
  event:
    | {
        localPostDeliverySince?: unknown;
        localPostOwnDeviceAt?: unknown;
        localPostMemberAt?: unknown;
      }
    | null
    | undefined
): {
  reticulumPostDeliverySince?: number;
  reticulumPostOwnDeviceAt?: number;
  reticulumPostMemberAt?: number;
} => {
  const since = positiveMs(event?.localPostDeliverySince);
  if (!since) return {};
  const ownDeviceAt = positiveMs(event?.localPostOwnDeviceAt);
  const memberAt = positiveMs(event?.localPostMemberAt);
  return {
    reticulumPostDeliverySince: since,
    ...(ownDeviceAt ? { reticulumPostOwnDeviceAt: ownDeviceAt } : {}),
    ...(memberAt ? { reticulumPostMemberAt: memberAt } : {}),
  };
};

/**
 * 'self_dm' for Saved Messages, 'group' for a group post, null otherwise.
 * Both need the user as author; a DM to someone else is never a post.
 */
const reticulumPostDeliveryScope = (
  value: unknown,
  myAddress: string | undefined
): ReticulumPostDeliveryScope | null => {
  if (!value || typeof value !== 'object' || !myAddress) return null;
  const message = value as PostDeliveryMessageFields;
  if (message.reticulumChat !== true || message.sender !== myAddress) {
    return null;
  }
  if (message.reticulumDirect !== true) return 'group';
  return String(message.recipientAddress || '') === myAddress
    ? 'self_dm'
    : null;
};

/** The id the engine reports proofs under. */
export const reticulumPostDeliveryEventId = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const message = value as PostDeliveryMessageFields;
  return String(message.signature || message.eventId || message.id || '');
};

/**
 * True when this message is a tracked own post. Clock-free on purpose: the
 * glyph stays mounted past the max age (it renders nothing then), so a proof
 * that arrives later through the store still shows the tick.
 */
export const hasReticulumPostDeliveryState = (
  value: unknown,
  myAddress: string | undefined
): boolean => {
  if (!reticulumPostDeliveryScope(value, myAddress)) return false;
  const since = (value as PostDeliveryMessageFields).reticulumPostDeliverySince;
  return positiveMs(since) > 0;
};

export const getReticulumPostDelivery = (
  message: PostDeliveryMessageFields | null | undefined,
  myAddress: string | undefined,
  nowMs: number,
  proof?: ReticulumPostDeliveryProof | null
): ReticulumPostDelivery | null => {
  const scope = reticulumPostDeliveryScope(message, myAddress);
  if (!scope) return null;
  const since = positiveMs(message!.reticulumPostDeliverySince);
  if (!since) return null;
  // The row and the store each hold what was known when they were filled;
  // whichever has a proof wins.
  const memberAt =
    scope === 'group'
      ? positiveMs(message!.reticulumPostMemberAt) ||
        positiveMs(proof?.memberAt)
      : 0;
  if (memberAt) return { scope, state: 'delivered', via: 'member' };
  const ownDeviceAt =
    positiveMs(message!.reticulumPostOwnDeviceAt) ||
    positiveMs(proof?.ownDeviceAt);
  if (ownDeviceAt) return { scope, state: 'delivered', via: 'own_device' };
  const ageMs = nowMs - since;
  if (ageMs < RETICULUM_POST_SENDING_MS) {
    return { scope, state: 'sending', via: null };
  }
  const maxAgeMs =
    scope === 'self_dm'
      ? RETICULUM_SELF_DM_POST_PENDING_MAX_AGE_MS
      : RETICULUM_GROUP_POST_PENDING_MAX_AGE_MS;
  return ageMs < maxAgeMs ? { scope, state: 'not_picked_up', via: null } : null;
};

export const getReticulumPostDeliveryState = (
  message: PostDeliveryMessageFields | null | undefined,
  myAddress: string | undefined,
  nowMs: number,
  proof?: ReticulumPostDeliveryProof | null
): ReticulumPostDeliveryState | null =>
  getReticulumPostDelivery(message, myAddress, nowMs, proof)?.state ?? null;

/**
 * The i18n key under reticulum:post_delivery for this delivery, e.g.
 * 'delivered_member' or 'not_picked_up_self_dm'.
 */
export const reticulumPostDeliveryTextKey = (
  delivery: ReticulumPostDelivery
): string => {
  const key =
    delivery.state === 'delivered'
      ? delivery.via === 'member'
        ? 'delivered_member'
        : 'delivered_own_device'
      : delivery.state;
  return delivery.scope === 'self_dm' ? `${key}_self_dm` : key;
};

/**
 * When the state changes by time alone ('sending' -> 'not picked up yet'),
 * or null when it can only change through a proof. The max age has no timer
 * (29 d does not fit a setTimeout); the next render catches up, as for DMs.
 * A post stamped ahead of this clock (the clock was set back) waits at most
 * one more window per wake.
 */
export const reticulumPostDeliveryBoundaryAt = (
  message: PostDeliveryMessageFields | null | undefined,
  state: ReticulumPostDeliveryState | null,
  nowMs: number
): number | null => {
  if (state !== 'sending') return null;
  const since = positiveMs(message?.reticulumPostDeliverySince);
  return since > 0 ? Math.min(since, nowMs) + RETICULUM_POST_SENDING_MS : null;
};

/** Calls `wake` once at `at`, on the timer the DM glyphs share. */
export const waitForReticulumPostDeliveryBoundary =
  waitForReticulumDmDeliveryBoundary;

/** Test hook: how many glyphs wait on the shared timer. */
export const reticulumPostDeliveryWaiterCount = reticulumDmDeliveryWaiterCount;
