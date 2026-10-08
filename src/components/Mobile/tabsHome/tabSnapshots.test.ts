import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import {
  clearTabSnapshots,
  frameIsUncovered,
  pruneTabSnapshots,
  tabSnapshotsAtom,
  visiblePart,
} from './tabSnapshots';

describe('visiblePart', () => {
  it('clips the frame to the screen', () => {
    expect(
      visiblePart(
        { left: -10, top: 52, right: 400, bottom: 900 },
        { width: 390, height: 844 }
      )
    ).toEqual({ x: 0, y: 52, width: 390, height: 792 });
  });

  it('gives nothing for a frame that is off screen', () => {
    expect(
      visiblePart(
        { left: -800, top: 0, right: -410, bottom: 800 },
        { width: 390, height: 844 }
      )
    ).toBeNull();
  });
});

describe('frameIsUncovered', () => {
  const area = { x: 0, y: 0, width: 100, height: 100 };

  it('is true when every sample point hits the frame', () => {
    const frame = document.createElement('iframe');
    expect(frameIsUncovered(frame, area, () => frame)).toBe(true);
  });

  it('is false when something sits over part of it', () => {
    const frame = document.createElement('iframe');
    const dialog = document.createElement('div');
    expect(
      frameIsUncovered(frame, area, (x, y) =>
        x > 60 && y > 60 ? dialog : frame
      )
    ).toBe(false);
  });
});

describe('pruneTabSnapshots / clearTabSnapshots', () => {
  it('drops the pictures of closed tabs and frees them', () => {
    const revoke = vi.fn();
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      const store = createStore();
      store.set(tabSnapshotsAtom, {
        a: { url: 'blob:a', at: 1 },
        b: { url: 'blob:b', at: 2 },
      });
      pruneTabSnapshots(['b'], store);
      expect(Object.keys(store.get(tabSnapshotsAtom))).toEqual(['b']);
      expect(revoke).toHaveBeenCalledWith('blob:a');

      clearTabSnapshots(store);
      expect(store.get(tabSnapshotsAtom)).toEqual({});
      expect(revoke).toHaveBeenCalledWith('blob:b');
    } finally {
      URL.revokeObjectURL = original;
    }
  });
});
