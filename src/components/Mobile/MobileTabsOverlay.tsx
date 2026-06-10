import { useCallback, useEffect, useMemo, useRef, useState, useTransition, memo } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slide,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { alpha } from '@mui/material/styles';
import { extractComponents } from '../Chat/MessageDisplay';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { FolderCompositeAvatar } from './FolderCompositeAvatar';
import { MobileTabAppDetailsDialog } from './MobileTabAppDetailsDialog';
import { MobileTabOptionsDialog } from './MobileTabOptionsDialog';
import { getOpenTabKey, groupFoldersByRow, resolveFolderTab } from './mobileTabOrganization';
import { useMobileTabOrganization } from './useMobileTabOrganization';
import {
  TabAvatar,
  colorFor,
  shortenTabDisplayTitle,
} from './MobileTabsOverlay.shared';
import {
  closeOpenTab,
  openOrSelectTab,
  useOpenTabs,
  type OpenTab,
} from './useOpenTabs';
import { buildTabQortalUrl } from './tabQortalLink';
import { filterAppTabsForMobile, isQChatOpenTab } from '../../utils/openQChatTab';
import { MOBILE_TAB_BAR_HEIGHT_PX } from './MobileTabBar';
import { MOBILE_TOP_BAR_HEIGHT_PX } from './MobileTopBar';
import { MOBILE_TABS_DIALOG_Z, MOBILE_TABS_OVERLAY_Z } from './mobileLayout';

type MobileTabsOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const LONG_PRESS_MS = 500;

const clearNativeTextSelection = () => {
  if (typeof window === 'undefined') return;
  window.getSelection()?.removeAllRanges();
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
};

const noTextSelectionSx = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  MozUserSelect: 'none',
} as const;
const TAB_DRAG_PREFIX = 'tab:';
const FOLDER_DRAG_PREFIX = 'folder:';
const ROW_DROP_PREFIX = 'row:drop:';

const tabDragId = (tab: OpenTab) => `${TAB_DRAG_PREFIX}${getOpenTabKey(tab)}`;
const folderDragId = (folderId: string) => `${FOLDER_DRAG_PREFIX}${folderId}`;
const rowDropId = (rowIndex: number) => `${ROW_DROP_PREFIX}${rowIndex}`;

type TabDropTarget = { type: 'folder'; folderId: string };

const parseTabDragId = (id: string | number) => {
  const value = String(id);
  return value.startsWith(TAB_DRAG_PREFIX) ? value.slice(TAB_DRAG_PREFIX.length) : null;
};

const parseFolderDragId = (id: string | number) => {
  const value = String(id);
  return value.startsWith(FOLDER_DRAG_PREFIX)
    ? value.slice(FOLDER_DRAG_PREFIX.length)
    : null;
};

const parseRowDropId = (id: string | number) => {
  const value = String(id);
  if (!value.startsWith(ROW_DROP_PREFIX)) return null;
  const parsed = Number.parseInt(value.slice(ROW_DROP_PREFIX.length), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTabDropTarget = (id: string | number): TabDropTarget | null => {
  const folderId = parseFolderDragId(String(id));
  if (folderId) return { type: 'folder', folderId };
  return null;
};

const tabGridCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCenter(args);
};

const TabDragAvatarPreview = ({
  tab,
  title,
  color,
}: {
  tab: OpenTab;
  title: string;
  color: string;
}) => (
  <Box
    sx={{
      '@keyframes tabDragFloat': {
        '0%, 100%': { transform: 'scale(1.14) rotate(-4deg) translateY(0)' },
        '50%': { transform: 'scale(1.18) rotate(-2deg) translateY(-4px)' },
      },
      animation: 'tabDragFloat 680ms ease-in-out infinite',
      filter: 'drop-shadow(0 14px 28px rgba(0,0,0,0.38))',
      pointerEvents: 'none',
    }}
  >
    <TabAvatar tab={tab} title={title} color={color} size={58} />
  </Box>
);

const FolderDragPreview = ({
  name,
  tabs,
  getTitle,
}: {
  name: string;
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
}) => (
  <Box
    sx={{
      '@keyframes folderDragFloat': {
        '0%, 100%': { transform: 'scale(1.08) rotate(-2deg) translateY(0)' },
        '50%': { transform: 'scale(1.12) rotate(0deg) translateY(-4px)' },
      },
      alignItems: 'center',
      animation: 'folderDragFloat 680ms ease-in-out infinite',
      backgroundColor: 'background.paper',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 2,
      boxShadow: '0 14px 28px rgba(0,0,0,0.38)',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.5,
      minWidth: 84,
      pointerEvents: 'none',
      px: 1,
      py: 0.85,
    }}
  >
    <FolderCompositeAvatar getTitle={getTitle} size={40} tabs={tabs} />
    <Typography sx={{ fontSize: 11, fontWeight: 600, maxWidth: 76, textAlign: 'center' }}>
      {name}
    </Typography>
  </Box>
);

function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

const FolderRowDropZone = ({ rowIndex }: { rowIndex: number }) => {
  const theme = useTheme();
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: rowDropId(rowIndex) });
  const folderDragActive =
    active != null && String(active.id).startsWith(FOLDER_DRAG_PREFIX);

  return (
    <Box
      ref={setNodeRef}
      sx={{
        alignItems: 'center',
        backgroundColor: isOver
          ? alpha(theme.palette.primary.main, 0.14)
          : alpha(theme.palette.primary.main, 0.05),
        border: `1px dashed ${
          isOver
            ? theme.palette.primary.main
            : alpha(theme.palette.primary.main, 0.45)
        }`,
        borderRadius: 2,
        color: 'text.secondary',
        display: 'flex',
        flex: 1,
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        justifyContent: 'center',
        minHeight: 52,
        minWidth: 120,
        opacity: folderDragActive ? 1 : 0.72,
        px: 1,
        py: 0.85,
        transition:
          'background-color 140ms ease, border-color 140ms ease, opacity 140ms ease',
      }}
    >
      Drop folder here
    </Box>
  );
};

