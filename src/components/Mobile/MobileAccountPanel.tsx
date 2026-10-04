import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Box, Typography, useTheme, type Theme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { SvgIconComponent } from '@mui/icons-material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useTranslation } from 'react-i18next';
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
import { requestAppLockNow } from '../../lib/appLock';

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
  /**
   * "Lock now": locks GO exactly as the idle timer does. Defaults to asking
   * App over the event bus; pass null to leave the item out.
   */
  onLockNow?: (() => void) | null;
};

/**
 * Put "Lock now" just above the last action, which is Logout, so the two ways
 * of leaving the wallet sit together at the bottom of the menu.
 */
export function withLockNowAction(
  actions: AccountAction[],
  lockAction: AccountAction
): AccountAction[] {
  if (actions.length === 0) return [lockAction];
  return [...actions.slice(0, -1), lockAction, actions[actions.length - 1]];
}

/** Past this upward travel a slow swipe still closes the panel on release. */
export const DISMISS_DISTANCE_PX = 72;
/** An upward flick this fast (px/s) closes it even after a short travel. */
export const DISMISS_FLICK_VELOCITY = 600;
export const DISMISS_FLICK_MIN_PX = 24;
/** Upward travel over which every tile has closed to the side. */
export const BUTTONS_GONE_TRAVEL_PX = 144;
/**
 * Share of that travel one tile takes to close. Small, so the tiles leave
 * one after another, bottom-up, rather than all at once.
 */
const BUTTON_CLOSE_SPAN = 0.3;
/** How far a tile slides to the side while it closes. */
const BUTTON_SLIDE_OUT_PX = 96;
/** Upward travel over which the panel's own background dissolves. */
const SHELL_GONE_TRAVEL_PX = 24;
/** How much of the finger's travel the tiles follow upwards. */
const CONTENT_LIFT = 0.25;
/** A tap-close (or a released swipe) runs the rest of the travel this fast. */
const CLOSE_SECONDS = 0.42;
/** Travel that turns the gesture into a swipe, so releasing it is not a tap. */
const DRAG_SUPPRESSES_CLICK_PX = 8;
/** How much of a downward pull the panel follows: a hint that it only goes up. */
const PULL_DOWN_ELASTIC = 0.12;
const ANIMATIONS_DISABLED_STORAGE_KEY = 'hub_ui_animations_enabled';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN_OUT = [0.45, 0, 0.55, 1] as const;
const SETTLE_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

const BACKDROP_Z = 1290;
const PANEL_Z = 1291;

/** Where a released swipe-up sends the travel, in px (negative). */
export type Fling = { y: number };

export type SwipeRelease = { kind: 'settle' } | ({ kind: 'fling' } & Fling);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Decide what a released swipe does. Pure so the thresholds are testable
 * without a pointer: enough upward travel, or an upward flick, closes the
 * panel (the travel runs on to `flingToY`); anything else (including any
 * downward pull) springs it back.
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
 * How far tile `index` of `count` has closed to the side, 0..1, for the
 * swipe travel `y` (negative while swiped up). The bottom tile starts first
 * and the top one last, each taking a short slice of the travel, so they peel
 * off one after another; because it is a pure function of `y`, swiping back
 * down simply plays it backwards and the tiles return.
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
 * The account menu under the avatar on GO: the account and the actions, each
 * its own tile. It opens with the tiles dropping in one
 * after another. Closing, by a tap outside, an action, Android back or a
 * swipe up (on the panel or anywhere on the dimmed screen), dissolves the
 * panel's background at once and leaves the tiles on their own, which then
 * slide away to the side one by one, bottom-up, while the dim clears. During
 * a swipe the tiles follow the finger: swipe back down and they return; a
 * long or fast enough swipe finishes the close on release, a short one
 * springs everything back, and a downward pull only rubber-bands. When the
 * list has to scroll (short landscape screens) it scrolls instead, and the
 * swipe-up still works from the header and the dim.
 */
export const MobileAccountPanel = ({
  open,
  anchor,
  actions,
  address,
  primaryName,
  cachedAvatarEntry,
  onClose,
  onLockNow = requestAppLockNow,
}: MobileAccountPanelProps) => {
  const { t } = useTranslation(['core']);
  const lockNowLabel = t('core:app_lock.lock_now');
  const menuActions = useMemo(
    () =>
      onLockNow
        ? withLockNowAction(actions, {
            icon: LockRoundedIcon,
            label: lockNowLabel,
            onClick: onLockNow,
          })
        : actions,
    [actions, lockNowLabel, onLockNow]
  );

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
          actions={menuActions}
          address={address}
          primaryName={primaryName}
          cachedAvatarEntry={cachedAvatarEntry}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>
  );
};

