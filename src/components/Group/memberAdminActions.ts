// Which group-management actions a viewer can take on one member row, and
// when a broadcast action has landed in the member list. Mirrors Qortal Core's
// validation (GroupKickTransaction & co. since block 2,012,800) so the Members
// view never offers a transaction Core would reject:
//   - ADD_GROUP_ADMIN / REMOVE_GROUP_ADMIN, GROUP_KICK, GROUP_BAN and
//     CANCEL_GROUP_BAN: only the group owner. Other admins get
//     INVALID_GROUP_OWNER.
//   - A group owned by Core's null account has no owner: each of these needs
//     approval from the group's admins (the transaction's txGroupId is the
//     group, then GROUP_APPROVALs). GO can't approve, so it offers none.
//   - Nobody acts on the owner or on themselves.

export type MemberAdminAction = 'make_admin' | 'remove_admin' | 'kick' | 'ban';

/** Core's Group.NULL_OWNER_ADDRESS: a group it owns has no owner. */
export const NULL_OWNER_ADDRESS = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

export const isOwnerlessGroup = (ownerAddress?: string | null): boolean =>
  ownerAddress === NULL_OWNER_ADDRESS;

/**
 * Why an admin gets no kick, ban or admin buttons: `owner_only` in a group
 * with an owner, `needs_approval` in an ownerless group. Null for the owner,
 * for regular members (who expect none) and while the owner is unknown.
 */
export type MemberActionsNotice = 'owner_only' | 'needs_approval';

export const getMemberActionsNotice = ({
  ownerAddress,
  isOwner = false,
  isAdmin = false,
}: {
  ownerAddress?: string | null;
  isOwner?: boolean;
  isAdmin?: boolean;
}): MemberActionsNotice | null => {
  if (!ownerAddress || !isAdmin) return null;
  if (isOwnerlessGroup(ownerAddress)) return 'needs_approval';
  return isOwner ? null : 'owner_only';
};

/** CANCEL_GROUP_BAN follows the GROUP_BAN rule: the owner only. */
export const canLiftGroupBans = ({
  ownerAddress,
  isOwner = false,
}: {
  ownerAddress?: string | null;
  isOwner?: boolean;
}): boolean => Boolean(isOwner) && !isOwnerlessGroup(ownerAddress);

interface MemberActionTarget {
  member?: string;
  isAdmin?: boolean;
}

interface MemberActionContext {
  viewerAddress?: string | null;
  ownerAddress?: string | null;
  isOwner?: boolean;
  /** False for rows that only exist because of Qortal Land presence. */
  inGroup?: boolean;
}

export const getAvailableMemberActions = (
  target: MemberActionTarget | null | undefined,
  {
    viewerAddress,
    ownerAddress,
    isOwner = false,
    inGroup = true,
  }: MemberActionContext
): MemberAdminAction[] => {
  const address = target?.member;
  if (!address || !inGroup) return [];
  if (viewerAddress && address === viewerAddress) return [];
  if (ownerAddress && address === ownerAddress) return [];
  if (!isOwner || isOwnerlessGroup(ownerAddress)) return [];

  return target?.isAdmin
    ? ['remove_admin', 'kick', 'ban']
    : ['make_admin', 'kick', 'ban'];
};

export interface PendingMemberAction {
  action: MemberAdminAction;
  startedAt: number;
}

/** Long enough for a few blocks; after that the row stops claiming "pending". */
export const PENDING_MEMBER_ACTION_TTL_MS = 6 * 60_000;

/**
 * True once the refreshed member list shows the effect of `action`, i.e. the
 * transaction confirmed. `member` is the row for the target address, or
 * undefined when the address is no longer a member.
 */
export const isPendingMemberActionSettled = (
  action: MemberAdminAction,
  member: MemberActionTarget | null | undefined
): boolean => {
  switch (action) {
    case 'make_admin':
      return Boolean(member?.isAdmin);
    case 'remove_admin':
      return Boolean(member) && !member?.isAdmin;
    case 'kick':
    case 'ban':
      return !member;
    default:
      return true;
  }
};

/**
 * Drops pending entries that have settled against `members` or outlived the
 * TTL. Returns the same object when nothing changed so React can bail out.
 */
export const prunePendingMemberActions = (
  pending: Record<string, PendingMemberAction>,
  members: MemberActionTarget[] | null | undefined,
  now: number
): Record<string, PendingMemberAction> => {
  const addresses = Object.keys(pending);
  if (addresses.length === 0) return pending;
  const byAddress = new Map(
    (members || [])
      .filter((member) => member?.member)
      .map((member) => [member.member, member])
  );
  let changed = false;
  const next: Record<string, PendingMemberAction> = {};
  for (const address of addresses) {
    const entry = pending[address];
    if (
      now - entry.startedAt > PENDING_MEMBER_ACTION_TTL_MS ||
      isPendingMemberActionSettled(entry.action, byAddress.get(address))
    ) {
      changed = true;
      continue;
    }
    next[address] = entry;
  }
  return changed ? next : pending;
};