const FolderRowEndDropZone = ({ rowIndex }: { rowIndex: number }) => {
  const theme = useTheme();
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: rowDropId(rowIndex) });
  const folderDragActive =
    active != null && String(active.id).startsWith(FOLDER_DRAG_PREFIX);

  if (!folderDragActive) return null;

  return (
    <Box
      ref={setNodeRef}
      sx={{
        alignSelf: 'stretch',
        backgroundColor: isOver
          ? alpha(theme.palette.primary.main, 0.14)
          : alpha(theme.palette.primary.main, 0.05),
        border: `1px dashed ${
          isOver
            ? theme.palette.primary.main
            : alpha(theme.palette.primary.main, 0.45)
        }`,
        borderRadius: 2,
        flexShrink: 0,
        minWidth: 28,
        transition: 'background-color 140ms ease, border-color 140ms ease',
      }}
    />
  );
};

const FolderRowAddButton = ({ onClick }: { onClick: () => void }) => {
  const theme = useTheme();

  return (
    <Box
      aria-label="Add folder row"
      component="button"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      sx={{
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        border: `1px dashed ${alpha(theme.palette.primary.main, 0.45)}`,
        borderRadius: 2,
        color: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: 0.5,
        justifyContent: 'center',
        minWidth: 52,
        px: 0.75,
        py: 0.85,
        touchAction: 'manipulation',
        transition: 'background-color 140ms ease, border-color 140ms ease',
        '&:active': {
          backgroundColor: alpha(theme.palette.primary.main, 0.16),
        },
      }}
    >
      <AddRoundedIcon sx={{ color: theme.palette.primary.main, fontSize: 22 }} />
    </Box>
  );
};

const FolderRowRemoveButton = ({ onClick }: { onClick: () => void }) => {
  const theme = useTheme();

  return (
    <Box
      aria-label="Remove empty folder row"
      component="button"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      sx={{
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.error.main, 0.08),
        border: `1px dashed ${alpha(theme.palette.error.main, 0.45)}`,
        borderRadius: 2,
        color: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: 0.5,
        justifyContent: 'center',
        minWidth: 52,
        px: 0.75,
        py: 0.85,
        touchAction: 'manipulation',
        transition: 'background-color 140ms ease, border-color 140ms ease',
        '&:active': {
          backgroundColor: alpha(theme.palette.error.main, 0.16),
        },
      }}
    >
      <RemoveRoundedIcon sx={{ color: theme.palette.error.main, fontSize: 22 }} />
    </Box>
  );
};

const SortableFolderChip = memo(function SortableFolderChip({
  folderId,
  name,
  tabs,
  getTitle,
  selected,
  editMode,
  onSelect,
  onRemove,
}: {
  folderId: string;
  name: string;
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
  selected: boolean;
  editMode: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { active } = useDndContext();
  const sortableId = folderDragId(folderId);
  const skipClickRef = useRef(false);
  const wasDraggingRef = useRef(false);
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: !editMode });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: sortableId });

  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    setDropRef(node);
  };

  useEffect(() => {
    if (isDragging) {
      skipClickRef.current = true;
      wasDraggingRef.current = true;
      return;
    }
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
    }
  }, [isDragging]);

  const handleClick = () => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    onSelect();
  };

  const isTabDropTarget =
    isOver && active?.id != null && String(active.id).startsWith(TAB_DRAG_PREFIX);

  return (
    <Box
      ref={setNodeRef}
      {...(editMode ? listeners : {})}
      {...(editMode ? attributes : {})}
      onClick={handleClick}
      style={{
        transform: CSS.Transform.toString(transform),
        transition:
          transition ||
          'transform 220ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms ease',
        opacity: isDragging ? 0.35 : 1,
      }}
      sx={{
        alignItems: 'center',
        backgroundColor: isTabDropTarget
          ? `${theme.palette.primary.main}28`
          : editMode
            ? `${theme.palette.primary.main}10`
            : selected
              ? `${theme.palette.primary.main}18`
              : theme.palette.background.paper,
        border: isTabDropTarget
          ? `2px solid ${theme.palette.primary.main}`
          : editMode
            ? `1px dashed ${theme.palette.primary.main}`
            : selected
              ? `1.5px solid ${theme.palette.primary.main}`
              : `1px solid ${theme.palette.divider}`,
        borderRadius: 2,
        boxShadow: isTabDropTarget
          ? `0 0 0 3px ${theme.palette.primary.main}22`
          : 'none',
        cursor: editMode ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: 0.5,
        minWidth: 84,
        position: 'relative',
        px: 1,
        py: 0.85,
        touchAction: editMode ? 'none' : 'pan-x',
        userSelect: 'none',
        willChange: 'transform',
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
      }}
    >
      {editMode ? (
        <IconButton
          aria-label="Remove folder"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          sx={{
            backgroundColor: alpha(theme.palette.error.main, 0.12),
            color: theme.palette.error.main,
            height: 22,
            position: 'absolute',
            right: 2,
            top: 2,
            width: 22,
            zIndex: 2,
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      ) : null}
      <FolderCompositeAvatar tabs={tabs} getTitle={getTitle} size={40} />
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 600,
          maxWidth: 76,
          overflow: 'hidden',
          textAlign: 'center',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </Typography>
    </Box>
  );
});

