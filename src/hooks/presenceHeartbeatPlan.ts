/**
 * GO: heartbeats signed in advance when GO goes off screen.
 *
 * Off screen on battery Chromium freezes GO's page, so it stops signing
 * presence heartbeats and ~90 s later every other device shows the phone
 * offline: friends can no longer call it, although a call request would
 * still reach the phone and ring natively. So when GO leaves the screen it
 * signs the coming heartbeats (ordinary PRESENCE_HEARTBEAT envelopes, same
 * spacing as live ones) and Python publishes each at its own time
 * (qortal_presence_host.py, schedule_presence_heartbeats). Python skips them
 * while the page still sends live heartbeats and drops them when GO comes
 * back on screen, signs out or goes invisible.
 */

export type PlannedHeartbeat = {
  timestamp: number;
  status: 'online' | 'idle' | 'busy';
};

/** Same spacing as the live heartbeats (usePresence HEARTBEAT_INTERVAL_MS). */
export const SIGNED_HEARTBEAT_INTERVAL_MS = 25_000;
/** How long a phone off screen stays visible to friends. */
export const SIGNED_HEARTBEAT_COVER_MS = 2 * 60 * 60 * 1_000;
/** Off screen this long before signing (a quick app switch signs nothing). */
export const SIGNED_HEARTBEAT_HIDE_DELAY_MS = 3_000;
/** Handed over first, so a page frozen mid-signing still leaves some. */
export const SIGNED_HEARTBEAT_FIRST_BATCH = 12;
/** Then handed over again every this many (the whole list each time). */
export const SIGNED_HEARTBEAT_BATCH = 48;

/**
 * Timestamps and statuses of the heartbeats to sign. `busy` stays busy;
 * otherwise a heartbeat becomes `idle` once it is `idleAfterMs` past the
 * last activity, like the page's own idle detection. 'offline' (invisible)
 * plans nothing.
 */
export function planSignedHeartbeats({
  now,
  lastActivityAt,
  status,
  idleAfterMs,
  intervalMs = SIGNED_HEARTBEAT_INTERVAL_MS,
  coverMs = SIGNED_HEARTBEAT_COVER_MS,
}: {
  now: number;
  lastActivityAt: number;
  status: 'online' | 'idle' | 'busy' | 'offline';
  idleAfterMs: number;
  intervalMs?: number;
  coverMs?: number;
}): PlannedHeartbeat[] {
  if (status === 'offline') return [];
  if (!(intervalMs > 0) || !(coverMs > 0)) return [];
  const out: PlannedHeartbeat[] = [];
  for (let at = now + intervalMs; at <= now + coverMs; at += intervalMs) {
    const planned: PlannedHeartbeat['status'] =
      status === 'busy'
        ? 'busy'
        : status === 'idle' || at - lastActivityAt >= idleAfterMs
          ? 'idle'
          : 'online';
    out.push({ timestamp: Math.floor(at), status: planned });
  }
  return out;
}

/** Whether `count` signed so far is a point to hand the list to Python. */
export function isSignedHeartbeatHandover(
  count: number,
  total: number
): boolean {
  if (count <= 0) return false;
  if (count === total) return true;
  if (count === SIGNED_HEARTBEAT_FIRST_BATCH) return true;
  return (
    count > SIGNED_HEARTBEAT_FIRST_BATCH &&
    (count - SIGNED_HEARTBEAT_FIRST_BATCH) % SIGNED_HEARTBEAT_BATCH === 0
  );
}
