import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { TabAvatar, colorFor } from '../MobileTabsOverlay.shared';
import { getOpenTabKey, type FolderSize } from '../mobileTabOrganization';
import type { OpenTab } from '../useOpenTabs';
import {
  MOBILE_TABS_DIALOG_Z,
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
} from '../mobileLayout';
import { BACK_PRIORITY, useAndroidBack } from '../../../utils/androidBack';
import { MOSAIC_KEY_ATTR, LIFT_CLASS, RunningDot } from './FolderTile';
import {
  FLIP_EASE,
  animateFromBox,
  animateToBox,
  measureBoxes,
  playFlip,
  prefersReducedMotion,
} from './flip';
import { moveId } from './homeGrid';
import { useLongPressReorder } from './useLongPressReorder';
import { useGoLayout } from '../../../layout/goLayout';
import { folderPanelGeometry, selectGoFolderPanelWide } from './goTabsGrid';

/** Above the phone bars (1200) and below the Tabs overlay and its dialogs. */
export const FOLDER_OVERLAY_Z = 1990;

const APP_ATTR = 'data-folder-app';
const ICON_ATTR = 'data-panel-icon';
const LABEL_ATTR = 'data-panel-label';
const OPEN_MS = 380;
const CLOSE_MS = 300;

type FolderOpenOverlayProps = {
  name: string;
  size: FolderSize;
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
  openKeys: Set<string>;
  activeKey: string | null;
  /** False plays the closing animation, then calls onExited. */
  open: boolean;
  /** The folder's tile on the home grid, to open out of and close into. */
  getSourceTile: () => HTMLElement | null;
  onRequestClose: () => void;
  onExited: () => void;
  onOpenApp: (tab: OpenTab) => void;
  onAppMenu: (tab: OpenTab) => void;
  onReorder: (tabKeys: string[]) => void;
  onRename: (name: string) => void;
  onSetSize: (size: FolderSize) => void;
  onDelete: () => void;
};

const centreSquare = (box: DOMRect, side: number) => ({
  left: box.left + box.width / 2 - side / 2,
  top: box.top + box.height / 2 - side / 2,
  width: side,
  height: side,
});

/**
 * An open folder, as on an Android home screen: the folder's tile grows into
 * a panel over a blurred home, its icons fly from the mosaic to their places,
 * and closing plays it backwards into the tile. Long-press an app to move it
 * (drag) or for its options (let go).
 */