const SortableTabCard = ({
  tab,
  title,
  color,
  isActive,
  isSavedOnly,
  editMode,
  showQuickClose,
  onSelect,
  onClose,
  longPressProps,
}: {
  tab: OpenTab;
  title: string;
  color: string;
  isActive: boolean;
  isSavedOnly: boolean;
  editMode: boolean;
  showQuickClose?: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  longPressProps: {
    onContextMenu: (e: React.MouseEvent) => void;
    onSelectStart: (e: React.SyntheticEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: () => void;
    onTouchEnd: () => void;
  };
}) => {
  const theme = useTheme();
  const sortableId = tabDragId(tab);
  const displayTitle = shortenTabDisplayTitle(title);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: !editMode });

  const dragListeners = editMode ? listeners : undefined;
  const showCloseButton = editMode || showQuickClose;

  return (
    <Box
      ref={setNodeRef}
      {...(editMode ? attributes : {})}
      {...(dragListeners ?? {})}
      onClick={editMode ? undefined : onSelect}
      {...(editMode ? {} : longPressProps)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition:
          transition ||
          'transform 220ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms ease',
        opacity: isDragging ? 0.28 : 1,
        zIndex: isDragging ? 0 : 1,
      }}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        pl: 1,
        pr: showCloseButton ? 3 : 1,
        py: 0.85,
        borderRadius: 2,
        cursor: editMode ? 'grab' : 'pointer',
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        width: '100%',
        ...noTextSelectionSx,
        border: editMode
          ? `1px dashed ${alpha(theme.palette.primary.main, 0.55)}`
          : isActive
          ? `1.5px solid ${theme.palette.primary.main}`
          : isSavedOnly
            ? `1px dashed ${theme.palette.divider}`
            : `1px solid ${theme.palette.divider}`,
        backgroundColor: editMode
          ? `${theme.palette.primary.main}08`
          : isActive
          ? `${theme.palette.primary.main}14`
          : isSavedOnly
            ? `${theme.palette.action.hover}`
            : theme.palette.background.paper,
        touchAction: editMode ? 'none' : 'manipulation',
        willChange: 'transform',
        '&:active': !editMode ? { transform: 'scale(0.97)' } : undefined,
      }}
    >
      <TabAvatar tab={tab} title={title} color={color} />
      <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <Typography
          title={title !== displayTitle ? title : undefined}
          sx={{
            fontSize: 12.5,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.2,
            maxWidth: '100%',
            ...noTextSelectionSx,
          }}
        >
          {displayTitle}
        </Typography>
        <Typography
          sx={{
            fontSize: 9.5,
            opacity: isActive ? 0.9 : 0.55,
            color: isActive ? theme.palette.primary.main : 'inherit',
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            ...noTextSelectionSx,
          }}
        >
          {isActive
            ? 'Active'
            : isSavedOnly
              ? 'Tap to open'
              : tab.internal
                ? 'Built-in'
                : tab.service || 'App'}
        </Typography>
      </Box>
      {showCloseButton ? (
        <IconButton
          size="small"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          aria-label={editMode ? 'Remove app' : 'Close tab'}
          sx={{
            position: 'absolute',
            ...(showQuickClose && !editMode
              ? { top: 4, right: 4 }
              : {
                  top: '50%',
                  right: 2,
                  transform: 'translateY(-50%)',
                }),
            zIndex: 2,
            ...(showQuickClose && !editMode
              ? {
                  backgroundColor: alpha(theme.palette.error.main, 0.14),
                  height: 20,
                  width: 20,
                }
              : {}),
            color: theme.palette.error.main,
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: showQuickClose && !editMode ? 13 : 15 }} />
        </IconButton>
      ) : null}
    </Box>
  );
};

