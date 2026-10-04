import { useAtomValue } from 'jotai';
import { groupsOwnerNamesSelector } from '../../atoms/global';
import { useQdnAvatarSrc } from '../../hooks/useQdnAvatarSrc';
import { qdnGroupAvatarIdentifier } from '../../lib/qdnAvatars';

const cleanName = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Owner name for the open group's avatar: the one from the groups list
 * (known at once, so a cached avatar shows before the member fetch ends),
 * else the one from the member fetch, but only when that fetch was for this
 * group. Right after a switch the fetch result still belongs to the previous
 * group; its owner must never be paired with the new group id.
 */
export function pickGroupAvatarOwnerName(options: {
  selectedGroup: string | number | null | undefined;
  listedOwnerName: unknown;
  fetchedOwnerName: string | null | undefined;
  fetchedForGroupId: number | null | undefined;
}): string {
  const listed = cleanName(options.listedOwnerName);
  if (listed) return listed;
  const { fetchedForGroupId, selectedGroup } = options;
  if (fetchedForGroupId == null || selectedGroup == null) return '';
  if (fetchedForGroupId !== Number(selectedGroup)) return '';
  return cleanName(options.fetchedOwnerName);
}

/**
 * Avatar of the open group from the device cache. Returns only the src, so
 * a status-only change (a retry on a slow node) does not re-render the
 * (large) chat component.
 */
export function useSelectedGroupAvatar(
  selectedGroup: string | number | null | undefined,
  fetchedOwnerName: string | null | undefined,
  fetchedForGroupId: number | null | undefined
): { ownerName: string; src: string | undefined } {
  const hasGroup = selectedGroup != null && String(selectedGroup).trim() !== '';
  const listedOwnerName = useAtomValue(
    groupsOwnerNamesSelector(hasGroup ? selectedGroup : '')
  );
  const ownerName = pickGroupAvatarOwnerName({
    selectedGroup,
    listedOwnerName,
    fetchedOwnerName,
    fetchedForGroupId,
  });
  const src = useQdnAvatarSrc(ownerName, {
    identifier: hasGroup ? qdnGroupAvatarIdentifier(selectedGroup) : null,
    enabled: hasGroup,
  });
  return { ownerName, src };
}
