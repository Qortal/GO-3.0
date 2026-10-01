import { describe, expect, it } from 'vitest';
import {
  PENDING_MEMBER_ACTION_TTL_MS,
  getAvailableMemberActions,
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

  it('lets a non-owner admin kick and ban regular members only', () => {
    expect(getAvailableMemberActions({ member: MEMBER }, adminView)).toEqual([
      'kick',
      'ban',
    ]);
    expect(
      getAvailableMemberActions({ member: 'Qother', isAdmin: true }, adminView)
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
