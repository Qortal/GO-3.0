/**
 * Honest delivery states for the user's own Reticulum DMs (plan item #13).
 *
 * - delivered: the engine served the event on the recipient's own page
 *   request and the bridge reported that transfer complete ('sent', set once
 *   the recipient's Reticulum stack proved receipt of the page; it does not
 *   prove the recipient's app stored it), or the recipient's own signed
 *   notify named it as its newest event. Older builds set it as soon as the
 *   transfer was authorized, so a row from those builds may say 'sent'
 *   without a delivery. Each message shows its own state: a later delivered
 *   message never makes an earlier pending one "delivered".
 * - on_other_device: still pending here, but one of the user's own devices
 *   (the home Hub) pulled a copy and may deliver it; not confirmed. Never
 *   "delivered".
 * - sending: pending, no own-device copy, sent less than ~30 s ago.
 * - only_on_this_phone: pending, no own-device copy, older than that.
 *
 * Saved Messages (self-DMs) are born 'sent' and show nothing. Events this
 * device did not author locally (also copies of the account's own messages
 * written on another device) are stored 'received' and show nothing; older
 * builds marked such a copy 'sent' when it served it, and the DM hook shows
 * those as 'received' (useReticulumDirectChat, localOwnEvent).
 * A message still pending after the engine stopped re-announcing it (older
 * than RETICULUM_DM_PENDING_MAX_AGE_MS) shows nothing either: nobody retries
 * it any more, and rows written before own-device copies were recorded may
 * well have been delivered. For the same reason a pending row older than this
 * device's first run of the tracking build (deliveryTrackingSinceMs) shows
 * nothing: its own-device copy was never recorded.
 */
export type ReticulumDmDeliveryState =
  | 'sending'
  | 'only_on_this_phone'
  | 'on_other_device'
  | 'delivered';

export const RETICULUM_DM_ONLY_LOCAL_AFTER_MS = 30_000;
/** Matches RETICULUM_CHAT_DM_PENDING_TAIL_MAX_AGE_MS in the chat engine. */
export const RETICULUM_DM_PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

type DeliveryMessageFields = {
  reticulumDirect?: unknown;
  sender?: unknown;
  recipientAddress?: unknown;
  timestamp?: unknown;
  reticulumDeliveryStatus?: unknown;
  reticulumOwnDeviceCopiedAt?: unknown;
};

// Rows written before own-device copies were recorded (the engine column is
// new and never backfilled) cannot tell 'only on this phone' from 'copied by
// the Hub', so pending rows older than this device's first run of this build
// show no glyph. The engine still retries them. Kept per device, like the
// engine DB; if storage is unavailable, this session start is used, which
// only hides more.
const DELIVERY_TRACKING_SINCE_KEY = 'reticulum-dm-delivery-tracking-since';
let deliveryTrackingSince: number | null = null;

const deliveryTrackingSinceMs = (): number => {
  if (deliveryTrackingSince !== null) return deliveryTrackingSince;
  let since = 0;
  try {
    since = Number(localStorage.getItem(DELIVERY_TRACKING_SINCE_KEY)) || 0;
  } catch {
    since = 0;
  }
  if (since <= 0) {
    since = Date.now();
    try {
      localStorage.setItem(DELIVERY_TRACKING_SINCE_KEY, String(since));
    } catch {
      // Private window or blocked storage: this session start is used.
    }
  }
  deliveryTrackingSince = since;
  return since;
};
// Recorded at load, before this build's engine writes its first DM.
deliveryTrackingSinceMs();

/** Test hook: when delivery tracking started (null re-reads storage). */
export const setReticulumDmDeliveryTrackingSince = (ms: number | null) => {
  deliveryTrackingSince = ms;
};

const timestampMs = (value: unknown): number => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
};

/**
 * True when this message gets a delivery glyph at all. Only the pending
 * max age depends on the clock; it has no timer (a list open for a week
 * catches up on its next render).
 */
