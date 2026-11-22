import { useTranslation } from 'react-i18next';
import {
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
} from '@mui/material';
import BookmarkRemoveOutlinedIcon from '@mui/icons-material/BookmarkRemoveOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FolderOffOutlinedIcon from '@mui/icons-material/FolderOffOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import type {
  LauncherAppItem,
  LauncherBookmarkItem,
} from '../../Apps/AppsLauncher/launcherItems';
import { MOBILE_TABS_DIALOG_Z } from '../mobileLayout';

/** An app or a bookmark on the Pinned tab, in the row or in a folder. */
export type PinnedLeaf = LauncherAppItem | LauncherBookmarkItem;

export type PinnedTileMenuTarget = {
  item: PinnedLeaf;
  /** The folder it is in, or null in the row. */
  folderId: string | null;
  anchor: HTMLElement;
};

type PinnedTileMenuProps = {
  target: PinnedTileMenuTarget | null;
  folders: { id: string; name: string }[];
  onClose: () => void;
  onOpen: (item: PinnedLeaf) => void;
  onRename: (item: LauncherBookmarkItem) => void;
  onMoveToFolder: (item: PinnedLeaf, folderId: string) => void;
  onNewFolder: (item: PinnedLeaf) => void;
  onRemoveFromFolder: (item: PinnedLeaf) => void;
  /** Unpins an app, or removes a bookmark. */
  onRemove: (item: PinnedLeaf) => void;
};

const iconSx = { fontSize: 20 } as const;

/**
 * What a long press on an app or a bookmark offers, as the desktop Hub's
 * launcher does on a right-click: open it, rename a bookmark, move it
 * between folders, take it out of its folder, unpin it or remove it.
 */
export function PinnedTileMenu({
  target,
  folders,
  onClose,
  onOpen,
  onRename,
  onMoveToFolder,
  onNewFolder,
  onRemoveFromFolder,
  onRemove,
}: PinnedTileMenuProps) {
  const { t } = useTranslation(['core']);
  const item = target?.item ?? null;
  const pin = item?.pin ?? null;
  // A private app has no bookmark, so no folder takes it.
  const canBeInFolder = !!item && !pin?.app.isPrivate;
  // The account's own app and website are always shown.
  const canBeRemoved = !!item && !pin?.isMine;
  const isBookmark = item?.type === 'bookmark';
  const otherFolders = folders.filter(
    (folder) => folder.id !== target?.folderId
  );

  const run = (action: (leaf: PinnedLeaf) => void) => () => {
    onClose();
    if (item) action(item);
  };

  return (
    <Menu
      anchorEl={target?.anchor ?? null}
      anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
      onClose={onClose}
      open={!!target}
      slotProps={{
        paper: {
          sx: { borderRadius: '16px', maxHeight: '70vh', minWidth: 220 },
        },
      }}
      sx={{ zIndex: MOBILE_TABS_DIALOG_Z }}
      transformOrigin={{ horizontal: 'center', vertical: 'top' }}
    >
      <MenuItem onClick={run(onOpen)}>
        <ListItemIcon>
          <OpenInNewRoundedIcon sx={iconSx} />
        </ListItemIcon>
        <ListItemText>
          {t('core:action.open', { postProcess: 'capitalizeFirstChar' })}
        </ListItemText>
      </MenuItem>
      {isBookmark ? (
        <MenuItem
          onClick={run((leaf) => {
            if (leaf.type === 'bookmark') onRename(leaf);
          })}
        >
          <ListItemIcon>
            <DriveFileRenameOutlineRoundedIcon sx={iconSx} />
          </ListItemIcon>
          <ListItemText>
            {t('core:bookmarks.rename', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ListItemText>
        </MenuItem>
      ) : null}
      {canBeInFolder ? <Divider /> : null}
      {canBeInFolder && otherFolders.length > 0 ? (
        <ListSubheader
          sx={{ backgroundColor: 'transparent', lineHeight: '32px' }}
        >
          {t('core:launcher.folder_move_to', {
            postProcess: 'capitalizeFirstChar',
          })}
        </ListSubheader>
      ) : null}
      {canBeInFolder
        ? otherFolders.map((folder) => (
            <MenuItem
              key={folder.id}
              onClick={run((leaf) => onMoveToFolder(leaf, folder.id))}
            >
              <ListItemIcon>
                <FolderOutlinedIcon sx={iconSx} />
              </ListItemIcon>
              <ListItemText
                primaryTypographyProps={{
                  noWrap: true,
                  sx: { maxWidth: 200 },
                }}
              >
                {folder.name}
              </ListItemText>
            </MenuItem>
          ))
        : null}
      {canBeInFolder ? (
        <MenuItem onClick={run(onNewFolder)}>
          <ListItemIcon>
            <CreateNewFolderOutlinedIcon sx={iconSx} />
          </ListItemIcon>
          <ListItemText>
            {t('core:bookmarks.new_folder', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ListItemText>
        </MenuItem>
      ) : null}
      {target?.folderId ? (
        <MenuItem onClick={run(onRemoveFromFolder)}>
          <ListItemIcon>
            <FolderOffOutlinedIcon sx={iconSx} />
          </ListItemIcon>
          <ListItemText>
            {t('core:tabs_home.remove_from_folder', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ListItemText>
        </MenuItem>
      ) : null}
      {canBeRemoved ? <Divider /> : null}
      {canBeRemoved ? (
        <MenuItem onClick={run(onRemove)} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}>
            {pin ? (
              <PushPinOutlinedIcon sx={iconSx} />
            ) : (
              <BookmarkRemoveOutlinedIcon sx={iconSx} />
            )}
          </ListItemIcon>
          <ListItemText>
            {pin
              ? t('core:action.unpin_app', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:launcher.bookmark_remove', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </ListItemText>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
