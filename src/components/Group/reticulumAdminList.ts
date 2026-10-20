/**
 * The admin-group list the chat page pushes to the chat engine together with
 * the group memberships (GET /groups/member/{address}?adminOnly=true).
 *
 * The engine answers "is this account admin here?" from that list, without
 * asking Core, whenever the list says it is authoritative. A failed fetch used
 * to become an empty, authoritative list, so every group read "not admin"
 * until the next good fetch: the account's own channel edits were skipped and
 * its own metadata snapshots rejected. Now a failure keeps the last good list,
 * and before the first good one the list is pushed as non-authoritative, so
 * the engine asks Core per check and defers when Core has no answer.
 */

/** How long one admin-list fetch may take before it counts as failed. */
export const RETICULUM_ADMIN_LIST_TIMEOUT_MS = 15_000;

export type ReticulumGroupMembership = {
  groupId: number;
  isPrivate: boolean;
  isAdmin: boolean;
  adminStatusAuthoritative: boolean;
  joinedAt?: number;
  localAddress?: string;
};

export const getGroupIdFromGroupLike = (group: unknown): number | null => {
  if (!group || typeof group !== 'object') return null;
  const candidate =
    (group as { groupId?: unknown }).groupId ??
    (group as { groupid?: unknown }).groupid ??
    (group as { group_id?: unknown }).group_id ??
    (group as { id?: unknown }).id;
  const groupId = Number(candidate);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
};

/**
 * One membership per group for setLocalGroupMemberships. adminListAuthoritative
 * is true only once the admin list loaded for this account: before that, the
 * engine must not read a missing admin entry as "not admin".
 */
export const getReticulumGroupMembershipsFromGroupLikeList = (
  groups: unknown,
  groupsProperties: Record<string, unknown>,
  localAddress: string | undefined,
  adminGroupIds: ReadonlySet<number>,
  adminListAuthoritative: boolean
): ReticulumGroupMembership[] => {
  if (!Array.isArray(groups)) return [];
  const byGroupId = new Map<
    number,
    { isPrivate: boolean; joinedAt?: number }
  >();
  const normalizedLocalAddress =
    typeof localAddress === 'string' ? localAddress.trim() : '';
  for (const group of groups) {
    const groupId = getGroupIdFromGroupLike(group);
    if (groupId == null) continue;
    const groupObject =
      group && typeof group === 'object'
        ? (group as { isOpen?: unknown; isPrivate?: unknown })
        : {};
    const groupProperty = groupsProperties[String(groupId)] as
      | { isOpen?: unknown; isPrivate?: unknown }
      | undefined;
    const isPrivate =
      groupObject.isPrivate === true ||
      groupProperty?.isPrivate === true ||
      groupObject.isOpen === false ||
      groupProperty?.isOpen === false;
    const joinedAt = Number(
      (group as { reticulumJoinedAt?: unknown; joinedAt?: unknown })
        ?.reticulumJoinedAt ?? (group as { joinedAt?: unknown })?.joinedAt
    );
    const previous = byGroupId.get(groupId);
    byGroupId.set(groupId, {
      isPrivate: previous?.isPrivate === true || isPrivate,
      joinedAt:
        previous?.joinedAt ||
        (Number.isFinite(joinedAt) && joinedAt > 0 ? joinedAt : undefined),
    });
  }
  return [...byGroupId.entries()].map(([groupId, { isPrivate, joinedAt }]) => ({
    groupId,
    isPrivate,
    isAdmin: adminGroupIds.has(groupId),
    adminStatusAuthoritative: adminListAuthoritative === true,
    ...(joinedAt ? { joinedAt } : {}),
    ...(normalizedLocalAddress ? { localAddress: normalizedLocalAddress } : {}),
  }));
};

/**
 * The admin list to keep after a failed fetch. Once a list loaded for this
 * account it stays (a node that answers poorly for a while must not make the
 * account "not admin" everywhere); before that the list is empty. An empty
 * list is returned as it is, so a retry loop does not re-push memberships.
 */
export const reticulumAdminGroupsAfterFailedFetch = <T>(
  current: T[],
  listLoadedForAccount: boolean
): T[] => {
  if (listLoadedForAccount) return current;
  return Array.isArray(current) && current.length === 0 ? current : [];
};

export class ReticulumAdminListTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Admin list request timed out after ${timeoutMs} ms`);
    this.name = 'ReticulumAdminListTimeoutError';
  }
}

/** Fetches the account's admin groups; throws on HTTP errors and on timeout. */
export const fetchReticulumAdminGroups = async (
  url: string,
  {
    timeoutMs = RETICULUM_ADMIN_LIST_TIMEOUT_MS,
    fetchImpl = fetch,
  }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<unknown[]> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Unable to load group admins: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data?.groups ?? []);
  } catch (error) {
    if (timedOut) throw new ReticulumAdminListTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export type ReticulumAdminListFetchStats = {
  ok: number;
  failed: number;
  timedOut: number;
  /** Short reason of the last failure, addresses removed; '' when none. */
  lastError: string;
  /** Epoch ms of the last failure / success; 0 when none yet. */
  lastErrorAt: number;
  lastOkAt: number;
  /** A list loaded for the current account, so the engine trusts it. */
  authoritative: boolean;
};

const emptyStats = (): ReticulumAdminListFetchStats => ({
  ok: 0,
  failed: 0,
  timedOut: 0,
  lastError: '',
  lastErrorAt: 0,
  lastOkAt: 0,
  authoritative: false,
});

let adminListFetchStats = emptyStats();

const QORTAL_ADDRESS_PATTERN = /Q[1-9A-HJ-NP-Za-km-z]{20,}/g;

const describeAdminListError = (error: unknown): string => {
  if (error instanceof ReticulumAdminListTimeoutError) {
    return `timeout after ${Math.round(error.timeoutMs / 1000)} s`;
  }
  const raw =
    error instanceof Error
      ? `${error.name && error.name !== 'Error' ? `${error.name}: ` : ''}${
          error.message
        }`
      : String(error ?? '');
  const text = raw
    .replace(QORTAL_ADDRESS_PATTERN, '<address>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 120) || 'unknown error';
};

export const noteReticulumAdminListFetchOk = (now = Date.now()): void => {
  adminListFetchStats = {
    ...adminListFetchStats,
    ok: adminListFetchStats.ok + 1,
    lastOkAt: now,
    authoritative: true,
  };
};

export const noteReticulumAdminListFetchFailed = (
  error: unknown,
  now = Date.now()
): void => {
  adminListFetchStats = {
    ...adminListFetchStats,
    failed: adminListFetchStats.failed + 1,
    timedOut:
      adminListFetchStats.timedOut +
      (error instanceof ReticulumAdminListTimeoutError ? 1 : 0),
    lastError: describeAdminListError(error),
    lastErrorAt: now,
  };
};

/** A new account starts non-authoritative until its own list loads. */
export const noteReticulumAdminListAccountChanged = (): void => {
  adminListFetchStats = { ...adminListFetchStats, authoritative: false };
};

/** For Copy diagnostics: counts since the page started. */
export const getReticulumAdminListFetchStats =
  (): ReticulumAdminListFetchStats => ({ ...adminListFetchStats });

export const resetReticulumAdminListFetchStatsForTests = (): void => {
  adminListFetchStats = emptyStats();
};
