import { describe, expect, it, vi } from 'vitest';
import { createBackgroundGesture } from './tabsOverlayBackgroundGesture';

const PANEL_BOTTOM = 700;

const setup = ({ listScrolls }: { listScrolls: boolean }) => {
  const panel = document.createElement('div');
  const list = document.createElement('div');
  const inside = document.createElement('button');
  const backdrop = document.createElement('div');
  panel.append(list);
  list.append(inside);
  document.body.append(panel, backdrop);
  panel.getBoundingClientRect = () => ({ bottom: PANEL_BOTTOM }) as DOMRect;
  Object.defineProperty(list, 'clientHeight', { value: 500 });
  Object.defineProperty(list, 'scrollHeight', {
    value: listScrolls ? 2000 : 500,
  });
  list.scrollTop = 600;
  const onClose = vi.fn();
  const gesture = createBackgroundGesture({
    getList: () => list,
    getPanel: () => panel,
    isExempt: (target) => target instanceof Node && panel.contains(target),
    onClose,
  });
  const touch = (target: Element, clientY: number) =>
    ({ target, touches: [{ clientY }] }) as unknown as TouchEvent;
  return { backdrop, gesture, inside, list, onClose, touch };
};

describe('createBackgroundGesture', () => {
  it('leaves a swipe below a long list to the list', () => {
    const { backdrop, gesture, list, onClose, touch } = setup({
      listScrolls: true,
    });
    gesture.onTouchStart(touch(backdrop, 760));
    gesture.onTouchMove(touch(backdrop, 700));
    gesture.onTouchMove(touch(backdrop, 650));

    expect(onClose).not.toHaveBeenCalled();
    // The list's own swipe (useTabsSwipeClose) scrolls it, not this.
    expect(list.scrollTop).toBe(600);
  });

  it('still closes for a swipe on the app behind a short panel', () => {
    const { backdrop, gesture, onClose, touch } = setup({ listScrolls: false });
    gesture.onTouchStart(touch(backdrop, 760));
    gesture.onTouchMove(touch(backdrop, 700));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes for a swipe that starts above the panel', () => {
    const { backdrop, gesture, onClose, touch } = setup({ listScrolls: true });
    gesture.onTouchStart(touch(backdrop, 40));
    gesture.onTouchMove(touch(backdrop, 90));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores touches inside the panel', () => {
    const { gesture, inside, list, onClose, touch } = setup({
      listScrolls: true,
    });
    gesture.onTouchStart(touch(inside, 300));
    gesture.onTouchMove(touch(inside, 200));

    expect(onClose).not.toHaveBeenCalled();
    expect(list.scrollTop).toBe(600);
  });

  it('forgets the swipe once the finger lifts', () => {
    const { backdrop, gesture, onClose, touch } = setup({ listScrolls: true });
    gesture.onTouchStart(touch(backdrop, 760));
    gesture.onTouchEnd();
    gesture.onTouchMove(touch(backdrop, 700));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
