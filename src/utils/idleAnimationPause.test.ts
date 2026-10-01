import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform', () => ({ isCapacitor: () => true }));

type FakeAnimation = {
  animationName?: string;
  playState: AnimationPlayState;
  effect: { getTiming: () => { iterations: number } } | null;
  play: ReturnType<typeof vi.fn>;
};

const fakeAnimation = ({
  css = true,
  iterations,
  playState,
}: {
  css?: boolean;
  iterations: number;
  playState: AnimationPlayState;
}): FakeAnimation => {
  const animation: FakeAnimation = {
    ...(css ? { animationName: 'anim' } : {}),
    playState,
    effect: { getTiming: () => ({ iterations }) },
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
