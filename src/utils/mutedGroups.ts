// The "Mute push notifications" list (user setting `mutedGroups`). Group ids
// arrive as numbers from Core and as strings from some stored records (thread
// activity), so membership is compared as text.

export const isGroupMuted = (mutedGroups: unknown, groupId: unknown): boolean =>
  Array.isArray(mutedGroups) &&
  groupId !== null &&
  groupId !== undefined &&
  groupId !== '' &&
  mutedGroups.some((mutedGroupId) => String(mutedGroupId) === String(groupId));

/** The list with `groupId` added, or removed when it was already muted. */
export const toggleGroupMute = (
  mutedGroups: unknown,
  groupId: string | number
): Array<string | number> => {
  const current = Array.isArray(mutedGroups) ? mutedGroups : [];
  return isGroupMuted(current, groupId)
    ? current.filter((mutedGroupId) => String(mutedGroupId) !== String(groupId))
    : [...current, groupId];
};
