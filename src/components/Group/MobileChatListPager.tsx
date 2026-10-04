import { Box, useMediaQuery } from '@mui/material';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PAGER_SCROLLER_ATTR } from '../../hooks/horizontalPagerSwipe';
import { useHorizontalPagerSwipe } from '../../hooks/useHorizontalPagerSwipe';
import type { ChatScope } from './ChatScopeSwitch';

/** Left to right, as on the Groups / DMs switch. */
const PAGE_SCOPES: readonly ChatScope[] = ['groups', 'directs'];
/** The page beside the one showing is built this long after the lists come
 * up (and once the phone is idle), so it never slows the list sliding in. */
const NEIGHBOR_WARM_DELAY_MS = 250;
/** ...and dropped this long after a chat covers the lists, never on the
 * tap that opens the chat. */
const NEIGHBOR_COOL_DELAY_MS = 600;

/**
 * The phone lists swipe between Groups and DMs only on the full-screen
 * Q-Chat home: not over an open chat (the list swiped in from the edge has
 * its own swipe to close) and not while the Q-Chat surface is hidden.
 */
export function isChatListSwipeEnabled({
  inChatDetail,
  isVisible,
}: {
  inChatDetail: boolean;
  isVisible: boolean;
}): boolean {
  return isVisible && !inChatDetail;
}

/** Runs `run` after `delayMs`, at the next idle moment. Returns a cancel. */
function afterDelayWhenIdle(run: () => void, delayMs: number): () => void {
  let idle: number | null = null;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(run, { timeout: 1000 });
    } else {
      run();
    }
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    if (idle !== null) window.cancelIdleCallback?.(idle);
  };
}

export interface MobileChatListPagerProps {
  /** The full-screen home lists: pages side by side, swipe on. Off (the
   * list swiped in over a chat, or covered by one) only the list in `scope`
   * shows, exactly as without the pager. */
  swipeEnabled: boolean;
  scope: ChatScope;
  /** What the Groups / DMs switch calls. A swipe calls nothing else. */
  onScopeChange: (scope: ChatScope) => void;
  /** The Groups page. `beside`: it also has to show its list while DMs are
   * the current scope, because it sits right beside them. */
  renderGroups: (beside: boolean) => ReactNode;
  /** The DMs page. `mounted`: whether to render it at all. */
  renderDirects: (mounted: boolean) => ReactNode;
}

/**
 * The phone Q-Chat lists as two pages, Groups on the left and DMs on the
 * right like the switch above them. On the home screen a sideways swipe
 * drags the pages with the finger and, past about a quarter of the width
 * or with a flick, lands on the other list through the switch's own
 * `onChange`, so everything else behaves exactly as for a tap on the switch
 * (which now slides the pages too).
 *
 * The list out of view is built shortly after the home screen comes up and
 * then stays mounted (keeping its scroll position); a drag only changes the
 * track's transform. The page out of view is inert.
 */
export function MobileChatListPager({
  onScopeChange,
  renderDirects,
  renderGroups,
  scope,
  swipeEnabled,
}: MobileChatListPagerProps) {
  const page = scope === 'directs' ? 1 : 0;
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', {
    noSsr: true,
  });
  // Whether the page out of view is built and laid out beside this one.
  const [neighborReady, setNeighborReady] = useState(false);

  useEffect(() => {
    if (neighborReady === swipeEnabled) return;
    return afterDelayWhenIdle(
      () => setNeighborReady(swipeEnabled),
      swipeEnabled ? NEIGHBOR_WARM_DELAY_MS : NEIGHBOR_COOL_DELAY_MS
    );
  }, [neighborReady, swipeEnabled]);

  const onScopeChangeRef = useRef(onScopeChange);
  onScopeChangeRef.current = onScopeChange;
  const handlePageChange = useCallback((next: number) => {
    const nextScope = PAGE_SCOPES[next];
    if (nextScope) onScopeChangeRef.current(nextScope);
  }, []);
  // A swipe that beats the warm-up builds the other list at once.
  const handleDragStart = useCallback(() => setNeighborReady(true), []);

  useHorizontalPagerSwipe(viewportRef, trackRef, {
    animatePageChange: neighborReady,
    enabled: swipeEnabled,
    onDragStart: handleDragStart,
    onPageChange: handlePageChange,
    page,
    pageCount: PAGE_SCOPES.length,
    reducedMotion,
  });

  const pageSx = (index: number) => {
    const current = index === page;
    return {
      // Side by side every page keeps its place in the row, built or not,
      // so the track's -100% always lands on the DM page.
      display: current || swipeEnabled ? 'flex' : 'none',
      flex: '0 0 100%',
      height: '100%',
      minHeight: 0,
      minWidth: 0,
      position: 'relative' as const,
      visibility: current || neighborReady ? 'visible' : 'hidden',
      width: '100%',
    };
  };

  const scrollerSelector = `[${PAGER_SCROLLER_ATTR}]`;

  return (
    <Box
      ref={viewportRef}
      data-chat-list-pager={swipeEnabled ? 'swipe' : 'single'}
      sx={{
        display: 'flex',
        flex: '1 1 auto',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        // clip, not hidden: nothing can scroll the pages sideways.
        overflow: 'clip',
        position: 'relative',
        width: '100%',
        ...(swipeEnabled
          ? {
              // The browser keeps vertical scrolling and never starts one
              // for a sideways swipe. Lists are scroll containers, which
              // re-enable panning for their content, so they (and their
              // direct children) are marked too.
              touchAction: 'pan-y',
              [`& ${scrollerSelector}, & ${scrollerSelector} > *`]: {
                touchAction: 'pan-y',
              },
            }
          : {}),
      }}
    >
      <Box
        ref={trackRef}
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          willChange: swipeEnabled ? 'transform' : undefined,
        }}
      >
        {/* The page out of view is inert: no taps, focus or screen
            reader. */}
        <Box data-chat-list-page="groups" inert={page !== 0} sx={pageSx(0)}>
          {renderGroups(neighborReady)}
        </Box>
        <Box data-chat-list-page="directs" inert={page !== 1} sx={pageSx(1)}>
          {renderDirects(page === 1 || neighborReady)}
        </Box>
      </Box>
    </Box>
  );
}
