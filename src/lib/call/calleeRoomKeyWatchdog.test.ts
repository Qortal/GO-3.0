import { describe, expect, it } from 'vitest';
import {
  CALLEE_RTC_RECHECK_GRACE_MS,
  nextCalleeWatchdogStep,
} from './calleeRoomKeyWatchdog';

const WAIT = 65_000;

describe('nextCalleeWatchdogStep', () => {
  it('keeps a call whose Direct leg is open and looks again after the full wait', () => {
    expect(
      nextCalleeWatchdogStep({
        rtcOpen: true,
        rtcLastOpenAt: 1_000,
        now: 66_000,
        waitMs: WAIT,
      })
    ).toEqual({ end: false, againInMs: WAIT });
  });

  it('ends a call that never had a Direct leg', () => {
    expect(
      nextCalleeWatchdogStep({
        rtcOpen: false,
        rtcLastOpenAt: 0,
        now: 65_000,
        waitMs: WAIT,
      })
    ).toEqual({ end: true, againInMs: 0 });
  });

  it('looks again shortly while a leg that was just open re-checks its path', () => {
    // A network change 2 s ago made the leg stop counting as open.
    expect(
      nextCalleeWatchdogStep({
        rtcOpen: false,
        rtcLastOpenAt: 128_000,
        now: 130_000,
        waitMs: WAIT,
      })
    ).toEqual({ end: false, againInMs: CALLEE_RTC_RECHECK_GRACE_MS - 2_000 });
  });

  it('ends the call when the leg stayed down for the whole grace', () => {
    expect(
      nextCalleeWatchdogStep({
        rtcOpen: false,
        rtcLastOpenAt: 128_000,
        now: 128_000 + CALLEE_RTC_RECHECK_GRACE_MS,
        waitMs: WAIT,
      })
    ).toEqual({ end: true, againInMs: 0 });
  });

  it('does not trust a last-open time from the future (clock change)', () => {
    expect(
      nextCalleeWatchdogStep({
        rtcOpen: false,
        rtcLastOpenAt: 200_000,
        now: 130_000,
        waitMs: WAIT,
      })
    ).toEqual({ end: true, againInMs: 0 });
  });

  it('a re-check after the grace keeps the call once the leg is open again', () => {
    const first = nextCalleeWatchdogStep({
      rtcOpen: false,
      rtcLastOpenAt: 129_000,
      now: 130_000,
      waitMs: WAIT,
    });
    expect(first).toEqual({ end: false, againInMs: 14_000 });
    expect(
      nextCalleeWatchdogStep({
        rtcOpen: true,
        rtcLastOpenAt: 140_000,
        now: 144_000,
        waitMs: WAIT,
      })
    ).toEqual({ end: false, againInMs: WAIT });
  });
});
