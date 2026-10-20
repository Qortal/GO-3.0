import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchReticulumAdminGroups,
  getReticulumAdminListFetchStats,
  getReticulumGroupMembershipsFromGroupLikeList,
  noteReticulumAdminListAccountChanged,
  noteReticulumAdminListFetchFailed,
  noteReticulumAdminListFetchOk,
  RETICULUM_ADMIN_LIST_TIMEOUT_MS,
  ReticulumAdminListTimeoutError,
  reticulumAdminGroupsAfterFailedFetch,
  resetReticulumAdminListFetchStatsForTests,
} from './reticulumAdminList';

const ME = 'QMyAccountAddressxxxxxxxxxxxxxxxxx';
const memberGroups = [{ groupId: 10 }, { groupId: 20, isOpen: false }];

/**
 * Group.tsx's admin-list flow, reduced to its state: the admin list (atom),
 * the account whose list last loaded (okAddress), and what is pushed to the
 * engine.
 */
const createAdminListFlow = (address: string) => {
  let adminGroups: Array<{ groupId: number }> = [];
  let okAddress = '';
  return {
    succeed(groups: Array<{ groupId: number }>) {
      noteReticulumAdminListFetchOk();
      adminGroups = groups;
      okAddress = address;
    },
    fail(error: unknown) {
      noteReticulumAdminListFetchFailed(error);
      adminGroups = reticulumAdminGroupsAfterFailedFetch(
        adminGroups,
        okAddress === address
      );
    },
    memberships() {
      return getReticulumGroupMembershipsFromGroupLikeList(
        memberGroups,
        {},
        address,
        new Set(adminGroups.map((group) => group.groupId)),
        okAddress === address
      );
    },
  };
};

describe('admin list authority', () => {
  beforeEach(() => resetReticulumAdminListFetchStatsForTests());

  it('is not authoritative before the first good admin list', () => {
    const flow = createAdminListFlow(ME);
    flow.fail(new TypeError('Failed to fetch'));
    expect(flow.memberships()).toEqual([
      {
        groupId: 10,
        isPrivate: false,
        isAdmin: false,
        adminStatusAuthoritative: false,
        localAddress: ME,
      },
      {
        groupId: 20,
        isPrivate: true,
        isAdmin: false,
        adminStatusAuthoritative: false,
        localAddress: ME,
      },
    ]);
    expect(getReticulumAdminListFetchStats().authoritative).toBe(false);
  });

  it('keeps the admin ids and stays authoritative when a later fetch fails', () => {
    const flow = createAdminListFlow(ME);
    flow.succeed([{ groupId: 20 }]);
    const afterSuccess = flow.memberships();
    expect(afterSuccess.map((m) => [m.groupId, m.isAdmin])).toEqual([
      [10, false],
      [20, true],
    ]);
    expect(afterSuccess.every((m) => m.adminStatusAuthoritative)).toBe(true);

    flow.fail(
      new ReticulumAdminListTimeoutError(RETICULUM_ADMIN_LIST_TIMEOUT_MS)
    );
    flow.fail(new Error('Unable to load group admins: 500'));
    // Nothing flips, so the engine re-initializes no group.
    expect(flow.memberships()).toEqual(afterSuccess);
  });

  it('starts over for a new account', () => {
    noteReticulumAdminListFetchOk();
    expect(getReticulumAdminListFetchStats().authoritative).toBe(true);
    noteReticulumAdminListAccountChanged();
    expect(getReticulumAdminListFetchStats().authoritative).toBe(false);
  });
});

describe('reticulumAdminGroupsAfterFailedFetch', () => {
  it('keeps the loaded list, else returns an empty one', () => {
    const loaded = [{ groupId: 1 }];
    expect(reticulumAdminGroupsAfterFailedFetch(loaded, true)).toBe(loaded);
    expect(reticulumAdminGroupsAfterFailedFetch(loaded, false)).toEqual([]);
    // Another account's list never survives; an empty list keeps identity so
    // a retry loop does not re-push memberships.
    const empty: Array<{ groupId: number }> = [];
    expect(reticulumAdminGroupsAfterFailedFetch(empty, false)).toBe(empty);
  });
});

describe('fetchReticulumAdminGroups', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const jsonResponse = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  it('reads the list from either response shape', async () => {
    await expect(
      fetchReticulumAdminGroups('u', {
        fetchImpl: async () => jsonResponse([{ groupId: 1 }]),
      })
    ).resolves.toEqual([{ groupId: 1 }]);
    await expect(
      fetchReticulumAdminGroups('u', {
        fetchImpl: async () => jsonResponse({ groups: [{ groupId: 2 }] }),
      })
    ).resolves.toEqual([{ groupId: 2 }]);
  });

  it('throws on an HTTP error', async () => {
    await expect(
      fetchReticulumAdminGroups('u', {
        fetchImpl: async () => jsonResponse({}, 500),
      })
    ).rejects.toThrow('Unable to load group admins: 500');
  });

  it('aborts a stalled request after the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const pending = fetchReticulumAdminGroups('u', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      ReticulumAdminListTimeoutError
    );
    await vi.advanceTimersByTimeAsync(RETICULUM_ADMIN_LIST_TIMEOUT_MS);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });
});

describe('admin list fetch stats', () => {
  beforeEach(() => resetReticulumAdminListFetchStatsForTests());

  it('counts results and keeps a short last error without addresses', () => {
    noteReticulumAdminListFetchOk(1_000);
    noteReticulumAdminListFetchFailed(
      new ReticulumAdminListTimeoutError(15_000),
      2_000
    );
    noteReticulumAdminListFetchFailed(
      new TypeError(`Failed to fetch /groups/member/${ME}?adminOnly=true`),
      3_000
    );
    expect(getReticulumAdminListFetchStats()).toEqual({
      ok: 1,
      failed: 2,
      timedOut: 1,
      lastError:
        'TypeError: Failed to fetch /groups/member/<address>?adminOnly=true',
      lastErrorAt: 3_000,
      lastOkAt: 1_000,
      authoritative: true,
    });
  });

  it('names a timeout plainly', () => {
    noteReticulumAdminListFetchFailed(
      new ReticulumAdminListTimeoutError(15_000)
    );
    expect(getReticulumAdminListFetchStats().lastError).toBe(
      'timeout after 15 s'
    );
  });
});
