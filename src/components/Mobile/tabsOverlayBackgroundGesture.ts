/**
 * Decides what a touch outside the Tabs panel does.
 *
 * Touching the app behind the panel closes it. But when the panel holds a
 * long, scrolling list it reaches down to a thin strip right above the bottom
 * tab bar, and the overlay's transparent backdrop covers both the strip and
 * the tab bar. A swipe from there is aimed at the list, so it is left to the
 * list's own swipe (useTabsSwipeClose: a small one scrolls the list, a big
 * one closes). A tap there still closes it (the backdrop's click).
 */
interface BackgroundGestureOptions {
  getPanel: () => HTMLElement | null;
  /** The panel's scrolling list of apps. */
  getList: () => HTMLElement | null;
  /** Touches inside these (dialogs, the panel) are never background. */
  isExempt: (target: EventTarget | null) => boolean;
  onClose: () => void;
}

export const createBackgroundGesture = ({
  getPanel,
  getList,
  isExempt,
  onClose,
}: BackgroundGestureOptions) => {
  /** Set while a swipe below the panel belongs to the list. */
  let leftToList = false;

  const onTouchStart = (event: TouchEvent) => {
    leftToList = false;
    if (isExempt(event.target)) return;
    const touch = event.touches[0];
    const panel = getPanel();
    const list = getList();
    if (!touch || !panel || !list) return;
    const canScroll = list.scrollHeight > list.clientHeight + 1;
    if (canScroll && touch.clientY >= panel.getBoundingClientRect().bottom) {
      leftToList = true;
    }
  };

  const onTouchMove = (event: TouchEvent) => {
    if (isExempt(event.target) || leftToList) return;
    onClose();
  };

  const onTouchEnd = () => {
    leftToList = false;
  };

  const onWheel = (event: Event) => {
    if (isExempt(event.target)) return;
    onClose();
  };

  return { onTouchEnd, onTouchMove, onTouchStart, onWheel };
};
