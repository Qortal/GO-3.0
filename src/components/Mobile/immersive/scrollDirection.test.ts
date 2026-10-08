import { describe, expect, it } from 'vitest';
import {
  createScrollDirectionTracker,
  signalForFingerDirection,
} from './scrollDirection';

describe('createScrollDirectionTracker', () => {
  it('hides only after a run of scrolling down adds up', () => {
    const tracker = createScrollDirectionTracker({
      hideAfterPx: 30,
      showAfterPx: 20,
    });
    expect(tracker.push(10)).toBeNull();
    expect(tracker.push(10)).toBeNull();
    expect(tracker.push(10)).toBe('hide');
    // Same run keeps going: no repeat.
    expect(tracker.push(50)).toBeNull();
  });

  it('shows after scrolling back up, and a turn restarts the count', () => {
    const tracker = createScrollDirectionTracker({
      hideAfterPx: 30,
      showAfterPx: 20,
    });
    tracker.push(40);
    expect(tracker.push(-10)).toBeNull();
    expect(tracker.push(-10)).toBe('show');
    expect(tracker.push(-30)).toBeNull();
    // Turning round: the earlier upward run does not count.
    expect(tracker.push(25)).toBeNull();
    expect(tracker.push(5)).toBe('hide');
  });

  it('ignores jitter back and forth', () => {
    const tracker = createScrollDirectionTracker();
    for (let i = 0; i < 20; i += 1) {
      expect(tracker.push(i % 2 ? 6 : -6)).toBeNull();
    }
  });

  it('ignores zero and non-finite deltas, and reset clears the run', () => {
    const tracker = createScrollDirectionTracker({ hideAfterPx: 30 });
    expect(tracker.push(0)).toBeNull();
    expect(tracker.push(Number.NaN)).toBeNull();
    tracker.push(25);
    tracker.reset();
    expect(tracker.push(10)).toBeNull();
  });
});

describe('signalForFingerDirection', () => {
  it('finger up scrolls content down, so the bars hide', () => {
    expect(signalForFingerDirection('up')).toBe('hide');
    expect(signalForFingerDirection('down')).toBe('show');
    expect(signalForFingerDirection('sideways')).toBeNull();
  });
});