export function FolderOpenOverlay({
  name,
  size,
  tabs,
  getTitle,
  openKeys,
  activeKey,
  open,
  getSourceTile,
  onRequestClose,
  onExited,
  onOpenApp,
  onAppMenu,
  onReorder,
  onRename,
  onSetSize,
  onDelete,
}: FolderOpenOverlayProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [settled, setSettled] = useState(prefersReducedMotion());
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 360 : window.innerWidth,
  }));

  const tabsByKey = useMemo(() => {
    const map = new Map<string, OpenTab>();
    tabs.forEach((tab) => map.set(getOpenTabKey(tab), tab));
    return map;
  }, [tabs]);
  const propKeys = useMemo(() => tabs.map((tab) => getOpenTabKey(tab)), [tabs]);
  // The live order while an app is being dragged; the folder's otherwise.
  const [dragKeys, setDragKeys] = useState<string[] | null>(null);
  const keys = dragKeys ?? propKeys;
  const pendingFlip = useRef<Map<string, DOMRect> | null>(null);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!editingName) setNameDraft(name);
  }, [editingName, name]);

  // GO tablets and landscape: a wider panel with more columns.
  const widePanel = useGoLayout(selectGoFolderPanelWide);
  const { panelWidth, columns } = folderPanelGeometry(
    viewport.width,
    widePanel
  );
  const cellWidth = (panelWidth - 24) / columns;
  const iconSize = Math.round(Math.min(60, cellWidth * 0.72));
  const iconRadius = Math.round(iconSize * 0.27);

  // Opening: everything starts where the tile is drawn on the home grid.
  useLayoutEffect(() => {
    const tile = getSourceTile();
    const reduced = prefersReducedMotion();
    backdropRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: reduced ? 1 : 260,
      easing: 'ease-out',
      fill: 'backwards',
    });
    if (reduced) return;
    const settleTimer = window.setTimeout(() => setSettled(true), OPEN_MS + 40);
    titleRef.current?.animate?.(
      [
        { opacity: 0, transform: 'translateY(14px) scale(0.94)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 320, delay: 60, easing: FLIP_EASE, fill: 'backwards' }
    );
    if (!tile || !bgRef.current || !gridRef.current) {
      bgRef.current?.animate?.(
        [
          { opacity: 0, transform: 'scale(0.9)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 260, easing: FLIP_EASE, fill: 'backwards' }
      );
      return () => window.clearTimeout(settleTimer);
    }
    const tileBox = tile.getBoundingClientRect();
    const mosaic = measureBoxes(tile, MOSAIC_KEY_ATTR);
    animateFromBox(bgRef.current, tileBox, { duration: OPEN_MS });
    const scrollBottom =
      scrollerRef.current?.getBoundingClientRect().bottom ?? Infinity;
    gridRef.current
      .querySelectorAll<HTMLElement>(`[${ICON_ATTR}]`)
      .forEach((icon) => {
        const key = icon.getAttribute(ICON_ATTR) || '';
        const box = icon.getBoundingClientRect();
        if (box.top > scrollBottom) {
          // Below the panel's fold: it would show outside the panel while
          // the panel cannot clip yet.
          icon.animate([{ opacity: 0 }, { opacity: 0 }], {
            duration: OPEN_MS,
          });
          return;
        }
        const from = mosaic.get(key);
        if (from) {
          animateFromBox(icon, from, { duration: OPEN_MS });
        } else {
          animateFromBox(icon, centreSquare(tileBox, 10), {
            duration: OPEN_MS,
            fromOpacity: 0,
          });
        }
      });
    gridRef.current
      .querySelectorAll<HTMLElement>(`[${LABEL_ATTR}]`)
      .forEach((label) => {
        const belowFold = label.getBoundingClientRect().top > scrollBottom;
        label.animate([{ opacity: 0 }, { opacity: belowFold ? 0 : 1 }], {
          duration: belowFold ? OPEN_MS : 200,
          delay: belowFold ? 0 : 190,
          fill: 'backwards',
        });
      });
    return () => window.clearTimeout(settleTimer);
    // Runs once, on mount: later renders must not replay the opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing: the same flight backwards, into the tile as it is now.
  const exitedRef = useRef(false);
  useLayoutEffect(() => {
    if (open) return;
    const done = () => {
      if (exitedRef.current) return;
      exitedRef.current = true;
      onExited();
    };
    const tile = getSourceTile();
    if (prefersReducedMotion()) {
      done();
      return;
    }
    setMenuAnchor(null);
    const animations: (Animation | null | undefined)[] = [];
    animations.push(
      backdropRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], {
        duration: CLOSE_MS,
        easing: 'ease-in',
        fill: 'forwards',
      })
    );
    titleRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], {
      duration: 140,
      fill: 'forwards',
    });
    gridRef.current
      ?.querySelectorAll<HTMLElement>(`[${LABEL_ATTR}]`)
      .forEach((label) =>
        label.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 110,
          fill: 'forwards',
        })
      );
    const scrolled = (scrollerRef.current?.scrollTop ?? 0) > 2;
    if (!tile || !bgRef.current || !gridRef.current || scrolled) {
      // No tile to land in (the folder went away), or the panel was
      // scrolled: shrink and fade where it is.
      [bgRef.current, gridRef.current].forEach((element) =>
        animations.push(
          element?.animate?.(
            [
              { opacity: 1, transform: 'none' },
              { opacity: 0, transform: 'scale(0.86)' },
            ],
            { duration: 220, easing: 'ease-in', fill: 'forwards' }
          )
        )
      );
    } else {
      const tileBox = tile.getBoundingClientRect();
      const mosaic = measureBoxes(tile, MOSAIC_KEY_ATTR);
      // Icons fly out of the panel's box, so it must stop clipping them.
      if (scrollerRef.current) scrollerRef.current.style.overflowY = 'visible';
      animations.push(
        animateToBox(bgRef.current, tileBox, { duration: CLOSE_MS })
      );
      const scrollBottom =
        scrollerRef.current?.getBoundingClientRect().bottom ?? Infinity;
      gridRef.current
        .querySelectorAll<HTMLElement>(`[${ICON_ATTR}]`)
        .forEach((icon) => {
          const key = icon.getAttribute(ICON_ATTR) || '';
          const to = mosaic.get(key);
          if (icon.getBoundingClientRect().top > scrollBottom) {
            icon.style.opacity = '0';
            return;
          }
          animations.push(
            to
              ? animateToBox(icon, to, { duration: CLOSE_MS })
              : animateToBox(icon, centreSquare(tileBox, 10), {
                  duration: CLOSE_MS,
                  toOpacity: 0,
                })
          );
        });
    }
    const running = animations.filter(Boolean) as Animation[];
    if (running.length === 0) {
      done();
      return;
    }
    const fallback = window.setTimeout(done, CLOSE_MS + 200);
    void Promise.all(running.map((animation) => animation.finished))
      .catch(() => undefined)
      .then(() => {
        window.clearTimeout(fallback);
        done();
      });
    return () => window.clearTimeout(fallback);
    // getSourceTile and onExited are read once per close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useAndroidBack(
    () => {
      if (!open) return false;
      if (editingName) {
        setEditingName(false);
        return true;
      }
      onRequestClose();
      return true;
    },
    { priority: BACK_PRIORITY.overlay }
  );

  const bindScroller = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
    setScroller(node);
  }, []);

  useLayoutEffect(() => {
    const before = pendingFlip.current;
    if (!before) return;
    pendingFlip.current = null;
    playFlip(gridRef.current, APP_ATTR, before, { duration: 260 });
  }, [keys]);

  const bindGrid = useCallback((node: HTMLDivElement | null) => {
    gridRef.current = node;
    setGridEl(node);
  }, []);

  useLongPressReorder({
    container: gridEl,
    scroller,
    itemAttr: APP_ATTR,
    enabled: open && settled,
    onMenu: (key) => {
      const tab = tabsByKey.get(key);
      if (tab) onAppMenu(tab);
    },
    onMove: (key, overKey) => {
      const current = dragKeys ?? propKeys;
      const next = moveId(current, key, current.indexOf(overKey));
      if (next === current) return;
      pendingFlip.current = measureBoxes(gridRef.current, APP_ATTR);
      setDragKeys(next);
    },
    onDrop: () => {
      if (dragKeys) onReorder(dragKeys);
    },
    onEnd: () => setDragKeys(null),
  });

  const commitName = () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (next && next !== name) onRename(next);
    else setNameDraft(name);
  };

  const isDark = theme.palette.mode === 'dark';

  // createPortal, not MUI's Portal: that one mounts its children a render
  // later, after the opening animation has looked for them.
  return createPortal(
    <>
      <Box
        sx={{
          inset: 0,
          pointerEvents: open ? 'auto' : 'none',
          position: 'fixed',
          zIndex: FOLDER_OVERLAY_Z,
        }}
      >
        <Box
          ref={backdropRef}
          aria-label={t('core:tabs_home.close_folder', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={onRequestClose}
          sx={{
            backdropFilter: 'blur(22px) saturate(1.25)',
            backgroundColor: alpha(
              theme.palette.background.default,
              isDark ? 0.62 : 0.5
            ),
            inset: 0,
            position: 'absolute',
            WebkitBackdropFilter: 'blur(22px) saturate(1.25)',
          }}
        />
        <Box
          sx={{
            alignItems: 'center',
            bottom: `calc(${SAFE_AREA_BOTTOM} + 24px)`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            left: 0,
            pointerEvents: 'none',
            position: 'absolute',
            right: 0,
            top: `calc(${SAFE_AREA_TOP} + 24px)`,
          }}
        >
          <Box
            ref={titleRef}
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 0.5,
              justifyContent: 'center',
              mb: 2.25,
              maxWidth: panelWidth,
              minHeight: 44,
              pl: 5,
              pointerEvents: 'auto',
              pr: 0.5,
              width: '100%',
            }}
          >
            {editingName ? (
              <InputBase
                autoFocus
                inputProps={{
                  'aria-label': t('core:tabs_home.folder_name', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                  enterKeyHint: 'done',
                }}
                onBlur={commitName}
                onChange={(event) => setNameDraft(event.target.value)}
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitName();
                  if (event.key === 'Escape') {
                    setNameDraft(name);
                    setEditingName(false);
                  }
                }}
                value={nameDraft}
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.08),
                  borderRadius: '14px',
                  flex: 1,
                  fontSize: 22,
                  fontWeight: 600,
                  px: 1.5,
                  '& input': { textAlign: 'center' },
                }}
              />
            ) : (
              <Typography
                onClick={() => setEditingName(true)}
                sx={{
                  color: 'text.primary',
                  cursor: 'text',
                  flex: 1,
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  minWidth: 0,
                  overflow: 'hidden',
                  textAlign: 'center',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </Typography>
            )}
            <IconButton
              aria-label={t('core:tabs_home.folder_options', {
                postProcess: 'capitalizeFirstChar',
              })}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              sx={{ color: 'text.secondary', flexShrink: 0 }}
            >
              <MoreHorizRoundedIcon />
            </IconButton>
          </Box>

          <Box
            sx={{
              maxHeight: '100%',
              minHeight: 0,
              pointerEvents: 'auto',
              position: 'relative',
              width: panelWidth,
            }}
          >
            <Box
              ref={bgRef}
              sx={{
                backgroundColor: alpha(
                  theme.palette.background.paper,
                  isDark ? 0.9 : 0.94
                ),
                borderRadius: '30px',
                boxShadow: `0 24px 60px ${alpha(
                  theme.palette.common.black,
                  isDark ? 0.45 : 0.18
                )}`,
                inset: 0,
                position: 'absolute',
              }}
            />
            <Box
              ref={bindScroller}
              sx={{
                maxHeight: `calc(100dvh - ${SAFE_AREA_TOP} - ${SAFE_AREA_BOTTOM} - 140px)`,
                overflowX: 'hidden',
                overflowY: settled ? 'auto' : 'visible',
                overscrollBehavior: 'contain',
                position: 'relative',
                px: '12px',
                py: '20px',
                scrollbarWidth: 'none',
                touchAction: 'pan-y',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              <Box
                ref={bindGrid}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  position: 'relative',
                  rowGap: '18px',
                  [`[data-reorder-lifted] .${LIFT_CLASS}`]: {
                    transform: 'scale(1.12)',
                  },
                }}
              >
                {keys.map((key) => {
                  const tab = tabsByKey.get(key);
                  if (!tab) return null;
                  const title = getTitle(tab);
                  const isActive = key === activeKey;
                  return (
                    <Box
                      key={key}
                      {...{ [APP_ATTR]: key }}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                        WebkitUserSelect: 'none',
                      }}
                    >
                      <Box
                        aria-label={title}
                        className={LIFT_CLASS}
                        component="button"
                        onClick={() => onOpenApp(tab)}
                        type="button"
                        {...{ [ICON_ATTR]: key }}
                        sx={{
                          background: 'none',
                          border: 0,
                          borderRadius: `${iconRadius}px`,
                          boxShadow: isActive
                            ? `0 0 0 2.5px ${theme.palette.primary.main}`
                            : 'none',
                          cursor: 'pointer',
                          height: iconSize,
                          p: 0,
                          position: 'relative',
                          transition:
                            'transform 200ms cubic-bezier(0.2, 0.9, 0.25, 1)',
                          width: iconSize,
                          '&:active': { transform: 'scale(0.92)' },
                        }}
                      >
                        <TabAvatar
                          color={colorFor(title)}
                          radius={iconRadius}
                          size={iconSize}
                          tab={tab}
                          title={title}
                        />
                        {openKeys.has(key) ? (
                          <RunningDot size={iconSize} />
                        ) : null}
                      </Box>
                      <Typography
                        {...{ [LABEL_ATTR]: key }}
                        sx={{
                          color: 'text.primary',
                          fontSize: 12,
                          fontWeight: 500,
                          lineHeight: 1.3,
                          maxWidth: '96%',
                          mt: '7px',
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
                })}
              </Box>
              {keys.length === 0 ? (
                <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                    {t('core:tabs_overlay.folder_empty', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Typography
                    sx={{ color: 'text.secondary', fontSize: 12.5, mt: 0.75 }}
                  >
                    {t('core:tabs_home.folder_empty_hint', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
              ) : null}
            </Box>
          </Box>
        </Box>
      </Box>

      <Menu
        anchorEl={menuAnchor}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={() => setMenuAnchor(null)}
        open={Boolean(menuAnchor) && open}
        slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 210 } } }}
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setEditingName(true);
          }}
        >
          <ListItemIcon>
            <DriveFileRenameOutlineRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('core:tabs_home.rename_folder', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onSetSize(size === 'large' ? 'small' : 'large');
          }}
        >
          <ListItemIcon>
            {size === 'large' ? (
              <ViewModuleRoundedIcon fontSize="small" />
            ) : (
              <GridViewRoundedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {size === 'large'
              ? t('core:tabs_home.make_small', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:tabs_home.make_large', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onDelete();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <DeleteOutlineRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('core:tabs_home.delete_folder', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ListItemText>
        </MenuItem>
      </Menu>
    </>,
    document.body
  );
}
