/**
 * GO callee whose caller never sent the room key: WebRTC may carry the audio
 * on its own, so the watchdog in useVoiceCall keeps such a call and looks
 * again later. A Direct leg that was open moments ago may only be re-checking
 * its path (own network change or a short RTP gap, see
 * directVoiceWebRtcTransport `suspectPath`): for that it looks again shortly
 * instead of ending a call whose audio may still flow, and ends the call only
 * when the leg stayed down this long.
 */
export const CALLEE_RTC_RECHECK_GRACE_MS = 15_000;

/** End the call now, or look again in `againInMs` (0 when it ends). */
export type CalleeWatchdogStep = { end: boolean; againInMs: number };

export function nextCalleeWatchdogStep({
  rtcOpen,
  rtcLastOpenAt,
  now,
  waitMs,
  graceMs = CALLEE_RTC_RECHECK_GRACE_MS,
}: {
  /** The Direct (WebRTC) leg counts as open now. */
  rtcOpen: boolean;
  /** When the leg was last seen open (ms), 0 if never in this call. */
  rtcLastOpenAt: number;
  now: number;
  /** The normal wait between two looks. */
  waitMs: number;
  graceMs?: number;
}): CalleeWatchdogStep {
  if (rtcOpen) return { end: false, againInMs: waitMs };
  if (rtcLastOpenAt > 0) {
    const since = now - rtcLastOpenAt;
    if (since >= 0 && since < graceMs) {
      return { end: false, againInMs: graceMs - since };
    }
  }
  return { end: true, againInMs: 0 };
}
