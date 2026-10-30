import {
  memo,
  type ComponentProps,
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
  IconButton,
  Slide,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ClearAllRoundedIcon from '@mui/icons-material/ClearAllRounded';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
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
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import {
  getExtSavedSettings,
  getExtSavedSettingsRecord,
} from '../../hooks/qdnSavedSettings';
import { extractComponents } from '../Chat/MessageDisplay';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { FolderCompositeAvatar } from './FolderCompositeAvatar';
import { MobileTabAppDetailsDialog } from './MobileTabAppDetailsDialog';
import { MobileTabOptionsDialog } from './MobileTabOptionsDialog';
import { getOpenTabKey, groupFoldersByRow, resolveFolderTab } from './mobileTabOrganization';
import { useMobileTabOrganization } from './useMobileTabOrganization';
import { TabAvatar, colorFor } from './MobileTabsOverlay.shared';
import {
  closeAllOpenTabs,
  closeOpenTab,
  launchAppWindow,
  openOrSelectTab,
  useOpenTabs,
  type OpenTab,
} from './useOpenTabs';
import { buildTabQortalUrl } from './tabQortalLink';
import { normalizeQortalInput } from './appsDashboardSearch';
import { createBackgroundGesture } from './tabsOverlayBackgroundGesture';
import { setTabsPanelElement } from './tabsPull';
import { useTabsSwipeClose } from './tabsSwipeClose';
import { TabPreviewCard } from './tabsHome/TabPreviewCard';
import { useShownWindows } from './tabsHome/useShownWindows';
import { groupTabsIntoStacks, type TabStack } from './tabsHome/tabStacks';
import { measureBoxes, playFlip } from './tabsHome/flip';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { filterAppTabsForMobile, isQChatOpenTab } from '../../utils/openQChatTab';
import {
  MOBILE_TAB_BAR_HEIGHT_PX,
  MOBILE_TOP_BAR_HEIGHT_PX,
} from './mobileBarHeights';
import {
  MOBILE_TABS_DIALOG_Z,
  MOBILE_TABS_OVERLAY_Z,
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
} from './mobileLayout';
import { isGoLayout, useGoLayout, useNavInTopBar } from '../../layout/goLayout';
import {
  tabsCardColumnsTemplate,
  tabsFolderIconColumnsTemplate,
} from './tabsHome/goTabsGrid';

type MobileTabsOverlayProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Opened by a pull down from a list (tabsPull): shown at once, with no
   * slide of its own, while the pull moves its panel with the finger; and
   * the touch doing it never counts as a tap behind the panel.
   */
  pulling?: boolean;
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
const FOLDER_DROP_PREFIX = 'folder-drop:';
const ROW_DROP_PREFIX = 'row:drop:';

const tabDragId = (tab: OpenTab) => `${TAB_DRAG_PREFIX}${getOpenTabKey(tab)}`;
const folderDragId = (folderId: string) => `${FOLDER_DRAG_PREFIX}${folderId}`;
const folderDropId = (folderId: string) => `${FOLDER_DROP_PREFIX}${folderId}`;
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
  const value = String(id);
  if (value.startsWith(FOLDER_DROP_PREFIX)) {
    return { type: 'folder', folderId: value.slice(FOLDER_DROP_PREFIX.length) };
  }
  return null;
};

const tabGridCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);

  if (activeId.startsWith(TAB_DRAG_PREFIX)) {
    const folderDropContainers = args.droppableContainers.filter((container) =>
      String(container.id).startsWith(FOLDER_DROP_PREFIX)
    );
    const folderHits = rectIntersection({
      ...args,
      droppableContainers: folderDropContainers,
    });
    if (folderHits.length > 0) {
      return folderHits;
    }

    const tabPointerHits = pointerWithin(args).filter((collision) =>
      String(collision.id).startsWith(TAB_DRAG_PREFIX)
    );
    if (tabPointerHits.length > 0) {
      return tabPointerHits;
    }
  }

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
  const { t } = useTranslation(['core']);
  const { active } = useDndContext();
  const sortableId = folderDragId(folderId);
  const dropTargetId = folderDropId(folderId);
  const skipClickRef = useRef(false);
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: !editMode });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropTargetId });

  useEffect(() => {
    if (isDragging) {
      skipClickRef.current = true;
      return;
    }
    if (!skipClickRef.current) return;
    // Swallow only the click that ends the drag. dnd-kit usually eats that
    // click itself and a touch drag makes none, so a flag left set here
    // would swallow the next real tap on this folder.
    const timer = window.setTimeout(() => {
      skipClickRef.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
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
      ref={setDropRef}
      sx={{
        flexShrink: 0,
        pb: 0.25,
        pt: 0.5,
      }}
    >
      <Box
        ref={setSortableRef}
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
          cursor: editMode ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.6,
          position: 'relative',
          px: 0.5,
          touchAction: editMode ? 'none' : 'pan-x',
          userSelect: 'none',
          width: 76,
          willChange: 'transform',
        }}
      >
        <Box
          sx={{
            borderRadius: '15px',
            boxShadow: isTabDropTarget
              ? `0 0 0 3px ${theme.palette.primary.main}`
              : selected
                ? `0 0 0 2px ${theme.palette.primary.main}`
                : editMode
                  ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.6)}`
                  : 'none',
            lineHeight: 0,
            transform: isTabDropTarget ? 'scale(1.1)' : 'none',
            transition:
              'box-shadow 140ms ease, transform 200ms cubic-bezier(0.2, 0.9, 0.25, 1)',
            '&:active': editMode ? undefined : { transform: 'scale(0.93)' },
          }}
        >
          <FolderCompositeAvatar tabs={tabs} getTitle={getTitle} size={54} />
        </Box>
        {editMode ? (
          <IconButton
            aria-label={t('core:tabs_home.delete_folder', {
              postProcess: 'capitalizeFirstChar',
            })}
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            sx={{
              backgroundColor: theme.palette.background.paper,
              boxShadow: `0 0 0 1px ${theme.palette.divider}`,
              color: theme.palette.error.main,
              height: 22,
              left: 0,
              position: 'absolute',
              top: -6,
              width: 22,
              zIndex: 2,
              '&:hover': { backgroundColor: theme.palette.background.paper },
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 14 }} />
          </IconButton>
        ) : null}
        <Typography
          sx={{
            color: selected ? theme.palette.primary.main : 'text.primary',
            fontSize: 11.5,
            fontWeight: selected ? 700 : 500,
            maxWidth: 72,
            overflow: 'hidden',
            textAlign: 'center',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Typography>
      </Box>
    </Box>
  );
});

type LongPressProps = {
  onContextMenu: (e: React.MouseEvent) => void;
  onSelectStart: (e: React.SyntheticEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: () => void;
  onTouchEnd: () => void;
};

/** An open tab as a browser-style card with a picture of the page. */
const SortableTabPreview = ({
  tab,
  title,
  stackKey,
  windowProps,
  isActive,
  editMode,
  index,
  closing,
  closeLabel,
  onSelect,
  onClose,
  longPressProps,
}: {
  tab: OpenTab;
  title: string;
  stackKey: string;
  /** Several windows of one app: their avatars under the card. */
  windowProps: Pick<
    ComponentProps<typeof TabPreviewCard>,
    'windows' | 'activeWindowId' | 'onPickWindow' | 'windowLabel' | 'colorKey'
  >;
  isActive: boolean;
  editMode: boolean;
  index: number;
  closing: boolean;
  closeLabel: string;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  longPressProps: LongPressProps;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tabDragId(tab), disabled: !editMode });

  return (
    <Box
      ref={setNodeRef}
      data-overlay-card={stackKey}
      {...(editMode ? attributes : {})}
      {...(editMode ? listeners : {})}
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
        minWidth: 0,
        position: 'relative',
        touchAction: editMode ? 'none' : 'manipulation',
        ...noTextSelectionSx,
      }}
    >
      <TabPreviewCard
        closeLabel={closeLabel}
        closing={closing}
        editMode={editMode}
        index={index}
        isActive={isActive}
        onClose={onClose}
        onSelect={editMode ? undefined : onSelect}
        {...windowProps}
        tab={tab}
        title={title}
      />
    </Box>
  );
};

/** An app inside a folder, as an icon on a phone's home screen. */
const SortableFolderAppIcon = ({
  tab,
  title,
  isActive,
  isOpen,
  editMode,
  removeLabel,
  onSelect,
  onRemove,
  longPressProps,
}: {
  tab: OpenTab;
  title: string;
  isActive: boolean;
  isOpen: boolean;
  editMode: boolean;
  removeLabel: string;
  onSelect: () => void;
  onRemove: (e: React.MouseEvent) => void;
  longPressProps: LongPressProps;
}) => {
  const theme = useTheme();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tabDragId(tab), disabled: !editMode });

  return (
    <Box
      ref={setNodeRef}
      {...(editMode ? attributes : {})}
      {...(editMode ? listeners : {})}
      {...(editMode ? {} : longPressProps)}
      onClick={editMode ? undefined : onSelect}
      style={{
        transform: CSS.Transform.toString(transform),
        transition:
          transition ||
          'transform 220ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms ease',
        opacity: isDragging ? 0.28 : 1,
      }}
      sx={{
        alignItems: 'center',
        cursor: editMode ? 'grab' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minWidth: 0,
        position: 'relative',
        py: 0.75,
        touchAction: editMode ? 'none' : 'manipulation',
        ...noTextSelectionSx,
        '&:active > .go-folder-app-icon': editMode
          ? undefined
          : { transform: 'scale(0.92)' },
      }}
    >
      <Box
        className="go-folder-app-icon"
        sx={{
          borderRadius: '16px',
          boxShadow: isActive
            ? `0 0 0 2.5px ${theme.palette.primary.main}`
            : 'none',
          lineHeight: 0,
          position: 'relative',
          transition: 'transform 160ms ease',
        }}
      >
        <TabAvatar
          color={colorFor(title)}
          radius={15}
          size={54}
          tab={tab}
          title={title}
        />
        {isOpen ? (
          <Box
            component="span"
            sx={{
              backgroundColor: 'primary.main',
              borderRadius: '50%',
              bottom: -6,
              height: 5,
              left: '50%',
              position: 'absolute',
              transform: 'translateX(-50%)',
              width: 5,
            }}
          />
        ) : null}
      </Box>
      {editMode ? (
        <IconButton
          aria-label={removeLabel}
          size="small"
          onClick={onRemove}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          sx={{
            backgroundColor: theme.palette.background.paper,
            boxShadow: `0 0 0 1px ${theme.palette.divider}`,
            color: theme.palette.error.main,
            height: 22,
            left: 'calc(50% - 36px)',
            position: 'absolute',
            top: 0,
            width: 22,
            zIndex: 2,
            '&:hover': { backgroundColor: theme.palette.background.paper },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      ) : null}
      <Typography
        sx={{
          fontSize: 11.5,
          fontWeight: 500,
          maxWidth: '100%',
          overflow: 'hidden',
          textAlign: 'center',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...noTextSelectionSx,
        }}
      >
        {title}
      </Typography>
    </Box>
  );
};

export const MobileTabsOverlay = ({
  open,
  onClose,
  pulling = false,
}: MobileTabsOverlayProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  // The Hub's grids follow orientation; GO's follow the width (goTabsGrid).
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const goGrid = isGoLayout();
  const navInTopBar = useNavInTopBar();
  const isShortWindow = useGoLayout((l) => l.short);
  const { tabs: rawTabs, selectedTab: rawSelectedTab } = useOpenTabs();
  const tabs = useMemo(() => filterAppTabsForMobile(rawTabs), [rawTabs]);
  const selectedTab = useMemo(
    () =>
      rawSelectedTab && !isQChatOpenTab(rawSelectedTab) ? rawSelectedTab : null,
    [rawSelectedTab]
  );
  const org = useMobileTabOrganization();
  const userInfo = useAtomValue(userInfoAtom);
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
  const [importingHubDashboard, setImportingHubDashboard] = useState(false);
  const [folderPendingDelete, setFolderPendingDelete] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  // Keeps the dialog text stable while it fades out after a close.
  const lastFolderPendingDeleteRef = useRef(folderPendingDelete);
  if (folderPendingDelete) {
    lastFolderPendingDeleteRef.current = folderPendingDelete;
  }
  const folderDeleteText = folderPendingDelete ?? lastFolderPendingDeleteRef.current;
  const [overlayMounted, setOverlayMounted] = useState(false);
  const folderHeaderInputRef = useRef<HTMLInputElement>(null);
  const skipFolderBlurCommitRef = useRef(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const dragEndedRef = useRef(false);
  const tabsRef = useRef(tabs);
  const tabsPanelRef = useRef<HTMLDivElement | null>(null);
  // Also handed to a pull down from a list, which moves it (tabsPull).
  // State too, so the slide-up-to-close listeners follow a new panel.
  const [tabsPanelEl, setTabsPanelEl] = useState<HTMLDivElement | null>(null);
  const setTabsPanel = useCallback((element: HTMLDivElement | null) => {
    tabsPanelRef.current = element;
    setTabsPanelElement(element);
    setTabsPanelEl(element);
  }, []);
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  // The strip below the panel: a swipe there over a long list is a swipe on it.
  const [tabsBelowEl, setTabsBelowEl] = useState<HTMLDivElement | null>(null);
  const cardsGridRef = useRef<HTMLDivElement | null>(null);
  const [closingStackKeys, setClosingStackKeys] = useState<Set<string>>(
    () => new Set()
  );
  const pendingCardFlipRef = useRef<{
    at: number;
    boxes: Map<string, DOMRect>;
  } | null>(null);

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

  // Root shows the open tabs; a folder shows exactly its own apps in folder
  // order, open ones live and closed ones as saved shells.
  const visibleTabs = useMemo(
    () =>
      selectedFolder ? folderTabsMap.get(selectedFolder.id) ?? [] : tabs,
    [folderTabsMap, selectedFolder, tabs]
  );

  // Root: several tabs of one app are one stacked card.
  const rootStacks = useMemo(
    () => groupTabsIntoStacks(tabs, selectedTab?.tabId ?? null),
    [selectedTab?.tabId, tabs]
  );
  const { shownFor, pick } = useShownWindows(open);

  const sortableTabIds = useMemo(
    () =>
      selectedFolder
        ? visibleTabs.map((tab) => tabDragId(tab))
        : rootStacks.map((stack) => tabDragId(stack.lead)),
    [rootStacks, selectedFolder, visibleTabs]
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

  const openTabIdsKey = tabs.map((tab) => tab.tabId).join('|');
  useLayoutEffect(() => {
    const before = pendingCardFlipRef.current;
    pendingCardFlipRef.current = null;
    if (before && performance.now() - before.at < 1500) {
      playFlip(cardsGridRef.current, 'data-overlay-card', before.boxes, {
        duration: 300,
      });
    }
    setClosingStackKeys((prev) => {
      if (prev.size === 0) return prev;
      const stillOpen = new Set(rootStacks.map((stack) => stack.key));
      const next = new Set([...prev].filter((key) => stillOpen.has(key)));
      return next.size === prev.size ? prev : next;
    });
    // Only a change in which tabs are open plays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabIdsKey]);

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

  // Every open starts on all tabs, never inside the folder left open.
  const wasOpenRef = useRef(open);
  useLayoutEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) setSelectedFolderId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (detailsOpen || tabOptionsOpen || renameOpen || addressOpen) return;
    if (draggedTab || draggedFolderId) return;
    // The finger pulling it down is still on the page behind.
    if (pulling) return;
    // While arranging tabs/folders the @dnd-kit TouchSensor has a 180ms
    // activation delay; during it draggedTab is still null, so an early
    // touchmove would otherwise background-close the overlay mid-drag.
    if (tabsEditMode) return;

    const isInsideTabsPanel = (target: EventTarget | null) =>
      target instanceof Node &&
      Boolean(tabsPanelRef.current?.contains(target));

    const isInsideModal = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('.MuiDialog-root, .MuiModal-root'));

    // Touching the app behind closes the panel, except a swipe from just
    // below a long list, which scrolls the list (see the helper).
    const gesture = createBackgroundGesture({
      getList: () => tabsListRef.current,
      getPanel: () => tabsPanelRef.current,
      isExempt: (target) => isInsideTabsPanel(target) || isInsideModal(target),
      onClose,
    });

    // No 'scroll' listener: it also fires for programmatic scrolls, such as
    // a chat behind the panel following a new message, and closed the
    // overlay with no input at all.
    const options = { capture: true, passive: true };
    document.addEventListener('touchstart', gesture.onTouchStart, options);
    document.addEventListener('touchmove', gesture.onTouchMove, options);
    document.addEventListener('touchend', gesture.onTouchEnd, options);
    document.addEventListener('touchcancel', gesture.onTouchEnd, options);
    document.addEventListener('wheel', gesture.onWheel, options);

    return () => {
      document.removeEventListener('touchstart', gesture.onTouchStart, true);
      document.removeEventListener('touchmove', gesture.onTouchMove, true);
      document.removeEventListener('touchend', gesture.onTouchEnd, true);
      document.removeEventListener('touchcancel', gesture.onTouchEnd, true);
      document.removeEventListener('wheel', gesture.onWheel, true);
    };
  }, [
    addressOpen,
    detailsOpen,
    draggedFolderId,
    draggedTab,
    onClose,
    open,
    pulling,
    renameOpen,
    tabOptionsOpen,
    tabsEditMode,
  ]);

  useEffect(() => {
    if (open) return;
    setTabsEditMode(false);
    dismissFolderNameEdit(true);
    setDetailsOpen(false);
    setTabOptionsOpen(false);
    setRenameOpen(false);
    setAddressOpen(false);
    setFolderPendingDelete(null);
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

  // An urgent update on purpose: a folder holds at most a few dozen cards,
  // and a transition here left the tap without any visible response whenever
  // other work kept the transition lanes waiting.
  const selectFolder = useCallback((folderId: string | null) => {
    dismissFolderNameEdit(true);
    setSelectedFolderId(folderId);
  }, [dismissFolderNameEdit]);

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

  const showSnack = useCallback((type: string, message: string) => {
    setSnackInfo({ type, message, duration: 3200 });
    setSnackOpen(true);
  }, []);

  const handleImportHubDashboard = useCallback(async () => {
    if (importingHubDashboard) return;
    const myName = String(userInfo?.name || '').trim();
    if (!myName) {
      showSnack(
        'error',
        'This account has no registered name, so a Hub dashboard cannot be imported.'
      );
      return;
    }

    setImportingHubDashboard(true);
    try {
      const { hasPublishRecord } = await getExtSavedSettingsRecord(myName);
      if (!hasPublishRecord) {
        showSnack('error', 'No Hub dashboard is saved for this account.');
        return;
      }
      const settings = await getExtSavedSettings(myName);
      const pins = Array.isArray(settings?.sortablePinnedApps)
        ? settings.sortablePinnedApps
        : null;
      if (!settings || !pins) {
        showSnack('error', 'Could not read the Hub dashboard for this account.');
        return;
      }

      const { folderId, imported, skipped } =
        org.importPinnedAppsToHubFolder(pins);
      if (folderId) {
        selectFolder(folderId);
      }

      if (imported === 0 && skipped === 0) {
        showSnack('error', 'The Hub dashboard has no pinned apps to import.');
        return;
      }

      if (skipped > 0) {
        showSnack(
          'success',
          `Imported ${imported} pinned app${imported === 1 ? '' : 's'} into Hub. ${skipped} already in other folders.`
        );
        return;
      }
      showSnack(
        'success',
        `Imported ${imported} pinned app${imported === 1 ? '' : 's'} into Hub.`
      );
    } catch {
      showSnack('error', 'Could not read the Hub dashboard for this account.');
    } finally {
      setImportingHubDashboard(false);
    }
  }, [
    importingHubDashboard,
    org,
    selectFolder,
    showSnack,
    userInfo?.name,
  ]);

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

  // A folder with apps in it asks first: deleting it also forgets the saved
  // apps inside, and the × sits on a small corner of a draggable chip.
  const requestTrashFolder = useCallback(
    (folderId: string) => {
      const folder = org.folders.find((item) => item.id === folderId);
      if (!folder) return;
      const count = folderTabsMap.get(folderId)?.length ?? 0;
      if (count === 0) {
        void handleTrashFolder(folderId);
        return;
      }
      setFolderPendingDelete({ id: folderId, name: folder.name, count });
    },
    [folderTabsMap, handleTrashFolder, org.folders]
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
      const tab = resolveTabByKey(tabKey);
      if (!tab) return;

      const folderTarget = parseTabDropTarget(over.id);
      if (folderTarget) {
        const currentFolder = org.getFolderForTab(tab);
        if (currentFolder?.id !== folderTarget.folderId) {
          void org.addTabToFolder(tab, folderTarget.folderId);
        }
        return;
      }

      const overTabKey = parseTabDragId(over.id);
      if (overTabKey && overTabKey !== tabKey) {
        const folderId =
          selectedFolderId ?? org.getFolderForTab(tab)?.id ?? null;
        if (folderId) {
          void org.reorderTabsInFolder(folderId, tabKey, overTabKey);
        }
        return;
      }
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

  // An app icon in a folder launches it, again in a new window when it is
  // already open (its card in all tabs switches to the open one).
  const handleLaunch = (tab: OpenTab) => {
    if (tabsEditMode) return;
    if (dragEndedRef.current || longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    launchAppWindow(tab);
    onClose();
  };

  useTabsSwipeClose({
    enabled:
      open &&
      !pulling &&
      !tabsEditMode &&
      !detailsOpen &&
      !tabOptionsOpen &&
      !renameOpen &&
      !addressOpen &&
      !folderPendingDelete,
    below: tabsBelowEl,
    getList: () => tabsListRef.current,
    onClose,
    panel: tabsPanelEl,
  });

  // A closed card shrinks away, then the others glide into its place. With
  // several windows of one app only the shown one closes; the card stays.
  const closeStackAnimated = (stack: TabStack) => {
    const flipBefore = () => {
      pendingCardFlipRef.current = {
        at: performance.now(),
        boxes: measureBoxes(cardsGridRef.current, 'data-overlay-card'),
      };
    };
    if (stack.tabs.length > 1) {
      flipBefore();
      closeOpenTab(shownFor(stack).tabId);
      return;
    }
    if (closingStackKeys.has(stack.key)) return;
    setClosingStackKeys((prev) => new Set(prev).add(stack.key));
    window.setTimeout(() => {
      flipBefore();
      stack.tabs.forEach((tab) => {
        if (!isSavedOnlyTab(tab)) closeOpenTab(tab.tabId);
      });
    }, 170);
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

  // These dialogs act on actionTab, so only the options sheet closes here;
  // closeTabOptions() would clear the tab and leave Save with nothing to do.
  const openRenameDialog = () => {
    if (!actionTab) return;
    setRenameValue(org.getTabTitle(actionTab));
    setRenameOpen(true);
    setTabOptionsOpen(false);
  };

  const openAddressDialog = () => {
    if (!actionTab || actionTab.internal) return;
    setAddressValue(buildTabQortalUrl(actionTab));
    setAddressOpen(true);
    setTabOptionsOpen(false);
  };

  const closeRenameDialog = () => {
    setRenameOpen(false);
    setActionTab(null);
  };

  const closeAddressDialog = () => {
    setAddressOpen(false);
    setActionTab(null);
  };

  const saveFolderHeaderName = () => {
    void commitFolderHeaderName();
  };

  // Android back unwinds the overlay one layer at a time: a dialog, folder
  // name editing, edit mode, then the open folder. Only after that does
  // App's overlay handler close the panel.
  useAndroidBack(
    () => {
      if (folderPendingDelete) {
        setFolderPendingDelete(null);
        return true;
      }
      if (renameOpen) {
        closeRenameDialog();
        return true;
      }
      if (addressOpen) {
        closeAddressDialog();
        return true;
      }
      if (tabOptionsOpen) {
        closeTabOptions();
        return true;
      }
      if (detailsOpen) {
        closeTabDetails();
        return true;
      }
      if (!open) return false;
      if (folderNameEditing) {
        dismissFolderNameEdit(true);
        return true;
      }
      if (tabsEditMode) {
        toggleTabsEditMode();
        return true;
      }
      if (selectedFolder) {
        selectFolder(null);
        return true;
      }
      return false;
    },
    { priority: BACK_PRIORITY.overlay + 5 }
  );

  const tabsPanelTop = `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP})`;
  // With the nav in the top bar the bottom tab bar is hidden, so its height
  // is not reserved. A short window (GO) keeps only a sliver of gap.
  const tabsPanelMaxHeight = `calc(100dvh - ${MOBILE_TOP_BAR_HEIGHT_PX}px - ${SAFE_AREA_TOP} - ${navInTopBar ? 0 : MOBILE_TAB_BAR_HEIGHT_PX}px - ${SAFE_AREA_BOTTOM} - ${isShortWindow ? 8 : 24}px)`;

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
          // A pull moves the panel itself.
          timeout={pulling ? 0 : undefined}
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
              ref={setTabsPanel}
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              {tabs.length > 0 && !selectedFolder ? (
                <ButtonBase
                  onClick={(event) => {
                    event.stopPropagation();
                    closeAllOpenTabs();
                    onClose();
                  }}
                  sx={{
                    alignItems: 'center',
                    borderRadius: '999px',
                    color: theme.palette.error.main,
                    display: 'inline-flex',
                    fontSize: 13,
                    fontWeight: 600,
                    gap: 0.35,
                    px: 1,
                    py: 0.45,
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
              ) : null}
              {!selectedFolder ? tabsEditButton : null}
              {tabsEditMode ? (
                <>
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
                  <IconButton
                    size="small"
                    aria-label="Import Hub dashboard"
                    disabled={importingHubDashboard}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleImportHubDashboard();
                    }}
                  >
                    <CloudDownloadRoundedIcon />
                  </IconButton>
                </>
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
                    scrollbarWidth: 'none',
                    touchAction: 'pan-x',
                    WebkitOverflowScrolling: 'touch',
                    width: '100%',
                    '&::-webkit-scrollbar': { display: 'none' },
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
                          onRemove={() => requestTrashFolder(folder.id)}
                          onSelect={() => {
                            if (dragEndedRef.current) return;
                            // Tapping the open folder again goes back to all tabs.
                            selectFolder(
                              selectedFolder?.id === folder.id ? null : folder.id
                            );
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
            ref={tabsListRef}
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
            {tabsEditMode && canDragTabs && visibleTabs.length > 0 ? (
              <Typography
                sx={{
                  fontSize: 12,
                  mb: 1.25,
                  opacity: 0.65,
                  textAlign: 'center',
                }}
              >
                {canReorderFolderTabs
                  ? t('core:tabs_overlay.edit_hint_folder', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:tabs_overlay.edit_hint_root', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </Typography>
            ) : null}
            {visibleTabs.length === 0 ? (
              selectedFolder ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    opacity: 0.7,
                    px: 2,
                    py: 2.5,
                    textAlign: 'center',
                  }}
                >
                  <Typography sx={{ fontSize: 14 }}>
                    {t('core:tabs_overlay.folder_empty', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Typography sx={{ fontSize: 12, opacity: 0.8 }}>
                    {t('core:tabs_overlay.folder_empty_hint', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
              ) : org.folders.length > 0 ? (
                // Folders are right above: a big "nothing here" would read as
                // if the saved apps were gone.
                <Typography
                  sx={{
                    fontSize: 13,
                    opacity: 0.65,
                    px: 2,
                    py: 1.5,
                    textAlign: 'center',
                  }}
                >
                  {t('core:tabs_overlay.no_open_tabs_with_folders', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              ) : (
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
                  <Typography sx={{ fontSize: 14 }}>
                    {t('core:tabs_overlay.no_open_tabs', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
              )
            ) : (
              <SortableContext
                items={sortableTabIds}
                strategy={rectSortingStrategy}
              >
                {selectedFolder ? (
                  <Box
                    sx={{
                      columnGap: 1,
                      display: 'grid',
                      gridTemplateColumns: tabsFolderIconColumnsTemplate(
                        goGrid,
                        isLandscape
                      ),
                      minWidth: 0,
                      rowGap: 1.25,
                      width: '100%',
                    }}
                  >
                    {visibleTabs.map((tab) => {
                      const key = getOpenTabKey(tab);
                      return (
                        <SortableFolderAppIcon
                          key={tab.tabId || key}
                          editMode={tabEditMode}
                          isActive={selectedTab?.tabId === tab.tabId}
                          isOpen={!isSavedOnlyTab(tab)}
                          longPressProps={bindLongPress(tab)}
                          onRemove={(e) => handleClose(e, tab)}
                          onSelect={() => handleLaunch(tab)}
                          removeLabel={t('core:tabs_home.remove_from_folder', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                          tab={tab}
                          title={org.getTabTitle(tab)}
                        />
                      );
                    })}
                  </Box>
                ) : (
                  <Box
                    ref={cardsGridRef}
                    sx={{
                      display: 'grid',
                      gap: '10px',
                      gridTemplateColumns: tabsCardColumnsTemplate(
                        goGrid,
                        isLandscape
                      ),
                      minWidth: 0,
                      width: '100%',
                    }}
                  >
                    {rootStacks.map((stack, index) => {
                      const shown = shownFor(stack);
                      return (
                        <SortableTabPreview
                          key={stack.key}
                          closeLabel={t('core:tabs_home.close_tab', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                          closing={closingStackKeys.has(stack.key)}
                          editMode={tabEditMode}
                          index={index}
                          isActive={selectedTab?.tabId === shown.tabId}
                          longPressProps={bindLongPress(shown)}
                          onClose={(e) => {
                            e.stopPropagation();
                            closeStackAnimated(stack);
                          }}
                          onSelect={() => handleSelect(shown)}
                          stackKey={stack.key}
                          tab={shown}
                          title={org.getTabTitle(shown)}
                          windowProps={{
                            activeWindowId: selectedTab?.tabId
                              ? String(selectedTab.tabId)
                              : null,
                            colorKey: org.getTabTitle(stack.lead),
                            onPickWindow: (tab) => pick(stack.key, tab),
                            windowLabel: (position) =>
                              t('core:tabs_home.window_n', {
                                amount: position,
                                postProcess: 'capitalizeFirstChar',
                              }),
                            windows: stack.tabs,
                          }}
                        />
                      );
                    })}
                  </Box>
                )}
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
          {/* Slide up here (or on the header) to close; on the list a big
              swipe closes and a small one scrolls (useTabsSwipeClose). */}
          <Box
            aria-hidden
            sx={{
              display: 'flex',
              flexShrink: 0,
              justifyContent: 'center',
              pb: 1,
              pt: 0.75,
              touchAction: 'none',
            }}
          >
            <Box
              sx={{
                backgroundColor: alpha(theme.palette.text.primary, 0.28),
                borderRadius: 999,
                height: 4,
                width: 38,
              }}
            />
          </Box>
            </Box>
            {/* Over a long list a swipe here is one on the list (a small one
                scrolls it, a big one closes); otherwise the document
                listeners above close on any swipe. A tap closes. */}
            <Box
              ref={setTabsBelowEl}
              aria-label="Close tabs"
              onClick={onClose}
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
        open={Boolean(folderPendingDelete)}
        onClose={() => setFolderPendingDelete(null)}
        fullWidth
        maxWidth="xs"
        sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      >
        <DialogTitle>
          {t('core:tabs_overlay.delete_folder_title', {
            name: folderDeleteText?.name ?? '',
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, opacity: 0.8 }}>
            {t('core:tabs_overlay.delete_folder_body', {
              count: folderDeleteText?.count ?? 0,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderPendingDelete(null)}>
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            color="error"
            onClick={() => {
              const pending = folderPendingDelete;
              setFolderPendingDelete(null);
              if (pending) void handleTrashFolder(pending.id);
            }}
          >
            {t('core:action.delete', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={renameOpen}
        onClose={closeRenameDialog}
        fullWidth
        maxWidth="xs"
        sx={{
          zIndex: MOBILE_TABS_DIALOG_Z,
          '& .MuiDialog-container': {
            alignItems: 'flex-start',
          },
        }}
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
          <Button onClick={closeRenameDialog}>Cancel</Button>
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
        onClose={closeAddressDialog}
        fullWidth
        maxWidth="sm"
        sx={{
          zIndex: MOBILE_TABS_DIALOG_Z,
          '& .MuiDialog-container': {
            alignItems: 'flex-start',
          },
        }}
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
          <Button onClick={closeAddressDialog}>Cancel</Button>
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
        info={snackInfo}
        open={snackOpen}
        setInfo={setSnackInfo}
        setOpen={setSnackOpen}
      />
    </>
  );
};
