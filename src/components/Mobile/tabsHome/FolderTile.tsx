import { memo, type MouseEvent } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { TabAvatar, colorFor } from '../MobileTabsOverlay.shared';
import { getOpenTabKey, type FolderSize } from '../mobileTabOrganization';
import type { OpenTab } from '../useOpenTabs';
import { planMosaic, type HomeGridMetrics } from './homeGrid';

/** Marks a mini icon inside a folder tile, so the open folder can fly from it. */
export const MOSAIC_KEY_ATTR = 'data-mosaic-key';
/** Marks the folder tile itself (the rounded square, without its label). */
export const FOLDER_TILE_ATTR = 'data-folder-tile';

/**
 * The part of an item that grows when it is lifted by a long press; the grid
 * styles `[data-reorder-lifted] .go-lift`.
 */
export const LIFT_CLASS = 'go-lift';

/** The rounded glass square of a folder, in both themes. */
export const folderTileSurface = (theme: Theme) => ({
  backgroundColor: alpha(
    theme.palette.text.primary,
    theme.palette.mode === 'dark' ? 0.11 : 0.07
  ),
  boxShadow: `inset 0 0 0 1px ${alpha(
    theme.palette.text.primary,
    theme.palette.mode === 'dark' ? 0.07 : 0.05
  )}`,
});

type MosaicProps = {
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
  size: number;
};

/**
 * A small folder icon: up to nine mini app icons, three by three, on the
 * rounded glass square. Used on the Pinned home and in the Tabs overlay.
 */
export function SmallFolderMosaic({ tabs, getTitle, size }: MosaicProps) {
  const theme = useTheme();
  const padding = Math.max(4, Math.round(size * 0.14));
  const gap = Math.max(1.5, Math.round(size * 0.055 * 2) / 2);
  const mini = Math.max(4, Math.floor((size - 2 * padding - 2 * gap) / 3));
  const items = tabs.slice(0, 9);
  return (
    <Box
      {...{ [FOLDER_TILE_ATTR]: 'small' }}
      sx={{
        ...folderTileSurface(theme),
        alignContent: 'start',
        borderRadius: `${Math.round(size * 0.27)}px`,
        boxSizing: 'border-box',
        display: 'grid',
        flexShrink: 0,
        gap: `${gap}px`,
        gridTemplateColumns: `repeat(3, ${mini}px)`,
        gridAutoRows: `${mini}px`,
        height: size,
        justifyContent: 'center',
        overflow: 'hidden',
        padding: `${padding}px`,
        width: size,
      }}
    >
      {items.map((tab) => {
        const title = getTitle(tab);
        return (
          <Box
            key={getOpenTabKey(tab)}
            {...{ [MOSAIC_KEY_ATTR]: getOpenTabKey(tab) }}
            sx={{ height: mini, width: mini }}
          >
            <TabAvatar
              color={colorFor(title)}
              radius={Math.max(1.5, mini * 0.28)}
              size={mini}
              tab={tab}
              title={title}
            />
          </Box>
        );
      })}
    </Box>
  );
}

type FolderTileProps = {
  folderId: string;
  name: string;
  size: FolderSize;
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
  metrics: HomeGridMetrics;
  /** Open tabs (keys), marked with a dot like running apps. */
  openKeys: Set<string>;
  /** While the folder is open its tile makes room for the opened panel. */
  hidden: boolean;
  onOpenFolder: (folderId: string) => void;
  onOpenApp: (tab: OpenTab) => void;
};

/**
 * One folder on the Pinned home. A small folder is a single cell that opens
 * the folder. A large one covers two by two cells and its apps open with one
 * tap; past nine apps the last cell shows the rest and opens the folder.
 */