export const MobileTabsOverlay = ({ open, onClose }: MobileTabsOverlayProps) => {
  const theme = useTheme();
  const { tabs: rawTabs, selectedTab: rawSelectedTab } = useOpenTabs();
  const tabs = useMemo(() => filterAppTabsForMobile(rawTabs), [rawTabs]);
  const selectedTab = useMemo(
    () =>
      rawSelectedTab && !isQChatOpenTab(rawSelectedTab) ? rawSelectedTab : null,
    [rawSelectedTab]
  );
  const org = useMobileTabOrganization();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [tabOptionsOpen, setTabOptionsOpen] = useState(false);
  const [actionTab, setActionTab] = useState<OpenTab | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressValue, setAddressValue] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<OpenTab | null>(null);
  const [draggedTab, setDraggedTab] = useState<OpenTab | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackInfo, setSnackInfo] = useState<{
    type: string;
    message: string;
    duration?: number;
  } | null>(null);
  const [folderHeaderName, setFolderHeaderName] = useState('');
  const [folderNameEditing, setFolderNameEditing] = useState(false);
  const [tabsEditMode, setTabsEditMode] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const folderHeaderInputRef = useRef<HTMLInputElement>(null);
  const skipFolderBlurCommitRef = useRef(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const dragEndedRef = useRef(false);
  const tabsRef = useRef(tabs);
  const tabsPanelRef = useRef<HTMLDivElement | null>(null);
  const [, startFolderTransition] = useTransition();

  tabsRef.current = tabs;

  const canDragTabs = tabsEditMode && org.folders.length > 0;
  const canReorderFolderTabs = tabsEditMode && Boolean(selectedFolderId);
  const tabEditMode = tabsEditMode && (Boolean(selectedFolderId) || org.folders.length > 0);

  const selectedFolder = useMemo(
    () => org.folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [org.folders, selectedFolderId]
  );

  const tabsByKey = useMemo(() => {
    const map = new Map<string, OpenTab>();
    tabs.forEach((tab) => map.set(getOpenTabKey(tab), tab));
    return map;
  }, [tabs]);

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

  const visibleTabs = useMemo(() => {
    const seenKeys = new Set<string>();
    const result: OpenTab[] = [];

    for (const tab of tabs) {
      const key = getOpenTabKey(tab);
      seenKeys.add(key);
      result.push(tab);
    }

    const foldersToAppend = selectedFolderId
      ? org.folders.filter((folder) => folder.id === selectedFolderId)
      : [];

    for (const folder of foldersToAppend) {
      for (const key of folder.tabKeys) {
        if (seenKeys.has(key)) continue;
        const resolved = resolveFolderTab(
          key,
          undefined,
          org.organization.savedTabs
        );
        if (resolved) {
          seenKeys.add(key);
          result.push(resolved);
        }
      }
    }

    return result;
  }, [
    org.folders,
    org.organization.savedTabs,
    selectedFolderId,
    tabs,
  ]);

  const sortableTabIds = useMemo(
    () => visibleTabs.map((tab) => tabDragId(tab)),
    [visibleTabs]
  );

  const folderRowCount = org.organization.folderRowCount ?? 1;
  const folderRows = useMemo(
    () => groupFoldersByRow(org.folders, folderRowCount),
    [folderRowCount, org.folders]
  );

  useEffect(() => {
    if (!open || !org.ready) return;
    org.syncOpenTabSnapshots(tabsRef.current);
  }, [open, org.ready, org.syncOpenTabSnapshots]);

  const resolveTabByKey = useCallback(
    (tabKey: string): OpenTab | null =>
      resolveFolderTab(
        tabKey,
        tabsByKey.get(tabKey),
        org.organization.savedTabs
      ),
    [org.organization.savedTabs, tabsByKey]
  );

  useEffect(() => {
    skipFolderBlurCommitRef.current = true;
    setFolderNameEditing(false);
    folderHeaderInputRef.current?.blur();
    if (selectedFolder) {
      setFolderHeaderName(selectedFolder.name);
    }
  }, [selectedFolder?.id, selectedFolder?.name]);

  const focusInput = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const scheduleInputFocus = useCallback(
    (input: HTMLInputElement | null) => {
      if (!input) return;
      focusInput(input);
      window.setTimeout(() => focusInput(input), 50);
    },
    [focusInput]
  );

  const dismissFolderNameEdit = useCallback((revert = false) => {
    skipFolderBlurCommitRef.current = true;
    setFolderNameEditing(false);
    if (revert && selectedFolder) {
      setFolderHeaderName(selectedFolder.name);
    }
    folderHeaderInputRef.current?.blur();
  }, [selectedFolder]);

  const commitFolderHeaderName = useCallback(async () => {
    if (!selectedFolderId || !selectedFolder) return;
    const trimmed = folderHeaderName.trim();
    const nextName = trimmed || selectedFolder.name;
    if (nextName !== selectedFolder.name) {
      await org.renameFolder(selectedFolderId, nextName);
    } else {
      setFolderHeaderName(selectedFolder.name);
    }
    dismissFolderNameEdit();
  }, [
    dismissFolderNameEdit,
    folderHeaderName,
    org,
    selectedFolder,
    selectedFolderId,
  ]);

  const startFolderHeaderEdit = useCallback(() => {
    if (!selectedFolder || !tabsEditMode) return;
    skipFolderBlurCommitRef.current = false;
    setFolderHeaderName(selectedFolder.name);
    setFolderNameEditing(true);
  }, [selectedFolder, tabsEditMode]);

  useEffect(() => {
    if (!folderNameEditing) return;
    scheduleInputFocus(folderHeaderInputRef.current);
  }, [folderNameEditing, scheduleInputFocus]);

  useEffect(() => {
    if (open) setOverlayMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (detailsOpen || tabOptionsOpen || renameOpen || addressOpen) return;
    if (draggedTab || draggedFolderId) return;

    const panel = tabsPanelRef.current;
    const isInsideTabsPanel = (target: EventTarget | null) =>
      target instanceof Node && Boolean(panel?.contains(target));

    const isInsideModal = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('.MuiDialog-root, .MuiModal-root'));

    const closeIfBackgroundInteraction = (event: Event) => {
      if (isInsideTabsPanel(event.target) || isInsideModal(event.target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('scroll', closeIfBackgroundInteraction, true);
    document.addEventListener('touchmove', closeIfBackgroundInteraction, {
      capture: true,
      passive: true,
    });
    document.addEventListener('wheel', closeIfBackgroundInteraction, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener('scroll', closeIfBackgroundInteraction, true);
      document.removeEventListener('touchmove', closeIfBackgroundInteraction, true);
      document.removeEventListener('wheel', closeIfBackgroundInteraction, true);
    };
  }, [
    addressOpen,
    detailsOpen,
    draggedFolderId,
    draggedTab,
    onClose,
    open,
    renameOpen,
    tabOptionsOpen,
  ]);

  useEffect(() => {
    if (open) return;
    setTabsEditMode(false);
    dismissFolderNameEdit(true);
  }, [dismissFolderNameEdit, open]);

  const toggleTabsEditMode = useCallback(() => {
    setTabsEditMode((prev) => {
      if (prev) {
        dismissFolderNameEdit(true);
      }
      return !prev;
    });
  }, [dismissFolderNameEdit]);

  const tabsEditButton = (
    <IconButton
      size="small"
      aria-label={tabsEditMode ? 'Done editing' : 'Edit tabs and folders'}
      aria-pressed={tabsEditMode}
      onClick={(event) => {
        event.stopPropagation();
        toggleTabsEditMode();
      }}
      sx={{
        backgroundColor: tabsEditMode
          ? `${theme.palette.primary.main}18`
          : undefined,
        color: tabsEditMode ? theme.palette.primary.main : undefined,
      }}
    >
      <TuneRoundedIcon sx={{ fontSize: 20 }} />
    </IconButton>
  );

  const selectFolder = useCallback((folderId: string | null) => {
    dismissFolderNameEdit(true);
    startFolderTransition(() => {
      setSelectedFolderId(folderId);
    });
  }, [dismissFolderNameEdit, startFolderTransition]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    })
  );

  const showRemovalSnack = useCallback((message: string) => {
    setSnackInfo({ type: 'success', message, duration: 3200 });
    setSnackOpen(true);
  }, []);

  const handleTrashTab = useCallback(
    async (tabKey: string) => {
      const tab = resolveTabByKey(tabKey);
      if (!tab) return;
      const title = org.getTabTitle(tab);
      const savedOnly = String(tab.tabId || '').startsWith('saved:');
      if (org.getFolderForTab(tab) || savedOnly) {
        await org.removeTabFromFolder(tab);
      }
      if (!savedOnly) {
        closeOpenTab(tab.tabId);
      }
      showRemovalSnack(`"${title}" removed`);
    },
    [org, resolveTabByKey, showRemovalSnack]
  );

  const handleTrashFolder = useCallback(
    async (folderId: string) => {
      const folder = org.folders.find((item) => item.id === folderId);
      const name = folder?.name || 'Folder';
      await org.deleteFolder(folderId);
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      showRemovalSnack(`Folder "${name}" removed`);
    },
    [org, selectedFolderId, showRemovalSnack]
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    const tabKey = parseTabDragId(event.active.id);
    if (tabKey) {
      setDraggedTab(resolveTabByKey(tabKey));
      setDraggedFolderId(null);
      return;
    }
    const folderId = parseFolderDragId(event.active.id);
    if (folderId) {
      setDraggedFolderId(folderId);
      setDraggedTab(null);
    }
  };

  const handleDragCancel = () => {
    setDraggedTab(null);
    setDraggedFolderId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedTab(null);
    setDraggedFolderId(null);
    dragEndedRef.current = true;
    window.setTimeout(() => {
      dragEndedRef.current = false;
    }, 120);

    if (!over || active.id === over.id) return;

    const tabKey = parseTabDragId(active.id);
    if (tabKey) {
      const overTabKey = parseTabDragId(over.id);
      if (overTabKey && overTabKey !== tabKey) {
        const activeTab = resolveTabByKey(tabKey);
        const folderId =
          selectedFolderId ?? org.getFolderForTab(activeTab!)?.id ?? null;
        if (folderId) {
          void org.reorderTabsInFolder(folderId, tabKey, overTabKey);
        }
        return;
      }

      const tab = resolveTabByKey(tabKey);
      const target = parseTabDropTarget(over.id);
      if (!tab || !target) return;

      const currentFolder = org.getFolderForTab(tab);
      if (currentFolder?.id === target.folderId) return;
      void org.addTabToFolder(tab, target.folderId);
      return;
    }

    const activeFolderId = parseFolderDragId(active.id);
    if (activeFolderId) {
      const overFolderId = parseFolderDragId(over.id);
      const rowDrop = parseRowDropId(over.id);
      const activeFolder = org.folders.find((folder) => folder.id === activeFolderId);
      if (!activeFolder) return;

      if (overFolderId) {
        const overFolder = org.folders.find((folder) => folder.id === overFolderId);
        if (!overFolder) return;

        if ((activeFolder.row ?? 0) !== (overFolder.row ?? 0)) {
          void org.moveFolderToRow(
            activeFolderId,
            overFolder.row ?? 0,
            overFolderId
          );
          return;
        }

        const rowFolders = folderRows[activeFolder.row ?? 0] ?? [];
        const ids = rowFolders.map((folder) => folder.id);
        const oldIndex = ids.indexOf(activeFolderId);
        const newIndex = ids.indexOf(overFolderId);
        if (oldIndex === -1 || newIndex === -1) return;
        void org.reorderFoldersInRow(
          activeFolder.row ?? 0,
          arrayMove(ids, oldIndex, newIndex)
        );
        return;
      }

      if (rowDrop !== null) {
        void org.moveFolderToRow(activeFolderId, rowDrop, null);
      }
    }
  };

  const handleSelect = (tab: OpenTab) => {
    if (tabsEditMode) return;
    if (dragEndedRef.current || longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    openOrSelectTab(tab);
    onClose();
  };

  const handleQuickClose = (e: React.MouseEvent, tab: OpenTab) => {
    e.stopPropagation();
    if (isSavedOnlyTab(tab)) return;
    closeOpenTab(tab.tabId);
  };

  const handleClose = (e: React.MouseEvent, tab: OpenTab) => {
    e.stopPropagation();
    if (String(tab.tabId || '').startsWith('saved:')) {
      void org.removeTabFromFolder(tab);
      return;
    }
    closeOpenTab(tab.tabId);
  };

  const isSavedOnlyTab = (tab: OpenTab) =>
    String(tab.tabId || '').startsWith('saved:');

  const openTabDetails = (tab: OpenTab) => {
    clearNativeTextSelection();
    setDetailsTab(tab);
    setDetailsOpen(true);
  };

  useEffect(() => {
    if (!detailsOpen) return;
    clearNativeTextSelection();
    const frame = window.requestAnimationFrame(() => clearNativeTextSelection());
    return () => window.cancelAnimationFrame(frame);
  }, [detailsOpen]);

  const closeTabDetails = () => {
    setDetailsOpen(false);
    setDetailsTab(null);
  };

  const openTabOptions = (tab: OpenTab) => {
    setActionTab(tab);
    setTabOptionsOpen(true);
  };

  const closeTabOptions = () => {
    setTabOptionsOpen(false);
    setActionTab(null);
  };

  const bindLongPress = (tab: OpenTab) => {
    if (tabsEditMode) {
      return {
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
        },
        onSelectStart: (e: React.SyntheticEvent) => {
          e.preventDefault();
        },
        onTouchStart: () => {},
        onTouchMove: () => {},
        onTouchEnd: () => {},
      };
    }

    return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearNativeTextSelection();
      longPressTriggeredRef.current = true;
      openTabDetails(tab);
    },
    onSelectStart: (e: React.SyntheticEvent) => {
      e.preventDefault();
    },
    onTouchStart: () => {
      longPressTriggeredRef.current = false;
      clearNativeTextSelection();
      longPressRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        clearNativeTextSelection();
        openTabDetails(tab);
      }, LONG_PRESS_MS);
    },
    onTouchMove: () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
      clearNativeTextSelection();
    },
    onTouchEnd: () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
    },
  };
  };

  const handleCreateFolder = async () => {
    const id = await org.createFolder('New folder', actionTab || undefined);
    selectFolder(id);
    setActionTab(null);
    closeTabOptions();
  };

  const handleAddToFolder = async (folderId: string) => {
    if (!actionTab) return;
    await org.addTabToFolder(actionTab, folderId);
    setActionTab(null);
    closeTabOptions();
  };

  const openRenameDialog = () => {
    if (!actionTab) return;
    setRenameValue(org.getTabTitle(actionTab));
    setRenameOpen(true);
    closeTabOptions();
  };

  const openAddressDialog = () => {
    if (!actionTab || actionTab.internal) return;
    setAddressValue(buildTabQortalUrl(actionTab));
    setAddressOpen(true);
    closeTabOptions();
  };

  const saveFolderHeaderName = () => {
    void commitFolderHeaderName();
  };

  const tabsPanelTop = `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + env(safe-area-inset-top, 0px))`;
  const tabsPanelMaxHeight = `calc(100vh - ${MOBILE_TOP_BAR_HEIGHT_PX}px - env(safe-area-inset-top, 0px) - ${MOBILE_TAB_BAR_HEIGHT_PX}px - env(safe-area-inset-bottom, 0px) - 24px)`;

  return (
    <>
      {overlayMounted ? (
      <Box
        sx={{
          bottom: 0,
          left: 0,
          pointerEvents: open ? 'auto' : 'none',
          position: 'fixed',
          right: 0,
          top: tabsPanelTop,
          zIndex: MOBILE_TABS_OVERLAY_Z,
        }}
      >
        <Slide
          direction="down"
          in={open}
          mountOnEnter
          unmountOnExit
          onExited={() => setOverlayMounted(false)}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <Box
              ref={tabsPanelRef}
              sx={{
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? 'rgb(28, 30, 36)'
                    : theme.palette.background.paper,
                borderBottom: `1px solid ${theme.palette.divider}`,
                borderBottomLeftRadius: 18,
                borderBottomRightRadius: 18,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 14px 36px rgba(0,0,0,0.45)'
                    : '0 14px 36px rgba(15,20,30,0.18)',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: tabsPanelMaxHeight,
                overflow: 'hidden',
                pointerEvents: 'auto',
                width: '100%',
                ...noTextSelectionSx,
                '& input, & textarea, & [contenteditable="true"]': {
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                },
              }}
            >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              px: 2,
              py: 1.25,
              borderBottom: `1px solid ${theme.palette.divider}`,
              flexShrink: 0,
            }}
          >
            {selectedFolder ? (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flex: 1,
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                <IconButton
                  size="small"
                  aria-label="Back to all tabs"
                  onClick={() => selectFolder(null)}
                >
                  <ArrowBackRoundedIcon sx={{ fontSize: 20 }} />
                </IconButton>
                <FolderCompositeAvatar
                  getTitle={org.getTabTitle}
                  size={34}
                  tabs={folderTabsMap.get(selectedFolder.id) || []}
                />
                {folderNameEditing ? (
                  <>
                    <TextField
                      inputRef={folderHeaderInputRef}
                      size="small"
                      value={folderHeaderName}
                      onChange={(e) => setFolderHeaderName(e.target.value)}
                      onBlur={() => {
                        if (skipFolderBlurCommitRef.current) {
                          skipFolderBlurCommitRef.current = false;
                          return;
                        }
                        void commitFolderHeaderName();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveFolderHeaderName();
                        }
                        if (e.key === 'Escape') {
                          dismissFolderNameEdit(true);
                        }
                      }}
                      inputProps={{
                        enterKeyHint: 'done',
                        inputMode: 'text',
                      }}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        '& .MuiInputBase-input': {
                          fontSize: 16,
                          fontWeight: 700,
                          py: 0.75,
                        },
                      }}
                    />
                    <IconButton
                      size="small"
                      aria-label="Save folder name"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={saveFolderHeaderName}
                    >
                      <CheckRoundedIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <Typography
                      onClick={tabsEditMode ? startFolderHeaderEdit : undefined}
                      sx={{
                        flex: 1,
                        fontSize: 16,
                        fontWeight: 700,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: tabsEditMode ? 'text' : 'default',
                      }}
                    >
                      {selectedFolder.name}
                    </Typography>
                    {tabsEditButton}
                  </>
                )}
              </Box>
            ) : (
              <Typography sx={{ fontSize: 16, fontWeight: 700, flex: 1 }}>
                Tabs{tabs.length ? ` (${tabs.length})` : ''}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              {!selectedFolder ? tabsEditButton : null}
              {tabsEditMode ? (
                <IconButton
                  size="small"
                  aria-label="New folder"
                  onClick={(event) => {
                    event.stopPropagation();
                    void org.createFolder('New folder').then((id) => selectFolder(id));
                  }}
                >
                  <CreateNewFolderRoundedIcon />
                </IconButton>
              ) : null}
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
          <DndContext
            sensors={sensors}
            collisionDetection={tabGridCollisionDetection}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
          >
          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
          {org.folders.length > 0 && (
            <Box
              sx={{
                borderBottom: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                gap: 0.85,
                px: 1.5,
                py: 1.25,
              }}
            >
              {folderRows.map((rowFolders, rowIndex) => (
                <Box
                  key={`folder-row-${rowIndex}`}
                  sx={{
                    overflowX: 'auto',
                    touchAction: 'pan-x',
                    WebkitOverflowScrolling: 'touch',
                    width: '100%',
                  }}
                >
                  <SortableContext
                    items={rowFolders.map((folder) => folderDragId(folder.id))}
                    strategy={horizontalListSortingStrategy}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        gap: 1,
                        minWidth: 'min-content',
                        pr: 0.5,
                        width: 'max-content',
                      }}
                    >
                      {rowFolders.map((folder) => (
                        <SortableFolderChip
                          key={folder.id}
                          editMode={tabsEditMode}
                          folderId={folder.id}
                          getTitle={org.getTabTitle}
                          name={folder.name}
                          onRemove={() => void handleTrashFolder(folder.id)}
                          onSelect={() => {
                            if (dragEndedRef.current) return;
                            selectFolder(folder.id);
                          }}
                          selected={selectedFolderId === folder.id}
                          tabs={folderTabsMap.get(folder.id) || []}
                        />
                      ))}
                      {tabsEditMode && rowFolders.length === 0 ? (
                        <FolderRowDropZone rowIndex={rowIndex} />
                      ) : null}
                      {tabsEditMode && rowFolders.length > 0 ? (
                        <FolderRowEndDropZone rowIndex={rowIndex} />
                      ) : null}
                      {tabsEditMode ? (
                        <>
                          {rowFolders.length === 0 && folderRowCount > 1 ? (
                            <FolderRowRemoveButton
                              onClick={() => void org.removeFolderRow(rowIndex)}
                            />
                          ) : null}
                          <FolderRowAddButton
                            onClick={() => void org.insertFolderRowAfter(rowIndex)}
                          />
                        </>
                      ) : null}
                    </Box>
                  </SortableContext>
                </Box>
              ))}
            </Box>
          )}

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowX: 'hidden',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              p: 2,
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {visibleTabs.length === 0 ? (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  opacity: 0.7,
                  py: 2.5,
                }}
              >
                <AppsRoundedIcon sx={{ fontSize: 48 }} />
                <Typography sx={{ fontSize: 14 }}>No open tabs yet</Typography>
                {tabsEditMode && canDragTabs && (
                  <Typography sx={{ fontSize: 12, opacity: 0.75, px: 2, textAlign: 'center' }}>
                    {canReorderFolderTabs
                      ? 'Drag apps to reorder or tap × to remove'
                      : 'Drag apps onto folders, tap × to remove, or drag folders to reorder'}
                  </Typography>
                )}
              </Box>
            ) : (
              <SortableContext
                items={sortableTabIds}
                strategy={rectSortingStrategy}
              >
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 1,
                    minWidth: 0,
                    width: '100%',
                  }}
                >
                  {visibleTabs.map((tab) => {
                    const title = org.getTabTitle(tab);
                    const isActive = selectedTab?.tabId === tab.tabId;
                    const isSavedOnly = isSavedOnlyTab(tab);
                    const color = colorFor(title);
                    return (
                      <SortableTabCard
                        key={tab.tabId || getOpenTabKey(tab)}
                        tab={tab}
                        title={title}
                        color={color}
                        isActive={isActive}
                        isSavedOnly={isSavedOnly}
                        editMode={tabEditMode}
                        showQuickClose={!tabEditMode && !isSavedOnly}
                        longPressProps={bindLongPress(tab)}
                        onClose={(e) =>
                          tabEditMode
                            ? handleClose(e, tab)
                            : handleQuickClose(e, tab)
                        }
                        onSelect={() => handleSelect(tab)}
                      />
                    );
                  })}
                </Box>
              </SortableContext>
            )}
          </Box>
          </Box>

          <DragOverlay
            dropAnimation={{
              duration: 220,
              easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
            }}
          >
            {draggedTab ? (
              <TabDragAvatarPreview
                color={colorFor(org.getTabTitle(draggedTab))}
                tab={draggedTab}
                title={org.getTabTitle(draggedTab)}
              />
            ) : draggedFolderId ? (
              (() => {
                const folder = org.folders.find((item) => item.id === draggedFolderId);
                if (!folder) return null;
                return (
                  <FolderDragPreview
                    getTitle={org.getTabTitle}
                    name={folder.name}
                    tabs={folderTabsMap.get(folder.id) || []}
                  />
                );
              })()
            ) : null}
          </DragOverlay>
          </DndContext>
          </Box>
            </Box>
            <Box
              aria-label="Close tabs"
              onClick={onClose}
              onTouchMove={onClose}
              sx={{
                flex: 1,
                minHeight: 0,
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
            />
          </Box>
        </Slide>
      </Box>
      ) : null}

      <MobileTabAppDetailsDialog
        displayTitle={detailsTab ? org.getTabTitle(detailsTab) : ''}
        onClose={closeTabDetails}
        onOpenTabOptions={(tab) => {
          closeTabDetails();
          openTabOptions(tab);
        }}
        open={detailsOpen}
        tab={detailsTab}
      />

      <MobileTabOptionsDialog
        currentFolderId={
          actionTab ? org.getFolderForTab(actionTab)?.id ?? null : null
        }
        folders={org.folders}
        hasCustomLabel={
          actionTab
            ? Boolean(
                org.organization.tabOverrides[getOpenTabKey(actionTab)]?.customLabel
              )
            : false
        }
        onAddToFolder={(folderId) => void handleAddToFolder(folderId)}
        onChangeAddress={openAddressDialog}
        onClose={closeTabOptions}
        onCreateFolder={() => void handleCreateFolder()}
        onRemoveFromFolder={() => {
          if (!actionTab) return;
          void org.removeTabFromFolder(actionTab);
          setActionTab(null);
          closeTabOptions();
        }}
        onRename={openRenameDialog}
        onRestoreName={() => {
          if (!actionTab) return;
          void org.restoreTabName(actionTab);
          setActionTab(null);
          closeTabOptions();
        }}
        open={tabOptionsOpen && Boolean(actionTab)}
        tab={actionTab}
        tabTitle={actionTab ? org.getTabTitle(actionTab) : ''}
      />

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        fullWidth
        maxWidth="xs"
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      >
        <DialogTitle>Rename tab</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            label="Display name"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (actionTab) void org.renameTab(actionTab, renameValue);
              setRenameOpen(false);
              setActionTab(null);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={addressOpen}
        onClose={() => setAddressOpen(false)}
        fullWidth
        maxWidth="sm"
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      >
        <DialogTitle>Change qortal:// address</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            label="Qortal link"
            placeholder="qortal://APP/Name/path"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (!actionTab) return;
              const parsed = extractComponents(normalizeQortalInput(addressValue));
              if (!parsed) return;
              void org.updateTabAddress(actionTab, parsed);
              setAddressOpen(false);
              setActionTab(null);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <CustomizedSnackbars
        duration={3200}
        info={snackInfo}
        open={snackOpen}
        setInfo={setSnackInfo}
        setOpen={setSnackOpen}
      />
    </>
  );
};

export default MobileTabsOverlay;
