import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { SvgIconComponent } from '@mui/icons-material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type PanInfo,
  type Variants,
} from 'framer-motion';
import { QortalUserAvatar } from '../QortalUserAvatar';
import type { WalletAvatarCacheEntry } from '../../utils/walletAvatarCache';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';

export type AccountAction = {
  icon: SvgIconComponent;
  label: string;
  onClick: () => void;
  accent?: boolean;
  badge?: number;
};

export type AccountPanelAnchor = { top: number; right: number };

type MobileAccountPanelProps = {
  open: boolean;
  anchor: AccountPanelAnchor | null;
  actions: AccountAction[];
  address: string;
  primaryName: string;
  cachedAvatarEntry: WalletAvatarCacheEntry | null;
  onClose: () => void;
};

/** Past this upward travel a slow swipe still closes the panel on release. */
export const DISMISS_DISTANCE_PX = 72;
/** An upward flick this fast (px/s) closes it even after a short travel. */
export const DISMISS_FLICK_VELOCITY = 600;
export const DISMISS_FLICK_MIN_PX = 24;
/** Upward travel over which every button has closed to the side. */
export const BUTTONS_GONE_TRAVEL_PX = 144;
/** Share of that travel one button takes to close; they overlap, bottom-up. */
const BUTTON_CLOSE_SPAN = 0.5;
/** How far a button slides to the side while it closes. */
const BUTTON_SLIDE_OUT_PX = 88;
/** Travel that turns the gesture into a swipe, so releasing it is not a tap. */
const DRAG_SUPPRESSES_CLICK_PX = 8;
/** Extra travel past the top edge when the panel is thrown off-screen. */
const THROW_EXTRA_PX = 40;
/** How much of a downward pull the panel follows: a hint that it only goes up. */
const PULL_DOWN_ELASTIC = 0.12;
const ANIMATIONS_DISABLED_STORAGE_KEY = 'hub_ui_animations_enabled';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;
const SETTLE_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

const BACKDROP_Z = 1290;
const PANEL_Z = 1291;

/** Where a swipe-up sends the panel, in px from its resting spot (negative). */
export type Fling = { y: number };

export type SwipeRelease = { kind: 'settle' } | ({ kind: 'fling' } & Fling);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Decide what a released swipe does. Pure so the thresholds are testable
 * without a pointer: enough upward travel, or an upward flick, throws the
 * panel up to `flingToY`; anything else (including any downward pull) springs
 * it back.
 */
export function resolveSwipeRelease(
  offsetY: number,
  velocityY: number,
  flingToY: number
): SwipeRelease {
  const travelledUp = -offsetY;
  if (travelledUp <= 0) return { kind: 'settle' };
  const flicked =
    -velocityY > DISMISS_FLICK_VELOCITY && travelledUp > DISMISS_FLICK_MIN_PX;
  if (travelledUp <= DISMISS_DISTANCE_PX && !flicked) return { kind: 'settle' };
  return { kind: 'fling', y: flingToY };
}

/**
 * How far button `index` of `count` has closed to the side, 0..1, for the
 * panel's current vertical offset `y` (negative while swiped up). The bottom
 * button starts first and the top one last, each taking half the travel, so
 * they peel off one after another; because it is a pure function of `y`,
 * swiping back down simply plays it backwards and the buttons return.
 */
export function buttonCloseProgress(
  y: number,
  index: number,
  count: number
): number {
  const travel = clamp(-y / BUTTONS_GONE_TRAVEL_PX, 0, 1);
  const order = count > 1 ? (count - 1 - index) / (count - 1) : 0;
  const start = order * (1 - BUTTON_CLOSE_SPAN);
  const q = clamp((travel - start) / BUTTON_CLOSE_SPAN, 0, 1);
  return q * q * (3 - 2 * q);
}

const readAnimationsDisabled = (): boolean => {
  try {
    return (
      window.localStorage.getItem(ANIMATIONS_DISABLED_STORAGE_KEY) === 'false'
    );
  } catch {
    return false;
  }
};

/**
 * The account menu under the avatar on GO. It opens with the header and each
 * button dropping in one after another, and closes the same way in reverse:
 * the buttons slide away bottom-up, the header lifts, the panel shrinks back
 * towards the avatar and the dim behind it clears. It stays where it is
 * otherwise: a swipe up, on the panel or anywhere on the dimmed screen, lifts
 * it with the finger while the buttons close to the side one after another,
 * bottom-up, in step with the finger (swipe back down and they return), and
 * once the swipe is long or fast enough the release throws the panel off the
 * top; a short swipe springs everything back and a downward pull only
 * rubber-bands. When the list has to scroll (short landscape screens) it
 * scrolls instead, and the swipe-up still works from the header and the dim.
 * Android back closes it as well.
 */
