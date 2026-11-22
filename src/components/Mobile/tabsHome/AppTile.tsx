import { memo } from 'react';
import { Box, Typography } from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { TabAvatar, colorFor } from '../MobileTabsOverlay.shared';
import type { OpenTab } from '../useOpenTabs';
import { LIFT_CLASS, RunningDot } from './FolderTile';
import type { HomeGridMetrics } from './homeGrid';

/** Marks the picture of a tile, where a dragged app drops into it. */
export const TILE_ICON_ATTR = 'data-tile-icon';

type AppTileProps = {
  /** The app or the page, as a saved tab: what opens, and its picture. */
  tab: OpenTab;
  title: string;
  metrics: HomeGridMetrics;
  /** A bookmark (a page), not a pinned app: it carries a bookmark mark. */
  isBookmark: boolean;
  /** Open in a tab: a dot under it, like a running app. */
  isOpen: boolean;
  onOpen: (tab: OpenTab) => void;
};

/**
 * A pinned app or a bookmark on the Pinned tab: one cell, the app's picture
 * and its name, like an app on a phone's home screen. A bookmark shows its
 * app's picture with a bookmark mark, as on the desktop Hub's launcher.
 */
export const AppTile = memo(function AppTile({
  tab,
  title,
  metrics,
  isBookmark,
  isOpen,
  onOpen,
}: AppTileProps) {
  const size = metrics.icon;
  const badge = Math.max(16, Math.round(size * 0.36));
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <Box
        className={LIFT_CLASS}
        {...{ [TILE_ICON_ATTR]: 'true' }}
        sx={{
          height: size,
          position: 'relative',
          transition: 'transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1)',
          width: size,
        }}
      >
        <Box
          aria-label={title}
          component="button"
          onClick={() => onOpen(tab)}
          type="button"
          sx={{
            background: 'none',
            border: 0,
            borderRadius: `${metrics.smallRadius}px`,
            cursor: 'pointer',
            display: 'block',
            height: size,
            p: 0,
            transition: 'transform 160ms ease',
            width: size,
            '&:active': { transform: 'scale(0.94)' },
          }}
        >
          <TabAvatar
            color={colorFor(title)}
            radius={metrics.smallRadius}
            size={size}
            tab={tab}
            title={title}
          />
        </Box>
        {isBookmark ? (
          <Box
            aria-hidden
            sx={(theme) => ({
              alignItems: 'center',
              backgroundColor: theme.palette.background.default,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '50%',
              bottom: -3,
              color: theme.palette.text.secondary,
              display: 'flex',
              height: badge,
              justifyContent: 'center',
              pointerEvents: 'none',
              position: 'absolute',
              right: -3,
              width: badge,
            })}
          >
            <BookmarkIcon sx={{ fontSize: Math.round(badge * 0.62) }} />
          </Box>
        ) : null}
        {isOpen ? <RunningDot size={size} /> : null}
      </Box>
      <Typography
        onClick={() => onOpen(tab)}
        sx={{
          color: 'text.primary',
          fontSize: 12.5,
          fontWeight: 500,
          height: metrics.labelHeight,
          lineHeight: `${metrics.labelHeight}px`,
          maxWidth: metrics.cell - 4,
          mt: `${metrics.labelGap}px`,
          overflow: 'hidden',
          textAlign: 'center',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </Typography>
    </Box>
  );
});
