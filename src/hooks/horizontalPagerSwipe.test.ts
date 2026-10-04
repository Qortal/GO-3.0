import { describe, expect, it } from 'vitest';
import {
  PAGER_AXIS_LOCK_PX,
  PAGER_COMMIT_RATIO,
  PAGER_EDGE_ZONE_PX,
  PAGER_FLING_MIN_PX,
  PAGER_FLING_VELOCITY,
  PAGER_HOLD_MS,
  PAGER_POINTER_STOPPED_MS,
  PAGER_RUBBER_BAND_MAX_PX,
  PAGER_SCROLL_SETTLE_MS,
  PAGER_SCROLL_SETTLE_PX,
  PAGER_SETTLE_MAX_MS,
  PAGER_SETTLE_MIN_MS,
  isInPagerEdgeZone,
  isPagerScrollSettling,
  pagerDragOffset,
  pagerLiftVelocity,
  pagerReleaseVelocity,
  pagerRubberBand,
  pagerSettleDurationMs,
  pagerTargetForDrag,
  pagerTrackTransform,
  pagerTranslateX,
  pagerTravelForOffset,
  resolvePagerAxis,
  resolvePagerRelease,
} from './horizontalPagerSwipe';

const WIDTH = 412;

describe('isInPagerEdgeZone', () => {
  it('ignores touches within 24px of either screen edge', () => {
    expect(PAGER_EDGE_ZONE_PX).toBe(24);
    expect(isInPagerEdgeZone(0, WIDTH)).toBe(true);
    expect(isInPagerEdgeZone(23, WIDTH)).toBe(true);
    expect(isInPagerEdgeZone(WIDTH - 23, WIDTH)).toBe(true);
    expect(isInPagerEdgeZone(WIDTH, WIDTH)).toBe(true);
  });

  it('accepts touches from 24px in', () => {
    expect(isInPagerEdgeZone(24, WIDTH)).toBe(false);
    expect(isInPagerEdgeZone(WIDTH / 2, WIDTH)).toBe(false);
    expect(isInPagerEdgeZone(WIDTH - 24, WIDTH)).toBe(false);
  });
});

describe('resolvePagerAxis', () => {
  it('waits until the finger has moved about 10px', () => {
    expect(PAGER_AXIS_LOCK_PX).toBe(10);
    expect(resolvePagerAxis(0, 0)).toBeNull();
    expect(resolvePagerAxis(9, 9)).toBeNull();
    expect(resolvePagerAxis(-9.5, 3)).toBeNull();
  });

  it('locks horizontal when sideways travel dominates', () => {
    expect(resolvePagerAxis(10, 0)).toBe('horizontal');
    expect(resolvePagerAxis(-12, 6)).toBe('horizontal');
    expect(resolvePagerAxis(15, -14)).toBe('horizontal');
  });

  it('locks vertical when vertical travel dominates or ties', () => {
    expect(resolvePagerAxis(0, 10)).toBe('vertical');
    expect(resolvePagerAxis(4, -12)).toBe('vertical');
    // A perfect diagonal is left to list scrolling.
    expect(resolvePagerAxis(11, 11)).toBe('vertical');
  });

  it('calls a touch that stayed put a hold, even if it moves later', () => {
    expect(PAGER_HOLD_MS).toBeLessThan(450);
    expect(resolvePagerAxis(2, 1, PAGER_HOLD_MS - 1)).toBeNull();
    expect(resolvePagerAxis(-14, 2, PAGER_HOLD_MS - 1)).toBe('horizontal');
    expect(resolvePagerAxis(2, 1, PAGER_HOLD_MS)).toBe('hold');
    expect(resolvePagerAxis(-60, 2, PAGER_HOLD_MS + 200)).toBe('hold');
  });
});

describe('pagerTargetForDrag (Groups = 0 on the left, DMs = 1)', () => {
  it('brings in DMs for a right-to-left drag on Groups', () => {
    expect(pagerTargetForDrag(0, -40, 2)).toBe(1);
  });

  it('brings back Groups for a left-to-right drag on DMs', () => {
    expect(pagerTargetForDrag(1, 40, 2)).toBe(0);
  });

  it('has nowhere to go past either end', () => {
    expect(pagerTargetForDrag(0, 40, 2)).toBeNull();
    expect(pagerTargetForDrag(1, -40, 2)).toBeNull();
    expect(pagerTargetForDrag(0, 0, 2)).toBeNull();
  });
});

