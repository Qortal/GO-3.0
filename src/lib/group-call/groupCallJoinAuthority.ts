/**
 * Join-time root authority guards for Qortal group calls.
 *
 * Seen on three phones and a desktop Hub (2026-11-26): on Reticulum a joiner
 * learns about the people already in the call 1-3 s after it joins. With a
 * 1 s "alone" wait it elected itself root, minted its own room key and then
 * kept that root when the incumbent showed up a moment later ("keeping the
 * same root" counted as authoritative). The incumbent kept its root too, so
 * the call had two roots with two keys, each side dropping the other's
 * GC_TOPOLOGY and GC_KEY, for minutes. A newcomer that never reached the root
 * (no key, no audio from it) also took over as standby after the 11.5 s
 * heartbeat timeout, although the root was alive for everyone else.
 *
 * Nothing here changes what goes on the wire: these only decide when this
 * device may make itself root.
 */

/** How long a joiner that sees nobody waits before electing itself root. */
export const GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS = 4_000;

/**
 * When the group's call badge said people were already in the call, a joiner
 * that still hears nobody waits this long before electing itself (instead of
 * the 11.5 s failover window). Seen on phones: a freshly started GO heard
 * nothing from the people already in the call for 38 s (RNS paths towards it
 * were still being found) while they had seen its join within a second.
 * Joining an occupied call alone has nobody to talk to anyway.
 */
export const OCCUPIED_HINT_SELF_ELECTION_WAIT_MS = 30_000;

/**
 * How long a root elected while alone stays provisional (yields to the
 * incumbent's topology) when the badge said the call was occupied: long enough
 * for slow paths to deliver the incumbent's topology heartbeat.
 */
export const OCCUPIED_HINT_PROVISIONAL_ROOT_MS = 90_000;

/** Wait before a self-only election: badge hint, other evidence, or none. */
export function resolveSelfOnlyElectionWaitMs(opts: {
  occupiedRoomHint: boolean;
  occupiedRoomEvidence: boolean;
  failoverTimeoutMs: number;
}): number {
  if (opts.occupiedRoomHint) {
    return Math.max(
      OCCUPIED_HINT_SELF_ELECTION_WAIT_MS,
      opts.failoverTimeoutMs
    );
  }
  return opts.occupiedRoomEvidence
    ? opts.failoverTimeoutMs
    : GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS;
}

/** How long a newly armed provisional local root stays provisional. */
export function resolveProvisionalLocalRootMs(opts: {
  selfOnly: boolean;
  occupiedRoomHint: boolean;
  defaultMs: number;
}): number {
  return opts.selfOnly && opts.occupiedRoomHint
    ? Math.max(OCCUPIED_HINT_PROVISIONAL_ROOT_MS, opts.defaultMs)
    : opts.defaultMs;
}

/**
 * A standby that joined recently and has never received the room key or any
 * audio from the root does not declare that root dead before this long after
 * its join: it has no evidence either way, the others may still hear the root.
 */
export const NEWCOMER_ROOT_CONTACT_GRACE_MS = 45_000;

/**
 * The group's call badge (mesh activity) says how many people are in the
 * call before we join. Anything that is not a sane positive count is 0.
 */
export function sanitizeOccupiedRoomParticipantHint(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(64, Math.floor(n));
}

/**
 * A Qortal group call root chosen while this device saw no one else: an
 * incumbent may simply not have been heard yet, so the choice stays
 * provisional (it yields to a verified topology from the incumbent root).
 */
export function isSelfOnlyGroupRootElection(opts: {
  roomId: string;
  previousRoot: string;
  remoteParticipantCount: number;
  hydratedRemoteCount: number;
}): boolean {
  return (
    opts.roomId.startsWith('gcall-qortal-') &&
    !opts.previousRoot.trim() &&
    opts.remoteParticipantCount <= 0 &&
    opts.hydratedRemoteCount <= 0
  );
}

/**
 * Keep a provisional local root provisional when an election keeps us root
 * (for example when the first peer appears): the original window still runs,
 * it is neither extended nor ended by re-electing ourselves.
 */
export function shouldKeepProvisionalLocalRoot(opts: {
  myAddress: string;
  previousRoot: string;
  electedRoot: string;
  provisionalActive: boolean;
}): boolean {
  const me = opts.myAddress.trim();
  return (
    Boolean(me) &&
    opts.provisionalActive &&
    opts.previousRoot.trim() === me &&
    opts.electedRoot.trim() === me
  );
}

/**
 * True while a newcomer standby must not promote itself over a root it has
 * never reached: no room key, no key or audio ever received from that root,
 * and the join is still recent.
 */
export function shouldSuppressNewcomerStandbyFailover(opts: {
  hasRoomKey: boolean;
  lastVerifiedKeyAt: number;
  lastDecodedMediaAt: number;
  lastSpeakerActivityAt: number;
  lastJoinSuccessAtMs: number;
  nowMs: number;
  graceMs?: number;
}): boolean {
  if (opts.hasRoomKey) return false;
  if (
    opts.lastVerifiedKeyAt > 0 ||
    opts.lastDecodedMediaAt > 0 ||
    opts.lastSpeakerActivityAt > 0
  ) {
    return false;
  }
  if (!(opts.lastJoinSuccessAtMs > 0)) return false;
  const graceMs = opts.graceMs ?? NEWCOMER_ROOT_CONTACT_GRACE_MS;
  return opts.nowMs - opts.lastJoinSuccessAtMs < graceMs;
}
