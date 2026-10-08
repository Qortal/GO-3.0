import { Box, ButtonBase, useTheme } from '@mui/material';
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ReticulumUnreadCountBadge } from '../common/ReticulumUnreadCountBadge';
import {
  CHAT_LIST_HEADER_CONTAINER,
  CHAT_LIST_HEADER_NARROW_PX,
  CHAT_SCOPE_PILL_INSET,
  CHAT_SCOPE_SEGMENT_HEIGHT,
} from './chatListRowStyles';

export type ChatScope = 'groups' | 'directs';

/** Left to right on the switch, and on the phone pager below it. */
export const CHAT_SCOPES: readonly ChatScope[] = ['groups', 'directs'];

/** Moves a sliding switch's pill (see `ChatScopeSwitch`'s `sliding`). */
export interface ChatScopeSwitchHandle {
  /**
   * Put the pill at `position` (0 = Groups, 1 = DMs, fractions in between),
   * gliding there over `durationMs` (0 = at once).
   */
  setPosition: (position: number, durationMs?: number, easing?: string) => void;
}

const SEGMENT_ATTR = 'data-chat-scope-segment';
/** Which segment the pill is nearer: that label is drawn as the current one. */
const NEAR_ATTR = 'data-chat-scope-near';
/**
 * Set once the sliding pill has been placed. Until then (the Chat section
 * built while parked, then peeked at during a swipe) the current segment
 * draws its own pill, as without `sliding`.
 */
const PILL_READY_ATTR = 'data-chat-scope-pill-ready';
const PILL_ATTR = 'data-chat-scope-pill';

const clampPosition = (position: number) =>
  Math.max(0, Math.min(CHAT_SCOPES.length - 1, position));

const nearScope = (position: number): ChatScope =>
  CHAT_SCOPES[Math.round(clampPosition(position))] ?? 'groups';

/**
 * Segmented Groups / DMs switch for the top-left of the mobile list headers.
 *
 * Both list views show the same control in the same spot so switching scope
 * never depends on remembering where a back arrow leads. Each segment is a
 * full 44px touch target; the active pill is drawn 2px inside it. The labels
 * carry the switch on their own: segment icons did not fit beside both labels
 * and three header buttons when the list is swiped in over an open chat, and
 * one look in both places reads better than icons that come and go.
 */