describe('pagerRubberBand', () => {
  it('resists at half speed at first', () => {
    expect(pagerRubberBand(4)).toBeCloseTo(2, 0);
    expect(pagerRubberBand(-4)).toBeCloseTo(-2, 0);
    expect(pagerRubberBand(0)).toBe(0);
  });

  it('never pulls further than the cap', () => {
    const far = pagerRubberBand(10_000);
    expect(far).toBeLessThan(PAGER_RUBBER_BAND_MAX_PX);
    expect(far).toBeGreaterThan(PAGER_RUBBER_BAND_MAX_PX * 0.95);
    expect(pagerRubberBand(-10_000)).toBeCloseTo(-far, 5);
    // Monotonic: more pull, more (but ever less) movement.
    expect(pagerRubberBand(200)).toBeGreaterThan(pagerRubberBand(100));
    expect(pagerRubberBand(100)).toBeLessThan(100);
  });
});

describe('pagerDragOffset', () => {
  it('follows the finger towards a neighbouring page', () => {
    expect(pagerDragOffset(0, -120, 2, WIDTH)).toBe(-120);
    expect(pagerDragOffset(1, 90, 2, WIDTH)).toBe(90);
  });

  it('stops at a whole page', () => {
    expect(pagerDragOffset(0, -900, 2, WIDTH)).toBe(-WIDTH);
    expect(pagerDragOffset(1, 900, 2, WIDTH)).toBe(WIDTH);
  });

  it('rubber-bands past either end', () => {
    expect(pagerDragOffset(0, 120, 2, WIDTH)).toBe(pagerRubberBand(120));
    expect(pagerDragOffset(1, -120, 2, WIDTH)).toBe(pagerRubberBand(-120));
    expect(Math.abs(pagerDragOffset(0, 400, 2, WIDTH))).toBeLessThan(
      PAGER_RUBBER_BAND_MAX_PX
    );
  });
});

describe('pagerReleaseVelocity', () => {
  it('is zero without enough samples', () => {
    expect(pagerReleaseVelocity([])).toBe(0);
    expect(pagerReleaseVelocity([{ t: 0, x: 100 }])).toBe(0);
  });

  it('measures px/ms over the recent samples only', () => {
    const samples = [
      { t: 0, x: 300 },
      // A pause, then a quick flick to the left over the last 60ms.
      { t: 400, x: 300 },
      { t: 430, x: 270 },
      { t: 460, x: 240 },
    ];
    expect(pagerReleaseVelocity(samples)).toBeCloseTo(-1, 5);
  });

  it('is zero when the finger stopped before letting go', () => {
    expect(
      pagerReleaseVelocity([
        { t: 0, x: 300 },
        { t: 50, x: 200 },
        { t: 400, x: 200 },
      ])
    ).toBe(0);
  });
});

describe('pagerLiftVelocity', () => {
  // About 70px in 96ms: a flick's speed while the finger moves.
  const quick = [0, 16, 32, 48, 64, 80, 96].map((t) => ({
    t,
    x: 600 - (70 * t) / 96,
  }));

  it('keeps the flick of a finger lifted while still moving', () => {
    expect(pagerLiftVelocity(quick, { t: 104, x: 524 })).toBeLessThan(
      -PAGER_FLING_VELOCITY
    );
    // Lifted in the same frame as the last move.
    expect(pagerLiftVelocity(quick, { t: 96, x: 530 })).toBeLessThan(
      -PAGER_FLING_VELOCITY
    );
  });

  it('is zero for a finger that rested before lifting (no moves sent)', () => {
    expect(PAGER_POINTER_STOPPED_MS).toBeLessThanOrEqual(50);
    expect(pagerLiftVelocity(quick, { t: 896, x: 530 })).toBe(0);
    expect(
      pagerLiftVelocity(quick, { t: 96 + PAGER_POINTER_STOPPED_MS, x: 530 })
    ).toBe(0);
  });

  it('counts a move reported only by the lift', () => {
    // The lock's move, then 50px that only the lift (50ms later) reports.
    expect(pagerLiftVelocity([{ t: 16, x: 300 }], { t: 66, x: 250 })).toBe(-1);
  });

  it('is zero without a drag', () => {
    expect(pagerLiftVelocity([], { t: 10, x: 100 })).toBe(0);
  });
});

describe('isPagerScrollSettling', () => {
  it('blames scroll changes right after touchdown on the fling it stopped', () => {
    expect(isPagerScrollSettling(-30, 0, PAGER_SCROLL_SETTLE_MS - 1)).toBe(
      true
    );
    expect(isPagerScrollSettling(3, -3, 500)).toBe(true);
  });

  it('counts later scrolling, once the finger has moved, as a scroll', () => {
    expect(isPagerScrollSettling(-PAGER_SCROLL_SETTLE_PX, 0, 60)).toBe(false);
    expect(isPagerScrollSettling(0, 12, PAGER_SCROLL_SETTLE_MS)).toBe(false);
  });
});