type SurfaceProps = Omit<
  MobileAccountPanelProps,
  'open' | 'anchor' | 'onLockNow'
> & {
  anchor: AccountPanelAnchor;
};

// One instance per opening, so the swipe position and the close of a closing
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

  const listRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  const dragControls = useDragControls();
  // The swipe travel (negative while swiped up). Drag writes it through
  // `_dragY` instead of moving the panel, and everything below is derived
  // from it, so a swipe and a tap-close play the same choreography.
  const y = useMotionValue(0);
  const travel = useTransform(y, (value) => Math.max(0, -value));
  // The panel's own background goes first, so the tiles stand on their own.
  const shellOpacity = useTransform(travel, (value) =>
    clamp(1 - value / SHELL_GONE_TRAVEL_PX, 0, 1)
  );
  // Each tile gets its own surface as the shared one dissolves.
  const tileSurfaceOpacity = useTransform(shellOpacity, (value) => 1 - value);
  const contentLift = useTransform(y, (value) => value * CONTENT_LIFT);
  // The dim clears while the tiles leave, gone before the last one has.
  const dimFade = useTransform(travel, (value) =>
    clamp(1 - value / (BUTTONS_GONE_TRAVEL_PX * 0.6), 0, 1)
  );

  /** Seconds the close still needs from the current travel. */
  const remainingCloseSeconds = () =>
    reduced
      ? 0
      : CLOSE_SECONDS * clamp(1 - travel.get() / BUTTONS_GONE_TRAVEL_PX, 0, 1);

  // Closing runs the rest of the travel: the shell dissolves (if a swipe has
  // not already), then the tiles slide away one by one.
  useEffect(() => {
    if (isPresent) return undefined;
    const duration = remainingCloseSeconds();
    const controls = animate(y, -BUTTONS_GONE_TRAVEL_PX, {
      duration,
      ease: EASE_IN_OUT,
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  // While the list has to scroll (short landscape screens) an upward swipe on
  // it must scroll it, so the swipe-up then only starts from the header, the
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
        transition: {
          duration: d(0.2),
          ease: EASE_OUT,
          delayChildren: d(0.04),
          staggerChildren: d(0.035),
        },
      },
      // The tiles leave through `y` (see the effect above); the panel only
      // stays mounted until the last one is gone.
      exit: () => ({
        opacity: 0,
        transition: { duration: d(0.06), delay: remainingCloseSeconds() },
      }),
    };
    const backdrop: Variants = {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { duration: d(0.16) } },
      exit: { opacity: 0, transition: { duration: d(0.2) } },
    };
    const list: Variants = {
      hidden: {},
      show: { transition: { staggerChildren: d(0.035) } },
    };
    const tile: Variants = {
      hidden: { opacity: 0, y: -12 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: d(0.2), ease: EASE_OUT },
      },
    };
    return { panel, backdrop, list, tile };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const handleDragEnd = (_event: PointerEvent, info: PanInfo) => {
    const release = resolveSwipeRelease(
      info.offset.y,
      info.velocity.y,
      -BUTTONS_GONE_TRAVEL_PX
    );
    if (release.kind === 'settle') {
      // Springing the travel back also brings the tiles and the shell back.
      void animate(y, 0, SETTLE_SPRING);
      return;
    }
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
  const surface = panelSurfaceColor(theme);
  // The header first, then the actions: one sequence of tiles.
  const tileCount = actions.length + 1;

  return (
    <>
      <motion.div
        aria-hidden
        data-testid="account-menu-backdrop"
        onClick={onClose}
        onClickCapture={swallowClickAfterDrag}
        // A touch swipe ends without a click, so a fresh press clears the
        // flag here too, or the next tap on the dim would be swallowed.
        onPointerDownCapture={() => {
          movedRef.current = false;
        }}
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
        role="menu"
        aria-label="Account menu"
        variants={variants.panel}
        initial="hidden"
        animate="show"
        exit="exit"
        drag="y"
        _dragY={y}
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
          display: 'flex',
          flexDirection: 'column',
          // Cap to the viewport so the full action list (incl. Logout) is
          // reachable on short landscape screens; actions scroll if needed.
          maxHeight: `calc(100dvh - ${anchor.top + 8}px - 12px)`,
          maxWidth: 'min(300px, calc(100vw - 20px))',
          minWidth: 248,
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
        {/* The panel's own background, apart from the tiles so it can go
            first. */}
        <motion.div
          aria-hidden
          data-testid="account-menu-shell"
          style={{
            backgroundColor: surface,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 16,
            boxShadow: isDark
              ? `0 16px 40px ${alpha('#000', 0.45)}`
              : `0 14px 36px ${alpha('#1E3248', 0.14)}`,
            inset: 0,
            opacity: shellOpacity,
            pointerEvents: 'none',
            position: 'absolute',
          }}
        />
        <motion.div
          style={{
            display: 'flex',
            flex: '1 1 auto',
            flexDirection: 'column',
            gap: 3,
            minHeight: 0,
            padding: 6,
            position: 'relative',
            y: contentLift,
          }}
        >
          <PanelTile
            count={tileCount}
            index={0}
            onPointerDown={startSwipe}
            surface={surface}
            surfaceOpacity={tileSurfaceOpacity}
            variants={variants.tile}
            y={y}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 1,
                p: '2.8px 4px',
              }}
            >
              <QortalUserAvatar
                key={`${address}-${primaryName}-panel`}
                primaryName={primaryName}
                walletAddress={address}
                cachedAvatarEntry={cachedAvatarEntry}
                ownAvatar
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
            </Box>
          </PanelTile>

          {/* The list is a scroll container, and Chrome resolves touch-action
              only between the touched element and the nearest scroll
              container, so the panel's own touch-action: none never applied
              to a swipe that started on a button: after 4 px Chrome claimed
              the touch as a scroll and fired pointercancel, and the swipe
              sprang back. The list has to forbid native panning itself, and
              only scrolls when it really overflows. */}
          <motion.div
            ref={listRef}
            data-testid="account-menu-list"
            onPointerDown={listOverflows ? undefined : startSwipe}
            variants={variants.list}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              minHeight: 0,
              // A scroll container clips, and tiles sliding to the side gave it
              // a horizontal scrollbar; only scroll when the list must.
              overflowX: listOverflows ? 'hidden' : 'visible',
              overflowY: listOverflows ? 'auto' : 'visible',
              overscrollBehavior: 'contain',
              touchAction: listOverflows ? 'pan-y' : 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {actions.map((action, index) => (
              <PanelTile
                key={action.label}
                count={tileCount}
                index={index + 1}
                surface={surface}
                surfaceOpacity={tileSurfaceOpacity}
                variants={variants.tile}
                y={y}
              >
                <AccountPanelButton
                  action={action}
                  onSelect={runAction(action)}
                />
              </PanelTile>
            ))}
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
};

