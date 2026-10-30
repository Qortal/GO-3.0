import { memo, type MouseEvent, type ReactNode } from 'react';
import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { TabAvatar, colorFor } from '../MobileTabsOverlay.shared';
import type { OpenTab } from '../useOpenTabs';
import { buildTabQortalUrl } from '../tabQortalLink';
import { useTabSnapshot } from './tabSnapshots';

/** Preview height over width, close to a phone screen cut short. */
const TAB_CARD_PREVIEW_RATIO = 1.18;

type TabPreviewCardProps = {
  tab: OpenTab;
  title: string;
  isActive: boolean;
  closeLabel: string;
  /** A dashed frame while tabs are being arranged. */
  editMode?: boolean;
  /** 0-based place in the grid, for the staggered entrance. */
  index?: number;
  /** Plays the closing animation; the parent removes the tab after it. */
  closing?: boolean;
  onSelect?: () => void;
  onClose: (event: MouseEvent) => void;
  /** Extra props for the frame (sortable listeners, long press). */
  frameProps?: Record<string, unknown>;
  /** Picks the placeholder colour; defaults to the title. */
  colorKey?: string;
  /**
   * Every open window of this app when there are several: small avatars
   * under the card, the one shown (`tab`) ringed. Tapping one shows that
   * window's page on the card.
   */
  windows?: OpenTab[];
  /** The window that is on screen in the Apps section, if one of these. */
  activeWindowId?: string | null;
  onPickWindow?: (tab: OpenTab) => void;
  windowLabel?: (position: number) => string;
  children?: ReactNode;
};

/**
 * An open Q-App or website as a card, like a browser's tab switcher: the
 * app's icon, its name and a close button over a picture of the page. Without
 * a picture (not on screen yet, or not on Android) the app's icon sits on a
 * soft wash of its colour. The active tab's frame is filled with the accent.
 */
