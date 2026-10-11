import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QortinoZoomableBox,
  type QortinoZoomableBoxControl,
} from './QortinoZoomableBox';

// A whole A4 page fitted into a phone held sideways (873x393): the page is
// far smaller than the box it sits in.
const BOX = { width: 865, height: 245 };
const PAGE = { width: 165, height: 233 };
const CENTRE = { x: BOX.width / 2, y: BOX.height / 2 };

const touch = (x: number, y: number) => ({ clientX: x, clientY: y });

function tap(target: HTMLElement, x = CENTRE.x, y = CENTRE.y) {
  fireEvent.touchStart(target, { touches: [touch(x, y)] });
  fireEvent.touchEnd(target, { touches: [] });
}

function doubleTap(target: HTMLElement) {
  tap(target);
  act(() => vi.advanceTimersByTime(120));
  tap(target);
  act(() => vi.advanceTimersByTime(400));
}

function drag(target: HTMLElement, dx: number, dy: number) {
  fireEvent.touchStart(target, { touches: [touch(CENTRE.x, CENTRE.y)] });
  fireEvent.touchMove(target, {
    touches: [touch(CENTRE.x + dx, CENTRE.y + dy)],
  });
  act(() => vi.advanceTimersByTime(20));
  fireEvent.touchEnd(target, { touches: [] });
  act(() => vi.advanceTimersByTime(400));
}

function pinch(target: HTMLElement, from: number, to: number) {
  const { x, y } = CENTRE;
  fireEvent.touchStart(target, {
    touches: [touch(x - from / 2, y), touch(x + from / 2, y)],
  });
  fireEvent.touchMove(target, {
    touches: [touch(x - to / 2, y), touch(x + to / 2, y)],
  });
  act(() => vi.advanceTimersByTime(20));
  fireEvent.touchEnd(target, { touches: [] });
}

const transformOf = (el: HTMLElement) => {
  const m =
    /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) scale\(([\d.]+)\)/.exec(
      el.style.transform
    );
  return m
    ? { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) }
    : { x: 0, y: 0, scale: 1 };
};

describe('QortinoZoomableBox fitted content', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (props: {
    maxZoom?: number;
    doubleTapScale?: number;
    clampToContent?: boolean;
  }) => {
    const controlRef = createRef<QortinoZoomableBoxControl>();
    const { unmount } = render(
      <QortinoZoomableBox controlRef={controlRef} {...props}>
        <div data-testid="page">page</div>
      </QortinoZoomableBox>
    );
    const page = screen.getByTestId('page');
    const content = page.parentElement!;
    const box = content.parentElement!;
    box.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: BOX.width,
        bottom: BOX.height,
        x: 0,
        y: 0,
        ...BOX,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(content, 'offsetWidth', {
      configurable: true,
      value: PAGE.width,
    });
    Object.defineProperty(content, 'offsetHeight', {
      configurable: true,
      value: PAGE.height,
    });
    return { page, content, controlRef, unmount };
  };

  it('double taps to the scale it is given', () => {
    const { page, content } = setup({ doubleTapScale: 5.1 });
    doubleTap(page);
    expect(transformOf(content).scale).toBe(5.1);
  });

  it('pinches up to the limit it is given, and to 5 without one', () => {
    const custom = setup({ maxZoom: 25 });
    pinch(custom.page, 20, 2000);
    expect(transformOf(custom.content).scale).toBe(25);
    custom.unmount();

    const plain = setup({});
    pinch(plain.page, 20, 2000);
    expect(transformOf(plain.content).scale).toBe(5);
  });

  it('keeps small content in view when clamped to it', () => {
    const { page, content } = setup({ clampToContent: true });
    doubleTap(page);
    expect(transformOf(content).scale).toBe(2.5);
    // 412 px wide in an 865 px box: it stays centred sideways.
    drag(page, 700, 0);
    expect(transformOf(content).x).toBe(0);
    // 583 px tall in a 245 px box: it moves until its edge meets the box's.
    drag(page, 0, 900);
    expect(transformOf(content).y).toBeCloseTo(
      (PAGE.height * 2.5 - BOX.height) / 2,
      6
    );
  });

  it('lets small content leave the view without the clamp (as before)', () => {
    const { page, content } = setup({});
    doubleTap(page);
    drag(page, 700, 0);
    expect(transformOf(content).x).toBeCloseTo((BOX.width * 1.5) / 2, 6);
  });

  it('keeps zoomed-in content the same size on screen when resized', () => {
    const { page, content, controlRef } = setup({ clampToContent: true });
    doubleTap(page);
    act(() => controlRef.current!.contentResized(0.5));
    expect(transformOf(content).scale).toBe(5);
    act(() => controlRef.current!.contentResized(2));
    expect(transformOf(content).scale).toBe(2.5);
  });

  it('back at fit after a resize, the zoom resets', () => {
    const { page, content, controlRef } = setup({});
    doubleTap(page);
    act(() => controlRef.current!.contentResized(3));
    expect(transformOf(content)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('a resize at fit changes nothing', () => {
    const { content, controlRef } = setup({});
    const before = content.style.transform;
    act(() => controlRef.current!.contentResized(1.6));
    act(() => controlRef.current!.contentResized(NaN));
    act(() => controlRef.current!.contentResized(0));
    expect(content.style.transform).toBe(before);
  });
});
