import { describe, expect, it } from 'vitest';
import { edgeScrollStep } from './useLongPressReorder';

describe('edgeScrollStep', () => {
  const bounds = { top: 100, bottom: 700 };

  it('does not scroll away from the edges', () => {
    expect(edgeScrollStep(bounds, 400)).toBe(0);
    expect(edgeScrollStep(bounds, 164)).toBe(0);
    expect(edgeScrollStep(bounds, 636)).toBe(0);
  });

  it('scrolls up near the top, faster closer to it', () => {
    expect(edgeScrollStep(bounds, 132)).toBeCloseTo(-7);
    expect(edgeScrollStep(bounds, 100)).toBeCloseTo(-14);
  });

  it('scrolls down near the bottom', () => {
    expect(edgeScrollStep(bounds, 668)).toBeCloseTo(7);
  });

  it('caps the speed past the edges', () => {
    expect(edgeScrollStep(bounds, 0)).toBe(-14);
    expect(edgeScrollStep(bounds, 900)).toBe(14);
  });
});
