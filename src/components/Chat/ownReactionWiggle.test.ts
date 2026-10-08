import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveOneOwnReaction, registerOwnReaction } from './ownReactionWiggle';

const rect = (top: number) =>
  ({
    bottom: top + 20,
    height: 20,
    left: 40,
    right: 60,
    top,
    width: 20,
    x: 40,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const chipAt = (top: number) => {
  const button = document.createElement('button');
  const emoji = document.createElement('span');
  button.appendChild(emoji);
  document.body.appendChild(button);
  emoji.getBoundingClientRect = () => rect(top);
  const animate = vi.fn();
  emoji.animate = animate as unknown as typeof emoji.animate;
  emoji.getAnimations = () => [];
  return { emoji, animate };
};

describe('own reaction wiggle', () => {
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    document.elementFromPoint = ((x: number, y: number) => {
      for (const span of Array.from(document.querySelectorAll('span'))) {
        const r = span.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
          return span;
        }
      }
      return document.body;
    }) as typeof document.elementFromPoint;
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    document.documentElement.removeAttribute('data-hub-ui-idle');
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('moves one on-screen reaction of the viewer’s at a time', () => {
    const shown = chipAt(200);
    const below = chipAt(5000);
    cleanups.push(registerOwnReaction(shown.emoji));
    cleanups.push(registerOwnReaction(below.emoji));
    const now = Date.now() + 60_000;
    expect(moveOneOwnReaction(now)).toBe(true);
    expect(shown.animate).toHaveBeenCalledTimes(1);
    expect(below.animate).not.toHaveBeenCalled();
    // It rests before its next turn.
    expect(moveOneOwnReaction(now + 1_000)).toBe(false);
    expect(moveOneOwnReaction(now + 9_000)).toBe(true);
    expect(shown.animate).toHaveBeenCalledTimes(2);
  });

  it('stays still while the screen is idle', () => {
    const shown = chipAt(200);
    cleanups.push(registerOwnReaction(shown.emoji));
    document.documentElement.setAttribute('data-hub-ui-idle', 'on');
    expect(moveOneOwnReaction(Date.now() + 60_000)).toBe(false);
    expect(shown.animate).not.toHaveBeenCalled();
  });

  it('skips a reaction covered by something else', () => {
    const shown = chipAt(200);
    cleanups.push(registerOwnReaction(shown.emoji));
    document.elementFromPoint = (() =>
      document.body) as typeof document.elementFromPoint;
    expect(moveOneOwnReaction(Date.now() + 60_000)).toBe(false);
  });

  it('moves them by itself every few seconds once registered', () => {
    const shown = chipAt(200);
    cleanups.push(registerOwnReaction(shown.emoji));
    vi.advanceTimersByTime(30_000);
    expect(shown.animate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
