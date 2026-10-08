import type { OpenTab } from './useOpenTabs';
import { SmallFolderMosaic } from './tabsHome/FolderTile';

type FolderCompositeAvatarProps = {
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
  size?: number;
};

/**
 * A folder's icon in the Tabs overlay: the same three by three mosaic as a
 * small folder on the Q-Apps library's Pinned home, so both read as one set
 * of folders.
 */
export function FolderCompositeAvatar({
  tabs,
  getTitle,
  size = 44,
}: FolderCompositeAvatarProps) {
  return <SmallFolderMosaic getTitle={getTitle} size={size} tabs={tabs} />;
}