const panelSurfaceColor = (theme: Theme) =>
  theme.palette.mode === 'dark'
    ? 'rgb(34, 36, 42)'
    : theme.palette.background.paper;

type PanelTileProps = {
  children: ReactNode;
  count: number;
  index: number;
  onPointerDown?: (event: ReactPointerEvent) => void;
  surface: string;
  surfaceOpacity: MotionValue<number>;
  variants: Variants;
  y: MotionValue<number>;
};

// One tile of the menu. The outer div carries the drop-in on open; the inner
// one closes to the side in step with the travel and comes back with it. Its
// own surface shows once the panel's background has gone, so a tile reads as
// a card on its own while it leaves.
const PanelTile = ({
  children,
  count,
  index,
  onPointerDown,
  surface,
  surfaceOpacity,
  variants,
  y,
}: PanelTileProps) => {
  const theme = useTheme();
  const progress = useTransform(y, (value) =>
    buttonCloseProgress(value, index, count)
  );
  const x = useTransform(progress, (q) => q * BUTTON_SLIDE_OUT_PX);
  const opacity = useTransform(progress, (q) => 1 - q);
  const scale = useTransform(progress, (q) => 1 - 0.06 * q);

  return (
    <motion.div
      variants={variants}
      onPointerDown={onPointerDown}
      style={{ flexShrink: 0 }}
    >
      <motion.div
        data-testid="account-menu-tile"
        style={{ opacity, position: 'relative', scale, x }}
      >
        <motion.div
          aria-hidden
          style={{
            backgroundColor: surface,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 12,
            boxShadow: `0 6px 16px ${alpha('#000', 0.22)}`,
            inset: 0,
            opacity: surfaceOpacity,
            pointerEvents: 'none',
            position: 'absolute',
          }}
        />
        <Box sx={{ position: 'relative' }}>{children}</Box>
      </motion.div>
    </motion.div>
  );
};

type AccountPanelButtonProps = {
  action: AccountAction;
  onSelect: () => void;
};

const AccountPanelButton = ({ action, onSelect }: AccountPanelButtonProps) => {
  const theme = useTheme();
  const { icon: Icon, label, accent, badge } = action;

  return (
    <Box
      role="menuitem"
      data-testid="account-menu-button"
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
  );
};

export default MobileAccountPanel;
