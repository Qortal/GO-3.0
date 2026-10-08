/**
 * Sideways swipes nest on phones: the chat list pager (Groups / DMs) sits
 * inside the swipe between Home, Apps and Chat. Both listen to the same
 * touches; the inner one claims a gesture when it locks onto it, and the
 * outer one leaves claimed gestures alone. Inner listeners run first (the
 * touch bubbles up), so the claim is always in place by the time the outer
 * one decides.
 *
 * A gesture is known by its touchstart's timeStamp: every listener sees the
 * same event, and a new touch has a new stamp.
 */
let claimedGestureStart: number | null = null;

export function claimHorizontalGesture(touchStartTimeStamp: number): void {
  claimedGestureStart = touchStartTimeStamp;
}

export function isHorizontalGestureClaimed(
  touchStartTimeStamp: number
): boolean {
  return claimedGestureStart === touchStartTimeStamp;
}
