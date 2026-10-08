import { describe, expect, it } from 'vitest';
import {
  decideSwipe,
  dragOffset,
  EDGE_RESISTANCE,
  sideRevealedBy,
  stepFor,
} from './mediaSwipe';

const base = { width: 400, hasLeft: true, hasRight: true };

describe('media swipe rules', () => {
  it('shows older ones swiping right and newer ones swiping left', () => {
    expect(sideRevealedBy(10)).toBe('left');
    expect(stepFor('left')).toBe(-1); // older: earlier in the chat
    expect(sideRevealedBy(-10)).toBe('right');
    expect(stepFor('right')).toBe(1);
  });

  it('moves on after a long drag or a quick flick', () => {
    expect(decideSwipe({ ...base, dx: -120, velocity: 0 })).toBe('right');
    expect(decideSwipe({ ...base, dx: -30, velocity: -0.8 })).toBe('right');
    expect(decideSwipe({ ...base, dx: 120, velocity: 0 })).toBe('left');
  });

  it('springs back after a short slow drag or a flick back', () => {
    expect(decideSwipe({ ...base, dx: -40, velocity: -0.1 })).toBeNull();
    expect(decideSwipe({ ...base, dx: -200, velocity: 0.9 })).toBeNull();
  });

  it('never moves to a side with nothing on it, which resists', () => {
    expect(
      decideSwipe({ ...base, hasRight: false, dx: -300, velocity: -2 })
    ).toBeNull();
    expect(dragOffset(-100, false)).toBe(-100 * EDGE_RESISTANCE);
    expect(dragOffset(-100, true)).toBe(-100);
  });
});
