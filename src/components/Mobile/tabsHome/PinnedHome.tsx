import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ClearAllRoundedIcon from '@mui/icons-material/ClearAllRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded';
import {
  filterAppTabsForMobile,
  isQChatOpenTab,
} from '../../../utils/openQChatTab';
import { MobileTabOptionsDialog } from '../MobileTabOptionsDialog';
import {
  getFolderSize,
  getOpenTabKey,
  resolveFolderTab,
  type FolderSize,
} from '../mobileTabOrganization';
import { useMobileTabOrganization } from '../useMobileTabOrganization';
import {
  closeAllOpenTabs,
  closeOpenTab,
  launchAppWindow,
  openOrSelectTab,
  useOpenTabs,
  type OpenTab,
} from '../useOpenTabs';
import { MOBILE_TABS_DIALOG_Z } from '../mobileLayout';
import {
  FOLDER_TILE_ATTR,
  FolderTile,
  LIFT_CLASS,
  folderTileSurface,
} from './FolderTile';
import { FolderOpenOverlay } from './FolderOpenOverlay';
import { TabPreviewCard } from './TabPreviewCard';
import { useShownWindows } from './useShownWindows';
import { groupTabsIntoStacks, type TabStack } from './tabStacks';
import { measureBoxes, playFlip } from './flip';
import {
  hitTestSlot,
  homeGridMetrics,
  moveId,
  rowPlacementForFlatOrder,
} from './homeGrid';
import { edgeScrollStep, useLongPressReorder } from './useLongPressReorder';
import { DevModeButton } from '../devMode/DevModeButton';
import { canOpenDevZips, goDevModeEnabledAtom } from '../devMode/devModeApp';

const FOLDER_ATTR = 'data-home-folder';
const FLIP_STALE_MS = 700;
const CARD_ATTR = 'data-home-tab';
const CARRY_OVER_ATTR = 'data-carry-over';
/** A carried app counts as over a folder this far around its tile. */
const CARRY_HIT_SLOP_PX = 10;

type PinnedHomeProps = {
  /** The library and this tab are on screen. */
  isVisible: boolean;
  /** The library's scroller, locked while a folder is dragged. */
  scrollParent: HTMLElement | null;
  /** Leaves for the Official apps tab (empty state). */
  onBrowseApps: () => void;
};

/** `carried`: closed by dragging an app out; its tile shows at once. */
type OpenFolderState = { id: string; open: boolean; carried?: boolean } | null;
/** An app dragged out of an open folder, still under the finger. */
type CarryState = { tabKey: string; fromId: string } | null;

/**
 * The Q-Apps library's first tab on phones: the Tabs folders full screen,
 * laid out like a phone's home screen (small folders take a cell, large ones
 * two by two), and the open tabs as cards with a picture of each page. It is
 * the same data as the Tabs overlay, so a change in one shows in the other.
 */
