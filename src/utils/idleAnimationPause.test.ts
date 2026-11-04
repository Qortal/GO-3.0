import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform', () => ({ isCapacitor: () => true }));

type FakeAnimation = {
  animationName?: string;
  playState: AnimationPlayState;
  currentTime: number | null;
  playbackRate: number;
  effect: {
    getTiming: () => { iterations: number };
    getComputedTiming: () => { endTime: number };
  } | null;
  play: ReturnType<typeof vi.fn>;
};

const fakeAnimation = ({
  css = true,
  iterations,
  playState,
  currentTime = 0,
  endTime = 720,
}: {
  css?: boolean;
  iterations: number;
  playState: AnimationPlayState;
  currentTime?: number | null;
  endTime?: number;
}): FakeAnimation => {
  const animation: FakeAnimation = {
    ...(css ? { animationName: 'anim' } : {}),
    playState,
    currentTime,
    playbackRate: 1,
    effect: {
      getTiming: () => ({ iterations }),
      getComputedTiming: () => ({ endTime }),
    },
    play: vi.fn(),
  };
  animation.play.mockImplementation(() => {
    animation.playState = 'running';
  });
  return animation;
};

const IDLE_ATTR = 'data-hub-ui-idle';
let animations: FakeAnimation[] = [];

const install = async () => {
  vi.resetModules();
  const mod = await import('./idleAnimationPause');
  mod.installIdleAnimationPause();
  return mod;
};

describe('installIdleAnimationPause', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    animations = [];
    (
      document as unknown as { getAnimations: () => FakeAnimation[] }
    ).getAnimations = () => animations;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    document.documentElement.removeAttribute(IDLE_ATTR);
    document.getElementById('hub-ui-idle-animations')?.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('marks the document idle after 10 s without input and clears it on input', async () => {
    await install();
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
    window.dispatchEvent(new Event('pointerdown'));
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBeNull();
  });

  it('lets finite CSS animations finish when the document goes idle, and only those', async () => {
    const entrance = fakeAnimation({ iterations: 1, playState: 'paused' });
    const loop = fakeAnimation({ iterations: Infinity, playState: 'paused' });
    const finished = fakeAnimation({ iterations: 1, playState: 'finished' });
    const waapi = fakeAnimation({
      css: false,
      iterations: 1,
      playState: 'paused',
    });
    animations = [entrance, loop, finished, waapi];
    await install();
    vi.advanceTimersByTime(10_000);
    expect(entrance.play).toHaveBeenCalledTimes(1);
    expect(loop.play).not.toHaveBeenCalled();
    expect(finished.play).not.toHaveBeenCalled();
    expect(waapi.play).not.toHaveBeenCalled();
  });

  it('does not replay an entrance the idle rule paused on its last frame', async () => {
    // The dashboard fade (fill: both) is paused at its end when the document
    // goes idle; play() would rewind it to opacity 0: a black flash.
    const done = fakeAnimation({
      iterations: 1,
      playState: 'paused',
      currentTime: 720,
      endTime: 720,
    });
    const halfway = fakeAnimation({
      iterations: 1,
      playState: 'paused',
      currentTime: 300,
      endTime: 720,
    });
    animations = [done, halfway];
    await install();
    vi.advanceTimersByTime(10_000);
    expect(done.play).not.toHaveBeenCalled();
    expect(halfway.play).toHaveBeenCalledTimes(1);
    // A later entrance starting while idle must not replay it either.
    document.body.dispatchEvent(new Event('animationstart', { bubbles: true }));
    expect(done.play).not.toHaveBeenCalled();
  });

  it('plays a finite animation that starts while idle (the post-login dashboard fade)', async () => {
    await install();
    vi.advanceTimersByTime(10_000);
    const dashboard = fakeAnimation({ iterations: 1, playState: 'paused' });
    const loop = fakeAnimation({ iterations: Infinity, playState: 'paused' });
    animations = [dashboard, loop];
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.dispatchEvent(new Event('animationstart', { bubbles: true }));
    expect(dashboard.play).toHaveBeenCalledTimes(1);
    expect(loop.play).not.toHaveBeenCalled();
    el.remove();
  });

  it('does nothing on animationstart while the user is active', async () => {
    await install();
    const entrance = fakeAnimation({ iterations: 1, playState: 'running' });
    animations = [entrance];
    document.body.dispatchEvent(new Event('animationstart', { bubbles: true }));
    expect(entrance.play).not.toHaveBeenCalled();
  });

  it('keeps loops frozen through input while held, then hands back to the idle timer', async () => {
    const mod = await install();
    mod.holdAnimationPause('qortino', true);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
    // Input, through this module only: earlier tests' copies still listen on window.
    mod.noteIdlePauseActivity();
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
    mod.holdAnimationPause('qortino', false);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
  });

  it('stays paused when a hold ends while the user is idle anyway', async () => {
    const mod = await install();
    vi.advanceTimersByTime(10_000);
    mod.holdAnimationPause('qortino', true);
    mod.holdAnimationPause('qortino', false);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
  });

  it('lets entrances finish when a hold starts', async () => {
    const entrance = fakeAnimation({ iterations: 1, playState: 'paused' });
    const loop = fakeAnimation({ iterations: Infinity, playState: 'paused' });
    animations = [entrance, loop];
    const mod = await install();
    mod.holdAnimationPause('qortino', true);
    expect(entrance.play).toHaveBeenCalledTimes(1);
    expect(loop.play).not.toHaveBeenCalled();
  });

  it('noteIdlePauseActivity counts as input', async () => {
    const mod = await install();
    vi.advanceTimersByTime(10_000);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
    mod.noteIdlePauseActivity();
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(document.documentElement.getAttribute(IDLE_ATTR)).toBe('on');
  });
});