export function ChatScopeSwitch({
  directHasUnread = false,
  directUnreadCount = 0,
  onChange,
  ref,
  sliding = false,
  value,
}: {
  directHasUnread?: boolean;
  directUnreadCount?: number;
  onChange: (scope: ChatScope) => void;
  /** With `sliding`: moves the pill. */
  ref?: Ref<ChatScopeSwitchHandle>;
  /**
   * One pill that slides between the segments, moved through `ref` (the
   * phone header over the Groups / DMs pages follows the swipe with it).
   * Without it each segment draws its own pill.
   */
  sliding?: boolean;
  value: ChatScope;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['reticulum']);
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<number>(CHAT_SCOPES.indexOf(value));

  /** Where each segment sits in the track, measured once per layout (not
   * per frame of a swipe). Null until laid out, and again on a resize. */
  const segmentRectsRef = useRef<{ left: number; width: number }[] | null>(
    null
  );
  /**
   * The pill's CSS width. A glide only moves and scales the pill (the GPU
   * runs that on its own, even while the page is busy switching lists; a
   * width change would wait for it), and the exact width is set once the
   * pill rests.
   */
  const pillWidthRef = useRef<number | null>(null);
  /** Sets the exact width once the current glide ends. */
  const pendingRestRef = useRef<{ rest: () => void; timer: number } | null>(
    null
  );

  const measureSegments = () => {
    const root = rootRef.current;
    if (!root) return null;
    const rects = CHAT_SCOPES.map((scope) => {
      const element = root.querySelector<HTMLElement>(
        `[${SEGMENT_ATTR}="${scope}"]`
      );
      return element
        ? { left: element.offsetLeft, width: element.offsetWidth }
        : null;
    });
    // Hidden (the Chat section parked, say): measure again when shown.
    if (rects.some((rect) => !rect || rect.width <= 0)) return null;
    segmentRectsRef.current = rects;
    return rects;
  };

  const placePill = (position: number, durationMs = 0, easing = 'ease') => {
    positionRef.current = position;
    const root = rootRef.current;
    const pill = pillRef.current;
    if (!root || !pill) return;
    const clamped = clampPosition(position);
    root.setAttribute(NEAR_ATTR, nearScope(clamped));
    const rects = segmentRectsRef.current ?? measureSegments();
    if (!rects) return;
    const from = rects[Math.floor(clamped)];
    const to = rects[Math.ceil(clamped)] ?? from;
    const share = clamped - Math.floor(clamped);
    const left = from.left + (to.left - from.left) * share;
    const width =
      Math.round((from.width + (to.width - from.width) * share) * 100) / 100;
    const translate = `translate3d(${Math.round(left * 100) / 100}px, 0, 0)`;
    const pending = pendingRestRef.current;
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingRestRef.current = null;
    }
    const rest = () => {
      pill.style.transition = 'none';
      pill.style.transform = translate;
      pill.style.width = `${width}px`;
      pillWidthRef.current = width;
    };
    const base = pillWidthRef.current;
    if (durationMs > 0 && base) {
      pill.style.transition = `transform ${durationMs}ms ${easing}`;
      pill.style.transform = `${translate} scaleX(${
        Math.round((width / base) * 10000) / 10000
      })`;
      // transitionend sets it as the glide lands; the timer covers a pill
      // that never animated (hidden, or already there).
      pendingRestRef.current = {
        rest,
        timer: window.setTimeout(finishGlide, durationMs + 300),
      };
    } else {
      rest();
    }
    root.setAttribute(PILL_READY_ATTR, '');
  };

  function finishGlide() {
    const pending = pendingRestRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRestRef.current = null;
    pending.rest();
  }
  const finishGlideRef = useRef(finishGlide);
  finishGlideRef.current = finishGlide;
  const placePillRef = useRef(placePill);
  placePillRef.current = placePill;

  useImperativeHandle(
    ref,
    () => ({
      setPosition: (position, durationMs, easing) =>
        placePillRef.current(position, durationMs, easing),
    }),
    []
  );

  // Measured once laid out, and again whenever a label changes width (a
  // language switch, the font arriving, the narrow header's tighter sides).
  useLayoutEffect(() => {
    if (!sliding) return;
    const root = rootRef.current;
    const pill = pillRef.current;
    if (!root || !pill) return;
    placePillRef.current(positionRef.current);
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === pill && event.propertyName === 'transform') {
        finishGlideRef.current();
      }
    };
    pill.addEventListener('transitionend', onTransitionEnd);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            segmentRectsRef.current = null;
            placePillRef.current(positionRef.current);
          });
    root
      .querySelectorAll(`[${SEGMENT_ATTR}]`)
      .forEach((segment) => observer?.observe(segment));
    return () => {
      pill.removeEventListener('transitionend', onTransitionEnd);
      observer?.disconnect();
      const pending = pendingRestRef.current;
      if (pending) window.clearTimeout(pending.timer);
      pendingRestRef.current = null;
    };
  }, [sliding]);

  const segment = (
    scope: ChatScope,
    label: string,
    badge?: ReactNode,
    dataTour?: string
  ) => {
    const active = value === scope;
    return (
      <ButtonBase
        aria-label={label}
        aria-pressed={active}
        data-tour={dataTour}
        {...{ [SEGMENT_ATTR]: scope }}
        onClick={() => {
          if (!active) onChange(scope);
        }}
        sx={{
          alignItems: 'center',
          borderRadius: '9px',
          // Sliding: the label the pill is nearer is the current one (set
          // on the switch as the pill moves, see NEAR_ATTR).
          color: active && !sliding ? 'text.primary' : 'text.secondary',
          display: 'flex',
          flex: '0 1 auto',
          fontFamily: 'Inter',
          fontSize: 14,
          fontWeight: 700,
          height: CHAT_SCOPE_SEGMENT_HEIGHT,
          // The pill below paints under the label and the ripple.
          isolation: 'isolate',
          justifyContent: 'center',
          minWidth: 0,
          overflow: 'visible',
          position: 'relative',
          px: 1.5,
          transition: 'color 160ms ease',
          '&::before': {
            backgroundColor: active
              ? theme.palette.background.paper
              : 'transparent',
            borderRadius: '9px',
            bottom: CHAT_SCOPE_PILL_INSET,
            boxShadow: active ? theme.shadows[1] : 'none',
            content: '""',
            left: 0,
            position: 'absolute',
            right: 0,
            top: CHAT_SCOPE_PILL_INSET,
            transition: 'background-color 160ms ease',
            zIndex: -1,
          },
          // Only on the narrowest headers (the swiped-in list on a small
          // phone): tighter sides keep both labels whole.
          [`@container ${CHAT_LIST_HEADER_CONTAINER} (max-width: ${
            CHAT_LIST_HEADER_NARROW_PX - 0.05
          }px)`]: { px: 1 },
        }}
      >
        {/* Long translations shorten rather than push the header buttons
            off a narrow phone. */}
        <Box
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Box>
        {badge}
      </ButtonBase>
    );
  };

  return (
    <Box
      ref={rootRef}
      role="group"
      aria-label={t('reticulum:chat_scope.label', {
        postProcess: 'capitalizeFirstChar',
      })}
      {...{ [NEAR_ATTR]: value }}
      sx={{
        backgroundColor: theme.palette.action.hover,
        borderRadius: '11px',
        display: 'flex',
        flexShrink: 1,
        gap: '2px',
        // The sliding pill paints under the segments' labels.
        isolation: 'isolate',
        minWidth: 0,
        overflow: 'visible',
        position: 'relative',
        // No vertical padding: the segments themselves fill the track's
        // height so the whole bar is tappable.
        px: `${CHAT_SCOPE_PILL_INSET}px`,
        ...(sliding
          ? {
              [`&[${NEAR_ATTR}="groups"] [${SEGMENT_ATTR}="groups"], &[${NEAR_ATTR}="directs"] [${SEGMENT_ATTR}="directs"]`]:
                { color: 'text.primary' },
              // The sliding pill takes over from the segments' own once
              // placed (and stays hidden until then).
              [`&[${PILL_READY_ATTR}] [${SEGMENT_ATTR}]::before`]: {
                backgroundColor: 'transparent',
                boxShadow: 'none',
              },
              [`&:not([${PILL_READY_ATTR}]) [${PILL_ATTR}]`]: {
                visibility: 'hidden',
              },
            }
          : {}),
      }}
    >
      {sliding && (
        <Box
          ref={pillRef}
          aria-hidden
          {...{ [PILL_ATTR]: '' }}
          sx={{
            backgroundColor: theme.palette.background.paper,
            borderRadius: '9px',
            bottom: CHAT_SCOPE_PILL_INSET,
            boxShadow: theme.shadows[1],
            left: 0,
            pointerEvents: 'none',
            position: 'absolute',
            top: CHAT_SCOPE_PILL_INSET,
            // Glides scale it from its left edge.
            transformOrigin: '0 50%',
            // Placed once the segments are measured (before paint).
            width: 0,
            willChange: 'transform',
            zIndex: -1,
          }}
        />
      )}
      {segment(
        'groups',
        t('reticulum:chat_scope.groups', {
          postProcess: 'capitalizeFirstChar',
        })
      )}
      {segment(
        'directs',
        t('reticulum:chat_scope.direct_messages', {
          postProcess: 'capitalizeFirstChar',
        }),
        directHasUnread ? (
          <ReticulumUnreadCountBadge
            count={directUnreadCount}
            outlineColor={
              value === 'directs'
                ? theme.palette.background.paper
                : theme.palette.action.hover
            }
            sx={{
              position: 'absolute',
              right: -5,
              // Same spot on the pill as before the segment grew to the
              // full track height.
              top: -6 + CHAT_SCOPE_PILL_INSET,
              zIndex: 2,
            }}
          />
        ) : null,
        // The onboarding tour points at the DMs segment on phones (the
        // desktop rail has its own anchor).
        'hub-direct-messages'
      )}
    </Box>
  );
}
