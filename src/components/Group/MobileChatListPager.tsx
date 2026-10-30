import { Box, useMediaQuery } from '@mui/material';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  PAGER_SCROLLER_ATTR,
  PAGER_SLIDE_EASING,
} from '../../hooks/horizontalPagerSwipe';
import {
  useHorizontalPagerSwipe,
  type TrackPositionListener,
} from '../../hooks/useHorizontalPagerSwipe';
import { CHAT_SCOPES, type ChatScope } from './ChatScopeSwitch';
import {
  SECTION_SURFACE_TOUCH_ACTION,
  SECTION_SWIPE_COOPERATIVE_ATTR,
} from '../Mobile/sectionSwipe/sectionSwipe';

/** The page beside the one showing is built this long after the lists come
 * up (and once the phone is idle), so it never slows the list sliding in. */
const NEIGHBOR_WARM_DELAY_MS = 250;
/** ...and dropped this long after a chat covers the lists, never on the
 * tap that opens the chat. */
const NEIGHBOR_COOL_DELAY_MS = 600;

/**
 * The phone lists swipe between Groups and DMs only on the full-screen
 * Q-Chat home: not over an open chat (the list swiped in from the edge has
 * its own swipe to close) and not while the Q-Chat surface is hidden. A list
 * pinned beside the chat (GO two-pane) keeps its swipes.
 */
export function isChatListSwipeEnabled({
  inChatDetail,
  isVisible,
  twoPane = false,
}: {
  inChatDetail: boolean;
  isVisible: boolean;
  twoPane?: boolean;
}): boolean {
  return isVisible && (twoPane || !inChatDetail);
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

interface MobileChatListPagerProps {
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
  /** Where the pages are while they move (0 = Groups, 1 = DMs), for the
   * header above them. */
  onTrackPosition?: TrackPositionListener;
  /**
   * Stays still above the pages (the Groups / DMs switch and buttons). A
   * sideways swipe on it moves the pages too.
   */
  header?: ReactNode;
  ref?: Ref<MobileChatListPagerHandle>;
}

export interface MobileChatListPagerHandle {
  /**
   * With the swipe off (a chat open over the lists): show `scope`'s list
   * instead of the current one, or the current one again for `null`. For a
   * swipe out of a group chat to the DMs, which slides that list in under
   * it before the scope changes.
   */
  preview: (scope: ChatScope | null) => void;
  /**
   * Switch to `scope` the way a swipe does: the pages glide there first,
   * and the switch happens once that is on screen (taps on the Groups / DMs
   * switch). With the swipe off, it just switches.
   */
  slideTo: (scope: ChatScope) => void;
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
  header,
  ref,
  onScopeChange,
  onTrackPosition,
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
  const [previewScope, setPreviewScope] = useState<ChatScope | null>(null);
  const previewing = !swipeEnabled && previewScope !== null;
  const shownPage = previewing ? CHAT_SCOPES.indexOf(previewScope) : page;
  const onTrackPositionRef = useRef(onTrackPosition);
  onTrackPositionRef.current = onTrackPosition;
  const pageRef = useRef(page);
  pageRef.current = page;

  // A preview only stands in until the scope itself changes.
  useEffect(() => {
    setPreviewScope(null);
  }, [scope, swipeEnabled]);

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
    const nextScope = CHAT_SCOPES[next];
    if (nextScope) onScopeChangeRef.current(nextScope);
  }, []);
  // A swipe that beats the warm-up builds the other list at once.
  const handleDragStart = useCallback(() => setNeighborReady(true), []);

  const { slideTo } = useHorizontalPagerSwipe(viewportRef, trackRef, {
    animatePageChange: neighborReady,
    enabled: swipeEnabled,
    onDragStart: handleDragStart,
    onPageChange: handlePageChange,
    onTrackPosition,
    page,
    pageCount: CHAT_SCOPES.length,
    reducedMotion,
    // Swiping right on Groups goes on to Apps (the section swipe).
    releaseEdges: true,
  });

  const slideToRef = useRef(slideTo);
  slideToRef.current = slideTo;
  useImperativeHandle(
    ref,
    () => ({
      slideTo: (scope) => {
        const target = CHAT_SCOPES.indexOf(scope);
        if (target >= 0) slideToRef.current(target);
      },
      preview: (next) => {
        setPreviewScope(next);
        // The switch's pill moves to the list on show.
        const position = next ? CHAT_SCOPES.indexOf(next) : pageRef.current;
        onTrackPositionRef.current?.(position, 0, PAGER_SLIDE_EASING);
      },
    }),
    []
  );

  const pageSx = (index: number) => {
    const current = index === shownPage;
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
      // Claims its own swipes; the section swipe takes the rest.
      {...{ [SECTION_SWIPE_COOPERATIVE_ATTR]: '' }}
      sx={{
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
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
              // for a sideways swipe (see SECTION_SURFACE_TOUCH_ACTION).
              // Lists are scroll containers, which re-enable panning for
              // their content, so they (and their direct children) are
              // marked too.
              touchAction: SECTION_SURFACE_TOUCH_ACTION,
              [`& ${scrollerSelector}, & ${scrollerSelector} > *`]: {
                touchAction: SECTION_SURFACE_TOUCH_ACTION,
              },
            }
          : {}),
      }}
    >
      {header}
      <Box
        ref={trackRef}
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          minHeight: 0,
          minWidth: 0,
          width: '100%',
          willChange: swipeEnabled ? 'transform' : undefined,
        }}
      >
        {/* The page out of view is inert: no taps, focus or screen
            reader. */}
        <Box
          data-chat-list-page="groups"
          inert={shownPage !== 0}
          sx={pageSx(0)}
        >
          {renderGroups(neighborReady || previewScope === 'groups')}
        </Box>
        <Box
          data-chat-list-page="directs"
          inert={shownPage !== 1}
          sx={pageSx(1)}
        >
          {renderDirects(
            page === 1 || neighborReady || previewScope === 'directs'
          )}
        </Box>
      </Box>
    </Box>
  );
}
