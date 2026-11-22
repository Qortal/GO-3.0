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
import { userInfoAtom } from '../../../atoms/global';
import {
  filterAppTabsForMobile,
  isQChatOpenTab,
} from '../../../utils/openQChatTab';
import {
  folderItemKey,
  type LauncherItem,
} from '../../Apps/AppsLauncher/launcherItems';
import { LauncherSaveWindow } from '../../Apps/AppsLauncher/LauncherSaveWindow';
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
import { MobileTabOptionsDialog } from '../MobileTabOptionsDialog';
import { MOBILE_TABS_DIALOG_Z } from '../mobileLayout';
import { GO_TAB_BAR_SPACE } from '../mobileBarHeights';
import { shellOfBookmark, shellOfPin } from '../goLauncher/goLauncherOps';
import {
  FOLDER_TILE_ATTR,
  FolderTile,
  LIFT_CLASS,
  folderTileSurface,
} from './FolderTile';
import { AppTile, TILE_ICON_ATTR } from './AppTile';
import { FolderOpenOverlay } from './FolderOpenOverlay';
import {
  PinnedTileMenu,
  type PinnedLeaf,
  type PinnedTileMenuTarget,
} from './PinnedTileMenu';
import { TabPreviewCard } from './TabPreviewCard';
import { useShownWindows } from './useShownWindows';
import { groupTabsIntoStacks, type TabStack } from './tabStacks';
import { measureBoxes, playFlip } from './flip';
import { hitTestSlot, homeGridMetrics, moveId } from './homeGrid';
import { edgeScrollStep, useLongPressReorder } from './useLongPressReorder';
import { DevModeButton } from '../devMode/DevModeButton';
import { canOpenDevZips, goDevModeEnabledAtom } from '../devMode/devModeApp';

const TILE_ATTR = 'data-home-tile';
const FLIP_STALE_MS = 700;
const CARD_ATTR = 'data-home-tab';
const DROP_OVER_ATTR = 'data-carry-over';
/** A carried app counts as over a tile this far around it. */
const CARRY_HIT_SLOP_PX = 10;
/** How far inside a picture a dragged app drops into it (share of its side). */
const DROP_INTO_INSET = 0.2;
/** How long a dragged app rests over a tile before the others make room. */
const SETTLE_MS = 170;

type PinnedHomeProps = {
  /** The library and this tab are on screen. */
  isVisible: boolean;
  /** The library's scroller, locked while a tile is dragged. */
  scrollParent: HTMLElement | null;
  /** Leaves for the Official apps tab (empty state). */
  onBrowseApps: () => void;
};

/** `carried`: closed by dragging an app out; its tile shows at once. */
type OpenFolderState = { id: string; open: boolean; carried?: boolean } | null;
/** An app dragged out of an open folder, still under the finger. */
type CarryState = { tabKey: string; fromId: string } | null;
type Renaming =
  | { kind: 'folder'; id: string; value: string }
  | { kind: 'bookmark'; id: string; value: string }
  | { kind: 'tab'; tab: OpenTab; value: string };

const isLeaf = (item: LauncherItem | undefined): item is PinnedLeaf =>
  !!item && item.type !== 'folder';

const isPrivateLeaf = (item: LauncherItem | undefined) =>
  item?.type === 'app' && !!item.pin.app.isPrivate;

/**
 * The Q-Apps library's first tab on phones: the desktop Hub's launcher, laid
 * out like a phone's home screen. The pinned apps and the bookmarks are app
 * tiles, the bookmark folders are folder tiles (small ones take a cell,
 * large ones two by two), all in the order the launcher keeps, and the open
 * tabs are cards with a picture of each page under them.
 *
 * Long-press a tile to move it, or let go for its options. Dropping an app
 * on another one makes a folder of the two, onto a folder puts it there.
 * Every change is offered to be saved to QDN, so the Hub shows it too.
 */
