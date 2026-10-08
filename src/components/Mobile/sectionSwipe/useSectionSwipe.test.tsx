import { act, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimHorizontalGesture } from '../../../hooks/horizontalGestureClaim';
import type { MobileTabKey } from '../useMobileTabNavigation';
import { SECTION_ATTR } from './sectionSwipe';
import { useSectionSwipe } from './useSectionSwipe';

// jsdom lays nothing out: the swipe falls back to the window width.
const WIDTH = 1024;
const MID_Y = 300;

let navigations: MobileTabKey[] = [];
let setCurrentRef: ((tab: MobileTabKey) => void) | null = null;

const Harness = ({
  start = 'home' as MobileTabKey,
  peekPaddingBottom = {} as Partial<Record<MobileTabKey, string>>,
  /** How long the switch takes to render (0: at once). */
  switchMs = 0,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<MobileTabKey>(start);
  setCurrentRef = setCurrent;
  useSectionSwipe(rootRef, {
    enabled: true,
    current,
    onNavigate: (tab) => {
      // Asked again for the switch still rendering: the real one is then
      // run in flushSync, and lands at once.
      const repeat = navigations[navigations.length - 1] === tab;
      navigations.push(tab);
      if (switchMs > 0 && !repeat) {
        window.setTimeout(() => setCurrent(tab), switchMs);
      } else setCurrent(tab);
    },
    peekPaddingBottom,
  });
  return (
    <div ref={rootRef} data-testid="root">
      {(['home', 'apps', 'chat'] as const).map((key) => (
        <div
          key={key}
          {...{ [SECTION_ATTR]: key }}
          // Like React does for the sections: only the current one shows.
          style={{ display: current === key ? 'flex' : 'none' }}
        >
          <div data-testid={`${key}-content`}>{key}</div>
          {key === 'home' ? (
            <div
              data-testid="carousel"
              style={{ overflowX: 'auto', width: 300 }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
};

const section = (key: string) =>
  document.querySelector<HTMLElement>(`[${SECTION_ATTR}="${key}"]`)!;

const touch = (
  type: string,
  target: Element,
  points: Array<{ x: number; y: number }>,
  timeStamp: number,
  changed = points
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = (items: typeof points) =>
    items.map((p) => ({ clientX: p.x, clientY: p.y, target }));
  Object.defineProperty(event, 'touches', { value: list(points) });
  Object.defineProperty(event, 'changedTouches', { value: list(changed) });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
};

/** A finger from x0 to x1 in 16ms steps of `step` px, then a lift. */
const drag = (
  target: Element,
  x0: number,
  x1: number,
  { t0 = 1000, step = 40, restMs = 0 } = {}
) => {
  let t = t0;
  touch('touchstart', target, [{ x: x0, y: MID_Y }], t);
  const direction = Math.sign(x1 - x0);
  let x = x0;
  while ((x1 - x) * direction > 0) {
    x = direction > 0 ? Math.min(x1, x + step) : Math.max(x1, x - step);
    t += 16;
    touch('touchmove', target, [{ x, y: MID_Y }], t);
  }
  act(() => {
    vi.advanceTimersByTime(16);
  });
  touch('touchend', target, [], t + restMs, [{ x: x1, y: MID_Y }]);
};

describe('useSectionSwipe', () => {
  beforeEach(() => {
    navigations = [];
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('slides the next section in with the finger, then switches', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('home-content');
    touch('touchstart', content, [{ x: 700, y: MID_Y }], 1000);
    touch('touchmove', content, [{ x: 680, y: MID_Y }], 1016);
    touch('touchmove', content, [{ x: 300, y: MID_Y }], 1032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // Home follows the finger; Apps is shown beside it, out of view.
    expect(section('home').style.transform).toBe('translate3d(-380px, 0, 0)');
    expect(section('apps').style.getPropertyValue('display')).toBe('flex');
    expect(section('apps').style.getPropertyPriority('display')).toBe(
      'important'
    );
    expect(section('apps').style.transform).toBe('translate3d(644px, 0, 0)');

    touch('touchend', content, [], 1040, [{ x: 300, y: MID_Y }]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(navigations).toEqual(['apps']);
    // React shows Apps; the swipe's styles are gone from it.
    expect(section('apps').style.display).toBe('flex');
    expect(section('apps').style.getPropertyPriority('display')).toBe('');
    expect(section('apps').style.transform).toBe('');
    expect(section('apps').style.position).toBe('');
    expect(section('apps')).not.toHaveAttribute('aria-hidden');
    // React hides Home; once things are quiet it is laid out and painted
    // beside Apps again (off screen), out of screen readers' way.
    expect(section('home').style.display).toBe('none');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(section('home').style.getPropertyPriority('display')).toBe(
      'important'
    );
    expect(section('home').style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(section('home')).toHaveAttribute('aria-hidden', 'true');
  });

  it('springs back from a short, slow drag', () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('home-content'), 600, 450, { step: 10, restMs: 80 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(navigations).toEqual([]);
    expect(section('home').style.transform).toBe('');
    // Apps glided back out of view and waits there, still painted.
    expect(section('apps').style.transform).toBe('translate3d(100%, 0, 0)');
    expect(section('apps')).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes a quick flick', () => {
    const { getByTestId } = render(<Harness start="apps" />);
    drag(getByTestId('apps-content'), 500, 620, { step: 60 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(navigations).toEqual(['home']);
  });

  it('rubber-bands past the first section and stays', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('home-content');
    touch('touchstart', content, [{ x: 300, y: MID_Y }], 1000);
    touch('touchmove', content, [{ x: 320, y: MID_Y }], 1016);
    touch('touchmove', content, [{ x: 800, y: MID_Y }], 1032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    const pulled = Number(
      /translate3d\(([-\d.]+)px/.exec(section('home').style.transform)?.[1]
    );
    expect(pulled).toBeGreaterThan(5);
    expect(pulled).toBeLessThan(48);
    touch('touchend', content, [], 1040, [{ x: 800, y: MID_Y }]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(navigations).toEqual([]);
    expect(section('home').style.transform).toBe('');
  });

  it('leaves carousels, screen edges and claimed swipes alone', () => {
    const { getByTestId } = render(<Harness />);
    const carousel = getByTestId('carousel');
    Object.defineProperty(carousel, 'scrollWidth', { value: 900 });
    Object.defineProperty(carousel, 'clientWidth', { value: 300 });
    drag(carousel, 700, 200, { step: 60 });
    // From the very edge: the Android back gesture's.
    drag(getByTestId('home-content'), 1015, 500, { t0: 3000, step: 60 });
    // The chat list pager took this one.
    claimHorizontalGesture(5000);
    drag(getByTestId('home-content'), 700, 200, { t0: 5000, step: 60 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(navigations).toEqual([]);
    expect(section('home').style.transform).toBe('');
  });

  it('leaves vertical scrolling alone', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('home-content');
    touch('touchstart', content, [{ x: 500, y: 200 }], 1000);
    touch('touchmove', content, [{ x: 497, y: 230 }], 1016);
    touch('touchmove', content, [{ x: 300, y: 300 }], 1032);
    touch('touchend', content, [], 1050, [{ x: 300, y: 300 }]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(navigations).toEqual([]);
    expect(section('home').style.transform).toBe('');
  });

  it('swallows the click that ends a swipe', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('home-content');
    const onClick = vi.fn();
    content.addEventListener('click', onClick);
    drag(content, 600, 450, { step: 10, restMs: 80 });
    act(() => {
      content.click();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('switches at once for a tap on the section a swipe just landed on', () => {
    const { getByTestId } = render(<Harness start="apps" switchMs={5000} />);
    drag(getByTestId('apps-content'), 800, 300, { t0: 97000 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Landed on Chat; React has not switched yet (a slow transition), but
    // Chat already takes touches (its list scrolls).
    expect(navigations).toEqual(['chat']);
    expect(section('chat').style.getPropertyPriority('display')).toBe(
      'important'
    );
    expect(section('chat').style.pointerEvents).toBe('');

    // A tap on it: the switch happens before the tap's click.
    const chat = getByTestId('chat-content');
    const onClick = vi.fn();
    chat.addEventListener('click', onClick);
    touch('touchstart', chat, [{ x: 500, y: MID_Y }], 97800);
    touch('touchend', chat, [], 97860, [{ x: 500, y: MID_Y }]);
    expect(navigations).toEqual(['chat', 'chat']);
    expect(section('chat').style.display).toBe('flex');
    expect(section('chat').style.getPropertyPriority('display')).toBe('');
    expect(section('chat').style.transform).toBe('');
    act(() => {
      chat.click();
    });
    expect(onClick).toHaveBeenCalled();
  });

  it('leaves the switch to its transition for a scroll on the new section', () => {
    const { getByTestId } = render(<Harness start="apps" switchMs={5000} />);
    drag(getByTestId('apps-content'), 800, 300, { t0: 98000 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const chat = getByTestId('chat-content');
    touch('touchstart', chat, [{ x: 500, y: 400 }], 98800);
    touch('touchmove', chat, [{ x: 502, y: 360 }], 98816);
    touch('touchend', chat, [], 98832, [{ x: 502, y: 360 }]);
    expect(navigations).toEqual(['chat']);
  });

  it('puts everything back if the section changes from elsewhere', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('home-content');
    touch('touchstart', content, [{ x: 700, y: MID_Y }], 1000);
    touch('touchmove', content, [{ x: 680, y: MID_Y }], 1016);
    touch('touchmove', content, [{ x: 400, y: MID_Y }], 1032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(section('apps').style.getPropertyPriority('display')).toBe(
      'important'
    );
    act(() => setCurrentRef?.('chat'));
    expect(section('apps').style.display).toBe('none');
    expect(section('apps').style.getPropertyPriority('display')).toBe('');
    expect(section('home').style.transform).toBe('');
  });

  it('lays the neighbours out and paints them ahead of a swipe, off screen', () => {
    const { getByTestId } = render(<Harness start="apps" />);
    // Not on the frames of a switch: only once things are quiet.
    expect(section('home').style.getPropertyValue('display')).toBe('none');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    for (const [key, at] of [
      ['home', '-100%'],
      ['chat', '100%'],
    ]) {
      const el = section(key);
      expect(el.style.getPropertyValue('display')).toBe('flex');
      expect(el.style.getPropertyPriority('display')).toBe('important');
      expect(el.style.getPropertyValue('visibility')).toBe('visible');
      expect(el.style.transform).toBe(`translate3d(${at}, 0, 0)`);
      expect(el.style.pointerEvents).toBe('none');
      expect(el).toHaveAttribute('aria-hidden', 'true');
    }

    // A swipe towards Chat only moves it in beside Apps.
    const content = getByTestId('apps-content');
    // (A timestamp no other test claimed: claims are shared.)
    touch('touchstart', content, [{ x: 700, y: MID_Y }], 91000);
    touch('touchmove', content, [{ x: 680, y: MID_Y }], 91016);
    touch('touchmove', content, [{ x: 300, y: MID_Y }], 91032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(section('chat').style.transform).toBe(
      `translate3d(${WIDTH - 380}px, 0, 0)`
    );
    touch('touchend', content, [], 91300, [{ x: 300, y: MID_Y }]);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(navigations).toEqual(['chat']);
    // Chat is current now: nothing of the swipe is left on it.
    expect(section('chat').style.getPropertyValue('visibility')).toBe('');
    expect(section('chat').style.transform).toBe('');
    expect(section('chat')).not.toHaveAttribute('aria-hidden');
    // Apps, just left, and Home, two away, are React's (hidden) again...
    expect(section('apps').style.display).toBe('none');
    expect(section('home').style.display).toBe('none');
    expect(section('home').style.getPropertyPriority('display')).toBe('');
    expect(section('home')).not.toHaveAttribute('aria-hidden');
    // ...and Apps waits beside Chat once things are quiet.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(section('apps').style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(section('home').style.display).toBe('none');
  });

  it('parks around a section a tap on the buttons went to', () => {
    render(<Harness start="home" />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // Home's neighbour, Apps, waits on its right.
    expect(section('apps').style.transform).toBe('translate3d(100%, 0, 0)');

    // Straight to Chat: Apps, beside it still, stays parked (on its other
    // side now); Home is React's again.
    act(() => setCurrentRef?.('chat'));
    expect(section('apps').style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(section('apps')).toHaveAttribute('aria-hidden', 'true');
    expect(section('home').style.display).toBe('none');

    // Back to Apps: React's own again; Chat, just hidden, and Home are
    // parked once things are quiet.
    act(() => setCurrentRef?.('apps'));
    expect(section('apps').style.transform).toBe('');
    expect(section('apps')).not.toHaveAttribute('aria-hidden');
    expect(section('chat').style.display).toBe('none');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(section('chat').style.transform).toBe('translate3d(100%, 0, 0)');
    expect(section('home').style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('gives a waiting section the bottom room it will have once current', () => {
    render(<Harness start="home" peekPaddingBottom={{ apps: '76px' }} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(section('apps').style.paddingBottom).toBe('76px');
    expect(section('apps').style.boxSizing).toBe('border-box');
    // Switched to by the buttons: React's layout again, nothing left over.
    act(() => setCurrentRef?.('apps'));
    expect(section('apps').style.paddingBottom).toBe('');
  });

  it('switches from a swipe along the bottom bar, even with the screen swipe off', () => {
    const BarHarness = () => {
      const rootRef = useRef<HTMLDivElement | null>(null);
      const [bar, setBar] = useState<HTMLDivElement | null>(null);
      const [current, setCurrent] = useState<MobileTabKey>('apps');
      useSectionSwipe(rootRef, {
        // A Q-App owns the screen's swipes...
        enabled: false,
        // ...the bar's are still ours.
        bar,
        barEnabled: true,
        current,
        onNavigate: (tab) => {
          navigations.push(tab);
          setCurrent(tab);
        },
      });
      return (
        <>
          <div ref={rootRef}>
            {(['home', 'apps', 'chat'] as const).map((key) => (
              <div
                key={key}
                {...{ [SECTION_ATTR]: key }}
                style={{ display: current === key ? 'flex' : 'none' }}
              >
                <div data-testid={`${key}-content`}>{key}</div>
              </div>
            ))}
          </div>
          <div ref={setBar} data-testid="bar">
            <button type="button">Home</button>
          </div>
        </>
      );
    };
    const { getByTestId, getByText } = render(<BarHarness />);

    // On the screen itself: nothing (the Q-App's).
    drag(getByTestId('apps-content'), 700, 200, { t0: 93000 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(navigations).toEqual([]);

    // Along the bar, from a button: on to Chat.
    drag(getByText('Home'), 700, 200, { t0: 94000 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(navigations).toEqual(['chat']);
  });

  it('takes a quick second swipe that starts while the first still glides', () => {
    const { getByTestId } = render(<Harness start="home" />);
    // First swipe: Home towards Apps, let go mid-way (it glides on).
    const home = getByTestId('home-content');
    touch('touchstart', home, [{ x: 800, y: MID_Y }], 95000);
    touch('touchmove', home, [{ x: 780, y: MID_Y }], 95016);
    touch('touchmove', home, [{ x: 400, y: MID_Y }], 95032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    touch('touchend', home, [], 95040, [{ x: 400, y: MID_Y }]);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(navigations).toEqual([]);

    // The finger is back before the glide ends: Apps lands at once, and
    // the new swipe goes on from it, to Chat.
    const apps = getByTestId('apps-content');
    touch('touchstart', apps, [{ x: 800, y: MID_Y }], 95200);
    expect(navigations).toEqual(['apps']);
    touch('touchmove', apps, [{ x: 780, y: MID_Y }], 95216);
    touch('touchmove', apps, [{ x: 400, y: MID_Y }], 95232);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    touch('touchend', apps, [], 95240, [{ x: 400, y: MID_Y }]);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(navigations).toEqual(['apps', 'chat']);
    expect(section('chat').style.transform).toBe('');
  });
  it('keeps a next swipe under the finger when the last switch lands mid-drag', () => {
    const { getByTestId } = render(<Harness start="home" switchMs={300} />);
    const home = getByTestId('home-content');
    drag(home, 800, 300, { t0: 96000 });
    // Landed on Apps; React takes a while to switch.
    for (let i = 0; i < 50 && navigations.length === 0; i += 1) {
      act(() => {
        vi.advanceTimersByTime(10);
      });
    }
    expect(navigations).toEqual(['apps']);
    expect(section('apps').style.getPropertyPriority('display')).toBe(
      'important'
    );

    // The next swipe, towards Chat, while that switch still renders.
    const apps = getByTestId('apps-content');
    touch('touchstart', apps, [{ x: 800, y: MID_Y }], 96600);
    touch('touchmove', apps, [{ x: 780, y: MID_Y }], 96616);
    touch('touchmove', apps, [{ x: 300, y: MID_Y }], 96632);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    const dragged = section('apps').style.transform;
    expect(dragged).toBe('translate3d(-480px, 0, 0)');

    // The switch lands: the sections stay where the finger has them.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(section('apps').style.display).not.toBe('none');
    expect(section('apps').style.transform).toBe(dragged);
    expect(section('chat').style.transform).toBe(
      `translate3d(${WIDTH - 480}px, 0, 0)`
    );
    touch('touchend', apps, [], 96900, [{ x: 300, y: MID_Y }]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(navigations).toEqual(['apps', 'chat']);
  });
});
