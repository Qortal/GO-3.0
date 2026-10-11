import { afterEach, describe, expect, it } from 'vitest';
import {
  BUBBLE_EDGE_GAP_PX,
  BUBBLE_SIZE_PX,
  bubbleBounds,
  DEFAULT_BUBBLE_PLACEMENT,
  loadBubblePlacement,
  placementPoint,
  releaseVelocity,
  saveBubblePlacement,
  settlePlacement,
} from './publishBubblePosition';
import {
  MOBILE_TAB_BAR_HEIGHT_PX,
  MOBILE_TOP_BAR_HEIGHT_PX,
} from '../Mobile/mobileBarHeights';

const phone = bubbleBounds(
  { width: 390, height: 844 },
  { top: 24, bottom: 16, left: 0, right: 0 }
);

describe('publish bubble position', () => {
  afterEach(() => localStorage.clear());

  it('keeps to the strip between the top bar and the tab buttons', () => {
    expect(phone).toEqual({
      minX: BUBBLE_EDGE_GAP_PX,
      maxX: 390 - BUBBLE_EDGE_GAP_PX - BUBBLE_SIZE_PX,
      minY: 24 + MOBILE_TOP_BAR_HEIGHT_PX + BUBBLE_EDGE_GAP_PX,
      maxY:
        844 -
        16 -
        MOBILE_TAB_BAR_HEIGHT_PX -
        BUBBLE_EDGE_GAP_PX -
        BUBBLE_SIZE_PX,
    });
  });

  it('sits against its side, at its height in the strip', () => {
    expect(placementPoint({ side: 'left', ratio: 0 }, phone)).toEqual({
      x: phone.minX,
      y: phone.minY,
    });
    expect(placementPoint({ side: 'right', ratio: 1 }, phone)).toEqual({
      x: phone.maxX,
      y: phone.maxY,
    });
  });

  it('settles against the nearer edge, or the one it was flung to', () => {
    const still = { x: 0, y: 0 };
    expect(settlePlacement({ x: 60, y: 300 }, still, phone).side).toBe('left');
    expect(settlePlacement({ x: 250, y: 300 }, still, phone).side).toBe(
      'right'
    );
    expect(
      settlePlacement({ x: 250, y: 300 }, { x: -900, y: 0 }, phone).side
    ).toBe('left');
    // Never past the ends of the strip, however hard it is flung.
    expect(
      settlePlacement({ x: 60, y: 700 }, { x: 0, y: 5000 }, phone).ratio
    ).toBe(1);
  });

  it('measures only the last moves before letting go', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 50, x: 50, y: 25 },
      { t: 100, x: 100, y: 50 },
    ];
    expect(releaseVelocity(samples, 100)).toEqual({ x: 1000, y: 500 });
    // The finger rested before letting go: no fling.
    expect(releaseVelocity(samples, 400)).toEqual({ x: 0, y: 0 });
  });

  it('remembers the spot, and falls back to the default', () => {
    expect(loadBubblePlacement()).toEqual(DEFAULT_BUBBLE_PLACEMENT);
    saveBubblePlacement({ side: 'left', ratio: 0.25 });
    expect(loadBubblePlacement()).toEqual({ side: 'left', ratio: 0.25 });
    localStorage.setItem('go-qdn-publish-bubble', '{"side":"up"}');
    expect(loadBubblePlacement()).toEqual(DEFAULT_BUBBLE_PLACEMENT);
  });
});