describe('pagerTranslateX', () => {
  it('reads computed matrices', () => {
    expect(pagerTranslateX('matrix(1, 0, 0, 1, -205.5, 0)', WIDTH)).toBe(
      -205.5
    );
    expect(
      pagerTranslateX(
        'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -300, 0, 0, 1)',
        WIDTH
      )
    ).toBe(-300);
    expect(pagerTranslateX('none', WIDTH)).toBe(0);
    expect(pagerTranslateX('', WIDTH)).toBe(0);
  });

  it('reads the inline px and percent forms', () => {
    expect(pagerTranslateX('translate3d(-120px, 0, 0)', WIDTH)).toBe(-120);
    expect(pagerTranslateX(pagerTrackTransform(1), WIDTH)).toBe(-WIDTH);
    expect(pagerTranslateX(pagerTrackTransform(0), WIDTH)).toBe(0);
  });

  it('gives up on anything else', () => {
    expect(pagerTranslateX('rotate(10deg)', WIDTH)).toBeNull();
  });
});

describe('pagerTravelForOffset', () => {
  it('is the offset itself towards a neighbouring page', () => {
    expect(pagerTravelForOffset(1, 200, 2)).toBe(200);
    expect(pagerTravelForOffset(0, -150, 2)).toBe(-150);
  });

  it('undoes the rubber band past either end', () => {
    for (const travel of [5, 40, 160]) {
      const offset = pagerDragOffset(0, travel, 2, WIDTH);
      expect(pagerTravelForOffset(0, offset, 2)).toBeCloseTo(travel, 5);
      expect(
        pagerTravelForOffset(1, pagerDragOffset(1, -travel, 2, WIDTH), 2)
      ).toBeCloseTo(-travel, 5);
    }
    expect(pagerTravelForOffset(0, 0, 2)).toBe(0);
    // Never infinite, even for an offset at or past the cap.
    expect(
      Number.isFinite(pagerTravelForOffset(0, PAGER_RUBBER_BAND_MAX_PX * 2, 2))
    ).toBe(true);
  });
});

describe('resolvePagerRelease', () => {
  const release = (dx: number, velocity = 0, page = 0) =>
    resolvePagerRelease({ dx, page, pageCount: 2, velocity, width: WIDTH });

  it('commits a slow drag past about 28% of the width', () => {
    expect(PAGER_COMMIT_RATIO).toBeGreaterThanOrEqual(0.25);
    expect(PAGER_COMMIT_RATIO).toBeLessThanOrEqual(0.3);
    const threshold = WIDTH * PAGER_COMMIT_RATIO;
    expect(release(-(threshold + 1))).toBe(1);
    expect(release(threshold + 1, 0, 1)).toBe(0);
  });

  it('springs back from a short slow drag', () => {
    const threshold = WIDTH * PAGER_COMMIT_RATIO;
    expect(release(-(threshold - 1))).toBe(0);
    expect(release(threshold - 1, 0, 1)).toBe(1);
  });

  it('commits a quick flick even when short', () => {
    expect(release(-PAGER_FLING_MIN_PX, -PAGER_FLING_VELOCITY)).toBe(1);
    expect(release(40, 0.9, 1)).toBe(0);
  });

  it('ignores a flick that is too short to be a swipe', () => {
    expect(release(-(PAGER_FLING_MIN_PX - 1), -2)).toBe(0);
  });

  it('cancels a long drag flicked back the other way', () => {
    expect(release(-WIDTH * 0.6, 0.8)).toBe(0);
    expect(release(WIDTH * 0.6, -0.8, 1)).toBe(1);
  });

  it('stays put at either end, however far or fast', () => {
    expect(release(WIDTH, 3)).toBe(0);
    expect(release(-WIDTH, -3, 1)).toBe(1);
  });
});

describe('pagerSettleDurationMs', () => {
  it('stays within its bounds', () => {
    expect(pagerSettleDurationMs(0, 0, WIDTH)).toBe(PAGER_SETTLE_MIN_MS);
    expect(pagerSettleDurationMs(WIDTH, 0, WIDTH)).toBe(PAGER_SETTLE_MAX_MS);
    expect(pagerSettleDurationMs(-WIDTH * 3, 0, WIDTH)).toBe(
      PAGER_SETTLE_MAX_MS
    );
  });

  it('is shorter for the rest of a long drag than for a whole page', () => {
    expect(pagerSettleDurationMs(WIDTH * 0.3, 0, WIDTH)).toBeLessThan(
      pagerSettleDurationMs(WIDTH, 0, WIDTH)
    );
  });

  it('is shorter after a fast flick', () => {
    expect(pagerSettleDurationMs(WIDTH * 0.8, 6, WIDTH)).toBeLessThan(
      pagerSettleDurationMs(WIDTH * 0.8, 0, WIDTH)
    );
  });
});

describe('pagerTrackTransform', () => {
  it('rests in percent of the page width', () => {
    expect(pagerTrackTransform(0)).toBe('translate3d(0%, 0, 0)');
    expect(pagerTrackTransform(1)).toBe('translate3d(-100%, 0, 0)');
  });
});
