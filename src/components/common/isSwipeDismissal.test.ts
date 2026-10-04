import { describe, expect, it } from 'vitest';
import { isSwipeDismissal } from './SwipeToDismiss';

describe('isSwipeDismissal', () => {
  it('dismisses a slow drag past a third of the width, either way', () => {
    expect(isSwipeDismissal(130, 0, 360)).toBe(true);
    expect(isSwipeDismissal(-130, 0, 360)).toBe(true);
    expect(isSwipeDismissal(100, 0, 360)).toBe(false);
  });

  it('dismisses a short flick the way it was dragged', () => {
    expect(isSwipeDismissal(50, 900, 360)).toBe(true);
    expect(isSwipeDismissal(-50, -900, 360)).toBe(true);
    // Flicked back towards where it started: stays.
    expect(isSwipeDismissal(50, -900, 360)).toBe(false);
    // Too small to be anything but a wobble on a tap.
    expect(isSwipeDismissal(20, 900, 360)).toBe(false);
  });
});
