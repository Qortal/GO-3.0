import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Box,
  ButtonBase,
  Fade,
  ListItemIcon,
  MenuItem,
  MenuList,
  Modal,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { useTranslation } from 'react-i18next';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { ReactionEmojiGrid } from './ReactionEmojiGrid';
import { QUICK_REACTIONS, rememberRecentReaction } from './reactionEmojiData';
import {
  getPillWidth,
  getQuickReactionCount,
  layoutMessageActionsPopup,
  MENU_CARD_WIDTH_PX,
  PILL_CELL_PX,
  PILL_EXPAND_SLOT_PX,
  PILL_HEIGHT_PX,
  PILL_PADDING_X_PX,
  POPUP_EDGE_MARGIN_PX,
  POPUP_GAP_PX,
} from './messageActionsPopupLayout';

export type MessageActionsPopupAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

export type MessageActionsPopupProps = {
  open: boolean;
  /** Where the message was touched, in client coordinates. */
  anchor: { x: number; y: number };
  /** Own messages sit on the right, so the popup opens leftward. */
  alignEnd?: boolean;
  /** Emoji the viewer already reacted with: shown picked, a tap removes. */
  myReactions?: readonly string[];
  /** Left out where reacting isn't possible; the pill is not shown then. */
  onReact?: (emoji: string) => void;
  actions: MessageActionsPopupAction[];
  /** Card under the menu; the long-press version puts the details here. */
  details?: ReactNode;
  onClose: () => void;
  /** After the closing fade, so the host can unmount the popup. */
  onExited?: () => void;
};

type Viewport = {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  topInset: number;
  bottomInset: number;
};