export const TabPreviewCard = memo(function TabPreviewCard({
  tab,
  title,
  isActive,
  closeLabel,
  editMode = false,
  index = 0,
  closing = false,
  onSelect,
  onClose,
  frameProps,
  colorKey,
  windows,
  activeWindowId = null,
  onPickWindow,
  windowLabel,
  children,
}: TabPreviewCardProps) {
  const theme = useTheme();
  const snapshot = useTabSnapshot(tab.tabId);
  const color = colorFor(colorKey ?? title);
  const isDark = theme.palette.mode === 'dark';
  // A tint laid over the page colour, so the frame is opaque.
  const tint = (color: string) =>
    `linear-gradient(${color}, ${color}), ${theme.palette.background.default}`;
  const frameColor = isActive
    ? theme.palette.primary.main
    : tint(alpha(theme.palette.text.primary, isDark ? 0.09 : 0.07));
  const headerText = isActive
    ? theme.palette.getContrastText(theme.palette.primary.main)
    : theme.palette.text.primary;

  const hasWindows = Boolean(windows && windows.length > 1);

  return (
    <Box
      sx={{
        '@keyframes goTabCardIn': {
          from: { opacity: 0, transform: 'translateY(14px) scale(0.97)' },
          to: { opacity: 1, transform: 'none' },
        },
        '@keyframes goTabCardOut': {
          to: { opacity: 0, transform: 'scale(0.84)' },
        },
        // backwards, not both: a held end state would override :active.
        animation: closing
          ? 'goTabCardOut 180ms cubic-bezier(0.4, 0, 1, 1) forwards'
          : `goTabCardIn 340ms cubic-bezier(0.2, 0.9, 0.25, 1) ${
              Math.min(index, 8) * 35
            }ms backwards`,
        minWidth: 0,
        pointerEvents: closing ? 'none' : undefined,
        position: 'relative',
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'page' : undefined}
        aria-label={title}
        onClick={onSelect}
        {...frameProps}
        sx={{
          background: frameColor,
          border: editMode
            ? `1.5px dashed ${alpha(theme.palette.primary.main, 0.7)}`
            : '1.5px solid transparent',
          borderRadius: '22px',
          boxSizing: 'border-box',
          cursor: editMode ? 'grab' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          p: '4px',
          position: 'relative',
          zIndex: 1,
          transition:
            'transform 200ms cubic-bezier(0.2, 0.9, 0.25, 1), background-color 160ms ease',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          '&:active': editMode ? undefined : { transform: 'scale(0.97)' },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 0.9,
            height: 36,
            pl: 1,
            pr: 0.25,
          }}
        >
          <TabAvatar
            color={color}
            radius={5}
            size={18}
            tab={tab}
            title={title}
          />
          <Typography
            sx={{
              color: headerText,
              flex: 1,
              fontSize: 13.5,
              fontWeight: 600,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </Typography>
          <IconButton
            aria-label={closeLabel}
            onClick={(event) => {
              event.stopPropagation();
              onClose(event);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            size="small"
            sx={{ color: headerText, height: 30, width: 30 }}
          >
            <CloseRoundedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Box>
        <Box
          sx={{
            aspectRatio: `1 / ${TAB_CARD_PREVIEW_RATIO}`,
            backgroundColor: theme.palette.background.paper,
            borderRadius: '17px',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
            // GO short windows: a landscape card, so a whole row of cards
            // fits under the Tabs header (the picture is landscape too).
            'html[data-go-short] &': { aspectRatio: '16 / 10' },
          }}
        >
          {snapshot ? (
            <Box
              key={snapshot.url}
              alt=""
              component="img"
              draggable={false}
              src={snapshot.url}
              sx={{
                // A new picture (another window picked) fades in.
                '@keyframes goTabPictureIn': { from: { opacity: 0 } },
                animation: 'goTabPictureIn 180ms ease-out',
                display: 'block',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
                width: '100%',
              }}
            />
          ) : (
            <Box
              sx={{
                alignItems: 'center',
                background: `linear-gradient(165deg, ${alpha(color, isDark ? 0.34 : 0.26)} 0%, ${alpha(
                  color,
                  isDark ? 0.08 : 0.06
                )} 70%)`,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
                height: '100%',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <Box
                sx={{
                  borderRadius: '16px',
                  boxShadow: `0 10px 24px ${alpha(color, 0.35)}`,
                  lineHeight: 0,
                }}
              >
                <TabAvatar
                  color={color}
                  radius={16}
                  size={56}
                  tab={tab}
                  title={title}
                />
              </Box>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 11,
                  maxWidth: '86%',
                  overflow: 'hidden',
                  textAlign: 'center',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.isPrivate ? title : buildTabQortalUrl(tab)}
              </Typography>
            </Box>
          )}
          {children}
        </Box>
      </Box>
      {hasWindows ? (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            justifyContent: 'center',
            pt: '8px',
          }}
        >
          {windows!.map((window, position) => {
            const shown = window.tabId === tab.tabId;
            const onScreen =
              activeWindowId != null && window.tabId === activeWindowId;
            return (
              <Box
                key={String(window.tabId ?? position)}
                aria-label={windowLabel?.(position + 1)}
                aria-pressed={shown}
                component="button"
                onClick={(event: MouseEvent) => {
                  event.stopPropagation();
                  onPickWindow?.(window);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                type="button"
                sx={{
                  background: 'none',
                  border: 0,
                  borderRadius: '50%',
                  boxShadow: shown
                    ? `0 0 0 2px ${theme.palette.primary.main}`
                    : `0 0 0 1px ${alpha(theme.palette.text.primary, 0.14)}`,
                  cursor: 'pointer',
                  height: 26,
                  opacity: shown ? 1 : 0.62,
                  p: '2px',
                  position: 'relative',
                  transform: shown ? 'scale(1.08)' : 'none',
                  transition:
                    'opacity 160ms ease, transform 200ms cubic-bezier(0.2, 0.9, 0.25, 1), box-shadow 160ms ease',
                  width: 26,
                  '&:active': { transform: 'scale(0.9)' },
                }}
              >
                <TabAvatar
                  color={color}
                  radius={11}
                  size={22}
                  tab={window}
                  title={title}
                />
                {onScreen ? (
                  <Box
                    component="span"
                    sx={{
                      backgroundColor: 'primary.main',
                      border: `1.5px solid ${theme.palette.background.default}`,
                      borderRadius: '50%',
                      height: 8,
                      position: 'absolute',
                      right: -2,
                      top: -2,
                      width: 8,
                    }}
                  />
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
});