export const FolderTile = memo(function FolderTile({
  folderId,
  name,
  size,
  tabs,
  getTitle,
  metrics,
  openKeys,
  hidden,
  onOpenFolder,
  onOpenApp,
}: FolderTileProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isLarge = size === 'large';
  const tileWidth = isLarge ? metrics.largeWidth : metrics.icon;
  const tileHeight = isLarge ? metrics.largeHeight : metrics.icon;
  const openFolder = () => onOpenFolder(folderId);

  const label = (
    <Typography
      onClick={openFolder}
      sx={{
        color: 'text.primary',
        fontSize: 12.5,
        fontWeight: 500,
        height: metrics.labelHeight,
        lineHeight: `${metrics.labelHeight}px`,
        maxWidth: isLarge ? tileWidth : metrics.cell - 4,
        mt: `${metrics.labelGap}px`,
        overflow: 'hidden',
        textAlign: 'center',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </Typography>
  );

  let tile;
  if (!isLarge) {
    tile = (
      <Box
        aria-label={t('core:tabs_home.open_folder', {
          name,
          postProcess: 'capitalizeFirstChar',
        })}
        component="button"
        onClick={openFolder}
        type="button"
        sx={{
          background: 'none',
          border: 0,
          borderRadius: `${metrics.smallRadius}px`,
          cursor: 'pointer',
          display: 'block',
          p: 0,
          transition: 'transform 160ms ease',
          '&:active': { transform: 'scale(0.94)' },
        }}
      >
        <SmallFolderMosaic
          getTitle={getTitle}
          size={metrics.icon}
          tabs={tabs}
        />
      </Box>
    );
  } else {
    const { shown, more } = planMosaic(tabs, 'large');
    const inner = metrics.largeInnerIcon;
    const innerRadius = Math.round(inner * 0.27);
    const miniGap = 2;
    const mini = Math.floor((inner - miniGap) / 2);
    tile = (
      <Box
        {...{ [FOLDER_TILE_ATTR]: 'large' }}
        onClick={openFolder}
        role="group"
        aria-label={name}
        sx={{
          ...folderTileSurface(theme),
          alignContent: 'space-evenly',
          borderRadius: `${metrics.largeRadius}px`,
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: `repeat(3, ${inner}px)`,
          gridTemplateRows: `repeat(3, ${inner}px)`,
          height: tileHeight,
          justifyContent: 'space-between',
          px: `${metrics.largePadding}px`,
          py: `${Math.round(metrics.largePadding * 0.6)}px`,
          width: tileWidth,
        }}
      >
        {shown.map((tab) => {
          const key = getOpenTabKey(tab);
          const title = getTitle(tab);
          return (
            <Box
              key={key}
              aria-label={title}
              component="button"
              type="button"
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                onOpenApp(tab);
              }}
              {...{ [MOSAIC_KEY_ATTR]: key }}
              sx={{
                background: 'none',
                border: 0,
                cursor: 'pointer',
                height: inner,
                p: 0,
                position: 'relative',
                transition: 'transform 140ms ease',
                width: inner,
                '&:active': { transform: 'scale(0.9)' },
              }}
            >
              <TabAvatar
                color={colorFor(title)}
                radius={innerRadius}
                size={inner}
                tab={tab}
                title={title}
              />
              {openKeys.has(key) ? <RunningDot size={inner} /> : null}
            </Box>
          );
        })}
        {more.length > 0 ? (
          <Box
            aria-label={t('core:tabs_home.more_apps', {
              amount: more.length,
              postProcess: 'capitalizeFirstChar',
            })}
            component="button"
            type="button"
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              openFolder();
            }}
            sx={{
              alignContent: 'center',
              background: 'none',
              border: 0,
              cursor: 'pointer',
              display: 'grid',
              gap: `${miniGap}px`,
              gridTemplateColumns: `repeat(2, ${mini}px)`,
              gridAutoRows: `${mini}px`,
              height: inner,
              justifyContent: 'center',
              p: 0,
              width: inner,
            }}
          >
            {more.slice(0, 4).map((tab) => {
              const key = getOpenTabKey(tab);
              const title = getTitle(tab);
              return (
                <Box key={key} {...{ [MOSAIC_KEY_ATTR]: key }}>
                  <TabAvatar
                    color={colorFor(title)}
                    radius={Math.round(mini * 0.28)}
                    size={mini}
                    tab={tab}
                    title={title}
                  />
                </Box>
              );
            })}
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        visibility: hidden ? 'hidden' : 'visible',
      }}
    >
      <Box
        className={LIFT_CLASS}
        sx={{
          height: tileHeight,
          transition: 'transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1)',
          width: tileWidth,
        }}
      >
        {tile}
      </Box>
      {label}
    </Box>
  );
});

/** A small dot under an app that is open in a tab. */
export function RunningDot({ size }: { size: number }) {
  return (
    <Box
      component="span"
      sx={{
        backgroundColor: 'primary.main',
        borderRadius: '50%',
        bottom: -Math.max(3, size * 0.1),
        height: Math.max(3, Math.round(size * 0.09)),
        left: '50%',
        position: 'absolute',
        transform: 'translateX(-50%)',
        width: Math.max(3, Math.round(size * 0.09)),
      }}
    />
  );
}
