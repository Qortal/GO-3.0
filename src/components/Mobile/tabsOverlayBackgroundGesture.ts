/**
 * Decides what a touch outside the Tabs panel does.
 *
 * Touching the app behind the panel closes it. But when the panel holds a
 * long, scrolling list it reaches down to a thin strip right above the bottom
 * tab bar, and the overlay's transparent backdrop covers both the strip and
 * the tab bar. A swipe up from there is aimed at the list, so it scrolls the
 * list instead of closing the panel. A tap there still closes it (the
 * backdrop's click).
 */
export interface BackgroundGestureOptions {
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
  /** Last finger position while a swipe below the panel scrolls the list. */
  let scrollingFromY: number | null = null;

  const onTouchStart = (event: TouchEvent) => {
    scrollingFromY = null;
    if (isExempt(event.target)) return;
    const touch = event.touches[0];
    const panel = getPanel();
    const list = getList();
    if (!touch || !panel || !list) return;
    const canScroll = list.scrollHeight > list.clientHeight + 1;
    if (canScroll && touch.clientY >= panel.getBoundingClientRect().bottom) {
      scrollingFromY = touch.clientY;
    }
  };

  const onTouchMove = (event: TouchEvent) => {
    if (isExempt(event.target)) return;
    const touch = event.touches[0];
    const list = getList();
    if (scrollingFromY != null && touch && list) {
      list.scrollTop -= touch.clientY - scrollingFromY;
      scrollingFromY = touch.clientY;
      return;
    }
    onClose();
  };

  const onTouchEnd = () => {
    scrollingFromY = null;
  };

  const onWheel = (event: Event) => {
    if (isExempt(event.target)) return;
    onClose();
  };

  return { onTouchEnd, onTouchMove, onTouchStart, onWheel };
};