export const MobileAccountPanel = ({
  open,
  anchor,
  actions,
  address,
  primaryName,
  cachedAvatarEntry,
  onClose,
}: MobileAccountPanelProps) => {
  useAndroidBack(
    () => {
      onClose();
      return true;
    },
    { priority: BACK_PRIORITY.overlay, enabled: open }
  );

  return (
    <AnimatePresence>
      {open && anchor ? (
        <AccountPanelSurface
          key="account-panel"
          anchor={anchor}
          actions={actions}
          address={address}
          primaryName={primaryName}
          cachedAvatarEntry={cachedAvatarEntry}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>
  );
};

type SurfaceProps = Omit<MobileAccountPanelProps, 'open' | 'anchor'> & {
  anchor: AccountPanelAnchor;
};

// One instance per opening, so the swipe position and the throw of a closing
// panel never leak into the next one.
const AccountPanelSurface = ({
  anchor,
  actions,
  address,
  primaryName,
  cachedAvatarEntry,
  onClose,
}: SurfaceProps) => {
  const theme = useTheme();
  // useIsPresent, not usePresence: the latter would make AnimatePresence wait
  // for a manual safeToRemove() and the closed panel would never unmount.
  const isPresent = useIsPresent();
  const prefersReducedMotion = useReducedMotion();
  const reduced = Boolean(prefersReducedMotion) || readAnimationsDisabled();

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const flingRef = useRef<Fling | null>(null);
  const movedRef = useRef(false);
  const dragControls = useDragControls();
  const y = useMotionValue(0);
  // The dim clears as the buttons close, gone when the last one has left.
  const dimFade = useTransform(y, (value) =>
    clamp(1 - Math.max(0, -value) / BUTTONS_GONE_TRAVEL_PX, 0, 1)
  );

  // While the list has to scroll (short landscape screens) an upward swipe on
  // it must scroll it, so the swipe-up then only starts from the header and
  // the dim behind the panel.
  const [listOverflows, setListOverflows] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current;
      if (!el) return;
      setListOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [actions.length]);

  const variants = useMemo(() => {
    const d = (seconds: number) => (reduced ? 0 : seconds);
    const panel: Variants = {
      hidden: { opacity: 0, scale: 0.95, y: -8 },
      show: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { duration: d(0.2), ease: EASE_OUT },
      },
      // Resolved when the exit starts, so it sees the throw of the swipe that
      // closed the panel (a plain close folds it back towards the avatar).
      // Throwing `y` also drives the buttons' own close-to-the-side, so the
      // ones still showing finish it on the way out.
      exit: () => {
        const fling = flingRef.current;
        return fling
          ? {
              opacity: 0,
              scale: 0.96,
              y: fling.y,
              transition: { duration: d(0.26), ease: EASE_OUT },
            }
          : {
              opacity: 0,
              scale: 0.94,
              y: -10,
              transition: { duration: d(0.18), ease: EASE_IN, delay: d(0.12) },
            };
      },
    };
    const backdrop: Variants = {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { duration: d(0.16) } },
      exit: () => ({
        opacity: 0,
        transition: {
          duration: d(0.18),
          delay: flingRef.current ? 0 : d(0.1),
        },
      }),
    };
    const header: Variants = {
      hidden: { opacity: 0, y: -12 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: d(0.18), ease: 'easeOut', delay: d(0.04) },
      },
      exit: {
        opacity: 0,
        y: -6,
        transition: { duration: d(0.12), ease: EASE_IN, delay: d(0.14) },
      },
    };
    const list: Variants = {
      hidden: {},
      show: {
        transition: { delayChildren: d(0.07), staggerChildren: d(0.045) },
      },
      exit: { transition: { staggerChildren: d(0.03), staggerDirection: -1 } },
    };
    const item: Variants = {
      hidden: { opacity: 0, x: 0, y: -12 },
      show: {
        opacity: 1,
        x: 0,
        y: 0,
        transition: { duration: d(0.2), ease: EASE_OUT },
      },
      // A tap-close slides each button to the side, bottom-up. After a swipe
      // the buttons have already closed (or finish closing with the throw), so
      // the exit only makes sure nothing lingers.
      exit: () =>
        flingRef.current
          ? { opacity: 0, transition: { duration: d(0.1) } }
          : {
              opacity: 0,
              x: BUTTON_SLIDE_OUT_PX,
              transition: { duration: d(0.16), ease: EASE_IN },
            },
    };
    return { panel, backdrop, header, list, item };
  }, [reduced]);

  const handleDragEnd = (_event: PointerEvent, info: PanInfo) => {
    // Far enough that the panel's bottom edge clears the top of the screen.
    const height = panelRef.current?.offsetHeight ?? 0;
    const flingToY = -(anchor.top + 8 + height + THROW_EXTRA_PX);
    const release = resolveSwipeRelease(
      info.offset.y,
      info.velocity.y,
      flingToY
    );
    if (release.kind === 'settle') {
      // Springing `y` back also brings the buttons back to their places.
      void animate(y, 0, SETTLE_SPRING);
      return;
    }
    flingRef.current = release;
    onClose();
  };

  // The swipe is started by hand from the surfaces that may take it, instead
  // of framer's own pointerdown listener, so a scrolling list keeps scrolling
  // and a swipe on the dim behind the panel moves the panel too.
  const startSwipe = (event: ReactPointerEvent) => {
    dragControls.start(event);
  };

  const swallowClickAfterDrag = (event: ReactMouseEvent) => {
    if (!movedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    movedRef.current = false;
  };

  const runAction = (action: AccountAction) => () => {
    onClose();
    action.onClick();
  };

  const isDark = theme.palette.mode === 'dark';
  const interactive = isPresent ? undefined : ('none' as const);

  return (
    <>
      <motion.div
        aria-hidden
        data-testid="account-menu-backdrop"
        onClick={onClose}
        onClickCapture={swallowClickAfterDrag}
        onPointerDown={startSwipe}
        variants={variants.backdrop}
        initial="hidden"
        animate="show"
        exit="exit"
        style={{
          inset: 0,
          pointerEvents: interactive,
          position: 'fixed',
          touchAction: 'none',
          zIndex: BACKDROP_Z,
        }}
      >
        <motion.div
          style={{
            backgroundColor: alpha(theme.palette.common.black, 0.28),
            inset: 0,
            opacity: dimFade,
            position: 'absolute',
          }}
        />
      </motion.div>
      <motion.div
        ref={panelRef}
        role="menu"
        aria-label="Account menu"
        variants={variants.panel}
        initial="hidden"
        animate="show"
        exit="exit"
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        // Free to go up, only a hint of give downwards.
        dragConstraints={{ top: -4000, bottom: 0 }}
        dragElastic={{ top: 0, bottom: PULL_DOWN_ELASTIC }}
        dragMomentum={false}
        onClickCapture={swallowClickAfterDrag}
        onDrag={(_event, info) => {
          if (Math.abs(info.offset.y) > DRAG_SUPPRESSES_CLICK_PX) {
            movedRef.current = true;
          }
        }}
        onDragEnd={handleDragEnd}
        onPointerDownCapture={() => {
          movedRef.current = false;
        }}
        style={{
          y,
          backgroundColor: isDark
            ? 'rgb(34, 36, 42)'
            : theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 16,
          boxShadow: isDark
            ? `0 16px 40px ${alpha('#000', 0.45)}`
            : `0 14px 36px ${alpha('#1E3248', 0.14)}`,
          display: 'flex',
          flexDirection: 'column',
          // Cap to the viewport so the full action list (incl. Logout) is
          // reachable on short landscape screens; actions scroll if needed.
          maxHeight: `calc(100dvh - ${anchor.top + 8}px - 12px)`,
          maxWidth: 'min(300px, calc(100vw - 20px))',
          minWidth: 248,
          overflow: 'hidden',
          pointerEvents: interactive,
          position: 'fixed',
          right: anchor.right,
          top: anchor.top + 8,
          // framer only sets this for its own drag listener; without it Chrome
          // would take the swipe as a scroll and cancel the pointer.
          touchAction: 'none',
          transformOrigin: 'top right',
          zIndex: PANEL_Z,
        }}
      >
        <motion.div
          onPointerDown={startSwipe}
          variants={variants.header}
          style={{
            alignItems: 'center',
            borderBottom: `1px solid ${theme.palette.divider}`,
            display: 'flex',
            flexShrink: 0,
            gap: 8,
            padding: '8.8px 10px',
          }}
        >
          <QortalUserAvatar
            key={`${address}-${primaryName}-panel`}
            primaryName={primaryName}
            walletAddress={address}
            cachedAvatarEntry={cachedAvatarEntry}
            fallbackIconSize={22}
            sx={{
              width: 40,
              height: 40,
              bgcolor: isDark
                ? alpha(theme.palette.common.white, 0.1)
                : alpha(theme.palette.common.black, 0.06),
              fontSize: 16,
              fontWeight: 700,
            }}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: '0.95rem',
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {primaryName || 'Account'}
            </Typography>
            {address ? (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontFamily: 'monospace',
                  fontSize: '0.7rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {address.slice(0, 8)}…{address.slice(-6)}
              </Typography>
            ) : null}
          </Box>
        </motion.div>

        {/* The list is a scroll container, and Chrome resolves touch-action only
            between the touched element and the nearest scroll container, so the
            panel's own touch-action: none never applied to a swipe that started
            on a button: after 4 px Chrome claimed the touch as a scroll and
            fired pointercancel, and the swipe sprang back. The list has to forbid
            native panning itself, and only scrolls when it really overflows. */}
        <motion.div
          ref={listRef}
          onPointerDown={listOverflows ? undefined : startSwipe}
          variants={variants.list}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            padding: 6,
            touchAction: listOverflows ? 'pan-y' : 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {actions.map((action, index) => (
            <AccountPanelButton
              key={action.label}
              action={action}
              count={actions.length}
              index={index}
              onSelect={runAction(action)}
              variants={variants.item}
              y={y}
            />
          ))}
        </motion.div>
      </motion.div>
    </>
  );
};

