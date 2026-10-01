// Which group-management actions a viewer can take on one member row, and
// when a broadcast action has landed in the member list. Mirrors Qortal Core's
// validation so the Members view never offers a transaction Core would reject:
//   - ADD_GROUP_ADMIN / REMOVE_GROUP_ADMIN: only the group owner.
//   - GROUP_KICK / GROUP_BAN: any admin, but only the owner may target an admin.
//   - Nobody acts on the owner or on themselves.

export type MemberAdminAction = 'make_admin' | 'remove_admin' | 'kick' | 'ban';

export interface MemberActionTarget {
  member?: string;
  isAdmin?: boolean;
}

export interface MemberActionContext {
  viewerAddress?: string | null;
  ownerAddress?: string | null;
  isOwner?: boolean;
  isAdmin?: boolean;
  /** False for rows that only exist because of Qortal Land presence. */
  inGroup?: boolean;
}

export const getAvailableMemberActions = (
  target: MemberActionTarget | null | undefined,
  {
    viewerAddress,
    ownerAddress,
    isOwner = false,
    isAdmin = false,
    inGroup = true,
  }: MemberActionContext
): MemberAdminAction[] => {
  const address = target?.member;
  if (!address || !inGroup) return [];
  if (viewerAddress && address === viewerAddress) return [];
  if (ownerAddress && address === ownerAddress) return [];

  const targetIsAdmin = Boolean(target?.isAdmin);
  if (isOwner) {
    return targetIsAdmin
      ? ['remove_admin', 'kick', 'ban']
      : ['make_admin', 'kick', 'ban'];
  }
  if (isAdmin && !targetIsAdmin) return ['kick', 'ban'];
  return [];
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