export function PinnedHome({
  isVisible,
  scrollParent,
  onBrowseApps,
}: PinnedHomeProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const org = useMobileTabOrganization();
  const { tabs: rawTabs, selectedTab: rawSelectedTab } = useOpenTabs();
  const tabs = useMemo(() => filterAppTabsForMobile(rawTabs), [rawTabs]);
  const selectedTab =
    rawSelectedTab && !isQChatOpenTab(rawSelectedTab) ? rawSelectedTab : null;
  const activeKey = selectedTab ? getOpenTabKey(selectedTab) : null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);
  // Elements too: the grids come and go (first folder, first open tab) and
  // the long-press listeners must follow them.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [cardsEl, setCardsEl] = useState<HTMLDivElement | null>(null);
  const bindGrid = useCallback((node: HTMLDivElement | null) => {
    gridRef.current = node;
    setGridEl(node);
  }, []);
  const bindCards = useCallback((node: HTMLDivElement | null) => {
    cardsRef.current = node;
    setCardsEl(node);
  }, []);
  const [width, setWidth] = useState(0);
  const metrics = useMemo(() => homeGridMetrics(width), [width]);

  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Boxes measured right before a change, for the FLIP that follows it. A
  // change that moves nothing leaves them unused; they go stale after a
  // moment so a later, unrelated change does not replay them.
  const pendingFlip = useRef<{
    at: number;
    boxes: Map<string, DOMRect>;
  } | null>(null);
  const pendingCardFlip = useRef<{
    at: number;
    boxes: Map<string, DOMRect>;
  } | null>(null);
  const [openFolder, setOpenFolder] = useState<OpenFolderState>(null);
  const [folderMenu, setFolderMenu] = useState<{
    id: string;
    anchor: HTMLElement;
  } | null>(null);
  const [renaming, setRenaming] = useState<
    | { kind: 'folder'; id: string; value: string }
    | { kind: 'tab'; tab: OpenTab; value: string }
    | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  const lastPendingDelete = useRef(pendingDelete);
  if (pendingDelete) lastPendingDelete.current = pendingDelete;
  const [optionsTab, setOptionsTab] = useState<OpenTab | null>(null);
  const [closingStackKeys, setClosingStackKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [carry, setCarry] = useState<CarryState>(null);
  const [carryOverId, setCarryOverId] = useState<string | null>(null);
  // Refs as well: the drag reports every frame, before a render catches up.
  const carryRef = useRef<CarryState>(null);
  const carryOverRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const update = () => {
      const next = node.clientWidth;
      if (next > 0) setWidth(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const tabsByKey = useMemo(() => {
    const map = new Map<string, OpenTab>();
    tabs.forEach((tab) => map.set(getOpenTabKey(tab), tab));
    return map;
  }, [tabs]);
  const openKeys = useMemo(() => new Set(tabsByKey.keys()), [tabsByKey]);
  const stacks = useMemo(
    () => groupTabsIntoStacks(tabs, selectedTab?.tabId ?? null),
    [selectedTab?.tabId, tabs]
  );
  const { shownFor, pick } = useShownWindows(isVisible);

  const folderTabsMap = useMemo(() => {
    const map = new Map<string, OpenTab[]>();
    org.folders.forEach((folder) => {
      map.set(
        folder.id,
        folder.tabKeys
          .map((key) =>
            resolveFolderTab(
              key,
              tabsByKey.get(key),
              org.organization.savedTabs
            )
          )
          .filter(Boolean) as OpenTab[]
      );
    });
    return map;
  }, [org.folders, org.organization.savedTabs, tabsByKey]);

  const foldersById = useMemo(
    () => new Map(org.folders.map((folder) => [folder.id, folder])),
    [org.folders]
  );
  const folderIds = useMemo(
    () => dragOrder ?? org.folders.map((folder) => folder.id),
    [dragOrder, org.folders]
  );

  // Any change in the folders' order or sizes glides into place.
  const layoutKey = `${folderIds.join('|')}#${org.folders
    .map((folder) => `${folder.id}:${getFolderSize(folder)}`)
    .join('|')}#${width}`;
  useLayoutEffect(() => {
    const before = pendingFlip.current;
    pendingFlip.current = null;
    if (!before || performance.now() - before.at > FLIP_STALE_MS) return;
    playFlip(gridRef.current, FOLDER_ATTR, before.boxes, { duration: 300 });
  }, [layoutKey]);

  const tabsKey = tabs.map((tab) => tab.tabId).join('|');
  useLayoutEffect(() => {
    const before = pendingCardFlip.current;
    pendingCardFlip.current = null;
    if (before && performance.now() - before.at < FLIP_STALE_MS * 2) {
      playFlip(cardsRef.current, CARD_ATTR, before.boxes, { duration: 300 });
    }
    setClosingStackKeys((prev) => {
      if (prev.size === 0) return prev;
      const open = new Set(stacks.map((stack) => stack.key));
      const next = new Set([...prev].filter((key) => open.has(key)));
      return next.size === prev.size ? prev : next;
    });
    // Only a change in which tabs are open plays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey]);

  const captureFolderLayout = () => {
    pendingFlip.current = {
      at: performance.now(),
      boxes: measureBoxes(gridRef.current, FOLDER_ATTR),
    };
  };

  // A folder can only be open while its tab is on screen; leaving (an app
  // opened, another library tab, another section) drops it at once.
  useEffect(() => {
    if (!isVisible && openFolder) setOpenFolder(null);
  }, [isVisible, openFolder]);
  useEffect(() => {
    // Deleted (here or in the Tabs overlay) while open.
    if (openFolder && !foldersById.has(openFolder.id)) setOpenFolder(null);
  }, [foldersById, openFolder]);

  const getFolderElement = useCallback(
    (folderId: string) =>
      gridRef.current?.querySelector<HTMLElement>(
        `[${FOLDER_ATTR}="${CSS.escape(folderId)}"]`
      ) ?? null,
    []
  );

  const handleOpenFolder = useCallback((folderId: string) => {
    setOpenFolder({ id: folderId, open: true });
  }, []);

  const handleOpenApp = useCallback((tab: OpenTab) => {
    setOpenFolder(null);
    launchAppWindow(tab);
  }, []);

  const getFolderTile = useCallback(
    (folderId: string) =>
      getFolderElement(folderId)?.querySelector<HTMLElement>(
        `[${FOLDER_TILE_ATTR}]`
      ) ?? null,
    [getFolderElement]
  );

  // An app dragged out of an open folder: the folder fades, the home grid
  // shows, and the app goes into whichever folder it is let go over.
  const startCarry = (tabKey: string) => {
    if (!openFolder) return;
    const next = { tabKey, fromId: openFolder.id };
    carryRef.current = next;
    setCarry(next);
    setOpenFolder((prev) =>
      prev ? { ...prev, open: false, carried: true } : prev
    );
  };

  const moveCarry = (x: number, y: number) => {
    const current = carryRef.current;
    if (!current) return;
    if (scrollParent) {
      const step = edgeScrollStep(scrollParent.getBoundingClientRect(), y);
      if (step !== 0) scrollParent.scrollTop += step;
    }
    const tiles = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>(`[${FOLDER_ATTR}]`) ?? []
    ).map((element) => ({
      id: element.getAttribute(FOLDER_ATTR) || '',
      rect: (
        element.querySelector(`[${FOLDER_TILE_ATTR}]`) ?? element
      ).getBoundingClientRect(),
    }));
    const overId = hitTestSlot(tiles, x, y, current.fromId, -CARRY_HIT_SLOP_PX);
    if (overId !== carryOverRef.current) {
      carryOverRef.current = overId;
      setCarryOverId(overId);
      if (overId) navigator.vibrate?.(6);
    }
  };

  const dropCarry = (tabKey: string) => {
    const current = carryRef.current;
    if (!current) return null;
    const targetId = carryOverRef.current;
    const tab = folderTabsMap
      .get(current.fromId)
      ?.find((item) => getOpenTabKey(item) === tabKey);
    if (targetId && tab && foldersById.has(targetId)) {
      void org.addTabToFolder(tab, targetId);
      return getFolderTile(targetId)?.getBoundingClientRect() ?? null;
    }
    // Let go over nothing: back into its own folder.
    return getFolderTile(current.fromId)?.getBoundingClientRect() ?? null;
  };

  const endCarry = () => {
    carryRef.current = null;
    carryOverRef.current = null;
    setCarry(null);
    setCarryOverId(null);
  };

  useLongPressReorder({
    container: gridEl,
    scroller: scrollParent,
    itemAttr: FOLDER_ATTR,
    enabled: isVisible && !openFolder,
    onMenu: (id, element) => {
      const tile = element.querySelector<HTMLElement>(`.${LIFT_CLASS}`);
      setFolderMenu({ id, anchor: tile ?? element });
    },
    onMove: (id, overId) => {
      const current = dragOrder ?? org.folders.map((folder) => folder.id);
      const next = moveId(current, id, current.indexOf(overId));
      captureFolderLayout();
      setDragOrder(next);
    },
    onDrop: (id) => {
      if (!dragOrder) return;
      const placement = rowPlacementForFlatOrder(org.folders, dragOrder, id);
      if (placement) {
        void org.moveFolderToRow(id, placement.row, placement.beforeFolderId);
      }
    },
    onEnd: () => setDragOrder(null),
  });

  useLongPressReorder({
    container: cardsEl,
    itemAttr: CARD_ATTR,
    enabled: isVisible,
    allowDrag: false,
    onMenu: (stackKey) => {
      const stack = stacks.find((item) => item.key === stackKey);
      if (stack) setOptionsTab(shownFor(stack));
    },
    onMove: () => undefined,
    onDrop: () => undefined,
  });

  // Closing a card closes its last window with the card; with several
  // windows the card stays and shows the next one.
  const closeStack = (stack: TabStack) => {
    if (stack.tabs.length > 1) {
      closeOneTab(shownFor(stack));
      return;
    }
    if (closingStackKeys.has(stack.key)) return;
    setClosingStackKeys((prev) => new Set(prev).add(stack.key));
    window.setTimeout(() => {
      pendingCardFlip.current = {
        at: performance.now(),
        boxes: measureBoxes(cardsRef.current, CARD_ATTR),
      };
      stack.tabs.forEach((tab) => closeOpenTab(String(tab.tabId || '')));
    }, 170);
  };

  const closeOneTab = (tab: OpenTab) => {
    pendingCardFlip.current = {
      at: performance.now(),
      boxes: measureBoxes(cardsRef.current, CARD_ATTR),
    };
    closeOpenTab(String(tab.tabId || ''));
  };

  const setSize = (folderId: string, size: FolderSize) => {
    captureFolderLayout();
    org.setFolderSize(folderId, size);
  };

  const requestDelete = (folderId: string) => {
    const folder = foldersById.get(folderId);
    if (!folder) return;
    const count = folderTabsMap.get(folderId)?.length ?? 0;
    if (count === 0) {
      captureFolderLayout();
      void org.deleteFolder(folderId);
      return;
    }
    setPendingDelete({ id: folderId, name: folder.name, count });
  };

  const createFolder = async () => {
    captureFolderLayout();
    const name = t('core:tabs_home.new_folder_name', {
      postProcess: 'capitalizeFirstChar',
    });
    const id = await org.createFolder(name);
    if (id) setRenaming({ kind: 'folder', id, value: name });
  };

  const commitRename = () => {
    const current = renaming;
    setRenaming(null);
    if (!current || !current.value.trim()) return;
    if (current.kind === 'folder') {
      void org.renameFolder(current.id, current.value);
    } else {
      void org.renameTab(current.tab, current.value);
    }
  };

  const openFolderData = openFolder ? foldersById.get(openFolder.id) : null;
  const menuFolder = folderMenu ? foldersById.get(folderMenu.id) : null;
  const deleteText = pendingDelete ?? lastPendingDelete.current;
  const hasFolders = org.folders.length > 0;
  const showDevMode = useAtomValue(goDevModeEnabledAtom) && canOpenDevZips();
  const pillSx = {
    alignItems: 'center',
    border: `1px dashed ${alpha(theme.palette.text.primary, 0.22)}`,
    borderRadius: 999,
    color: 'text.secondary',
    display: 'inline-flex',
    fontSize: 13,
    fontWeight: 600,
    gap: 0.6,
    px: 1.75,
    py: 0.75,
    '&:active': {
      backgroundColor: alpha(theme.palette.text.primary, 0.06),
    },
  } as const;

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'relative',
        pt: 0.5,
        // The lift of a long-pressed folder.
        [`[data-reorder-lifted] .${LIFT_CLASS}`]: {
          transform: 'scale(1.08)',
        },
        // The folder a carried app would go into.
        [`[${CARRY_OVER_ATTR}] .${LIFT_CLASS}`]: {
          transform: 'scale(1.1)',
        },
        [`[${CARRY_OVER_ATTR}] [${FOLDER_TILE_ATTR}]`]: {
          boxShadow: `0 0 0 2.5px ${theme.palette.primary.main}`,
        },
      }}
    >
      {hasFolders ? (
        <Box
          ref={bindGrid}
          sx={{
            display: 'grid',
            gridAutoFlow: 'row dense',
            gridAutoRows: `${metrics.row}px`,
            gridTemplateColumns: `repeat(${metrics.columns}, minmax(0, 1fr))`,
            position: 'relative',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {width > 0 &&
            folderIds.map((id) => {
              const folder = foldersById.get(id);
              if (!folder) return null;
              const size = getFolderSize(folder);
              const span = size === 'large' ? 2 : 1;
              const folderTabs = folderTabsMap.get(id) || [];
              return (
                <Box
                  key={id}
                  {...{ [FOLDER_ATTR]: id }}
                  {...(carryOverId === id ? { [CARRY_OVER_ATTR]: 'true' } : {})}
                  sx={{
                    display: 'flex',
                    gridColumn: `span ${span}`,
                    gridRow: `span ${span}`,
                    justifyContent: 'center',
                  }}
                >
                  <FolderTile
                    folderId={id}
                    getTitle={org.getTabTitle}
                    hidden={openFolder?.id === id && !openFolder.carried}
                    metrics={metrics}
                    name={folder.name}
                    onOpenApp={handleOpenApp}
                    onOpenFolder={handleOpenFolder}
                    openKeys={openKeys}
                    size={size}
                    tabs={
                      carry?.fromId === id
                        ? folderTabs.filter(
                            (tab) => getOpenTabKey(tab) !== carry.tabKey
                          )
                        : folderTabs
                    }
                  />
                </Box>
              );
            })}
        </Box>
      ) : (
        <Box ref={bindGrid}>
          {org.ready ? <PinnedEmptyState onBrowseApps={onBrowseApps} /> : null}
        </Box>
      )}

      {hasFolders || showDevMode ? (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            justifyContent: 'center',
            mb: 1,
            mt: 0.5,
          }}
        >
          {hasFolders ? (
            <ButtonBase onClick={() => void createFolder()} sx={pillSx}>
              <AddRoundedIcon sx={{ fontSize: 18 }} />
              {t('core:tabs_home.new_folder', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ButtonBase>
          ) : null}
          {/* Settings → System: open a Q-App zip from the phone. */}
          {showDevMode ? <DevModeButton sx={pillSx} /> : null}
        </Box>
      ) : null}

      {tabs.length > 0 ? (
        <Box sx={{ mt: hasFolders ? 2.5 : 1 }}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              mb: 1.25,
              px: 0.5,
            }}
          >
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.75 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
                {t('core:tabs_home.open_tabs', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Box
                component="span"
                sx={{
                  backgroundColor: alpha(theme.palette.primary.main, 0.16),
                  borderRadius: 999,
                  color: 'primary.main',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: '20px',
                  minWidth: 20,
                  px: 0.75,
                  textAlign: 'center',
                }}
              >
                {tabs.length}
              </Box>
            </Box>
            <ButtonBase
              onClick={() => closeAllOpenTabs()}
              sx={{
                alignItems: 'center',
                borderRadius: 999,
                color: 'error.main',
                display: 'inline-flex',
                fontSize: 13,
                fontWeight: 600,
                gap: 0.4,
                px: 1,
                py: 0.5,
                '&:active': {
                  backgroundColor: alpha(theme.palette.error.main, 0.12),
                },
              }}
            >
              <ClearAllRoundedIcon sx={{ fontSize: 18 }} />
              {t('core:tabs_home.close_all', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ButtonBase>
          </Box>
          <Box
            ref={bindCards}
            sx={{
              display: 'grid',
              gap: '14px 12px',
              gridTemplateColumns:
                metrics.columns > 4
                  ? 'repeat(auto-fill, minmax(170px, 1fr))'
                  : 'repeat(2, minmax(0, 1fr))',
              position: 'relative',
            }}
          >
            {stacks.map((stack, index) => {
              const shown = shownFor(stack);
              const title = org.getTabTitle(shown);
              return (
                <Box
                  key={stack.key}
                  {...{ [CARD_ATTR]: stack.key }}
                  sx={{ minWidth: 0 }}
                >
                  <TabPreviewCard
                    activeWindowId={
                      selectedTab?.tabId ? String(selectedTab.tabId) : null
                    }
                    closeLabel={t('core:tabs_home.close_tab', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    closing={closingStackKeys.has(stack.key)}
                    colorKey={org.getTabTitle(stack.lead)}
                    index={index}
                    isActive={selectedTab?.tabId === shown.tabId}
                    onClose={() => closeStack(stack)}
                    onPickWindow={(tab) => pick(stack.key, tab)}
                    onSelect={() => openOrSelectTab(shown)}
                    tab={shown}
                    title={title}
                    windowLabel={(position) =>
                      t('core:tabs_home.window_n', {
                        amount: position,
                        postProcess: 'capitalizeFirstChar',
                      })
                    }
                    windows={stack.tabs}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      ) : null}

      {openFolder && openFolderData ? (
        <FolderOpenOverlay
          activeKey={activeKey}
          getSourceTile={() => getFolderTile(openFolder.id)}
          getTitle={org.getTabTitle}
          name={openFolderData.name}
          onAppMenu={(tab) => setOptionsTab(tab)}
          onCarryDrop={dropCarry}
          onCarryEnd={endCarry}
          onCarryMove={(_key, x, y) => moveCarry(x, y)}
          onDelete={() => requestDelete(openFolder.id)}
          onExited={() => setOpenFolder(null)}
          onOpenApp={handleOpenApp}
          onRename={(name) => void org.renameFolder(openFolder.id, name)}
          onDragOut={startCarry}
          onReorder={(keys) => org.setFolderTabOrder(openFolder.id, keys)}
          onRequestClose={() =>
            setOpenFolder((prev) => (prev ? { ...prev, open: false } : prev))
          }
          onSetSize={(size) => setSize(openFolder.id, size)}
          open={openFolder.open}
          openKeys={openKeys}
          size={getFolderSize(openFolderData)}
          tabs={folderTabsMap.get(openFolder.id) || []}
        />
      ) : null}

      <Menu
        anchorEl={folderMenu?.anchor ?? null}
        anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
        onClose={() => setFolderMenu(null)}
        open={Boolean(folderMenu && menuFolder)}
        slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 210 } } }}
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
        transformOrigin={{ horizontal: 'center', vertical: 'top' }}
      >
        <MenuItem
          onClick={() => {
            const id = folderMenu?.id;
            setFolderMenu(null);
            if (id) handleOpenFolder(id);
          }}
        >
          <ListItemIcon>
            <FolderOpenRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('core:action.open', { postProcess: 'capitalizeFirstChar' })}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFolder) {
              setRenaming({
                kind: 'folder',
                id: menuFolder.id,
                value: menuFolder.name,
              });
            }
            setFolderMenu(null);
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
            if (menuFolder) {
              setSize(
                menuFolder.id,
                getFolderSize(menuFolder) === 'large' ? 'small' : 'large'
              );
            }
            setFolderMenu(null);
          }}
        >
          <ListItemIcon>
            {menuFolder && getFolderSize(menuFolder) === 'large' ? (
              <ViewModuleRoundedIcon fontSize="small" />
            ) : (
              <GridViewRoundedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {menuFolder && getFolderSize(menuFolder) === 'large'
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
            if (menuFolder) requestDelete(menuFolder.id);
            setFolderMenu(null);
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

      <Dialog
        fullWidth
        maxWidth="xs"
        onClose={() => setRenaming(null)}
        open={Boolean(renaming)}
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      >
        <DialogTitle>
          {renaming?.kind === 'tab'
            ? t('core:tabs_home.rename_app', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:tabs_home.rename_folder', {
                postProcess: 'capitalizeFirstChar',
              })}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label={
              renaming?.kind === 'tab'
                ? t('core:tabs_home.app_name', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:tabs_home.folder_name', {
                    postProcess: 'capitalizeFirstChar',
                  })
            }
            margin="dense"
            onChange={(event) =>
              setRenaming((prev) =>
                prev ? { ...prev, value: event.target.value } : prev
              )
            }
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
            }}
            value={renaming?.value ?? ''}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button onClick={commitRename}>
            {t('core:action.save', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        fullWidth
        maxWidth="xs"
        onClose={() => setPendingDelete(null)}
        open={Boolean(pendingDelete)}
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      >
        <DialogTitle>
          {t('core:tabs_overlay.delete_folder_title', {
            name: deleteText?.name ?? '',
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, opacity: 0.8 }}>
            {t('core:tabs_overlay.delete_folder_body', {
              count: deleteText?.count ?? 0,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            color="error"
            onClick={() => {
              const pending = pendingDelete;
              setPendingDelete(null);
              if (!pending) return;
              if (openFolder?.id === pending.id) {
                setOpenFolder((prev) =>
                  prev ? { ...prev, open: false } : prev
                );
              }
              captureFolderLayout();
              void org.deleteFolder(pending.id);
            }}
          >
            {t('core:action.delete', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>

      <MobileTabOptionsDialog
        currentFolderId={
          optionsTab ? (org.getFolderForTab(optionsTab)?.id ?? null) : null
        }
        folders={org.folders}
        hasCustomLabel={
          optionsTab
            ? Boolean(
                org.organization.tabOverrides[getOpenTabKey(optionsTab)]
                  ?.customLabel
              )
            : false
        }
        onAddToFolder={(folderId) => {
          if (optionsTab) {
            captureFolderLayout();
            void org.addTabToFolder(optionsTab, folderId);
          }
          setOptionsTab(null);
        }}
        onClose={() => setOptionsTab(null)}
        onCreateFolder={() => {
          const tab = optionsTab;
          setOptionsTab(null);
          if (!tab) return;
          captureFolderLayout();
          const name = t('core:tabs_home.new_folder_name', {
            postProcess: 'capitalizeFirstChar',
          });
          void org.createFolder(name, tab).then((id) => {
            if (id) setRenaming({ kind: 'folder', id, value: name });
          });
        }}
        onRemoveFromFolder={() => {
          if (optionsTab) void org.removeTabFromFolder(optionsTab);
          setOptionsTab(null);
        }}
        onRename={() => {
          if (optionsTab) {
            setRenaming({
              kind: 'tab',
              tab: optionsTab,
              value: org.getTabTitle(optionsTab),
            });
          }
          setOptionsTab(null);
        }}
        onRestoreName={() => {
          if (optionsTab) void org.restoreTabName(optionsTab);
          setOptionsTab(null);
        }}
        open={Boolean(optionsTab)}
        tab={optionsTab}
        tabTitle={optionsTab ? org.getTabTitle(optionsTab) : ''}
      />
    </Box>
  );
}

function PinnedEmptyState({ onBrowseApps }: { onBrowseApps: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        px: 2,
        py: 5,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(2, 54px)',
          mb: 1,
        }}
      >
        {[0, 1, 2, 3].map((index) => (
          <Box
            key={index}
            sx={{
              ...folderTileSurface(theme),
              alignItems: 'center',
              borderRadius: '15px',
              color: alpha(theme.palette.text.primary, 0.35),
              display: 'flex',
              height: 54,
              justifyContent: 'center',
              width: 54,
            }}
          >
            {index === 0 ? (
              <PushPinRoundedIcon
                sx={{ color: 'primary.main', fontSize: 24 }}
              />
            ) : null}
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: 17, fontWeight: 700 }}>
        {t('core:tabs_home.empty_title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      <Typography
        sx={{ color: 'text.secondary', fontSize: 13.5, maxWidth: 300 }}
      >
        {t('core:tabs_home.empty_hint', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      <Button
        onClick={onBrowseApps}
        sx={{ borderRadius: 999, mt: 1, px: 2.5 }}
        variant="contained"
      >
        {t('core:tabs_home.browse_apps', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Button>
    </Box>
  );
}