type AccountPanelButtonProps = {
  action: AccountAction;
  count: number;
  index: number;
  onSelect: () => void;
  variants: Variants;
  y: MotionValue<number>;
};

// The outer div carries the open/close choreography; the inner one follows
// the swipe, closing to the side in step with the finger and coming back when
// the finger comes back.
const AccountPanelButton = ({
  action,
  count,
  index,
  onSelect,
  variants,
  y,
}: AccountPanelButtonProps) => {
  const theme = useTheme();
  const { icon: Icon, label, accent, badge } = action;
  const progress = useTransform(y, (value) =>
    buttonCloseProgress(value, index, count)
  );
  const x = useTransform(progress, (q) => q * BUTTON_SLIDE_OUT_PX);
  const opacity = useTransform(progress, (q) => 1 - q);
  const scale = useTransform(progress, (q) => 1 - 0.04 * q);

  return (
    <motion.div variants={variants} style={{ flexShrink: 0 }}>
      <motion.div
        data-testid="account-menu-button"
        style={{ opacity, scale, x }}
      >
        <Box
          role="menuitem"
          onClick={onSelect}
          sx={{
            alignItems: 'center',
            borderRadius: '12px',
            cursor: 'pointer',
            display: 'flex',
            gap: 1,
            px: 1,
            py: 0.95,
            transition: 'background-color 120ms ease',
            ...(accent
              ? {
                  bgcolor: alpha(theme.palette.success.main, 0.1),
                  border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
                }
              : {
                  '&:active': {
                    bgcolor: alpha(theme.palette.text.primary, 0.08),
                  },
                }),
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              bgcolor: accent
                ? alpha(theme.palette.success.main, 0.16)
                : alpha(theme.palette.primary.main, 0.1),
              borderRadius: '10px',
              color: accent
                ? theme.palette.success.main
                : theme.palette.primary.main,
              display: 'flex',
              height: 32,
              justifyContent: 'center',
              width: 32,
              flexShrink: 0,
            }}
          >
            <Icon sx={{ fontSize: 18 }} />
          </Box>
          <Typography sx={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>
            {label}
          </Typography>
          {badge != null && badge > 0 ? (
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: theme.palette.success.main,
                borderRadius: 999,
                color: '#fff',
                display: 'inline-flex',
                fontSize: '0.65rem',
                fontWeight: 700,
                height: 18,
                justifyContent: 'center',
                minWidth: 18,
                px: 0.5,
              }}
            >
              {badge > 99 ? '99+' : badge}
            </Box>
          ) : null}
          <ChevronRightRoundedIcon
            sx={{ color: theme.palette.text.disabled, fontSize: 18 }}
          />
        </Box>
      </motion.div>
    </motion.div>
  );
};

export default MobileAccountPanel;