const readInset = (style: CSSStyleDeclaration, name: string) => {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

// The visible part of the screen: with the soft keyboard up it is shorter
// than the window. The insets are the status and gesture bars GO draws under.
const readViewport = (): Viewport => {
  const visual = window.visualViewport;
  const rootStyle = window.getComputedStyle(document.documentElement);
  return {
    width: visual?.width || window.innerWidth,
    height: visual?.height || window.innerHeight,
    offsetLeft: visual?.offsetLeft || 0,
    offsetTop: visual?.offsetTop || 0,
    topInset: readInset(rootStyle, '--safe-area-inset-top'),
    bottomInset: readInset(rootStyle, '--safe-area-inset-bottom'),
  };
};

const EXPAND_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const popupSurfaceSx = (theme: Theme) => {
  const isDark = theme.palette.mode === 'dark';
  return {
    backgroundColor: isDark
      ? theme.palette.background.elevated
      : theme.palette.background.paper,
    // A ring instead of a border keeps the measured sizes exact.
    boxShadow: isDark
      ? `0 0 0 1px ${alpha(theme.palette.common.white, 0.07)}, 0 14px 36px rgba(0, 0, 0, 0.5)`
      : `0 0 0 1px ${alpha(theme.palette.common.black, 0.07)}, 0 14px 32px rgba(40, 30, 10, 0.2)`,
  };
};

/**
 * Message actions on phones, the way Telegram shows them: a pill of quick
 * reactions floats above a menu card where the message was touched, and the
 * pill's chevron grows it into the full emoji grid. A tap opens the short
 * menu; a long press adds the details card (sent time, expiry) and the
 * extra actions, which the host passes in.
 */
export const MessageActionsPopup = ({
  open,
  anchor,
  alignEnd = false,
  myReactions,
  onReact,
  actions,
  details,
  onClose,
  onExited,
}: MessageActionsPopupProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const isDark = theme.palette.mode === 'dark';
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // A state, not a ref: the Modal's portal mounts the content one render
  // after this component, and the measuring below has to run again then.
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  const mine = useMemo(() => new Set(myReactions ?? []), [myReactions]);

  const canReact = typeof onReact === 'function';
  const quickCount = canReact
    ? getQuickReactionCount(viewport.width, QUICK_REACTIONS.length)
    : 0;
  const quickReactions = QUICK_REACTIONS.slice(0, quickCount);
  const pillWidth = canReact ? getPillWidth(quickCount) : 0;
  const bodyWidth = Math.min(
    MENU_CARD_WIDTH_PX,
    viewport.width - 2 * POPUP_EDGE_MARGIN_PX
  );
  const hasBody = actions.length > 0 || Boolean(details);

  // Rotation and the soft keyboard move the visible area under the popup.
  useEffect(() => {
    if (!open) return;
    const update = () => setViewport(readViewport());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [open]);

  // Measured before paint, so the popup appears already in place: once the
  // menu is in the page, and again whenever its size changes. Without the
  // real height a message near the bottom would push the menu off screen.
  useLayoutEffect(() => {
    if (!bodyNode) return;
    const measure = () => setBodyHeight(bodyNode.offsetHeight);
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bodyNode);
    return () => observer.disconnect();
  }, [actions, bodyNode, bodyWidth, details]);

  const measuredBodyHeight = hasBody ? bodyHeight : 0;
  const layout = useMemo(
    () =>
      measuredBodyHeight === null
        ? null
        : layoutMessageActionsPopup({
            alignEnd,
            anchorX: anchor.x - viewport.offsetLeft,
            anchorY: anchor.y - viewport.offsetTop,
            bodyHeight: measuredBodyHeight,
            bodyWidth,
            bottomInset: viewport.bottomInset,
            pillWidth,
            topInset: viewport.topInset,
            viewportHeight: viewport.height,
            viewportWidth: viewport.width,
          }),
    [
      alignEnd,
      anchor.x,
      anchor.y,
      bodyWidth,
      measuredBodyHeight,
      pillWidth,
      viewport,
    ]
  );

  useAndroidBack(
    () => {
      if (expanded) {
        setExpanded(false);
        return true;
      }
      onClose();
      return true;
    },
    { enabled: open, priority: BACK_PRIORITY.dialog }
  );

  const react = (emoji: string) => {
    if (!onReact) return;
    if (!mine.has(emoji)) rememberRecentReaction(emoji);
    onClose();
    onReact(emoji);
  };

  const pillBox = layout ? (expanded ? layout.expanded : layout.pill) : null;
  const pillOriginX = layout
    ? Math.min(
        Math.max(anchor.x - viewport.offsetLeft - layout.pill.left, 24),
        pillWidth - 24
      )
    : pillWidth / 2;
  const bodyOverflows =
    layout !== null &&
    measuredBodyHeight !== null &&
    measuredBodyHeight > layout.body.maxHeight;

  return (
    <Modal
      closeAfterTransition
      // A tap on a message took focus from the composer on purpose; giving
      // it back would pop the keyboard up after every reaction.
      disableRestoreFocus
      onClose={onClose}
      open={open}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: isDark
              ? alpha(theme.palette.common.black, 0.34)
              : alpha(theme.palette.common.black, 0.16),
          },
          transitionDuration: { enter: 160, exit: 140 },
        },
      }}
      // Above the top bar, the tab bar and transfer cards (snackbar layer).
      sx={{ zIndex: theme.zIndex.snackbar + 50 }}
    >
      <Fade in={open} onExited={onExited} timeout={{ enter: 120, exit: 140 }}>
        <Box
          data-message-actions-popup="true"
          sx={{
            inset: 0,
            outline: 'none',
            pointerEvents: 'none',
            position: 'fixed',
          }}
        >
          {/* Mounted only once placed: its top animates for the grid, and
              that must not play as a slide in from the top of the screen. */}
          {canReact && pillBox && (
            <Box
              aria-label={t('group:message_item.quick_reactions', {
                postProcess: 'capitalizeFirstChar',
              })}
              role="group"
              sx={{
                ...popupSurfaceSx(theme),
                borderRadius: expanded ? '20px' : `${PILL_HEIGHT_PX / 2}px`,
                height: pillBox.height,
                left: pillBox.left,
                overflow: 'hidden',
                pointerEvents: 'auto',
                position: 'absolute',
                top: pillBox.top + viewport.offsetTop,
                transformOrigin: `${pillOriginX}px ${PILL_HEIGHT_PX}px`,
                transition: `top 240ms ${EXPAND_EASE}, height 240ms ${EXPAND_EASE}, border-radius 240ms ease`,
                width: pillWidth,
                '@keyframes messagePillIn': {
                  from: { opacity: 0, transform: 'scale(0.55)' },
                  to: { opacity: 1, transform: 'scale(1)' },
                },
                animation:
                  'messagePillIn 260ms cubic-bezier(0.2, 0.9, 0.25, 1.12) both',
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                  transition: 'none',
                },
              }}
            >
              {expanded && layout ? (
                <ReactionEmojiGrid
                  height={layout.expanded.height}
                  onPick={react}
                  selected={mine}
                  width={pillWidth}
                />
              ) : (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    height: PILL_HEIGHT_PX,
                    px: `${PILL_PADDING_X_PX}px`,
                  }}
                >
                  {quickReactions.map((emoji, index) => {
                    const picked = mine.has(emoji);
                    return (
                      <ButtonBase
                        aria-label={t('group:message_item.react_with', {
                          defaultValue: 'react with {{emoji}}',
                          emoji,
                          postProcess: 'capitalizeFirstChar',
                        })}
                        aria-pressed={picked}
                        key={emoji}
                        onClick={() => react(emoji)}
                        sx={{
                          backgroundColor: picked
                            ? alpha(theme.palette.primary.main, 0.26)
                            : 'transparent',
                          borderRadius: '50%',
                          flexShrink: 0,
                          fontSize: '28px',
                          height: PILL_CELL_PX,
                          lineHeight: 1,
                          width: PILL_CELL_PX,
                          '& .message-pill-emoji': {
                            display: 'block',
                            transition: 'transform 120ms ease',
                          },
                          '&:active .message-pill-emoji': {
                            transform: 'scale(0.82)',
                          },
                          '@keyframes messagePillEmojiIn': {
                            from: { opacity: 0, transform: 'scale(0.3)' },
                            '70%': { opacity: 1, transform: 'scale(1.14)' },
                            to: { opacity: 1, transform: 'scale(1)' },
                          },
                          animation: `messagePillEmojiIn 320ms ease-out ${
                            60 + index * 28
                          }ms both`,
                          '@media (prefers-reduced-motion: reduce)': {
                            animation: 'none',
                          },
                        }}
                      >
                        <span className="message-pill-emoji">{emoji}</span>
                      </ButtonBase>
                    );
                  })}
                  <ButtonBase
                    aria-expanded={false}
                    aria-label={t('group:message_item.more_reactions', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    onClick={() => setExpanded(true)}
                    sx={{
                      borderRadius: '50%',
                      flexShrink: 0,
                      height: PILL_CELL_PX,
                      width: PILL_EXPAND_SLOT_PX,
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        backgroundColor: alpha(
                          theme.palette.text.primary,
                          isDark ? 0.1 : 0.08
                        ),
                        borderRadius: '50%',
                        color: 'text.secondary',
                        display: 'flex',
                        height: 32,
                        justifyContent: 'center',
                        width: 32,
                      }}
                    >
                      <KeyboardArrowDownRoundedIcon sx={{ fontSize: 24 }} />
                    </Box>
                  </ButtonBase>
                </Box>
              )}
            </Box>
          )}
          {hasBody && (
            <Box
              sx={{
                left: layout?.body.left ?? 0,
                maxHeight: layout?.body.maxHeight,
                // Scrolling clips the cards' shadows, so only when needed.
                overflowY: bodyOverflows ? 'auto' : 'visible',
                pointerEvents: expanded ? 'none' : 'auto',
                position: 'absolute',
                top: (layout?.body.top ?? 0) + viewport.offsetTop,
                visibility: layout ? 'visible' : 'hidden',
                width: bodyWidth,
                // The grid takes the menu's place; it steps back, not away.
                opacity: expanded ? 0 : 1,
                transform: expanded ? 'translateY(10px) scale(0.96)' : 'none',
                transition: 'opacity 150ms ease, transform 150ms ease',
              }}
            >
              <Box
                data-message-actions-body="true"
                ref={setBodyNode}
                sx={{
                  transformOrigin: alignEnd ? 'right top' : 'left top',
                  '@keyframes messageMenuIn': {
                    from: {
                      opacity: 0,
                      transform: 'translateY(-6px) scale(0.92)',
                    },
                    to: { opacity: 1, transform: 'none' },
                  },
                  animation: `messageMenuIn 220ms ${EXPAND_EASE} 40ms both`,
                  '@media (prefers-reduced-motion: reduce)': {
                    animation: 'none',
                  },
                }}
              >
                {actions.length > 0 && (
                  <MenuList
                    aria-label={t('group:message_item.message_actions', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    disablePadding
                    sx={{
                      ...popupSurfaceSx(theme),
                      borderRadius: '16px',
                      overflow: 'hidden',
                      py: '6px',
                    }}
                  >
                    {actions.map((action) => (
                      <MenuItem
                        key={action.key}
                        onClick={() => {
                          onClose();
                          action.onSelect();
                        }}
                        sx={{
                          color: action.destructive
                            ? 'error.main'
                            : 'text.primary',
                          gap: '16px',
                          px: '18px',
                          py: 0,
                          // Doubled class: outranks MenuItem's auto height
                          // from the sm breakpoint up (tablets, narrow Hub).
                          '&&': { minHeight: 48 },
                        }}
                      >
                        <ListItemIcon
                          sx={{
                            color: action.destructive
                              ? 'inherit'
                              : 'text.secondary',
                            minWidth: '0 !important',
                            '& svg': { fontSize: 22 },
                          }}
                        >
                          {action.icon}
                        </ListItemIcon>
                        <Typography
                          noWrap
                          sx={{ fontSize: '16px', fontWeight: 500 }}
                        >
                          {action.label}
                        </Typography>
                      </MenuItem>
                    ))}
                  </MenuList>
                )}
                {details && (
                  <Box
                    sx={{
                      ...popupSurfaceSx(theme),
                      borderRadius: '16px',
                      marginTop: actions.length > 0 ? `${POPUP_GAP_PX}px` : 0,
                      overflow: 'hidden',
                      '& > * + *': {
                        borderTop: '1px solid',
                        borderColor: alpha(theme.palette.text.primary, 0.08),
                      },
                    }}
                  >
                    {details}
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </Fade>
    </Modal>
  );
};

type MessageActionsDetailRowProps = {
  icon: ReactNode;
  label: string;
  value?: string;
  /** 'warning' tints the row red, for a message that will expire. */
  tone?: 'default' | 'warning';
};

/** One line of the long-press details card: icon, small label, value. */
export const MessageActionsDetailRow = ({
  icon,
  label,
  value,
  tone = 'default',
}: MessageActionsDetailRowProps) => {
  const theme = useTheme();
  const warning = tone === 'warning';
  const warningText =
    theme.palette.mode === 'dark'
      ? theme.palette.error.light
      : theme.palette.error.main;
  return (
    <Box
      sx={{
        alignItems: 'center',
        backgroundColor: warning
          ? alpha(theme.palette.error.main, 0.1)
          : 'transparent',
        display: 'flex',
        gap: '16px',
        minHeight: 52,
        px: '18px',
        py: '7px',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          color: warning ? warningText : 'text.secondary',
          display: 'flex',
          flexShrink: 0,
          justifyContent: 'center',
          width: 22,
          '& svg': { fontSize: 22 },
          '& img': { display: 'block', height: 24, width: 24 },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            color: warning ? warningText : 'text.secondary',
            fontSize: '12px',
            fontWeight: 600,
            lineHeight: 1.25,
          }}
        >
          {label}
        </Typography>
        {value && (
          <Typography
            sx={{
              color: 'text.primary',
              fontSize: '14.5px',
              fontWeight: 600,
              lineHeight: 1.3,
              marginTop: '2px',
            }}
          >
            {value}
          </Typography>
        )}
      </Box>
    </Box>
  );
};
