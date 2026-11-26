import type { DmFriendStored } from '../atoms/global';
import {
  CHAT_ALERT_CLOCK_SKEW_MS,
  chatAlertFloor,
} from './reticulumChatAlerts';
import { isRingWakeUnattended } from './ringWakeAttention';

export const RETICULUM_DM_NOTIFICATION_CLOCK_SKEW_MS = CHAT_ALERT_CLOCK_SKEW_MS;

type ReticulumDmNotificationEvent = {
  eventId?: unknown;
  eventType?: unknown;
  senderAddress?: unknown;
  recipientAddress?: unknown;
  timestamp?: unknown;
  readByOwner?: unknown;
};

/**
 * True while the user is looking at GO/Hub. A screen woken by an incoming
 * call that nobody has touched yet does not count (utils/ringWakeAttention).
 */
export function isHubBeingViewed(): boolean {
  return (
    document.visibilityState === 'visible' &&
    document.hasFocus() &&
    !isRingWakeUnattended()
  );
}

export function shouldNotifyForReticulumDm({
  event,
  friendsByAddress,
  listeningSince,
  lastRunMark = null,
  now = Date.now(),
  myAddress,
  hubIsBeingViewed,
}: {
  event: ReticulumDmNotificationEvent;
  friendsByAddress: Record<string, DmFriendStored>;
  listeningSince: number;
  /** When GO last ran for this account (see chatAlertFloor); null if unknown. */
  lastRunMark?: number | null;
  now?: number;
  myAddress: string;
  hubIsBeingViewed: boolean;
}): boolean {
  const eventId = typeof event?.eventId === 'string' ? event.eventId : '';
  const senderAddress =
    typeof event?.senderAddress === 'string' ? event.senderAddress : '';
  const recipientAddress =
    typeof event?.recipientAddress === 'string' ? event.recipientAddress : '';
  const timestamp = Number(event?.timestamp);

  return Boolean(
    eventId &&
      event.eventType === 'message' &&
      senderAddress &&
      senderAddress !== myAddress &&
      recipientAddress === myAddress &&
      friendsByAddress?.[senderAddress] &&
      event.readByOwner !== true &&
      !hubIsBeingViewed &&
      Number.isFinite(timestamp) &&
      timestamp >= chatAlertFloor({ listeningSince, lastRunMark, now })
  );
}