export function PinnedHome({
  isVisible,
  scrollParent,
  onBrowseApps,
}: PinnedHomeProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const org = useMobileTabOrganization();
  const launcher = org.launcher;
  const myName: string = useAtomValue(userInfoAtom)?.name || '';
  const { tabs: rawTabs, selectedTab: rawSelectedTab } = useOpenTabs();
  const tabs = useMemo(() => filterAppTabsForMobile(rawTabs), [rawTabs]);
  const selectedTab =
    rawSelectedTab && !isQChatOpenTab(rawSelectedTab) ? rawSelectedTab : null;
  const activeKey = selectedTab ? getOpenTabKey(selectedTab) : null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);
  // Elements too: the grids come and go (first tile, first open tab) and
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
  const [tileMenu, setTileMenu] = useState<PinnedTileMenuTarget | null>(null);
  const [optionsTab, setOptionsTab] = useState<OpenTab | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  const lastPendingDelete = useRef(pendingDelete);
  if (pendingDelete) lastPendingDelete.current = pendingDelete;
  const [closingStackKeys, setClosingStackKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [carry, setCarry] = useState<CarryState>(null);
  // The tile a dragged or carried app would drop into.
  const [dropOverKey, setDropOverKey] = useState<string | null>(null);
  // Refs as well: the drag reports every frame, before a render catches up.
  const carryRef = useRef<CarryState>(null);
  const dropOverRef = useRef<string | null>(null);

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

  const { items } = launcher;
  const itemsByKey = useMemo(
    () => new Map(items.map((item) => [item.key, item])),
    [items]
  );
  const foldersById = useMemo(
    () => new Map(org.folders.map((folder) => [folder.id, folder])),
    [org.folders]
  );

  const pinLabelFallback = t('core:app_private', {
    postProcess: 'capitalizeFirstChar',
  });
  /** An app or a bookmark of the row, as a saved tab. */
  const shellsByKey = useMemo(() => {
    const map = new Map<string, OpenTab>();
    for (const item of items) {
      if (item.type === 'bookmark') {
        map.set(item.key, shellOfBookmark(item.bookmark));
      } else if (item.type === 'app') {
        const shell = shellOfPin(item.pin, pinLabelFallback);
        if (shell) map.set(item.key, shell);
      }
    }
    return map;
  }, [items, pinLabelFallback]);

  // A folder shows its apps live when they are open, saved otherwise.
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

  const rowKeys = useMemo(
    () => dragOrder ?? items.map((item) => item.key),
    [dragOrder, items]
  );

  // Any change in the tiles' order or sizes glides into place.
  const layoutKey = `${rowKeys.join('|')}#${org.folders
    .map((folder) => `${folder.id}:${getFolderSize(folder)}`)
    .join('|')}#${width}`;
  useLayoutEffect(() => {
    const before = pendingFlip.current;
    pendingFlip.current = null;
    if (!before || performance.now() - before.at > FLIP_STALE_MS) return;
    playFlip(gridRef.current, TILE_ATTR, before.boxes, { duration: 300 });
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

  const captureLayout = () => {
    pendingFlip.current = {
      at: performance.now(),
      boxes: measureBoxes(gridRef.current, TILE_ATTR),
    };
  };

  // A folder can only be open while its tab is on screen; leaving (an app
  // opened, another library tab, another section) drops it at once.
  useEffect(() => {
    if (!isVisible && openFolder) setOpenFolder(null);
  }, [isVisible, openFolder]);
  useEffect(() => {
    // Deleted (here, in the Tabs overlay or by a save from Hub) while open.
    if (openFolder && !foldersById.has(openFolder.id)) setOpenFolder(null);
  }, [foldersById, openFolder]);

  const getTileElement = useCallback(
    (key: string) =>
      gridRef.current?.querySelector<HTMLElement>(
        `[${TILE_ATTR}="${CSS.escape(key)}"]`
      ) ?? null,
    []
  );
  /** The picture of a tile: the part that lifts, and that apps drop into. */
  const getTilePicture = useCallback(
    (key: string) => {
      const tile = getTileElement(key);
      return (
        tile?.querySelector<HTMLElement>(`.${LIFT_CLASS}`) ??
        tile?.querySelector<HTMLElement>(`[${FOLDER_TILE_ATTR}]`) ??
        tile
      );
    },
    [getTileElement]
  );
  const getFolderTile = useCallback(
    (folderId: string) =>
      getTileElement(folderItemKey(folderId))?.querySelector<HTMLElement>(
        `[${FOLDER_TILE_ATTR}]`
      ) ?? null,
    [getTileElement]
  );

  const handleOpenFolder = useCallback((folderId: string) => {
    setOpenFolder({ id: folderId, open: true });
  }, []);

  // An app icon launches the app, again in a new window when it is open
  // already; a page inside an app opens there.
  const handleOpenApp = useCallback((tab: OpenTab) => {
    setOpenFolder(null);
    launchAppWindow(tab);
  }, []);
  const openShell = useCallback(
    (shell: OpenTab) => {
      const live = shell.path ? null : tabsByKey.get(getOpenTabKey(shell));
      handleOpenApp(live ?? shell);
    },
    [handleOpenApp, tabsByKey]
  );
  const openLeaf = (item: PinnedLeaf) => {
    const shell =
      item.type === 'bookmark'
        ? shellOfBookmark(item.bookmark)
        : shellOfPin(item.pin, pinLabelFallback);
    if (shell) openShell(shell);
  };

  const newFolderName = t('core:bookmarks.new_folder', {
    postProcess: 'capitalizeFirstChar',
  });
  /** A folder just made by a drop or the menu asks for its name. */
  const askFolderName = (folderId: string | null | undefined) => {
    if (folderId) {
      setRenaming({ kind: 'folder', id: folderId, value: newFolderName });
    }
  };

  /** What a dragged tile at `x`,`y` over `overKey` would drop into. */
  const dropTargetAt = (
    draggedKey: string,
    overKey: string | null,
    x: number,
    y: number
  ): string | null => {
    if (!overKey) return null;
    const dragged = itemsByKey.get(draggedKey);
    const target = itemsByKey.get(overKey);
    // A folder only moves along the row; a private app has no bookmark, so
    // no folder takes it.
    if (!isLeaf(dragged) || isPrivateLeaf(dragged)) return null;
    if (!target || isPrivateLeaf(target)) return null;
    const picture = getTilePicture(overKey);
    if (!picture) return null;
    const box = picture.getBoundingClientRect();
    const inset = Math.min(box.width, box.height) * DROP_INTO_INSET;
    return x >= box.left + inset &&
      x <= box.right - inset &&
      y >= box.top + inset &&
      y <= box.bottom - inset
      ? overKey
      : null;
  };

  const setDropOver = (key: string | null) => {
    if (key === dropOverRef.current) return;
    dropOverRef.current = key;
    setDropOverKey(key);
    if (key) navigator.vibrate?.(6);
  };

  /** A dragged tile let go: into a tile, or where the row made room. */
  const dropTile = (key: string) => {
    const into = dropOverRef.current;
    if (into) {
      const box = getTilePicture(into)?.getBoundingClientRect() ?? null;
      captureLayout();
      askFolderName(
        launcher.drop(key, { kind: 'merge', key: into })?.madeFolderId
      );
      return box ?? undefined;
    }
    if (!dragOrder) return;
    const index = dragOrder.indexOf(key);
    const next = dragOrder[index + 1];
    const previous = dragOrder[index - 1];
    if (next) {
      launcher.drop(key, { kind: 'insert', key: next, side: 'before' });
    } else if (previous) {
      launcher.drop(key, { kind: 'insert', key: previous, side: 'after' });
    }
  };

  // An app dragged out of an open folder: the folder fades, the home grid
  // shows, and the app goes into the tile it is let go over, or into the row
  // when it is let go over nothing.
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
      gridRef.current?.querySelectorAll<HTMLElement>(`[${TILE_ATTR}]`) ?? []
    ).map((element) => {
      const id = element.getAttribute(TILE_ATTR) || '';
      return {
        id,
        rect: (getTilePicture(id) ?? element).getBoundingClientRect(),
      };
    });
    const overKey = hitTestSlot(
      tiles,
      x,
      y,
      folderItemKey(current.fromId),
      -CARRY_HIT_SLOP_PX
    );
    setDropOver(
      overKey && !isPrivateLeaf(itemsByKey.get(overKey)) ? overKey : null
    );
  };

  const dropCarry = (tabKey: string) => {
    const current = carryRef.current;
    if (!current) return null;
    const home = getFolderTile(current.fromId)?.getBoundingClientRect() ?? null;
    const child = launcher.goFolders.children.get(tabKey);
    if (!child) return home;
    const into = dropOverRef.current;
    captureLayout();
    if (into) {
      const box = getTilePicture(into)?.getBoundingClientRect() ?? null;
      const target = itemsByKey.get(into);
      if (target?.type === 'folder') {
        launcher.moveToFolder(child.item.key, target.folder.id);
      } else {
        askFolderName(
          launcher.drop(child.item.key, { kind: 'merge', key: into })
            ?.madeFolderId
        );
      }
      return box;
    }
    // Let go over nothing: out of the folder, into the row after it.
    launcher.takeOutOfFolder(child.item.key);
    return home;
  };

  const endCarry = () => {
    carryRef.current = null;
    setCarry(null);
    setDropOver(null);
  };

  useLongPressReorder({
    container: gridEl,
    scroller: scrollParent,
    itemAttr: TILE_ATTR,
    enabled: isVisible && !openFolder && launcher.ready,
    settleMs: SETTLE_MS,
    onMenu: (key, element) => {
      const item = itemsByKey.get(key);
      const anchor =
        element.querySelector<HTMLElement>(`.${LIFT_CLASS}`) ?? element;
      if (item?.type === 'folder') {
        setFolderMenu({ id: item.folder.id, anchor });
      } else if (item) {
        setTileMenu({ item, folderId: null, anchor });
      }
    },
    mergeTargetAt: dropTargetAt,
    onMergeOver: (_key, target) => setDropOver(target),
    onMove: (key, overKey) => {
      const current = dragOrder ?? items.map((item) => item.key);
      const next = moveId(current, key, current.indexOf(overKey));
      captureLayout();
      setDragOrder(next);
    },
    onDrop: dropTile,
    onEnd: () => {
      setDragOrder(null);
      setDropOver(null);
    },
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
    captureLayout();
    org.setFolderSize(folderId, size);
  };

  const requestDelete = (folderId: string) => {
    const folder = foldersById.get(folderId);
    if (!folder) return;
    const count = folderTabsMap.get(folderId)?.length ?? 0;
    if (count === 0) {
      captureLayout();
      void org.deleteFolder(folderId);
      return;
    }
    setPendingDelete({ id: folderId, name: folder.name, count });
  };

  const createFolder = () => {
    captureLayout();
    const name = t('core:tabs_home.new_folder_name', {
      postProcess: 'capitalizeFirstChar',
    });
    const id = launcher.createFolder(name);
    if (id) setRenaming({ kind: 'folder', id, value: name });
  };

  const commitRename = () => {
    const current = renaming;
    setRenaming(null);
    if (!current || !current.value.trim()) return;
    if (current.kind === 'folder') {
      void org.renameFolder(current.id, current.value);
    } else if (current.kind === 'bookmark') {
      launcher.renameBookmark(current.id, current.value);
    } else {
      void org.renameTab(current.tab, current.value);
    }
  };

  /** The menu of an app in the open folder, from its icon in the panel. */
  const openChildMenu = (tab: OpenTab) => {
    const child = launcher.goFolders.children.get(getOpenTabKey(tab));
    if (!child) return;
    const anchor =
      document.querySelector<HTMLElement>(
        `[data-folder-app="${CSS.escape(getOpenTabKey(tab))}"]`
      ) ?? rootRef.current;
    if (!anchor) return;
    setTileMenu({ item: child.item, folderId: child.folderId, anchor });
  };

  const openFolderData = openFolder ? foldersById.get(openFolder.id) : null;
  const menuFolder = folderMenu ? foldersById.get(folderMenu.id) : null;
  const deleteText = pendingDelete ?? lastPendingDelete.current;
  const hasTiles = items.length > 0;
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
        // The lift of a long-pressed tile.
        [`[data-reorder-lifted] .${LIFT_CLASS}`]: {
          transform: 'scale(1.08)',
        },
        // The tile a dragged or carried app would go into.
        [`[${DROP_OVER_ATTR}] .${LIFT_CLASS}`]: {
          transform: 'scale(1.1)',
        },
        [`[${DROP_OVER_ATTR}] [${FOLDER_TILE_ATTR}], [${DROP_OVER_ATTR}] [${TILE_ICON_ATTR}]`]:
          {
            borderRadius: `${metrics.smallRadius}px`,
            boxShadow: `0 0 0 2.5px ${theme.palette.primary.main}`,
          },
      }}
    >
      {hasTiles ? (
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
            rowKeys.map((key) => {
              const item = itemsByKey.get(key);
              if (!item) return null;
              const dropOver =
                dropOverKey === key ? { [DROP_OVER_ATTR]: 'true' } : {};
              if (item.type === 'folder') {
                const id = item.folder.id;
                const folder = foldersById.get(id);
                const size = folder ? getFolderSize(folder) : 'large';
                const span = size === 'large' ? 2 : 1;
                const folderTabs = folderTabsMap.get(id) || [];
                return (
                  <Box
                    key={key}
                    {...{ [TILE_ATTR]: key }}
                    {...dropOver}
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
                      name={item.folder.name}
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
              }
              const shell = shellsByKey.get(key);
              if (!shell) return null;
              const title = String(shell.label || shell.name || '');
              return (
                <Box
                  key={key}
                  {...{ [TILE_ATTR]: key }}
                  {...dropOver}
                  sx={{ display: 'flex', justifyContent: 'center' }}
                >
                  <AppTile
                    isBookmark={item.type === 'bookmark'}
                    isOpen={openKeys.has(getOpenTabKey(shell))}
                    metrics={metrics}
                    onOpen={openShell}
                    tab={shell}
                    title={title}
                  />
                </Box>
              );
            })}
        </Box>
      ) : (
        <Box ref={bindGrid}>
          {launcher.ready ? (
            <PinnedEmptyState onBrowseApps={onBrowseApps} />
          ) : null}
        </Box>
      )}

      {hasTiles || showDevMode ? (
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
          {hasTiles ? (
            <ButtonBase onClick={createFolder} sx={pillSx}>
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
        <Box sx={{ mt: hasTiles ? 2.5 : 1 }}>
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
          onAppMenu={openChildMenu}
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

      <PinnedTileMenu
        folders={org.folders}
        onClose={() => setTileMenu(null)}
        onMoveToFolder={(item, folderId) => {
          captureLayout();
          launcher.moveToFolder(item.key, folderId);
        }}
        onNewFolder={(item) => {
          captureLayout();
          askFolderName(launcher.newFolderWith(item.key)?.madeFolderId);
        }}
        onOpen={openLeaf}
        onRemove={(item) => {
          captureLayout();
          launcher.remove(item.key);
        }}
        onRemoveFromFolder={(item) => {
          captureLayout();
          launcher.takeOutOfFolder(item.key);
        }}
        onRename={(item) =>
          setRenaming({
            kind: 'bookmark',
            id: item.bookmark.id,
            value: item.bookmark.name || item.bookmark.appName,
          })
        }
        target={tileMenu}
      />

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
          {renaming?.kind === 'bookmark' || renaming?.kind === 'tab'
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
              renaming?.kind === 'bookmark' || renaming?.kind === 'tab'
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
            {t('core:tabs_home.delete_folder_keeps', {
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
              captureLayout();
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
            captureLayout();
            void org.addTabToFolder(optionsTab, folderId);
          }
          setOptionsTab(null);
        }}
        onClose={() => setOptionsTab(null)}
        onCreateFolder={() => {
          const tab = optionsTab;
          setOptionsTab(null);
          if (!tab) return;
          captureLayout();
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

      {/* After a change: offer to save the arrangement to QDN, for Hub. */}
      {isVisible ? (
        <Box
          sx={{
            bottom: `calc(${GO_TAB_BAR_SPACE} + 8px)`,
            height: 0,
            left: 0,
            position: 'fixed',
            right: 0,
            zIndex: 1100,
          }}
        >
          <LauncherSaveWindow
            bookmarks={launcher.bookmarks}
            myAddress={launcher.address}
            myName={myName}
          />
        </Box>
      ) : null}
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