export const hasReticulumDmDeliveryState = (
  value: unknown,
  myAddress: string | undefined,
  nowMs = Date.now()
): boolean => {
  if (!value || typeof value !== 'object' || !myAddress) return false;
  const message = value as DeliveryMessageFields;
  if (message.reticulumDirect !== true) return false;
  if (message.sender !== myAddress) return false;
  const recipient = String(message.recipientAddress || '');
  if (!recipient || recipient === myAddress) return false;
  if (message.reticulumDeliveryStatus === 'sent') return true;
  if (message.reticulumDeliveryStatus !== 'pending') return false;
  const sentAt = timestampMs(message.timestamp);
  if (sentAt > 0 && sentAt < deliveryTrackingSinceMs()) return false;
  return !(sentAt > 0 && nowMs - sentAt > RETICULUM_DM_PENDING_MAX_AGE_MS);
};

export const getReticulumDmDeliveryState = (
  message: DeliveryMessageFields | null | undefined,
  myAddress: string | undefined,
  nowMs: number
): ReticulumDmDeliveryState | null => {
  if (!hasReticulumDmDeliveryState(message, myAddress, nowMs)) return null;
  if (message!.reticulumDeliveryStatus === 'sent') return 'delivered';
  if (Number(message!.reticulumOwnDeviceCopiedAt) > 0) {
    return 'on_other_device';
  }
  const sentAt = timestampMs(message!.timestamp);
  return sentAt > 0 && nowMs - sentAt >= RETICULUM_DM_ONLY_LOCAL_AFTER_MS
    ? 'only_on_this_phone'
    : 'sending';
};

/**
 * When the state changes by time alone ('sending' -> 'only_on_this_phone'),
 * or null when it can only change through a new event.
 */
export const reticulumDmDeliveryBoundaryAt = (
  message: DeliveryMessageFields | null | undefined,
  state: ReticulumDmDeliveryState | null
): number | null => {
  if (state !== 'sending') return null;
  const sentAt = timestampMs(message?.timestamp);
  return sentAt > 0 ? sentAt + RETICULUM_DM_ONLY_LOCAL_AFTER_MS : null;
};

// One shared one-shot timer for every mounted glyph: it is armed for the
// earliest pending boundary only, wakes the glyphs whose boundary passed and
// re-arms for the next one. No timer exists while nothing is 'sending'.
const boundaryWaiters = new Map<() => void, number>();
let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
let boundaryTimerAt = 0;

const armBoundaryTimer = () => {
  let earliest = Infinity;
  for (const at of boundaryWaiters.values()) earliest = Math.min(earliest, at);
  if (earliest === Infinity) {
    if (boundaryTimer) clearTimeout(boundaryTimer);
    boundaryTimer = null;
    boundaryTimerAt = 0;
    return;
  }
  if (boundaryTimer && boundaryTimerAt === earliest) return;
  if (boundaryTimer) clearTimeout(boundaryTimer);
  boundaryTimerAt = earliest;
  boundaryTimer = setTimeout(
    () => {
      boundaryTimer = null;
      boundaryTimerAt = 0;
      const now = Date.now();
      const due: Array<() => void> = [];
      for (const [wake, at] of boundaryWaiters) {
        if (at <= now) due.push(wake);
      }
      for (const wake of due) boundaryWaiters.delete(wake);
      armBoundaryTimer();
      for (const wake of due) wake();
    },
    Math.max(0, earliest - Date.now()) + 50
  );
};

/** Calls `wake` once at `at` (shared timer). Returns an unsubscribe. */
export const waitForReticulumDmDeliveryBoundary = (
  at: number,
  wake: () => void
): (() => void) => {
  boundaryWaiters.set(wake, at);
  armBoundaryTimer();
  return () => {
    if (!boundaryWaiters.delete(wake)) return;
    armBoundaryTimer();
  };
};

/** Test hook: how many glyphs wait on the shared timer. */
export const reticulumDmDeliveryWaiterCount = () => boundaryWaiters.size;
