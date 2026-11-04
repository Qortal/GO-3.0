import { describe, expect, it } from 'vitest';
import {
  NULL_OWNER_ADDRESS,
  PENDING_MEMBER_ACTION_TTL_MS,
  canLiftGroupBans,
  getAvailableMemberActions,
  getMemberActionsNotice,
  isOwnerlessGroup,
  isPendingMemberActionSettled,
  prunePendingMemberActions,
} from './memberAdminActions';

const OWNER = 'Qowner';
const ADMIN = 'Qadmin';
const MEMBER = 'Qmember';

describe('getAvailableMemberActions', () => {
  const ownerView = {
    viewerAddress: OWNER,
    ownerAddress: OWNER,
    isOwner: true,
  };
  const adminView = {
    viewerAddress: ADMIN,
    ownerAddress: OWNER,
    isAdmin: true,
  };

  it('lets the owner promote a regular member, kick and ban', () => {
    expect(getAvailableMemberActions({ member: MEMBER }, ownerView)).toEqual([
      'make_admin',
      'kick',
      'ban',
    ]);
  });

  it('lets the owner demote, kick and ban an admin', () => {
    expect(
      getAvailableMemberActions({ member: ADMIN, isAdmin: true }, ownerView)
    ).toEqual(['remove_admin', 'kick', 'ban']);
  });

  it('never offers actions on the owner row or the viewer row', () => {
    expect(
      getAvailableMemberActions({ member: OWNER, isAdmin: true }, ownerView)
    ).toEqual([]);
    expect(
      getAvailableMemberActions({ member: ADMIN, isAdmin: true }, adminView)
    ).toEqual([]);
    expect(
      getAvailableMemberActions({ member: OWNER, isAdmin: true }, adminView)
    ).toEqual([]);
  });

  it('gives a non-owner admin nothing: Core takes kicks and bans from the owner only', () => {
    expect(getAvailableMemberActions({ member: MEMBER }, adminView)).toEqual(
      []
    );
    expect(
      getAvailableMemberActions({ member: 'Qother', isAdmin: true }, adminView)
    ).toEqual([]);
  });

  it('offers nothing in an ownerless group, where every change needs approval', () => {
    const ownerlessAdminView = {
      viewerAddress: ADMIN,
      ownerAddress: NULL_OWNER_ADDRESS,
      isOwner: false,
    };
    expect(
      getAvailableMemberActions({ member: MEMBER }, ownerlessAdminView)
    ).toEqual([]);
    // Even a stray owner flag can't make the null account's group ownable.
    expect(
      getAvailableMemberActions(
        { member: MEMBER },
        { ...ownerlessAdminView, isOwner: true }
      )
    ).toEqual([]);
  });

  it('gives regular members nothing', () => {
    expect(
      getAvailableMemberActions(
        { member: 'Qother' },
        { viewerAddress: MEMBER, ownerAddress: OWNER }
      )
    ).toEqual([]);
  });

  it('skips rows that are not group members or have no address', () => {
    expect(
      getAvailableMemberActions(
        { member: MEMBER },
        { ...ownerView, inGroup: false }
      )
    ).toEqual([]);
    expect(getAvailableMemberActions({}, ownerView)).toEqual([]);
    expect(getAvailableMemberActions(null, ownerView)).toEqual([]);
  });
});

describe('isPendingMemberActionSettled', () => {
  it('settles admin changes on the isAdmin flag', () => {
    expect(isPendingMemberActionSettled('make_admin', { member: MEMBER })).toBe(
      false
    );
    expect(
      isPendingMemberActionSettled('make_admin', {
        member: MEMBER,
        isAdmin: true,
      })
    ).toBe(true);
    expect(
      isPendingMemberActionSettled('remove_admin', {
        member: ADMIN,
        isAdmin: true,
      })
    ).toBe(false);
    expect(
      isPendingMemberActionSettled('remove_admin', { member: ADMIN })
    ).toBe(true);
    // A demoted admin who also left the group is not proof of the demotion.
    expect(isPendingMemberActionSettled('remove_admin', undefined)).toBe(false);
  });

  it('settles kick and ban once the member is gone', () => {
    expect(isPendingMemberActionSettled('kick', { member: MEMBER })).toBe(
      false
    );
    expect(isPendingMemberActionSettled('kick', undefined)).toBe(true);
    expect(isPendingMemberActionSettled('ban', { member: MEMBER })).toBe(false);
    expect(isPendingMemberActionSettled('ban', null)).toBe(true);
  });
});

describe('prunePendingMemberActions', () => {
  const now = 1_000_000;

  it('returns the same object when nothing settled', () => {
    const pending = {
      [MEMBER]: { action: 'make_admin' as const, startedAt: now },
    };
    expect(
      prunePendingMemberActions(pending, [{ member: MEMBER }], now + 1000)
    ).toBe(pending);
  });

  it('drops settled and expired entries', () => {
    const pending = {
      [MEMBER]: { action: 'make_admin' as const, startedAt: now },
      [ADMIN]: { action: 'remove_admin' as const, startedAt: now },
      Qgone: { action: 'kick' as const, startedAt: now },
    };
    const members = [
      { member: MEMBER, isAdmin: true },
      { member: ADMIN, isAdmin: true },
    ];
    expect(prunePendingMemberActions(pending, members, now + 1000)).toEqual({
      [ADMIN]: pending[ADMIN],
    });
    expect(
      prunePendingMemberActions(
        pending,
        members,
        now + PENDING_MEMBER_ACTION_TTL_MS + 1
      )
    ).toEqual({});
  });
});

describe('isOwnerlessGroup', () => {
  it('is true only for the null owner', () => {
    expect(isOwnerlessGroup(NULL_OWNER_ADDRESS)).toBe(true);
    expect(isOwnerlessGroup(OWNER)).toBe(false);
    expect(isOwnerlessGroup(undefined)).toBe(false);
  });
});

describe('getMemberActionsNotice', () => {
  it('tells a non-owner admin that only the owner can act', () => {
    expect(getMemberActionsNotice({ ownerAddress: OWNER, isAdmin: true })).toBe(
      'owner_only'
    );
  });

  it('tells admins of an ownerless group that approval is needed', () => {
    expect(
      getMemberActionsNotice({
        ownerAddress: NULL_OWNER_ADDRESS,
        isAdmin: true,
      })
    ).toBe('needs_approval');
  });

  it('says nothing to the owner, to members, or before the owner is known', () => {
    expect(
      getMemberActionsNotice({
        ownerAddress: OWNER,
        isOwner: true,
        isAdmin: true,
      })
    ).toBeNull();
    expect(getMemberActionsNotice({ ownerAddress: OWNER })).toBeNull();
    expect(
      getMemberActionsNotice({
        ownerAddress: NULL_OWNER_ADDRESS,
        isAdmin: false,
      })
    ).toBeNull();
    expect(getMemberActionsNotice({ isAdmin: true })).toBeNull();
  });
});

describe('canLiftGroupBans', () => {
  it('lets only the owner of a group with an owner lift bans', () => {
    expect(canLiftGroupBans({ ownerAddress: OWNER, isOwner: true })).toBe(true);
    expect(canLiftGroupBans({ ownerAddress: OWNER, isOwner: false })).toBe(
      false
    );
    expect(
      canLiftGroupBans({ ownerAddress: NULL_OWNER_ADDRESS, isOwner: true })
    ).toBe(false);
  });
});
