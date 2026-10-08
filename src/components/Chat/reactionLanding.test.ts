import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelReactionLanding,
  planReveal,
  playReactionLanding,
  requestReactionLanding,
  revealInScrollParent,
  takeReactionLanding,
} from './reactionLanding';

const rect = (top: number, height: number) =>
  ({
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe('reaction landing', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('hands a waiting flight to the chip once', () => {
    requestReactionLanding('sig-1', '🔥', { x: 10, y: 20, size: 28 });
    expect(takeReactionLanding('sig-1', '👍')).toBeNull();
    expect(takeReactionLanding('sig-1', '🔥')?.source).toEqual({
      x: 10,
      y: 20,
      size: 28,
    });
    expect(takeReactionLanding('sig-1', '🔥')).toBeNull();
  });

  it('forgets a flight that never landed', () => {
    vi.useFakeTimers();
    requestReactionLanding('sig-2', '🔥', { x: 0, y: 0, size: 28 });
    vi.advanceTimersByTime(5_000);
    expect(takeReactionLanding('sig-2', '🔥')).toBeNull();
    requestReactionLanding('sig-3', '🔥', { x: 0, y: 0, size: 28 });
    cancelReactionLanding('sig-3', '🔥');
    expect(takeReactionLanding('sig-3', '🔥')).toBeNull();
  });

  it('never plans to scroll past the end of the chat', () => {
    const list = document.createElement('div');
    list.style.overflowY = 'auto';
    const chip = document.createElement('button');
    list.appendChild(chip);
    document.body.appendChild(list);
    Object.defineProperty(list, 'scrollHeight', { value: 1000 });
    Object.defineProperty(list, 'clientHeight', { value: 500 });
    list.scrollTop = 490;
    list.getBoundingClientRect = () => rect(100, 500);
    chip.getBoundingClientRect = () => rect(580, 36);
    expect(planReveal(chip)?.delta).toBe(10);
  });

  it('scrolls the chat just enough to show a chip below the fold', () => {
    const list = document.createElement('div');
    list.style.overflowY = 'auto';
    const chip = document.createElement('button');
    list.appendChild(chip);
    document.body.appendChild(list);
    Object.defineProperty(list, 'scrollHeight', { value: 2000 });
    Object.defineProperty(list, 'clientHeight', { value: 500 });
    list.scrollTop = 300;
    list.getBoundingClientRect = () => rect(100, 500);
    chip.getBoundingClientRect = () => rect(580, 36);
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy as unknown as typeof list.scrollBy;
    expect(revealInScrollParent(chip)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 580 + 36 + 14 - 600 })
    );
    // Already in view: nothing moves.
    scrollBy.mockClear();
    chip.getBoundingClientRect = () => rect(300, 36);
    expect(revealInScrollParent(chip)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('the flight into the chip', () => {
  type FakeAnimation = {
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    finished: Promise<void>;
    finish: () => void;
    cancel: ReturnType<typeof vi.fn>;
  };
  const original = HTMLElement.prototype.animate;
  let started: FakeAnimation[] = [];
  let autoFinish = true;

  beforeEach(() => {
    started = [];
    autoFinish = true;
    HTMLElement.prototype.animate = function (
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions
    ) {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const animation = {
        keyframes,
        options,
        finished,
        finish,
        cancel: vi.fn(),
      };
      started.push(animation);
      if (autoFinish) finish();
      return animation as unknown as Animation;
    } as typeof HTMLElement.prototype.animate;
  });

  afterEach(() => {
    HTMLElement.prototype.animate = original;
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const chipWithEmoji = () => {
    const chip = document.createElement('button');
    const emoji = document.createElement('span');
    chip.appendChild(emoji);
    document.body.appendChild(chip);
    emoji.getBoundingClientRect = () => rect(400, 18);
    return { chip, emoji };
  };

  it('takes off at the tap and flies on from there without a jump', async () => {
    requestReactionLanding('sig-f', '🔥', { x: 100, y: 200, size: 28 });
    // Lifted off the pill right away.
    expect(document.querySelector('[data-reaction-landing]')).not.toBeNull();
    expect(started[0].keyframes.at(-1)?.transform).toBe(
      'translate(0px, -8px) scale(1.18)'
    );
    const flight = takeReactionLanding('sig-f', '🔥');
    const { chip, emoji } = chipWithEmoji();
    playReactionLanding({
      chip,
      emojiNode: emoji,
      flight: flight!,
      colors: { ring: 'blue', sparks: ['blue'] },
      appear: true,
    });
    // Hidden until it lands, so it is never seen in two places.
    expect(emoji.style.visibility).toBe('hidden');
    expect(chip.style.opacity).toBe('0');
    await vi.waitFor(() =>
      expect(started.some((a) => a.keyframes.length > 20)).toBe(true)
    );
    const path = started.find((a) => a.keyframes.length > 20)!;
    expect(path.keyframes[0].transform).toBe(
      'translate(0.00px, -8.00px) rotate(0.00deg) scale(1.1800)'
    );
    // Lands on the chip's emoji (centre 50, 409), at its size.
    expect(path.keyframes.at(-1)?.transform).toMatch(
      /^translate\(-50\.00px, 209\.00px\) rotate\(-?0\.00deg\) scale\(0\.6429\)$/
    );
    await vi.waitFor(() => expect(emoji.style.visibility).toBe(''));
    expect(chip.style.opacity).toBe('');
    expect(
      document.querySelector('[data-reaction-landing] div > span')
    ).toBeNull();
  });

  it('shows the emoji anyway when the animation never ends', async () => {
    vi.useFakeTimers();
    autoFinish = false;
    requestReactionLanding('sig-g', '🔥', { x: 100, y: 200, size: 28 });
    const flight = takeReactionLanding('sig-g', '🔥');
    const { chip, emoji } = chipWithEmoji();
    playReactionLanding({
      chip,
      emojiNode: emoji,
      flight: flight!,
      colors: { ring: 'blue', sparks: ['blue'] },
    });
    expect(emoji.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(3_000);
    expect(emoji.style.visibility).toBe('');
    expect(document.querySelector('[data-reaction-landing]')).toBeNull();
  });
});
