import Database, { type Database as DB, type Statement } from 'better-sqlite3';
import * as nodeCrypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ReticulumChatEvent,
  ReticulumChatMentionTarget,
  ReticulumDmEvent,
  ReticulumDmSummary,
  ReticulumDirectCallHistoryRecord,
} from './reticulum-chat';
import {
  expandReticulumCalendarMutation,
  findNextReticulumCalendarOccurrence,
  reticulumCalendarStateBounds,
  type ReticulumCalendarMutation,
  type ReticulumCalendarOccurrence,
  type ReticulumCalendarReminder,
} from './reticulum-calendar';

export const RETICULUM_CHAT_CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const RETICULUM_CHAT_RELAY_CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const RETICULUM_CHAT_RELAY_CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const RETICULUM_CHAT_RELAY_EVENT_MAX_BYTES = 32 * 1024;
export const RETICULUM_CHAT_DEFAULT_CHANNEL_ID = 'general';
export const RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID = 'qortal-land';
export const RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS =
  30 * 24 * 60 * 60 * 1000;
export const RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS = 'members';
export const RETICULUM_CHAT_CHANNEL_WRITE_MODE_ADMINS = 'admins';
export const RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS = 'members';
export const RETICULUM_CHAT_CHANNEL_READ_MODE_ADMINS = 'admins';
export const RETICULUM_CHAT_AUTHOR_SEQUENCE_LEASE_TTL_MS = 120_000;

export function isReticulumChatBuiltInChannelId(channelId: unknown): boolean {
  if (typeof channelId !== 'string') return false;
  const normalizedChannelId = channelId.trim().toLowerCase();
  return (
    normalizedChannelId === RETICULUM_CHAT_DEFAULT_CHANNEL_ID ||
    normalizedChannelId === RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID
  );
}

export class ReticulumChatSequenceLeaseBusyError extends Error {
  constructor() {
    super('A group author sequence is already reserved');
    this.name = 'ReticulumChatSequenceLeaseBusyError';
  }
}

export function normalizeReticulumChatAuthorStreamId(value: unknown): string {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : '';
}

export function normalizeReticulumChatDisplayName(
  value: unknown,
  fallback = ''
): string {
  const normalized = (typeof value === 'string' ? value : '')
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim();
  const safeName = Array.from(normalized).slice(0, 80).join('');
  return safeName || fallback;
}

function normalizeExcludedAuthors(addresses: readonly string[]): string[] {
  return [
    ...new Set(
      addresses.map((address) => String(address || '').trim()).filter(Boolean)
    ),
  ].slice(0, 100);
}

type ReticulumChatMentionRecord = {
  groupId: number;
  mentionedAddress: string;
  channelId: string;
  authorAddress: string;
  timestamp: number;
  readAt: number;
};

/** Same mention records, in any order (one per mentioned address). */
function sameMentionRecords(
  left: readonly ReticulumChatMentionRecord[],
  right: readonly ReticulumChatMentionRecord[]
): boolean {
  if (left.length !== right.length) return false;
  const byAddress = new Map(
    right.map((record) => [record.mentionedAddress, record])
  );
  if (byAddress.size !== right.length) return false;
  if (
    new Set(left.map((record) => record.mentionedAddress)).size !== left.length
  ) {
    return false;
  }
  return left.every((record) => {
    const other = byAddress.get(record.mentionedAddress);
    return (
      !!other &&
      record.groupId === other.groupId &&
      record.channelId === other.channelId &&
      record.authorAddress === other.authorAddress &&
      record.timestamp === other.timestamp &&
      record.readAt === other.readAt
    );
  });
}

const RETICULUM_CHAT_METADATA_EVENT_TYPES = new Set([
  'channel_create',
  'channel_update',
  'channel_archive',
  'channel_restore',
  'channel_reorder',
  'category_create',
  'category_update',
  'category_delete',
]);

const RETICULUM_CHAT_METADATA_EVENT_TYPES_SQL =
  "'channel_create', 'channel_update', 'channel_archive', 'channel_restore', " +
  "'channel_reorder', 'category_create', 'category_update', 'category_delete'";

function eventPassesAuthorExclusion(
  event: ReticulumChatEvent,
  excludedAuthors: ReadonlySet<string>
): boolean {
  return (
    RETICULUM_CHAT_METADATA_EVENT_TYPES.has(event.eventType) ||
    !excludedAuthors.has(event.authorAddress)
  );
}

const RETICULUM_CHAT_EXPIRY_PRUNE_INTERVAL_MS = 60 * 1000;
const RETICULUM_CHAT_CHANNEL_SUMMARY_CACHE_MAX_ENTRIES = 4096;
const RETICULUM_DM_EXPIRY_DAY_MS = 24 * 60 * 60 * 1000;
export const RETICULUM_DM_DEFAULT_EXPIRY_MS = 30 * RETICULUM_DM_EXPIRY_DAY_MS;
const RETICULUM_DM_ALLOWED_EXPIRY_MS = new Set([
  RETICULUM_DM_EXPIRY_DAY_MS,
  2 * RETICULUM_DM_EXPIRY_DAY_MS,
  3 * RETICULUM_DM_EXPIRY_DAY_MS,
  7 * RETICULUM_DM_EXPIRY_DAY_MS,
  RETICULUM_DM_DEFAULT_EXPIRY_MS,
]);
const RETICULUM_CHAT_MAX_EFFECTIVE_MENTION_HASHES = 32;
const RETICULUM_CHAT_VISIBLE_EVENT_SQL =
  "(expires_at IS NULL OR expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)";

export type ReticulumGroupChannelWriteMode =
  | typeof RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS
  | typeof RETICULUM_CHAT_CHANNEL_WRITE_MODE_ADMINS;

export type ReticulumGroupChannelReadMode =
  | typeof RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS
  | typeof RETICULUM_CHAT_CHANNEL_READ_MODE_ADMINS;

export type ReticulumGroupChannel = {
  channelId: string;
  groupId: number;
  categoryId?: string;
  name: string;
  description?: string;
  position: number;
  archived: boolean;
  writeMode: ReticulumGroupChannelWriteMode;
  readMode: ReticulumGroupChannelReadMode;
  writeModeUpdatedAt: number;
  expiryDurationMs?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

function applyReticulumBuiltInChannelPolicy(
  channel: ReticulumGroupChannel
): ReticulumGroupChannel {
  if (!isReticulumChatBuiltInChannelId(channel.channelId)) return channel;
  const expiryDurationMs = normalizeReticulumChatChannelExpiryDurationMs(
    channel.channelId,
    channel.expiryDurationMs
  );
  if (
    channel.archived === false &&
    channel.writeMode === RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS &&
    channel.readMode === RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS &&
    channel.expiryDurationMs === expiryDurationMs
  )
    return channel;
  return {
    ...channel,
    archived: false,
    writeMode: RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS,
    readMode: RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS,
    expiryDurationMs,
  };
}

type ReticulumGroupChannelInput = Omit<
  ReticulumGroupChannel,
  'readMode' | 'writeModeUpdatedAt'
> & {
  readMode?: ReticulumGroupChannelReadMode;
  writeModeUpdatedAt?: number;
};

export type ReticulumGroupCategory = {
  categoryId: string;
  groupId: number;
  name: string;
  position: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type ReticulumPublicGroupActivitySummary = {
  groupId: number;
  messages24h: number;
  messages7d: number;
  activeAuthors7d: number;
  observedAt: number;
  confidence: number;
};

export type ReticulumPublicGroupActivityRecord =
  ReticulumPublicGroupActivitySummary & {
    localStateJson: string | null;
  };

export type ReticulumChatRejectedEventMarker = {
  groupId: number;
  eventId: string;
  eventFingerprint: string;
  authorAddress: string;
  authorStreamId: string;
  authorSeq: number;
  digestFingerprint: string;
  rejectedAt: number;
  nextRevalidateAt: number;
  revalidationAttempts: number;
};

export type ReticulumChatMetadataEntityRevision = {
  entityType: 'channel' | 'category';
  entityId: string;
  eventId: string;
  eventType: string;
  timestamp: number;
  deleted: boolean;
  stateHash: string;
};

export type ReticulumChatMetadataEntityRevisionSource = 'event' | 'snapshot';

export type ReticulumChatMetadataEntityRevisionRecord = {
  revision: ReticulumChatMetadataEntityRevision;
  source: ReticulumChatMetadataEntityRevisionSource;
};

export function compareMetadataEntityRevisionHeads(
  a: Pick<ReticulumChatMetadataEntityRevision, 'timestamp' | 'eventId'>,
  b: Pick<ReticulumChatMetadataEntityRevision, 'timestamp' | 'eventId'>
): number {
  return a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId);
}

export function compareMetadataEntityRevisions(
  a: Pick<
    ReticulumChatMetadataEntityRevision,
    'timestamp' | 'eventId' | 'stateHash'
  >,
  b: Pick<
    ReticulumChatMetadataEntityRevision,
    'timestamp' | 'eventId' | 'stateHash'
  >
): number {
  return (
    compareMetadataEntityRevisionHeads(a, b) ||
    String(a.stateHash || '').localeCompare(String(b.stateHash || ''))
  );
}

export function hashReticulumChatMetadataEntityState(
  entityType: 'channel' | 'category',
  entityId: string,
  state: ReticulumGroupChannel | ReticulumGroupCategory | null
): string {
  const normalizedId =
    entityType === 'channel'
      ? normalizeReticulumChatChannelId(entityId)
      : normalizeReticulumChatCategoryId(entityId);
  let normalizedState: Record<string, unknown>;
  if (!state) {
    normalizedState = { deleted: true, entityId: normalizedId, entityType };
  } else if (entityType === 'channel') {
    const channel = state as ReticulumGroupChannel;
    normalizedState = {
      archived: channel.archived === true,
      categoryId: normalizeReticulumChatCategoryId(channel.categoryId) || '',
      channelId: normalizeReticulumChatChannelId(channel.channelId),
      createdAt: Math.max(0, Math.floor(Number(channel.createdAt) || 0)),
      createdBy: String(channel.createdBy || ''),
      description: channel.description?.trim() || '',
      expiryDurationMs:
        normalizeReticulumChatExpiryDurationMs(channel.expiryDurationMs) ?? 0,
      groupId: Math.floor(Number(channel.groupId) || 0),
      name: normalizeReticulumChatDisplayName(channel.name, channel.channelId),
      position: Math.max(0, Math.floor(Number(channel.position) || 0)),
      readMode: normalizeReticulumChannelReadMode(channel.readMode),
      updatedAt: Math.max(0, Math.floor(Number(channel.updatedAt) || 0)),
      writeMode: normalizeReticulumChannelWriteMode(channel.writeMode),
      writeModeUpdatedAt: Math.max(
        0,
        Math.floor(Number(channel.writeModeUpdatedAt) || 0)
      ),
    };
  } else {
    const category = state as ReticulumGroupCategory;
    normalizedState = {
      categoryId: normalizeReticulumChatCategoryId(category.categoryId),
      createdAt: Math.max(0, Math.floor(Number(category.createdAt) || 0)),
      createdBy: String(category.createdBy || ''),
      groupId: Math.floor(Number(category.groupId) || 0),
      name: normalizeReticulumChatDisplayName(
        category.name,
        category.categoryId
      ),
      position: Math.max(0, Math.floor(Number(category.position) || 0)),
      updatedAt: Math.max(0, Math.floor(Number(category.updatedAt) || 0)),
    };
  }
  return nodeCrypto
    .createHash('sha256')
    .update(JSON.stringify(normalizedState), 'utf8')
    .digest('hex');
}

export type ReticulumChatAuthorHead = {
  authorAddress: string;
  authorStreamId: string;
  maxSeq: number;
  eventId: string;
  timestamp: number;
};

export type ReticulumChatAuthorSequenceHead = {
  authorAddress: string;
  authorStreamId: string;
  maxSeq: number;
};

export type ReticulumChatAuthorSequenceGap = {
  authorAddress: string;
  authorStreamId: string;
  fromSeq: number;
  toSeq: number;
};

export type ReticulumChatFeedCursor = {
  eventId: string;
  feedTimestamp: number;
};

export type ReticulumChatChannelDigest = {
  groupId: number;
  channelId: string;
  latestCursor: ReticulumChatFeedCursor | null;
  oldestCursor: ReticulumChatFeedCursor | null;
  visibleWindowHash: string;
};

export type ReticulumChatSummary = {
  groupId: number;
  channelId: string;
  lastEvent: ReticulumChatEvent | null;
  unreadCount: number;
  replyCount: number;
  mentionCount: number;
  hasUnreadMention: boolean;
  updatedAt: number;
  readThroughTimestamp: number;
};

export type ReticulumGroupChatSummary = {
  groupId: number;
  lastEvent: ReticulumChatEvent | null;
  unreadCount: number;
  replyCount: number;
  mentionCount: number;
  hasUnreadMention: boolean;
  updatedAt: number;
  channels: ReticulumChatSummary[];
};

type CachedReticulumChannelSummary = {
  groupId: number;
  channelId: string;
  ownerAddress: string;
  onlineSince: number;
  validUntil: number;
  summary: ReticulumChatSummary | null;
};

export type ReticulumChatReadTarget = {
  groupId: number;
  channelId: string;
  timestamp: number;
};

export type ReticulumChatDeviceReadState = {
  ownerAddress: string;
  scopeType: 'group' | 'dm';
  scopeId: string;
  groupId?: number;
  channelId?: string;
  conversationId?: string;
  peerAddress?: string;
  upToTimestamp: number;
  signedAt: number;
  authorPublicKey: string;
  signature: string;
};

export type ReticulumChatPendingDeviceReadState = Omit<
  ReticulumChatDeviceReadState,
  'signedAt' | 'authorPublicKey' | 'signature'
> & { updatedAt: number };

export type ReticulumChatDeviceStateRecord = {
  ownerAddress: string;
  key: string;
  value: string | null; // null = tombstone
  signedAt: number;
  expiresAt: number | null;
  authorPublicKey: string;
  signature: string;
};

export type ReticulumChatPendingDeviceState = {
  ownerAddress: string;
  key: string;
  value: string | null;
  expiresAt: number | null;
  updatedAt: number;
};

const RETICULUM_CHAT_DEVICE_STATE_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ReticulumChatSearchResult = {
  event: ReticulumChatEvent;
  snippet: string;
  cursor?: ReticulumChatSearchCursor;
};

export type ReticulumChatSearchCursor = {
  createdAt: number;
  eventId: string;
};

export type ReticulumChatSilenceScope = 'group' | 'dm';

export type ReticulumChatSilenceRecord = {
  ownerAddress: string;
  targetAddress: string;
  scopeType: ReticulumChatSilenceScope;
  scopeId: string;
  createdAt: number;
  expiresAt: number | null;
  ignoredThrough: number;
  updatedAt: number;
};

export type ReticulumChatSearchOptions = {
  groupIds?: number[];
  channelIds?: string[];
  authorAddresses?: string[];
  excludedAuthorAddresses?: string[];
  excludedAuthorAddressesByGroup?: Record<string, string[]>;
  eventTypes?: Array<'message' | 'attachment_manifest'>;
  beforeTimestamp?: number;
  afterTimestamp?: number;
  hasAttachment?: boolean;
  hasLink?: boolean;
  sort?: 'relevance' | 'newest' | 'oldest';
  limit?: number;
  offset?: number;
  cursor?: ReticulumChatSearchCursor;
  includeAdminPrivate?: boolean;
};

export type ReticulumChatMessageWindowOptions = {
  beforeLimit?: number;
  afterLimit?: number;
  includeAdminPrivate?: boolean;
  excludedAuthorAddresses?: string[];
};

export type ReticulumChatRelayCacheEntry = {
  blobId: string;
  eventId: string;
  groupId: number;
  groupHash: string;
  createdAt: number;
  expiresAt: number;
  sizeBytes: number;
  encoding: 'plain-json-v1';
  encryption: 'none';
  keyEpoch: number | null;
  encryptedKeyId: string | null;
  payloadJson: string;
  sourcePeerHash: string;
  servedCount: number;
  lastServedAt: number | null;
};

export type ReticulumChatRelayDigestEntry = {
  blobId: string;
  eventId: string;
  groupId: number;
  channelId: string;
  authorAddress: string;
  authorStreamId: string;
  authorSeq: number;
  timestamp: number;
  payloadHash: string;
  createdAt: number;
};

export type ReticulumChatGroupKey = {
  groupId: number;
  epoch: number;
  keyId: string;
  keyBytesBase64: string;
  createdBy: string;
  createdAt: number;
  status: 'active' | 'superseded';
  adminPublicKey: string;
  adminSignature: string;
};

export type ReticulumChatGroupKeyDigest = {
  groupId: number;
  epoch: number;
  keyId: string;
  createdBy: string;
  createdAt: number;
  adminPublicKey: string;
  adminSignature: string;
  sourcePeerHash: string;
  seenAt: number;
};

export type ReticulumChatGroupKeyRequest = {
  groupId: number;
  epoch: number;
  keyId: string;
  requestId: string;
  requestedAt: number;
  attempts: number;
  status: 'pending' | 'fulfilled' | 'failed';
};

type ReticulumChatMissingRangeRow = {
  group_id: number;
  author_address: string;
  author_stream_id: string;
  from_seq: number;
  to_seq: number;
  preferred_peer?: string | null;
  attempts?: number;
  next_attempt_at?: number;
};

export type ReticulumChatMissingRangeState = {
  groupId: number;
  authorAddress: string;
  authorStreamId: string;
  fromSeq: number;
  toSeq: number;
  preferredPeer: string;
  attempts: number;
  nextAttemptAt: number;
};

/** One group's background scanner pick (see getBackgroundMissingRangeCandidates). */
export type ReticulumChatBackgroundMissingRangeCandidate = {
  oldest: ReticulumChatMissingRangeState;
  ownOldest: ReticulumChatMissingRangeState | null;
};

/**
 * Missing-range rows by state, for Copy diagnostics. The first six counts are
 * exclusive, in that order of precedence; fromSeqOne, noPeer and
 * olderThanServeAge are tags over all rows.
 */
export type ReticulumChatMissingRangeStateCounts = {
  source: 'sql' | 'memory';
  total: number;
  /** Group not local+subscribed; the scanner never reads it. */
  notEligible: number;
  /** Known-unavailable marker (7-day park). */
  parked: number;
  due: number;
  /** Next try within the 2 h backoff ladder. */
  backoff: number;
  /** Next try further away than the backoff ladder, no marker: the 6 h quarantine. */
  quarantined: number;
  fromSeqOne: number;
  /** Empty preferred peer; never wakes the scanner. */
  noPeer: number;
  /** Stored neighbour at to_seq+1 older than the serve floor. */
  olderThanServeAge: number;
  // Optional tags over all rows, so an older engine's answer still fits
  // (memory mirror: 0, it has no neighbour timestamps).
  /** olderThanServeAge rows that are due now / parked (known-unavailable marker). */
  olderThanServeAgeDue?: number;
  olderThanServeAgeParked?: number;
  /** No stored message at to_seq+1: a tail row, or its neighbour was rejected. */
  noStoredNeighbour?: number;
  /** One missing sequence between two stored ones (from = to > 1, neighbour stored). */
  singleSeqInterior?: number;
  /** At most 5, rows desc then groupId asc. */
  topGroups: Array<{
    groupId: number;
    rows: number;
    due: number;
    eligible: boolean;
  }>;
};

const RETICULUM_CHAT_MISSING_RANGE_TOP_GROUPS = 5;
/** Exact SQL reads per group per scanner pick for due mirror-only rows. */
const RETICULUM_CHAT_MISSING_RANGE_MIRROR_PICK_CHECKS = 8;
// GO (authorGapAgeAware) asked lists: rows kept, peers kept per row, and how
// often rows whose gap is gone (or past the cap) are dropped. Losing a row
// costs at most one more ask per peer.
const RETICULUM_CHAT_OLD_GAP_ASKS_MAX_ROWS = 8_192;
const RETICULUM_CHAT_OLD_GAP_ASKS_MAX_PEERS = 64;
const RETICULUM_CHAT_OLD_GAP_ASKS_PRUNE_INTERVAL_MS = 60 * 60_000;

function parseOldGapAskPeers(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((peer) =>
        String(peer || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function sameMissingRangeState(
  a: ReticulumChatMissingRangeState,
  b: ReticulumChatMissingRangeState
): boolean {
  return (
    a.nextAttemptAt === b.nextAttemptAt &&
    a.attempts === b.attempts &&
    a.preferredPeer === b.preferredPeer
  );
}

// Scanner tie order. UTF-16 code-unit order equals SQLite BINARY for the
// ASCII base58 and hex values stored here.
function compareMissingRangeScanOrder(
  a: ReticulumChatMissingRangeState,
  b: ReticulumChatMissingRangeState
): number {
  if (a.nextAttemptAt !== b.nextAttemptAt) {
    return a.nextAttemptAt - b.nextAttemptAt;
  }
  if (a.authorAddress !== b.authorAddress) {
    return a.authorAddress < b.authorAddress ? -1 : 1;
  }
  if (a.authorStreamId !== b.authorStreamId) {
    return a.authorStreamId < b.authorStreamId ? -1 : 1;
  }
  return a.fromSeq - b.fromSeq || a.toSeq - b.toSeq;
}

export type ReticulumChatKnownUnavailableRange = {
  groupId: number;
  authorAddress: string;
  authorStreamId: string;
  fromSeq: number;
  toSeq: number;
  confirmedAt: number;
  recheckAt: number;
  peerHashes: string[];
};

/**
 * GO (mobileProfile authorGapAgeAware): what an old gap row (its next stored
 * message is older than the serve floor) has been through.
 */
export type ReticulumChatOldGapAskState = {
  /** Peers that already answered for this row or a range covering it. */
  askedPeers: string[];
  /** Answers since the row was last parked. */
  cycleAsks: number;
  /** When a new provider last woke the row (0 = never). */
  wokenAt: number;
};

export type ReticulumChatMetadataSnapshotRecord = {
  groupId: number;
  snapshotId: string;
  scope: 'public' | 'full';
  parentSnapshotHash: string;
  version: number;
  createdAt: number;
  latestEventId: string;
  latestFeedTimestamp: number;
  snapshotHash: string;
  adminAddress: string;
  adminPublicKey: string;
  signature: string;
  channels: ReticulumGroupChannel[];
  categories: ReticulumGroupCategory[];
  revisions: ReticulumChatMetadataEntityRevision[];
};

type EventRow = {
  event_id: string;
  group_id: number;
  channel_id: string;
  author_address: string;
  author_public_key: string;
  author_stream_id?: string;
  author_seq: number;
  timestamp: number;
  feed_timestamp: number;
  event_type: string;
  target_event_id: string | null;
  reply_to_event_id: string | null;
  encrypted_payload: string;
  payload_hash: string;
  mention_address_hashes: string;
  mention_targets?: string;
  signature: string;
  own_event: number;
  last_served_at: number;
  stored_at: number;
  accepted_at: number;
  wire_bytes: number;
  scrubbed_at?: number | null;
  expires_at?: number | null;
  message_expiry_duration_ms?: number | null;
  privileged_mention_status?: number;
};

type ChannelExpiryReconciliationRow = {
  group_id: number;
  channel_id: string;
  revision: number;
  expiry_duration_ms?: number | null;
  after_timestamp: number;
  after_event_id: string;
};

type DirectEventRow = {
  event_id: string;
  conversation_id: string;
  sender_address: string;
  recipient_address: string;
  sender_public_key: string;
  sender_stream_id?: string;
  sender_seq: number;
  timestamp: number;
  event_type: string;
  target_event_id: string | null;
  reply_to_event_id: string | null;
  payload: string;
  payload_hash: string;
  signature: string;
  legacy_signature?: string | null;
  own_event: number;
  read_at: number;
  stored_at: number;
  wire_bytes: number;
  delivery_status?: string;
  delivery_updated_at?: number;
  expires_at?: number | null;
  message_expiry_duration_ms?: number | null;
  own_device_copied_at?: number | null;
  delivery_attempts?: number | null;
  next_delivery_attempt_at?: number | null;
};

/**
 * Newest pending own DM event of one conversation plus its persisted retry
 * state (local only, never on the wire or in the renderer event).
 */
export type ReticulumPendingOwnDirectHead = {
  event: ReticulumDmEvent;
  /** Re-announce attempts made so far (0 = none). */
  deliveryAttempts: number;
  /** When the next re-announce is due (0 = not scheduled yet). */
  nextDeliveryAttemptAt: number;
};

// Re-announce number of a pending own DM head's first dm_notify without
// `lc` (the chat engine leaves it out on attempts 4, 8, 16, ...). With `lc`
// a recipient that already holds the head ends its pull without asking for
// a page, so nothing older is served or proven.
export const RETICULUM_DM_PENDING_NO_CURSOR_FIRST_ATTEMPT = 4;

// One-time re-pend of own DMs that older builds marked 'sent' when the
// bridge accepted the page authorize, before any byte was delivered
// (repairPrematureDmSent). Window, first due delay and per-conversation
// spacing of the re-announces it schedules.
export const RETICULUM_DM_PREMATURE_SENT_REPAIR_WINDOW_MS =
  7 * 24 * 60 * 60 * 1000;
export const RETICULUM_DM_PREMATURE_SENT_REPAIR_FIRST_DUE_MS = 120_000;
export const RETICULUM_DM_PREMATURE_SENT_REPAIR_SPACING_MS = 75_000;
// Attempts a re-pended row starts with: its first re-announce is then the
// first one without `lc`, so every recipient pulls from its own cursor once
// (and a page that arrives proves the rows it already had).
export const RETICULUM_DM_PREMATURE_SENT_REPAIR_SEED_ATTEMPTS =
  RETICULUM_DM_PENDING_NO_CURSOR_FIRST_ATTEMPT - 1;

export type ReticulumDmPrematureSentRepairResult = {
  /** Rows turned back into 'pending'. */
  rows: number;
  /** Touched conversations, newest first, with their first due time. */
  conversations: Array<{
    conversationId: string;
    recipientAddress: string;
    nextAttemptAt: number;
  }>;
};

export type ReticulumDmExpiryPreference = {
  ownerAddress: string;
  peerAddress: string;
  durationMs: number | null;
  updatedAt: number;
};

export type ReticulumDmExpiryPruneResult = {
  eventIds: string[];
  conversations: Array<{
    conversationId: string;
    peerAddresses: string[];
  }>;
};

export type ReticulumOwnPostDeliveryScope = 'group' | 'self_dm';

/**
 * An own post written on this device (GO, trackOwnPostDelivery): a group
 * message or attachment, or a Saved Messages post, and when another node
 * first fetched it from here (RNS proved receipt). Local only, never on the
 * wire. `ownDeviceAt`: a device of the same account (a home Hub);
 * `memberAt`: another group member's node.
 */
export type ReticulumOwnPostDeliveryRecord = {
  eventId: string;
  scope: ReticulumOwnPostDeliveryScope;
  groupId: number | null;
  channelId: string | null;
  conversationId: string | null;
  authorAddress: string;
  createdAt: number;
  ownDeviceAt: number | null;
  memberAt: number | null;
  memberPeerHash: string | null;
  proofKind: string | null;
};

/** A proof for one tracked own post; set fields are only ever filled once. */
export type ReticulumOwnPostDeliveryMark = {
  eventId: string;
  ownDeviceAt?: number;
  memberAt?: number;
  memberPeerHash?: string;
  /** How the proof came: live, page, range (groups) or dm_page (Saved Messages). */
  proofKind?: string;
};

type OwnPostDeliveryRow = {
  event_id: string;
  scope: string;
  group_id: number | null;
  channel_id: string | null;
  conversation_id: string | null;
  author_address: string;
  created_at: number;
  own_device_at: number | null;
  member_at: number | null;
  member_peer_hash: string | null;
  proof_kind: string | null;
};

function positiveTimestampOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

type SilenceRow = {
  owner_address: string;
  target_address: string;
  scope_type: string;
  scope_id: string;
  created_at: number;
  expires_at: number | null;
  ignored_through: number;
  updated_at: number;
};

type MessageProjectionRow = {
  root_event_id: string;
  group_id: number;
  channel_id: string;
  author_address: string;
  author_public_key: string;
  author_stream_id?: string;
  author_seq: number;
  created_at: number;
  root_event_type: string;
  current_event_id: string;
  updated_at: number;
  reply_to_event_id: string | null;
  encrypted_payload: string;
  payload_hash: string;
  mention_address_hashes: string;
  mention_targets: string;
  signature: string;
  deleted_at: number | null;
  deleted_event_id: string | null;
  expires_at?: number | null;
  has_attachment?: number | null;
};

// Expiry is local projection state, not part of the signed Reticulum event.
// Keep it associated with rows converted for local reads without adding an
// enumerable property that could accidentally enter a wire serialization.
const rendererExpiresAtByEvent = new WeakMap<
  ReticulumChatEvent,
  number | null
>();
const projectionUpdatedAtByEvent = new WeakMap<ReticulumChatEvent, number>();

function rememberRendererExpiresAt<T extends ReticulumChatEvent>(
  event: T,
  value: unknown
): T {
  const expiresAt = Number(value);
  rendererExpiresAtByEvent.set(
    event,
    Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null
  );
  return event;
}

export function buildReticulumDiscussionIndex(
  rows: ReadonlyArray<{ discussion_root_id: string; reply_count: number }>
): {
  replyCounts: Record<string, number>;
  rootByEventId: Record<string, string>;
} {
  const replyCounts: Record<string, number> = {};
  const rootByEventId: Record<string, string> = {};
  for (const row of rows) {
    const replyCount = Math.max(0, Number(row.reply_count) || 0);
    if (replyCount === 0) continue;
    replyCounts[row.discussion_root_id] = replyCount;
    rootByEventId[row.discussion_root_id] = row.discussion_root_id;
  }
  return { replyCounts, rootByEventId };
}

type RelayCacheRow = {
  blob_id: string;
  event_id: string;
  group_id: number;
  group_hash: string;
  created_at: number;
  expires_at: number;
  size_bytes: number;
  encoding: string;
  encryption: string;
  key_epoch: number | null;
  encrypted_key_id: string | null;
  payload_json: string;
  source_peer_hash: string;
  served_count: number;
  last_served_at: number | null;
};

type GroupKeyRow = {
  group_id: number;
  epoch: number;
  key_id: string;
  key_bytes_base64: string;
  created_by: string;
  created_at: number;
  status: string;
  admin_public_key: string;
  admin_signature: string;
};

type GroupKeyDigestRow = {
  group_id: number;
  epoch: number;
  key_id: string;
  created_by: string;
  created_at: number;
  admin_public_key: string;
  admin_signature: string;
  source_peer_hash: string;
  seen_at: number;
};

type GroupKeyRequestRow = {
  group_id: number;
  epoch: number;
  key_id: string;
  request_id: string;
  requested_at: number;
  attempts: number;
  status: string;
};

type MetadataSnapshotRow = {
  group_id: number;
  snapshot_id: string;
  scope: string;
  parent_snapshot_hash: string;
  version: number;
  created_at: number;
  latest_event_id: string;
  latest_feed_timestamp: number;
  snapshot_hash: string;
  admin_address: string;
  admin_public_key: string;
  signature: string;
  channels_json: string;
  categories_json: string;
  revisions_json: string;
};

function relayRowToEntry(row: RelayCacheRow): ReticulumChatRelayCacheEntry {
  return {
    blobId: row.blob_id,
    eventId: row.event_id,
    groupId: row.group_id,
    groupHash: row.group_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sizeBytes: row.size_bytes,
    encoding: 'plain-json-v1',
    encryption: 'none',
    keyEpoch: row.key_epoch,
    encryptedKeyId: row.encrypted_key_id,
    payloadJson: row.payload_json,
    sourcePeerHash: row.source_peer_hash,
    servedCount: row.served_count,
    lastServedAt: row.last_served_at,
  };
}

function metadataSnapshotRowToRecord(
  row: MetadataSnapshotRow
): ReticulumChatMetadataSnapshotRecord {
  let channels: ReticulumGroupChannel[] = [];
  let categories: ReticulumGroupCategory[] = [];
  let revisions: ReticulumChatMetadataEntityRevision[] = [];
  try {
    const parsedChannels = JSON.parse(row.channels_json);
    if (Array.isArray(parsedChannels))
      channels = parsedChannels as ReticulumGroupChannel[];
  } catch {
    channels = [];
  }
  try {
    const parsedCategories = JSON.parse(row.categories_json);
    if (Array.isArray(parsedCategories))
      categories = parsedCategories as ReticulumGroupCategory[];
  } catch {
    categories = [];
  }
  try {
    const parsedRevisions = JSON.parse(row.revisions_json);
    if (Array.isArray(parsedRevisions)) {
      revisions = parsedRevisions as ReticulumChatMetadataEntityRevision[];
    }
  } catch {
    revisions = [];
  }
  return {
    groupId: row.group_id,
    snapshotId: row.snapshot_id,
    scope: row.scope === 'full' ? 'full' : 'public',
    parentSnapshotHash: row.parent_snapshot_hash || '',
    version: row.version,
    createdAt: row.created_at,
    latestEventId: row.latest_event_id,
    latestFeedTimestamp: row.latest_feed_timestamp,
    snapshotHash: row.snapshot_hash,
    adminAddress: row.admin_address,
    adminPublicKey: row.admin_public_key,
    signature: row.signature,
    channels,
    categories,
    revisions,
  };
}

function groupKeyRowToEntry(row: GroupKeyRow): ReticulumChatGroupKey {
  return {
    groupId: row.group_id,
    epoch: row.epoch,
    keyId: row.key_id,
    keyBytesBase64: row.key_bytes_base64,
    createdBy: row.created_by,
    createdAt: row.created_at,
    status: row.status === 'superseded' ? 'superseded' : 'active',
    adminPublicKey: row.admin_public_key,
    adminSignature: row.admin_signature,
  };
}

function groupKeyDigestRowToEntry(
  row: GroupKeyDigestRow
): ReticulumChatGroupKeyDigest {
  return {
    groupId: row.group_id,
    epoch: row.epoch,
    keyId: row.key_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    adminPublicKey: row.admin_public_key,
    adminSignature: row.admin_signature,
    sourcePeerHash: row.source_peer_hash,
    seenAt: row.seen_at,
  };
}

export function reticulumChatRelayBlobId(payloadJson: string): string {
  return nodeCrypto
    .createHash('sha256')
    .update(payloadJson, 'utf8')
    .digest('hex');
}

export function reticulumChatRelayGroupHash(groupId: number): string {
  return nodeCrypto
    .createHash('sha256')
    .update(`rchat-relay-group:${groupId}`, 'utf8')
    .digest('hex');
}

function rowToEvent(row: EventRow): ReticulumChatEvent {
  const mentionTargets = parseMentionTargets(row.mention_targets);
  const authorStreamId = normalizeReticulumChatAuthorStreamId(
    row.author_stream_id
  );
  const event: ReticulumChatEvent = {
    eventId: row.event_id,
    groupId: row.group_id,
    channelId: normalizeReticulumChatChannelId(row.channel_id),
    authorAddress: row.author_address,
    authorPublicKey: row.author_public_key,
    authorStreamId,
    authorSeq: row.author_seq,
    timestamp: row.timestamp,
    eventType: row.event_type as ReticulumChatEvent['eventType'],
    ...(row.target_event_id ? { targetEventId: row.target_event_id } : {}),
    ...(row.reply_to_event_id ? { replyToEventId: row.reply_to_event_id } : {}),
    encryptedPayload: row.encrypted_payload,
    payloadHash: row.payload_hash,
    mentionAddressHashes: parseMentionAddressHashes(row.mention_address_hashes),
    ...(mentionTargets.length > 0 ? { mentionTargets } : {}),
    signature: row.signature,
  };
  return rememberRendererExpiresAt(event, row.expires_at);
}

// rchat_sync_state scope of the per-own-device Saved Messages confirmations.
const SELF_DM_CONFIRMED_SCOPE = 'self_dm_confirmed';
// rchat_sync_state scope of completed non-self DM look-backs, per source
// device (peer_hash) and conversation (state_key).
const DM_LOOKBACK_DONE_SCOPE = 'dm_lookback_done';
// rchat_sync_state scope of the once-per-address premature 'sent' repair
// guard (peer_hash '', state_key = the sender address).
const DM_PREMATURE_SENT_REPAIR_SCOPE = 'dm_premature_sent_repair';

// SQL condition: this rchat_dm_events row (alias `d`) is one the premature
// 'sent' repair turned back into 'pending' and nothing has settled since.
// The repair writes its own time into delivery_updated_at and into its
// guard row's updated_at; nothing else writes that column on a pending row.
function prematureSentRepairedRowSql(d: string): string {
  return `${d}.delivery_updated_at = (
      SELECT g.updated_at FROM rchat_sync_state g
      WHERE g.scope = '${DM_PREMATURE_SENT_REPAIR_SCOPE}'
        AND g.group_id = 0 AND g.peer_hash = ''
        AND g.state_key = ${d}.sender_address)`;
}

// Newest pending own outbound DM event per conversation. Parameters: sender,
// [conversation id,] since, now (inner window), then sender, since, now,
// uncopied-only-before (outer). Heads older than the last cutoff count only
// while no own device copied them; a head the premature 'sent' repair
// re-pended also counts until its first re-announce without `lc`
// (RETICULUM_DM_PENDING_NO_CURSOR_FIRST_ATTEMPT): an own device's copy never
// reaches a recipient whose cursor already passed it. The outer `since` only
// narrows (every head is inside the window) but lets the pending-delivery
// index range on time.
function pendingOwnDirectHeadsFrom(byConversation: boolean): string {
  return `
  FROM rchat_dm_events d
  JOIN (
    SELECT conversation_id AS head_conversation_id,
           MAX(timestamp) AS head_timestamp
    FROM rchat_dm_events
    WHERE delivery_status = 'pending'
      AND sender_address = ?${byConversation ? '\n      AND conversation_id = ?' : ''}
      AND recipient_address != sender_address
      AND own_event = 1
      AND timestamp >= ?
      AND (expires_at IS NULL OR expires_at > ?)
    GROUP BY conversation_id
  ) h
    ON d.conversation_id = h.head_conversation_id
   AND d.timestamp = h.head_timestamp
  WHERE d.delivery_status = 'pending'
    AND d.sender_address = ?
    AND d.timestamp >= ?
    AND d.recipient_address != d.sender_address
    AND d.own_event = 1
    AND (d.expires_at IS NULL OR d.expires_at > ?)
    AND (d.timestamp >= ?
         OR d.own_device_copied_at IS NULL
         OR (COALESCE(d.delivery_attempts, 0) < ${RETICULUM_DM_PENDING_NO_CURSOR_FIRST_ATTEMPT}
             AND ${prematureSentRepairedRowSql('d')}))`;
}
const PENDING_OWN_DIRECT_HEADS_FROM = pendingOwnDirectHeadsFrom(false);
const PENDING_OWN_DIRECT_CONVERSATION_HEAD_FROM =
  pendingOwnDirectHeadsFrom(true);

function rowToPendingOwnDirectHead(
  row: DirectEventRow
): ReticulumPendingOwnDirectHead {
  return {
    event: rowToDirectEvent(row),
    deliveryAttempts: Math.max(
      0,
      Math.floor(Number(row.delivery_attempts) || 0)
    ),
    nextDeliveryAttemptAt: Math.max(
      0,
      Math.floor(Number(row.next_delivery_attempt_at) || 0)
    ),
  };
}

function rowToDirectEvent(row: DirectEventRow): ReticulumDmEvent {
  return {
    eventId: row.event_id,
    conversationId: row.conversation_id,
    senderAddress: row.sender_address,
    recipientAddress: row.recipient_address,
    senderPublicKey: row.sender_public_key,
    ...(normalizeReticulumChatAuthorStreamId(row.sender_stream_id)
      ? {
          senderStreamId: normalizeReticulumChatAuthorStreamId(
            row.sender_stream_id
          ),
        }
      : {}),
    senderSeq: row.sender_seq,
    timestamp: row.timestamp,
    eventType: row.event_type as ReticulumDmEvent['eventType'],
    ...(row.target_event_id ? { targetEventId: row.target_event_id } : {}),
    ...(row.reply_to_event_id ? { replyToEventId: row.reply_to_event_id } : {}),
    payload: row.payload,
    payloadHash: row.payload_hash,
    signature: row.signature,
    ...(row.legacy_signature ? { legacySignature: row.legacy_signature } : {}),
    localDeliveryStatus:
      row.delivery_status === 'pending' ||
      row.delivery_status === 'sent' ||
      row.delivery_status === 'received'
        ? row.delivery_status
        : undefined,
    ...(Number.isFinite(Number(row.delivery_updated_at))
      ? { localDeliveryUpdatedAt: Number(row.delivery_updated_at) }
      : {}),
    ...(row.own_event != null
      ? { localOwnEvent: Number(row.own_event) === 1 }
      : {}),
    ...(row.own_device_copied_at != null && Number(row.own_device_copied_at) > 0
      ? { localOwnDeviceCopiedAt: Number(row.own_device_copied_at) }
      : {}),
    expiresAt:
      row.expires_at == null || !Number.isFinite(Number(row.expires_at))
        ? null
        : Number(row.expires_at),
  };
}

function silenceRowToRecord(row: SilenceRow): ReticulumChatSilenceRecord {
  return {
    ownerAddress: row.owner_address,
    targetAddress: row.target_address,
    scopeType: row.scope_type as ReticulumChatSilenceScope,
    scopeId: row.scope_id,
    createdAt: Number(row.created_at || 0),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    ignoredThrough: Number(row.ignored_through || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function messageProjectionRowToEvent(
  row: MessageProjectionRow
): ReticulumChatEvent {
  const mentionTargets = parseMentionTargets(row.mention_targets);
  const authorStreamId = normalizeReticulumChatAuthorStreamId(
    row.author_stream_id
  );
  const event: ReticulumChatEvent = {
    eventId: row.root_event_id,
    groupId: row.group_id,
    channelId: normalizeReticulumChatChannelId(row.channel_id),
    authorAddress: row.author_address,
    authorPublicKey: row.author_public_key,
    authorStreamId,
    authorSeq: row.author_seq,
    timestamp: row.created_at,
    eventType: row.root_event_type as ReticulumChatEvent['eventType'],
    ...(row.reply_to_event_id ? { replyToEventId: row.reply_to_event_id } : {}),
    encryptedPayload: row.encrypted_payload,
    payloadHash: row.payload_hash,
    mentionAddressHashes: parseMentionAddressHashes(row.mention_address_hashes),
    ...(mentionTargets.length > 0 ? { mentionTargets } : {}),
    signature: row.signature,
  };
  projectionUpdatedAtByEvent.set(
    event,
    Math.max(Number(row.created_at) || 0, Number(row.updated_at) || 0)
  );
  return rememberRendererExpiresAt(event, row.expires_at);
}

export function normalizeReticulumDmConversationId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : '';
}

export function reticulumDmConversationId(
  addressA: string,
  addressB: string
): string {
  const first = String(addressA || '').trim();
  const second = String(addressB || '').trim();
  if (!first || !second) return '';
  const [a, b] = [first, second].sort();
  return nodeCrypto
    .createHash('sha256')
    .update(`rchat-dm-v1:${a}:${b}`, 'utf8')
    .digest('hex');
}

export function normalizeReticulumChatChannelId(value: unknown): string {
  if (typeof value !== 'string') return RETICULUM_CHAT_DEFAULT_CHANNEL_ID;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(normalized) ||
    normalized === RETICULUM_CHAT_DEFAULT_CHANNEL_ID
    ? normalized
    : RETICULUM_CHAT_DEFAULT_CHANNEL_ID;
}

export function normalizeReticulumChatExpiryDurationMs(
  value: unknown
): number | undefined {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(duration));
}

export function normalizeReticulumChatChannelExpiryDurationMs(
  channelId: unknown,
  value: unknown
): number | undefined {
  const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
  if (normalizedChannelId === RETICULUM_CHAT_DEFAULT_CHANNEL_ID) {
    return RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS;
  }
  if (normalizedChannelId === RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID) {
    return RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS;
  }
  return normalizeReticulumChatExpiryDurationMs(value);
}

export function normalizeReticulumChatCategoryId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return /^cat-[a-z0-9][a-z0-9-]{0,54}[a-z0-9]$/.test(normalized)
    ? normalized
    : '';
}

function parseMentionAddressHashes(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => /^[0-9a-f]{64}$/i.test(item));
  } catch {
    return [];
  }
}

function serializeMentionAddressHashes(value: unknown): string {
  if (!Array.isArray(value)) return '[]';
  return JSON.stringify(
    [
      ...new Set(
        value
          .map((item) =>
            typeof item === 'string' ? item.trim().toLowerCase() : ''
          )
          .filter((item) => /^[0-9a-f]{64}$/i.test(item))
      ),
    ].slice(0, 100)
  );
}

function parseMentionTargets(value: unknown): ReticulumChatMentionTarget[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    return sanitizeMentionTargets(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function reticulumChatPayloadHasPrivilegedMention(
  encryptedPayload: string
): boolean {
  const containsPrivilegedMentionMarkup = (value: string): boolean =>
    /<(?:span|a)\b(?=[^>]*(?:data-type\s*=\s*["']mention["']|class\s*=\s*["'][^"']*\bmention\b[^"']*["']))(?=[^>]*data-(?:id|label)\s*=\s*["'](?:@)?(?:everyone|here)["'])[^>]*>/iu.test(
      value
    ) ||
    /<(?:span|a)\b(?=[^>]*(?:data-type\s*=\s*["']mention["']|class\s*=\s*["'][^"']*\bmention\b[^"']*["']))[^>]*>[^<]{0,128}@(?:everyone|here)\b/iu.test(
      value
    );
  const raw = String(encryptedPayload || '');
  if (containsPrivilegedMentionMarkup(raw)) {
    return true;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return false;
  }
  const pending: unknown[] = [payload];
  let visited = 0;
  while (pending.length > 0) {
    if (visited >= 4096) {
      // Treat excessive structured content as privileged. This keeps parsing
      // bounded and fails closed instead of allowing a complexity bypass.
      return true;
    }
    visited += 1;
    const value = pending.pop();
    if (typeof value === 'string') {
      if (containsPrivilegedMentionMarkup(value)) return true;
      continue;
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (
      record.type === 'mention' &&
      record.attrs &&
      typeof record.attrs === 'object'
    ) {
      const attrs = record.attrs as Record<string, unknown>;
      for (const candidate of [attrs.id, attrs.label]) {
        const token = String(candidate || '')
          .trim()
          .replace(/^@/, '')
          .toLowerCase();
        if (token === 'everyone' || token === 'here') return true;
      }
    }
    pending.push(...Object.values(record));
  }
  return false;
}

function serializeMentionTargets(value: unknown): string {
  return JSON.stringify(sanitizeMentionTargets(value));
}

function sanitizeMentionTargets(value: unknown): ReticulumChatMentionTarget[] {
  if (!Array.isArray(value)) return [];
  const targets: ReticulumChatMentionTarget[] = [];
  const seen = new Set<string>();
  const add = (target: ReticulumChatMentionTarget) => {
    const key = JSON.stringify(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === 'string' ? item.type : '';
    if (type === 'user') {
      const addressHash =
        typeof item.addressHash === 'string'
          ? item.addressHash.trim().toLowerCase()
          : '';
      if (/^[0-9a-f]{64}$/i.test(addressHash))
        add({ type: 'user', addressHash });
      continue;
    }
    const groupId = Number(item.groupId);
    if (!Number.isInteger(groupId) || groupId <= 0) continue;
    if (type === 'everyone') {
      add({ type: 'everyone', groupId });
      continue;
    }
    if (type === 'group') {
      const groupName =
        typeof item.groupName === 'string'
          ? item.groupName.trim().slice(0, 120)
          : '';
      add({ type: 'group', groupId, ...(groupName ? { groupName } : {}) });
      continue;
    }
    if (type === 'channel') {
      const channelId = normalizeReticulumChatChannelId(item.channelId);
      const channelName =
        typeof item.channelName === 'string'
          ? item.channelName.trim().slice(0, 120)
          : '';
      add({
        type: 'channel',
        groupId,
        channelId,
        ...(channelName ? { channelName } : {}),
      });
      continue;
    }
    if (type === 'here') {
      const channelId = normalizeReticulumChatChannelId(item.channelId);
      const createdAt = Number(item.createdAt);
      add({
        type: 'here',
        groupId,
        channelId,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      });
    }
  }

  return targets.slice(0, 32);
}

function mentionTargetAppliesTo(
  event: ReticulumChatEvent,
  myAddress: string,
  channelId: string,
  onlineSince: number,
  myMentionHash: string,
  privilegedMentionAuthorized: boolean
): boolean {
  if (!myAddress || event.authorAddress === myAddress) return false;
  const targets = sanitizeMentionTargets(event.mentionTargets);
  if (targets.length === 0) return false;
  const eventChannelId = normalizeReticulumChatChannelId(event.channelId);
  const summaryChannelId = normalizeReticulumChatChannelId(channelId);

  for (const target of targets) {
    if (target.type === 'user') {
      if (myMentionHash && target.addressHash === myMentionHash) return true;
      continue;
    }
    if (target.groupId !== event.groupId) continue;
    if (target.type === 'everyone') return privilegedMentionAuthorized;
    // Older clients signed group and channel targets as mentions. They now
    // represent navigation only and must never create unread notifications.
    if (target.type === 'group' || target.type === 'channel') continue;
    if (target.type === 'here') {
      if (!privilegedMentionAuthorized) continue;
      if (normalizeReticulumChatChannelId(target.channelId) !== eventChannelId)
        continue;
      if (eventChannelId !== summaryChannelId) continue;
      if (onlineSince > 0 && event.timestamp < onlineSince) continue;
      return true;
    }
  }

  return false;
}

export function hashReticulumChatMentionAddress(address: string): string {
  return nodeCrypto
    .createHash('sha256')
    .update(`reticulum-chat-mention:${address.trim()}`, 'utf8')
    .digest('hex');
}

function eventWireBytes(event: ReticulumChatEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

function deletedPayloadScrubMarker(
  eventId: string,
  deletedEventId: string | null
): string {
  return JSON.stringify({
    deleted: true,
    eventId,
    ...(deletedEventId ? { deletedEventId } : {}),
  });
}

function isDeletedPayloadScrubMarker(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = JSON.parse(value) as {
      deleted?: unknown;
      eventId?: unknown;
    };
    return (
      parsed.deleted === true &&
      typeof parsed.eventId === 'string' &&
      !!parsed.eventId
    );
  } catch {
    return false;
  }
}

function hashReticulumChatDbPayload(encryptedPayload: string): string {
  return nodeCrypto
    .createHash('sha256')
    .update(encryptedPayload, 'utf8')
    .digest('hex');
}

function collectVisibleMessageStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVisibleMessageStrings(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const [key, next] of Object.entries(record)) {
    if (key === 'type' || key === 'attrs') continue;
    collectVisibleMessageStrings(next, out);
  }
}

function projectedSearchTextFromPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return '';
    }
    const record = parsed as Record<string, unknown>;
    const strings: string[] = [];
    const visibleMessage = record.message || record.messageText;
    collectVisibleMessageStrings(visibleMessage, strings);
    if (Array.isArray(record.attachments)) {
      for (const attachment of record.attachments) {
        if (!attachment || typeof attachment !== 'object') continue;
        const attachmentRecord = attachment as Record<string, unknown>;
        const fileName =
          typeof attachmentRecord.fileName === 'string'
            ? attachmentRecord.fileName.trim()
            : typeof attachmentRecord.name === 'string'
              ? attachmentRecord.name.trim()
              : '';
        if (fileName) strings.push(fileName);
      }
    }
    return strings.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

function searchTextFromPayload(payload: string): string {
  return projectedSearchTextFromPayload(payload) ?? '';
}

function mentionedAddressesFromPayload(payload: string): string[] | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const mentionedAddresses = (parsed as Record<string, unknown>)
      .mentionedAddresses;
    if (!Array.isArray(mentionedAddresses)) return null;
    return [
      ...new Set(
        mentionedAddresses
          .map((address) => (typeof address === 'string' ? address.trim() : ''))
          .filter(Boolean)
      ),
    ];
  } catch {
    return null;
  }
}

function payloadHasReticulumFileAttachment(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    const hasAttachmentEntry = (value: unknown): boolean =>
      Array.isArray(value) &&
      value.some((item) => item && typeof item === 'object');
    return hasAttachmentEntry(record.attachments);
  } catch {
    return false;
  }
}

function messageExpiryDurationFromPayload(payload: string): number | undefined {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return undefined;
    const record = parsed as Record<string, unknown>;
    return normalizeReticulumChatExpiryDurationMs(
      record.expiryDurationMs ??
        record.expiresInMs ??
        record.messageExpiryDurationMs
    );
  } catch {
    return undefined;
  }
}

type ReticulumDmExpiryPayload =
  | { valid: true; specified: false; durationMs: null }
  | { valid: true; specified: true; durationMs: number | null }
  | { valid: false; specified: true; durationMs: null };

export function directMessageExpiryFromPayload(
  payload: string
): ReticulumDmExpiryPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { valid: true, specified: false, durationMs: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: true, specified: false, durationMs: null };
  }
  const record = parsed as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'expiryDurationMs')) {
    return { valid: true, specified: false, durationMs: null };
  }
  if (typeof record.expiryDurationMs !== 'number') {
    return { valid: false, specified: true, durationMs: null };
  }
  const duration = record.expiryDurationMs;
  if (duration === 0) {
    return { valid: true, specified: true, durationMs: null };
  }
  if (
    !Number.isSafeInteger(duration) ||
    !RETICULUM_DM_ALLOWED_EXPIRY_MS.has(duration)
  ) {
    return { valid: false, specified: true, durationMs: null };
  }
  return { valid: true, specified: true, durationMs: duration };
}

function stripSearchHtml(text: string): string {
  return text
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeSearchText(text: string): string {
  return stripSearchHtml(text).replace(/\s+/g, ' ').trim().slice(0, 20_000);
}

function normalizeReticulumChannelWriteMode(
  value: unknown
): ReticulumGroupChannelWriteMode {
  return value === RETICULUM_CHAT_CHANNEL_WRITE_MODE_ADMINS
    ? RETICULUM_CHAT_CHANNEL_WRITE_MODE_ADMINS
    : RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS;
}

function normalizeReticulumChannelReadMode(
  value: unknown
): ReticulumGroupChannelReadMode {
  return value === RETICULUM_CHAT_CHANNEL_READ_MODE_ADMINS
    ? RETICULUM_CHAT_CHANNEL_READ_MODE_ADMINS
    : RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS;
}

function buildSearchTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((term) => term.toLowerCase())
    .map((term) => term.trim().replace(/[^a-z0-9_-]+/g, ''))
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

function buildFtsQuery(query: string): string {
  return buildSearchTerms(query)
    .map((term) => `"${term}"*`)
    .join(' AND ');
}

function normalizeSearchCursor(
  cursor: ReticulumChatSearchCursor | undefined
): ReticulumChatSearchCursor | null {
  if (!cursor || typeof cursor !== 'object') return null;
  const createdAt = Number(cursor.createdAt);
  const eventId =
    typeof cursor.eventId === 'string' ? cursor.eventId.trim() : '';
  if (!Number.isFinite(createdAt) || !eventId) return null;
  return { createdAt, eventId };
}

function isProjectionAfterSearchCursor(
  projection: MessageProjectionRow,
  cursor: ReticulumChatSearchCursor | null,
  sort: 'newest' | 'oldest'
): boolean {
  if (!cursor) return true;
  if (sort === 'oldest') {
    return (
      projection.created_at > cursor.createdAt ||
      (projection.created_at === cursor.createdAt &&
        projection.root_event_id > cursor.eventId)
    );
  }
  return (
    projection.created_at < cursor.createdAt ||
    (projection.created_at === cursor.createdAt &&
      projection.root_event_id < cursor.eventId)
  );
}

function searchCursorFromProjection(
  projection: MessageProjectionRow
): ReticulumChatSearchCursor {
  return {
    createdAt: projection.created_at,
    eventId: projection.root_event_id,
  };
}

function buildPlainSnippet(text: string, terms: string[]): string {
  const normalized = normalizeSearchText(text);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  const firstMatch =
    terms
      .map((term) => lower.indexOf(term))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 48);
  const end = Math.min(normalized.length, firstMatch + 160);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${
    end < normalized.length ? '...' : ''
  }`;
}

/**
 * ReticulumChatDatabase.memoryEvents: every event stored this session, also
 * indexed by group. Chat summaries asked once per group for that group's
 * events, which walked the whole session (groups x events per refresh, tens
 * of ms on a phone after a busy hour). set/delete/clear keep the index, so no
 * call site can miss it; a group's events come back in the map's own order.
 */
class ReticulumChatMemoryEvents extends Map<string, ReticulumChatEvent> {
  private readonly eventIdsByGroup = new Map<number, Set<string>>();

  set(eventId: string, event: ReticulumChatEvent): this {
    const previous = this.get(eventId);
    super.set(eventId, event);
    if (previous && previous.groupId !== event.groupId) {
      // Event ids hash the signed fields, group included, so this does not
      // happen; if it did, the moved id keeps its first insertion position.
      this.dropFromGroup(previous.groupId, eventId);
      this.rebuildGroup(event.groupId);
      return this;
    }
    let ids = this.eventIdsByGroup.get(event.groupId);
    if (!ids) {
      ids = new Set();
      this.eventIdsByGroup.set(event.groupId, ids);
    }
    ids.add(eventId);
    return this;
  }

  delete(eventId: string): boolean {
    const previous = this.get(eventId);
    if (!super.delete(eventId)) return false;
    if (previous) this.dropFromGroup(previous.groupId, eventId);
    return true;
  }

  clear(): void {
    super.clear();
    this.eventIdsByGroup.clear();
  }

  /** The group's events, in insertion order (as values() would list them). */
  eventsInGroup(groupId: number): ReticulumChatEvent[] {
    const ids = this.eventIdsByGroup.get(groupId);
    if (!ids) return [];
    const events: ReticulumChatEvent[] = [];
    for (const eventId of ids) {
      const event = this.get(eventId);
      if (event) events.push(event);
    }
    return events;
  }

  /** Groups with at least one event in the map. */
  groupIds(): IterableIterator<number> {
    return this.eventIdsByGroup.keys();
  }

  private dropFromGroup(groupId: number, eventId: string): void {
    const ids = this.eventIdsByGroup.get(groupId);
    if (!ids) return;
    ids.delete(eventId);
    if (ids.size === 0) this.eventIdsByGroup.delete(groupId);
  }

  private rebuildGroup(groupId: number): void {
    const ids = new Set<string>();
    for (const [eventId, event] of this) {
      if (event.groupId === groupId) ids.add(eventId);
    }
    this.eventIdsByGroup.set(groupId, ids);
  }
}

export class ReticulumChatDatabase {
  private static sharedRelayCaches = new Map<
    string,
    Map<string, ReticulumChatRelayCacheEntry>
  >();
  private static activeSequenceLeaseOwners = new Set<string>();
  private readonly sequenceLeaseOwnerId = nodeCrypto
    .randomBytes(16)
    .toString('hex');
  private db: DB;
  private readonly relayCacheKey: string;
  private memoryEvents = new ReticulumChatMemoryEvents();
  private memoryGroupKeys = new Map<string, ReticulumChatGroupKey>();
  private memoryGroupKeyDigests = new Map<
    string,
    ReticulumChatGroupKeyDigest
  >();
  private memoryGroupKeyRequests = new Map<
    string,
    ReticulumChatGroupKeyRequest
  >();
  private memorySearchText = new Map<string, string>();
  private memoryScrubbedEvents = new Set<string>();
  private memoryScrubbedEventOverrides = new Map<string, ReticulumChatEvent>();
  private memoryMissingRanges = new Map<
    string,
    ReticulumChatMissingRangeState
  >();
  /** Modifying statements issued against rchat_missing_stream_ranges since open. */
  private missingRangeWrites = 0;
  private memoryChannels = new Map<string, ReticulumGroupChannel>();
  private memoryCategories = new Map<string, ReticulumGroupCategory>();
  private memoryMentions = new Map<
    string,
    Array<{
      groupId: number;
      mentionedAddress: string;
      channelId: string;
      authorAddress: string;
      timestamp: number;
      readAt: number;
    }>
  >();
  private memoryReadWatermarks = new Map<string, number>();
  private channelSummaryCache = new Map<
    string,
    CachedReticulumChannelSummary
  >();
  private memoryRelayCache: Map<string, ReticulumChatRelayCacheEntry>;
  private generalChannelExpiryPolicyAppliedAt = 0;
  private lastExpiryPruneAt = 0;
  private lastDirectExpiryPruneAt = 0;
  private memoryMeta = new Map<
    string,
    {
      ownEvent: boolean;
      lastServedAt: number;
      storedAt: number;
      wireBytes: number;
      expiresAt: number | null;
      messageExpiryDurationMs?: number;
    }
  >();
  private stmtInsertEvent: Statement;
  private stmtInsertEventHeaderV2: Statement;
  private stmtGetEvent: Statement;
  private stmtHasEvent: Statement;
  private stmtIsEventScrubbed: Statement;
  private stmtGetRecentEvents: Statement;
  private stmtGetRecentMessageEvents: Statement;
  private stmtGetRecentMessageEventsAllChannels: Statement;
  private stmtUpsertMessageProjection: Statement;
  private stmtGetMessageProjection: Statement;
  private stmtGetMessageProjectionEvents: Statement;
  private stmtDeleteMessageProjection: Statement;
  private stmtGetChannelMetadataEvents: Statement;
  private stmtGetChannelMetadataPageAfter: Statement;
  private stmtGetChannelMetadataPageBefore: Statement;
  private stmtGetChannelMetadataPageAtOrBefore: Statement;
  private stmtGetEventsAfter: Statement;
  private stmtGetEventsAfterCursor: Statement;
  private stmtGetEventsBefore: Statement;
  private stmtGetEventsBeforeCursor: Statement;
  private stmtGetGroupEventsAfter: Statement;
  private stmtGetGroupEventsAfterCursor: Statement;
  private stmtGetGroupEventsBeforeCursor: Statement;
  private stmtGetGroupEventsAtOrBeforeCursor: Statement;
  private stmtGetAuthorMaxSeq: Statement;
  private stmtGetAuthorEventsAfter: Statement;
  private stmtGetAuthorHeads: Statement;
  private stmtGetAllAuthorSequenceHeads: Statement;
  private stmtGetAuthorSequenceGaps: Statement;
  private stmtGetMissingByAuthor: Statement;
  private stmtGetGroupSeqs: Statement;
  private stmtGetKnownGroups: Statement;
  private stmtHasGroupEvents: Statement;
  private stmtGetKnownChannels: Statement;
  private stmtGetKnownMessageChannels: Statement;
  private stmtGetLastDisplayEvent: Statement;
  private stmtCountUnreadDisplayEvents: Statement;
  private stmtGetLastProjectedMessage: Statement;
  private stmtGetCurrentProjectedEventId: Statement;
  private stmtGetUnreadMentionTargetEvents: Statement;
  private stmtGetPrivilegedMentionStatus: Statement;
  private stmtUpdatePrivilegedMentionStatus: Statement;
  private stmtGetWatermark: Statement;
  private stmtGetDirectWatermark: Statement;
  private stmtUpsertWatermark: Statement;
  private stmtUpsertMention: Statement;
  private stmtDeleteMentionsForEvent: Statement;
  private stmtGetUnreadMentionRecords: Statement;
  private stmtGetUnreadReplyRecords: Statement;
  private stmtGetNextMessageExpiry: Statement;
  private stmtMarkMentionsRead: Statement;
  private stmtMarkServed: Statement;
  private stmtTotalCacheBytes: Statement;
  private stmtEvictCandidate: Statement;
  private stmtDeleteEvent: Statement;
  private stmtGetRelayEventsForGroup: Statement;
  private stmtGetDeleteEvents: Statement;
  private stmtUpdateScrubbedEvent: Statement;
  private stmtInsertScrubbedEvent: Statement;
  private stmtUpsertSearchMirror: Statement;
  private stmtDeleteSearchMirror: Statement;
  private stmtGetSearchMirrorRow: Statement;
  private stmtGetMentionRows: Statement;
  /** See getIndexWriteStats. */
  private readonly indexWriteStats = {
    searchWritten: 0,
    searchUnchanged: 0,
    searchNoMirror: 0,
    mentionsWritten: 0,
    mentionsUnchanged: 0,
    ftsCheck: {
      state: 'unchecked' as 'unchecked' | 'trusted' | 'untrusted',
      mirrorRows: null as number | null,
      ftsRows: null as number | null,
      rebuilt: false,
    },
  };
  // ensureSearchFtsMatchesMirror's check, waiting for the end of the
  // transaction that first needed it.
  private ftsCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private stmtSearchMirror: Statement;
  private stmtUpsertSearchText: Statement;
  private stmtDeleteSearchText: Statement;
  private stmtUpsertChannel: Statement;
  private stmtGetChannels: Statement;
  private stmtGetChannel: Statement;
  private stmtUpsertCategory: Statement;
  private stmtGetCategories: Statement;
  private stmtGetCategory: Statement;
  private stmtDeleteCategory: Statement;
  private stmtDeleteChannel: Statement;
  private stmtClearChannelCategory: Statement;
  private stmtGetLatestCursor: Statement;
  private stmtGetOldestCursor: Statement;
  private stmtGetChannelDigests: Statement;
  private stmtGetFeedPageAfter: Statement;
  private stmtGetFeedPageBefore: Statement;
  private stmtGetFeedPageAtOrBefore: Statement;
  private stmtGetAuthorEventsRange: Statement;
  private stmtUpsertPeerGroupState: Statement;
  private stmtUpsertPeerChannelState: Statement;
  private stmtUpsertVerifiedWindow: Statement;
  private stmtUpsertMissingRange: Statement;
  private stmtEnsureMissingRange: Statement;
  private stmtGetMissingRangeExact: Statement;
  private stmtGetMissingRangeOverlaps: Statement;
  private stmtUpdateMissingRangeAttempt: Statement;
  private stmtUpdateMissingRangeBackoff: Statement;
  private stmtRescheduleMissingRangeAny: Statement;
  private stmtRescheduleMissingRange: Statement;
  private stmtGetMissingRangesForSeq: Statement;
  private stmtGetAllMissingRanges: Statement;
  private stmtGetReadyMissingRanges: Statement;
  private stmtGetBackgroundMissingRangeCandidates: Statement;
  private stmtGetNextMissingRangeAttemptsByGroup: Statement;
  // Diagnostics only (Copy diagnostics): prepared on first use.
  private stmtCountMissingRangeStates: Statement | null = null;
  private stmtCountMissingRangeTopGroups: Statement | null = null;
  /** Copy diagnostics only (gapOutcomeAges); prepared on first use. */
  private stmtGetAuthorSeqTimestamp: Statement | null = null;
  /** Copy diagnostics: event and search row counts, read once per open. */
  private storageRowCounts: {
    events: number | null;
    searchRows: number | null;
    countedAt: number;
  } | null = null;
  // GO only (mobileProfile recentGapsFirst / gapDenialBackoff / refunds):
  // prepared on first use, so desktop never prepares or runs them.
  private stmtGetBackgroundMissingRangeCandidatesRecentFirst: Statement | null =
    null;
  private stmtBumpMissingRangeDenialStreak: Statement | null = null;
  private stmtGetMissingRangeDenialStreak: Statement | null = null;
  private stmtGetMissingRangeLastUnavailableAt: Statement | null = null;
  /** observedAt of the last global peer-observation prune (0 = never). */
  private missingRangeObservationPrunedAt = 0;
  // GO only (mobileProfile authorGapAgeAware): the old-row asked list lives
  // in its own table, created on first use, so desktop never creates it.
  private oldGapAskSchemaReady = false;
  private stmtGetMissingRangeNeighbourTimestamp: Statement | null = null;
  private stmtGetOldGapAsksCovering: Statement | null = null;
  private stmtGetOldGapAskExact: Statement | null = null;
  private stmtUpsertOldGapAsk: Statement | null = null;
  private stmtClearOldGapAsksForGroup: Statement | null = null;
  /** now of the last old-gap asked-list prune (0 = never). */
  private oldGapAskPrunedAt = 0;
  private stmtGetPresentSeqsInRange: Statement;
  private stmtPruneMissingRangePeerUnavailable: Statement;
  private stmtUpsertMissingRangePeerUnavailable: Statement;
  private stmtCountMissingRangePeerUnavailable: Statement;
  private stmtGetMissingRangePeerUnavailable: Statement;
  private stmtClearMissingRangePeerUnavailable: Statement;
  private stmtUpsertKnownUnavailableRange: Statement;
  private stmtParkKnownUnavailableRange: Statement;
  private stmtGetKnownUnavailableRange: Statement;
  private stmtGetKnownUnavailableRangesForGroup: Statement;
  private stmtWakeKnownUnavailableRangesForGroup: Statement;
  private stmtClearKnownUnavailableRange: Statement;
  private stmtClearKnownUnavailableRangesForGroup: Statement;
  private stmtPruneKnownUnavailableRanges: Statement;
  private stmtDeleteMissingRange: Statement;
  private stmtInsertMissingRangeRaw: Statement;
  private stmtGetRejectedEventMarker: Statement;
  private stmtHasRejectedDigestMarker: Statement;
  private stmtGetRejectedAuthorSeqs: Statement;
  private stmtUpsertRejectedEventMarker: Statement;
  private stmtDeleteRejectedEventMarker: Statement;
  private stmtUpsertRejectedDigestMarker: Statement;
  private stmtDeleteRejectedDigestMarkers: Statement;
  private stmtInsertRelayBlob: Statement;
  private stmtGetRelayBlobByEvent: Statement;
  private stmtListRelayDigestEntries: Statement;
  private stmtMarkRelayBlobServed: Statement;
  private stmtDeleteRelayExpired: Statement;
  private stmtTotalRelayBytes: Statement;
  private stmtRelayEvictCandidate: Statement;
  private stmtDeleteRelayBlob: Statement;
  private stmtDeleteRelayByEvent: Statement;
  private stmtUpsertGroupKey: Statement;
  private stmtGetActiveGroupKey: Statement;
  private stmtGetGroupKey: Statement;
  private stmtUpsertGroupKeyDigest: Statement;
  private stmtGetLatestGroupKeyDigest: Statement;
  private stmtListGroupKeyDigests: Statement;
  private stmtUpsertGroupKeyRequest: Statement;
  private stmtGetPendingGroupKeyRequests: Statement;
  private stmtMarkGroupKeyRequestStatus: Statement;
  private stmtUpsertMetadataSnapshot: Statement;
  private stmtGetLatestMetadataSnapshot: Statement;
  private stmtGetMetadataSnapshotByHash: Statement;
  private stmtGetGroupDigestRevision: Statement;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.relayCacheKey = path.resolve(dbPath);
    const sharedRelayCache = ReticulumChatDatabase.sharedRelayCaches.get(
      this.relayCacheKey
    );
    this.memoryRelayCache =
      sharedRelayCache ?? new Map<string, ReticulumChatRelayCacheEntry>();
    if (!sharedRelayCache) {
      ReticulumChatDatabase.sharedRelayCaches.set(
        this.relayCacheKey,
        this.memoryRelayCache
      );
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.initSchema();
    this.runSchemaMigrations();
    this.verifyRequiredSchema();
    this.pruneStaleAuthorSequenceLeases();
    ReticulumChatDatabase.activeSequenceLeaseOwners.add(
      this.sequenceLeaseOwnerId
    );

    this.stmtInsertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO reticulum_chat_events
        (event_id, group_id, author_address, author_public_key, author_stream_id, author_seq,
         timestamp, feed_timestamp, event_type, target_event_id, reply_to_event_id,
         encrypted_payload, payload_hash, mention_address_hashes, mention_targets, signature, own_event,
         last_served_at, stored_at, accepted_at, wire_bytes, channel_id, expires_at,
         message_expiry_duration_ms, privileged_mention_status)
      VALUES
        (@event_id, @group_id, @author_address, @author_public_key, @author_stream_id, @author_seq,
         @timestamp, @feed_timestamp, @event_type, @target_event_id, @reply_to_event_id,
         @encrypted_payload, @payload_hash, @mention_address_hashes, @mention_targets, @signature, @own_event,
         @last_served_at, @stored_at, @accepted_at, @wire_bytes, @channel_id, @expires_at,
         @message_expiry_duration_ms, @privileged_mention_status)
    `);
    this.stmtGetGroupDigestRevision = this.db.prepare(`
      SELECT revision
      FROM rchat_group_digest_revisions
      WHERE group_id = ?
    `);
    this.stmtInsertEventHeaderV2 = this.db.prepare(`
      INSERT OR IGNORE INTO rchat_event_headers
        (event_id, group_id, channel_id, author_address, author_public_key,
         author_stream_id, author_seq, timestamp, feed_timestamp, event_type, target_event_id,
         reply_to_event_id, payload_hash, mention_address_hashes, mention_targets,
         signature, own_event, last_served_at, stored_at, accepted_at, wire_bytes,
         retention_state, scrubbed_at, expires_at, message_expiry_duration_ms)
      VALUES
        (@event_id, @group_id, @channel_id, @author_address, @author_public_key,
         @author_stream_id, @author_seq, @timestamp, @feed_timestamp, @event_type, @target_event_id,
         @reply_to_event_id, @payload_hash, @mention_address_hashes, @mention_targets,
         @signature, @own_event, @last_served_at, @stored_at, @accepted_at, @wire_bytes,
         @retention_state, @scrubbed_at, @expires_at, @message_expiry_duration_ms)
    `);
    this.stmtGetEvent = this.db.prepare(
      `SELECT * FROM reticulum_chat_events WHERE event_id = ? AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL} LIMIT 1`
    );
    this.stmtHasEvent = this.db.prepare(
      'SELECT 1 FROM reticulum_chat_events WHERE event_id = ? LIMIT 1'
    );
    this.stmtIsEventScrubbed = this.db.prepare(
      'SELECT event_type, target_event_id, scrubbed_at, encrypted_payload FROM reticulum_chat_events WHERE event_id = ? LIMIT 1'
    );
    this.stmtGetRecentEvents = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ? AND channel_id = ?
          AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY timestamp ASC, event_id ASC
    `);
    this.stmtGetRecentMessageEvents = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM rchat_message_projection
        WHERE group_id = ? AND channel_id = ? AND deleted_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC, root_event_id DESC
        LIMIT ?
      )
      ORDER BY created_at ASC, root_event_id ASC
    `);
    this.stmtGetRecentMessageEventsAllChannels = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM rchat_message_projection
        WHERE group_id = ? AND deleted_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC, root_event_id DESC
        LIMIT ?
      )
      ORDER BY created_at ASC, root_event_id ASC
    `);
    this.stmtUpsertMessageProjection = this.db.prepare(`
      INSERT INTO rchat_message_projection
        (root_event_id, group_id, channel_id, author_address, author_public_key,
         author_stream_id, author_seq, created_at, root_event_type, current_event_id, updated_at,
         reply_to_event_id, encrypted_payload, payload_hash,
         mention_address_hashes, mention_targets, signature, deleted_at,
         deleted_event_id, expires_at, has_attachment)
      VALUES
        (@root_event_id, @group_id, @channel_id, @author_address, @author_public_key,
         @author_stream_id, @author_seq, @created_at, @root_event_type, @current_event_id, @updated_at,
         @reply_to_event_id, @encrypted_payload, @payload_hash,
         @mention_address_hashes, @mention_targets, @signature, @deleted_at,
         @deleted_event_id, @expires_at, @has_attachment)
      ON CONFLICT(root_event_id) DO UPDATE SET
        group_id = excluded.group_id,
        channel_id = excluded.channel_id,
        author_address = excluded.author_address,
        author_public_key = excluded.author_public_key,
        author_stream_id = excluded.author_stream_id,
        author_seq = excluded.author_seq,
        created_at = excluded.created_at,
        root_event_type = excluded.root_event_type,
        current_event_id = excluded.current_event_id,
        updated_at = excluded.updated_at,
        reply_to_event_id = excluded.reply_to_event_id,
        encrypted_payload = excluded.encrypted_payload,
        payload_hash = excluded.payload_hash,
        mention_address_hashes = excluded.mention_address_hashes,
        mention_targets = excluded.mention_targets,
        signature = excluded.signature,
        deleted_at = excluded.deleted_at,
        deleted_event_id = excluded.deleted_event_id,
        expires_at = excluded.expires_at,
        has_attachment = excluded.has_attachment
    `);
    this.stmtGetMessageProjection = this.db.prepare(
      'SELECT * FROM rchat_message_projection WHERE root_event_id = ? LIMIT 1'
    );
    this.stmtGetMessageProjectionEvents = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE event_id = ? OR target_event_id = ?
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtDeleteMessageProjection = this.db.prepare(
      'DELETE FROM rchat_message_projection WHERE root_event_id = ?'
    );
    this.stmtGetChannelMetadataEvents = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ?
          AND event_type IN (
            'channel_create',
            'channel_update',
            'channel_archive',
            'channel_restore',
            'channel_reorder',
            'category_create',
            'category_update',
            'category_delete'
          )
        ORDER BY timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY timestamp ASC, event_id ASC
    `);
    this.stmtGetChannelMetadataPageAfter = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ?
        AND event_type IN (
          'channel_create',
          'channel_update',
          'channel_archive',
          'channel_restore',
          'channel_reorder',
          'category_create',
          'category_update',
          'category_delete'
        )
        AND (feed_timestamp > ? OR (feed_timestamp = ? AND event_id > ?))
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetChannelMetadataPageBefore = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ?
          AND event_type IN (
            'channel_create',
            'channel_update',
            'channel_archive',
            'channel_restore',
            'channel_reorder',
            'category_create',
            'category_update',
            'category_delete'
          )
          AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id < ?))
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetChannelMetadataPageAtOrBefore = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ?
          AND event_type IN (
            'channel_create',
            'channel_update',
            'channel_archive',
            'channel_restore',
            'channel_reorder',
            'category_create',
            'category_update',
            'category_delete'
          )
          AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id <= ?))
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetEventsAfter = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ? AND feed_timestamp > ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetEventsAfterCursor = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ? AND (feed_timestamp > ? OR (feed_timestamp = ? AND event_id > ?))
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetEventsBefore = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ? AND feed_timestamp < ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetEventsBeforeCursor = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ? AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id < ?))
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetGroupEventsAfter = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND feed_timestamp > ?
        AND scrubbed_at IS NULL
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetGroupEventsAfterCursor = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND (feed_timestamp > ? OR (feed_timestamp = ? AND event_id > ?))
        AND scrubbed_at IS NULL
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetGroupEventsBeforeCursor = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ? AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id < ?))
          AND scrubbed_at IS NULL
          AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetGroupEventsAtOrBeforeCursor = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ? AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id <= ?))
          AND scrubbed_at IS NULL
          AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetAuthorMaxSeq = this.db.prepare(`
      SELECT MAX(author_seq) AS seq
      FROM (
        SELECT author_seq
        FROM rchat_event_headers
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        UNION ALL
        SELECT author_seq
        FROM rchat_expired_event_markers
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
      )
    `);
    this.stmtGetAuthorEventsAfter = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ? AND author_seq > ?
      ORDER BY author_seq ASC, timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetAuthorHeads = this.db.prepare(`
      WITH known_events AS (
        SELECT event_id, author_address, author_stream_id, author_seq, timestamp
        FROM rchat_event_headers
        WHERE group_id = ?
        UNION ALL
        SELECT event_id, author_address, author_stream_id, author_seq, timestamp
        FROM rchat_expired_event_markers
        WHERE group_id = ?
      )
      SELECT e.author_address, e.author_stream_id, e.author_seq AS max_seq, e.event_id, e.timestamp
      FROM known_events e
      JOIN (
        SELECT author_address, author_stream_id, MAX(author_seq) AS max_seq
        FROM known_events
        GROUP BY author_address, author_stream_id
      ) h ON h.author_address = e.author_address
        AND h.author_stream_id = e.author_stream_id
        AND h.max_seq = e.author_seq
      ORDER BY e.timestamp DESC, e.event_id DESC
      LIMIT ?
      OFFSET ?
    `);
    this.stmtGetAllAuthorSequenceHeads = this.db.prepare(`
      SELECT author_address, author_stream_id, MAX(author_seq) AS max_seq
      FROM (
        SELECT author_address, author_stream_id, author_seq
        FROM rchat_event_headers
        WHERE group_id = ?
        UNION ALL
        SELECT author_address, author_stream_id, author_seq
        FROM rchat_expired_event_markers
        WHERE group_id = ?
      )
      GROUP BY author_address, author_stream_id
      ORDER BY author_address ASC, author_stream_id ASC
    `);
    this.stmtGetAuthorSequenceGaps = this.db.prepare(`
      WITH ordered AS (
        SELECT author_address,
               author_stream_id,
               author_seq,
               LAG(author_seq) OVER (
                 PARTITION BY author_address, author_stream_id
                 ORDER BY author_seq ASC
               ) AS previous_seq
        FROM (
          SELECT author_address, author_stream_id, author_seq
          FROM rchat_event_headers
          WHERE group_id = ?
          UNION ALL
          SELECT author_address, author_stream_id, author_seq
          FROM rchat_expired_event_markers
          WHERE group_id = ?
        )
      )
      SELECT author_address,
             author_stream_id,
             previous_seq + 1 AS from_seq,
             author_seq - 1 AS to_seq
      FROM ordered
      WHERE previous_seq IS NOT NULL
        AND author_seq > previous_seq + 1
      ORDER BY to_seq DESC, author_address ASC, from_seq DESC
      LIMIT ?
    `);
    this.stmtGetMissingByAuthor = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ? AND author_seq > ?
      ORDER BY author_seq ASC
      LIMIT ?
    `);
    this.stmtGetGroupSeqs = this.db.prepare(`
      SELECT author_address, author_stream_id, MAX(author_seq) AS seq
      FROM (
        SELECT author_address, author_stream_id, author_seq
        FROM rchat_event_headers
        WHERE group_id = ?
        UNION ALL
        SELECT author_address, author_stream_id, author_seq
        FROM rchat_expired_event_markers
        WHERE group_id = ?
      )
      GROUP BY author_address, author_stream_id
    `);
    this.stmtGetKnownGroups = this.db.prepare(`
      SELECT DISTINCT group_id FROM reticulum_chat_events
      ORDER BY group_id ASC
    `);
    this.stmtHasGroupEvents = this.db.prepare(`
      SELECT 1 FROM reticulum_chat_events WHERE group_id = ? LIMIT 1
    `);
    this.stmtGetKnownChannels = this.db.prepare(`
      SELECT DISTINCT channel_id FROM reticulum_chat_events
      WHERE group_id = ?
      ORDER BY channel_id ASC
    `);
    this.stmtGetKnownMessageChannels = this.db.prepare(`
      SELECT DISTINCT channel_id FROM rchat_message_projection
      WHERE group_id = ? AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY channel_id ASC
    `);
    this.stmtGetLastDisplayEvent = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ? AND event_type IN ('message', 'attachment_manifest')
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY timestamp DESC, event_id DESC
      LIMIT 1
    `);
    this.stmtCountUnreadDisplayEvents = this.db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM reticulum_chat_events
      WHERE group_id = ?
        AND channel_id = ?
        AND event_type IN ('message', 'attachment_manifest')
        AND timestamp > ?
        AND author_address != ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
    `);
    this.stmtGetLastProjectedMessage = this.db.prepare(`
      SELECT * FROM rchat_message_projection
      WHERE group_id = ? AND channel_id = ? AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC, root_event_id DESC
      LIMIT 1
    `);
    this.stmtGetCurrentProjectedEventId = this.db.prepare(
      'SELECT current_event_id AS event_id FROM rchat_message_projection WHERE root_event_id = ? LIMIT 1'
    );
    this.stmtGetUnreadMentionTargetEvents = this.db.prepare(`
      SELECT *
      FROM reticulum_chat_events
      WHERE group_id = ?
        AND channel_id = ?
        AND timestamp > ?
        AND author_address != ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        AND (
          mention_targets != '[]'
          OR event_type IN ('edit', 'delete')
        )
      ORDER BY timestamp ASC, event_id ASC
    `);
    this.stmtGetPrivilegedMentionStatus = this.db.prepare(
      'SELECT privileged_mention_status AS status FROM reticulum_chat_events WHERE event_id = ? LIMIT 1'
    );
    this.stmtUpdatePrivilegedMentionStatus = this.db.prepare(
      'UPDATE reticulum_chat_events SET privileged_mention_status = ? WHERE event_id = ?'
    );
    this.stmtGetWatermark = this.db.prepare(
      'SELECT timestamp FROM reticulum_chat_read_watermarks WHERE group_id = ? AND channel_id = ? AND address = ?'
    );
    this.stmtGetDirectWatermark = this.db.prepare(
      'SELECT timestamp FROM rchat_dm_read_watermarks WHERE conversation_id = ? AND address = ?'
    );
    this.stmtUpsertWatermark = this.db.prepare(`
      INSERT INTO reticulum_chat_read_watermarks (group_id, channel_id, address, timestamp)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id, channel_id, address) DO UPDATE SET timestamp = excluded.timestamp
    `);
    this.stmtUpsertMention = this.db.prepare(`
      INSERT INTO reticulum_chat_mentions
        (event_id, group_id, channel_id, mentioned_address, author_address, timestamp, read_at)
      VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(event_id, mentioned_address) DO UPDATE SET
        group_id = excluded.group_id,
        author_address = excluded.author_address,
        timestamp = excluded.timestamp
    `);
    this.stmtDeleteMentionsForEvent = this.db.prepare(
      'DELETE FROM reticulum_chat_mentions WHERE event_id = ?'
    );
    this.stmtGetUnreadMentionRecords = this.db.prepare(`
      SELECT
        mention.event_id,
        mention.author_address,
        mention.timestamp,
        projection.author_address AS projection_author_address,
        projection.mention_address_hashes,
        projection.mention_targets,
        projection.encrypted_payload,
        current_event.privileged_mention_status
      FROM reticulum_chat_mentions AS mention
      JOIN rchat_message_projection AS projection
        ON projection.root_event_id = mention.event_id
      JOIN reticulum_chat_events AS current_event
        ON current_event.event_id = projection.current_event_id
      WHERE mention.group_id = ?
        AND mention.channel_id = ?
        AND mention.mentioned_address = ?
        AND mention.author_address != ?
        AND mention.timestamp > ?
        AND mention.read_at = 0
        AND projection.mention_address_hashes LIKE ?
        AND projection.deleted_at IS NULL
        AND (projection.expires_at IS NULL OR projection.expires_at > ?)
    `);
    this.stmtGetUnreadReplyRecords = this.db.prepare(`
      SELECT
        reply.root_event_id,
        reply.author_address,
        reply.created_at
      FROM rchat_message_projection AS reply
      JOIN rchat_message_projection AS parent
        ON parent.root_event_id = reply.reply_to_event_id
       AND parent.group_id = reply.group_id
       AND parent.channel_id = reply.channel_id
      WHERE reply.group_id = ?
        AND reply.channel_id = ?
        AND reply.created_at > ?
        AND reply.author_address != ?
        AND parent.author_address = ?
        AND reply.deleted_at IS NULL
        AND (reply.expires_at IS NULL OR reply.expires_at > ?)
        AND parent.deleted_at IS NULL
        AND (parent.expires_at IS NULL OR parent.expires_at > ?)
    `);
    this.stmtGetNextMessageExpiry = this.db.prepare(`
      SELECT MIN(expires_at) AS expires_at
      FROM reticulum_chat_events
      WHERE group_id = ?
        AND channel_id = ?
        AND event_type IN ('message', 'attachment_manifest')
        AND expires_at IS NOT NULL
        AND expires_at > ?
    `);
    this.stmtMarkMentionsRead = this.db.prepare(`
      UPDATE reticulum_chat_mentions
      SET read_at = ?
      WHERE group_id = ?
        AND channel_id = ?
        AND mentioned_address = ?
        AND timestamp <= ?
        AND read_at = 0
    `);
    this.stmtMarkServed = this.db.prepare(
      'UPDATE reticulum_chat_events SET last_served_at = ? WHERE event_id = ?'
    );
    this.stmtTotalCacheBytes = this.db.prepare(`
      SELECT COALESCE(SUM(wire_bytes), 0) AS total
      FROM reticulum_chat_events
      WHERE own_event = 0
    `);
    this.stmtEvictCandidate = this.db.prepare(`
      SELECT event_id FROM reticulum_chat_events
      WHERE own_event = 0
      ORDER BY last_served_at ASC, timestamp ASC, stored_at ASC
      LIMIT 1
    `);
    this.stmtDeleteEvent = this.db.prepare(
      'DELETE FROM reticulum_chat_events WHERE event_id = ?'
    );
    this.stmtUpsertSearchMirror = this.db.prepare(`
      INSERT INTO reticulum_chat_search_index
        (event_id, group_id, channel_id, author_address, timestamp, event_type, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        group_id = excluded.group_id,
        channel_id = excluded.channel_id,
        author_address = excluded.author_address,
        timestamp = excluded.timestamp,
        event_type = excluded.event_type,
        search_text = excluded.search_text
    `);
    this.stmtSearchMirror = this.db.prepare(`
      SELECT event_id, search_text
      FROM reticulum_chat_search_index
      WHERE lower(search_text) LIKE ?
      ORDER BY timestamp DESC, event_id DESC
      LIMIT ?
    `);
    this.stmtDeleteSearchMirror = this.db.prepare(
      'DELETE FROM reticulum_chat_search_index WHERE event_id = ?'
    );
    this.stmtGetSearchMirrorRow = this.db.prepare(`
      SELECT group_id, channel_id, author_address, timestamp, event_type, search_text
      FROM reticulum_chat_search_index
      WHERE event_id = ?
    `);
    this.stmtGetMentionRows = this.db.prepare(`
      SELECT group_id, channel_id, mentioned_address, author_address, timestamp, read_at
      FROM reticulum_chat_mentions
      WHERE event_id = ?
    `);
    this.stmtUpsertSearchText = this.db.prepare(`
      INSERT INTO reticulum_chat_search_fts
        (event_id, group_id, channel_id, author_address, timestamp, event_type, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtDeleteSearchText = this.db.prepare(
      'DELETE FROM reticulum_chat_search_fts WHERE event_id = ?'
    );
    this.stmtUpsertChannel = this.db.prepare(`
      INSERT OR REPLACE INTO reticulum_chat_channels
        (group_id, channel_id, category_id, name, description, position, archived, write_mode, read_mode, write_mode_updated_at, expiry_duration_ms, created_by, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetChannels = this.db.prepare(`
      SELECT * FROM reticulum_chat_channels
      WHERE group_id = ?
      ORDER BY position ASC, name ASC, channel_id ASC
    `);
    this.stmtGetChannel = this.db.prepare(`
      SELECT * FROM reticulum_chat_channels
      WHERE group_id = ? AND channel_id = ?
      LIMIT 1
    `);
    this.stmtUpsertCategory = this.db.prepare(`
      INSERT OR REPLACE INTO reticulum_chat_categories
        (group_id, category_id, name, position, created_by, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetCategories = this.db.prepare(`
      SELECT * FROM reticulum_chat_categories
      WHERE group_id = ?
      ORDER BY position ASC, name ASC, category_id ASC
    `);
    this.stmtGetCategory = this.db.prepare(`
      SELECT * FROM reticulum_chat_categories
      WHERE group_id = ? AND category_id = ?
      LIMIT 1
    `);
    this.stmtUpsertMetadataSnapshot = this.db.prepare(`
      INSERT OR REPLACE INTO rchat_metadata_snapshots
        (group_id, snapshot_id, scope, parent_snapshot_hash, version, created_at, latest_event_id,
         latest_feed_timestamp, snapshot_hash, admin_address, admin_public_key,
         signature, channels_json, categories_json, revisions_json)
      VALUES
        (@group_id, @snapshot_id, @scope, @parent_snapshot_hash, @version, @created_at, @latest_event_id,
         @latest_feed_timestamp, @snapshot_hash, @admin_address, @admin_public_key,
         @signature, @channels_json, @categories_json, @revisions_json)
    `);
    this.stmtGetLatestMetadataSnapshot = this.db.prepare(`
      SELECT * FROM rchat_metadata_snapshots
      WHERE group_id = ?
      ORDER BY version DESC, created_at DESC, snapshot_hash DESC
      LIMIT 1
    `);
    this.stmtGetMetadataSnapshotByHash = this.db.prepare(`
      SELECT * FROM rchat_metadata_snapshots
      WHERE group_id = ? AND snapshot_hash = ?
      LIMIT 1
    `);
    this.stmtDeleteCategory = this.db.prepare(
      'DELETE FROM reticulum_chat_categories WHERE group_id = ? AND category_id = ?'
    );
    this.stmtDeleteChannel = this.db.prepare(
      'DELETE FROM reticulum_chat_channels WHERE group_id = ? AND channel_id = ?'
    );
    this.stmtClearChannelCategory = this.db.prepare(
      'UPDATE reticulum_chat_channels SET category_id = NULL WHERE group_id = ? AND category_id = ?'
    );
    this.stmtGetLatestCursor = this.db.prepare(`
      SELECT event_id, feed_timestamp
      FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp DESC, event_id DESC
      LIMIT 1
    `);
    this.stmtGetOldestCursor = this.db.prepare(`
      SELECT event_id, feed_timestamp
      FROM reticulum_chat_events
      WHERE group_id = ? AND channel_id = ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT 1
    `);
    this.stmtGetChannelDigests = this.db.prepare(`
      SELECT channel_id,
             MIN(feed_timestamp) AS oldest_feed_timestamp,
             MAX(feed_timestamp) AS latest_feed_timestamp,
             COUNT(*) AS event_count
      FROM reticulum_chat_events
      WHERE group_id = ?
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      GROUP BY channel_id
      ORDER BY latest_feed_timestamp DESC, channel_id ASC
      LIMIT ?
      OFFSET ?
    `);
    this.stmtGetFeedPageAfter = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ?
        AND channel_id = ?
        AND scrubbed_at IS NULL
        AND (feed_timestamp > ? OR (feed_timestamp = ? AND event_id > ?))
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY feed_timestamp ASC, event_id ASC
      LIMIT ?
    `);
    this.stmtGetFeedPageBefore = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ?
          AND channel_id = ?
          AND scrubbed_at IS NULL
          AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id < ?))
          AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetFeedPageAtOrBefore = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ?
          AND channel_id = ?
          AND scrubbed_at IS NULL
          AND (feed_timestamp < ? OR (feed_timestamp = ? AND event_id <= ?))
          AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
        ORDER BY feed_timestamp DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY feed_timestamp ASC, event_id ASC
    `);
    this.stmtGetAuthorEventsRange = this.db.prepare(`
      SELECT * FROM reticulum_chat_events
      WHERE group_id = ?
        AND author_address = ?
        AND author_stream_id = ?
        AND author_seq >= ?
        AND author_seq <= ?
        AND scrubbed_at IS NULL
        AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
      ORDER BY author_seq DESC, feed_timestamp DESC, event_id DESC
      LIMIT ?
    `);
    this.stmtUpsertPeerGroupState = this.db.prepare(`
      INSERT INTO rchat_peer_group_state
        (peer_hash, group_id, latest_event_id, latest_feed_timestamp, digest_hash, updated_at)
      VALUES
        (@peer_hash, @group_id, @latest_event_id, @latest_feed_timestamp, @digest_hash, @updated_at)
      ON CONFLICT(peer_hash, group_id) DO UPDATE SET
        latest_event_id = excluded.latest_event_id,
        latest_feed_timestamp = excluded.latest_feed_timestamp,
        digest_hash = excluded.digest_hash,
        updated_at = excluded.updated_at
    `);
    this.stmtUpsertPeerChannelState = this.db.prepare(`
      INSERT INTO rchat_peer_channel_state
        (peer_hash, group_id, channel_id, latest_event_id, latest_feed_timestamp,
         oldest_event_id, oldest_feed_timestamp, visible_window_hash, updated_at)
      VALUES
        (@peer_hash, @group_id, @channel_id, @latest_event_id, @latest_feed_timestamp,
         @oldest_event_id, @oldest_feed_timestamp, @visible_window_hash, @updated_at)
      ON CONFLICT(peer_hash, group_id, channel_id) DO UPDATE SET
        latest_event_id = excluded.latest_event_id,
        latest_feed_timestamp = excluded.latest_feed_timestamp,
        oldest_event_id = excluded.oldest_event_id,
        oldest_feed_timestamp = excluded.oldest_feed_timestamp,
        visible_window_hash = excluded.visible_window_hash,
        updated_at = excluded.updated_at
    `);
    this.stmtUpsertVerifiedWindow = this.db.prepare(`
      INSERT INTO rchat_verified_windows
        (group_id, channel_id, start_event_id, start_feed_timestamp,
         end_event_id, end_feed_timestamp, window_hash, verified_at)
      VALUES
        (@group_id, @channel_id, @start_event_id, @start_feed_timestamp,
         @end_event_id, @end_feed_timestamp, @window_hash, @verified_at)
      ON CONFLICT(group_id, channel_id, start_event_id, end_event_id) DO UPDATE SET
        start_feed_timestamp = excluded.start_feed_timestamp,
        end_feed_timestamp = excluded.end_feed_timestamp,
        window_hash = excluded.window_hash,
        verified_at = excluded.verified_at
    `);
    this.stmtUpsertMissingRange = this.db.prepare(`
      INSERT INTO rchat_missing_stream_ranges
        (group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at)
      VALUES
        (@group_id, @author_address, @author_stream_id, @from_seq, @to_seq, @preferred_peer, 0, @next_attempt_at)
      ON CONFLICT(group_id, author_address, author_stream_id, from_seq, to_seq) DO UPDATE SET
        preferred_peer = CASE
          WHEN EXISTS (
            SELECT 1 FROM rchat_known_unavailable_ranges unavailable
            WHERE unavailable.group_id = excluded.group_id
              AND unavailable.author_address = excluded.author_address
              AND unavailable.author_stream_id = excluded.author_stream_id
              AND unavailable.from_seq = excluded.from_seq
              AND unavailable.to_seq = excluded.to_seq
          ) THEN rchat_missing_stream_ranges.preferred_peer
          ELSE excluded.preferred_peer
        END,
        next_attempt_at = CASE
          WHEN EXISTS (
            SELECT 1 FROM rchat_known_unavailable_ranges unavailable
            WHERE unavailable.group_id = excluded.group_id
              AND unavailable.author_address = excluded.author_address
              AND unavailable.author_stream_id = excluded.author_stream_id
              AND unavailable.from_seq = excluded.from_seq
              AND unavailable.to_seq = excluded.to_seq
          ) THEN MAX(rchat_missing_stream_ranges.next_attempt_at, excluded.next_attempt_at)
          ELSE MIN(rchat_missing_stream_ranges.next_attempt_at, excluded.next_attempt_at)
        END
    `);
    this.stmtEnsureMissingRange = this.db.prepare(`
      INSERT OR IGNORE INTO rchat_missing_stream_ranges
        (group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at)
      VALUES
        (@group_id, @author_address, @author_stream_id, @from_seq, @to_seq, @preferred_peer, 0, @next_attempt_at)
    `);
    this.stmtGetMissingRangeExact = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at
      FROM rchat_missing_stream_ranges
      WHERE group_id = ?
        AND author_address = ?
        AND author_stream_id = ?
        AND from_seq = ?
        AND to_seq = ?
    `);
    this.stmtGetMissingRangeOverlaps = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at
      FROM rchat_missing_stream_ranges
      WHERE group_id = @group_id
        AND author_address = @author_address
        AND author_stream_id = @author_stream_id
        AND from_seq <= @to_seq
        AND to_seq >= @from_seq
      ORDER BY from_seq ASC, to_seq ASC
    `);
    this.stmtUpdateMissingRangeAttempt = this.db.prepare(`
      UPDATE rchat_missing_stream_ranges
      SET preferred_peer = COALESCE(@preferred_peer, preferred_peer),
          attempts = @attempts,
          next_attempt_at = @next_attempt_at
      WHERE group_id = @group_id
        AND author_address = @author_address
        AND author_stream_id = @author_stream_id
        AND from_seq = @from_seq
        AND to_seq = @to_seq
    `);
    this.stmtUpdateMissingRangeBackoff = this.db.prepare(`
      UPDATE rchat_missing_stream_ranges
      SET preferred_peer = COALESCE(@preferred_peer, preferred_peer),
          attempts = MAX(attempts, @attempts),
          next_attempt_at = MAX(next_attempt_at, @next_attempt_at)
      WHERE group_id = @group_id
        AND author_address = @author_address
        AND author_stream_id = @author_stream_id
        AND from_seq = @from_seq
        AND to_seq = @to_seq
    `);
    this.stmtRescheduleMissingRangeAny = this.db.prepare(`
      UPDATE rchat_missing_stream_ranges
      SET preferred_peer = @preferred_peer,
          next_attempt_at = @next_attempt_at
      WHERE group_id = @group_id
        AND author_address = @author_address
        AND author_stream_id = @author_stream_id
        AND from_seq = @from_seq
        AND to_seq = @to_seq
    `);
    this.stmtRescheduleMissingRange = this.db.prepare(`
      UPDATE rchat_missing_stream_ranges
      SET preferred_peer = @preferred_peer,
          next_attempt_at = @next_attempt_at
      WHERE group_id = @group_id
        AND author_address = @author_address
        AND author_stream_id = @author_stream_id
        AND from_seq = @from_seq
        AND to_seq = @to_seq
        AND COALESCE(preferred_peer, '') = @expected_peer
    `);
    this.stmtGetMissingRangesForSeq = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at
      FROM rchat_missing_stream_ranges
      WHERE group_id = ?
        AND author_address = ?
        AND author_stream_id = ?
        AND from_seq <= ?
        AND to_seq >= ?
      ORDER BY from_seq ASC, to_seq ASC
    `);
    this.stmtGetAllMissingRanges = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at
      FROM rchat_missing_stream_ranges
      ORDER BY group_id ASC, author_address ASC, author_stream_id ASC, from_seq ASC
    `);
    this.stmtGetReadyMissingRanges = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at
      FROM rchat_missing_stream_ranges
      WHERE next_attempt_at <= ?
      ORDER BY next_attempt_at ASC, group_id ASC, author_address ASC, from_seq ASC
      LIMIT ?
    `);
    // Background scanner pick: per requested group the oldest due row and the
    // oldest due row of an own account, in one statement. The tie order
    // matches stmtGetReadyMissingRanges. UNION ALL measured 3.3 ms against
    // 5.4 ms for one CTE with two ROW_NUMBERs (3,000 rows, node:sqlite).
    this.stmtGetBackgroundMissingRangeCandidates = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq,
             preferred_peer, attempts, next_attempt_at, own_row
      FROM (
        SELECT r.group_id, r.author_address, r.author_stream_id, r.from_seq,
               r.to_seq, r.preferred_peer, r.attempts, r.next_attempt_at,
               0 AS own_row,
               ROW_NUMBER() OVER (
                 PARTITION BY r.group_id
                 ORDER BY r.next_attempt_at ASC, r.author_address ASC,
                          r.author_stream_id ASC, r.from_seq ASC, r.to_seq ASC
               ) AS rn
        FROM rchat_missing_stream_ranges r
        WHERE r.next_attempt_at <= @now
          AND r.group_id IN (SELECT value FROM json_each(@group_ids))
        UNION ALL
        SELECT o.group_id, o.author_address, o.author_stream_id, o.from_seq,
               o.to_seq, o.preferred_peer, o.attempts, o.next_attempt_at,
               1 AS own_row,
               ROW_NUMBER() OVER (
                 PARTITION BY o.group_id
                 ORDER BY o.next_attempt_at ASC, o.author_address ASC,
                          o.author_stream_id ASC, o.from_seq ASC, o.to_seq ASC
               ) AS rn
        FROM rchat_missing_stream_ranges o
        WHERE o.next_attempt_at <= @now
          AND o.group_id IN (SELECT value FROM json_each(@group_ids))
          AND o.author_address IN (SELECT value FROM json_each(@own_addresses))
      )
      WHERE rn = 1
    `);
    this.stmtGetNextMissingRangeAttemptsByGroup = this.db.prepare(`
      SELECT group_id, MIN(next_attempt_at) AS next_attempt_at
      FROM rchat_missing_stream_ranges
      WHERE group_id IN (SELECT value FROM json_each(?))
        AND TRIM(COALESCE(preferred_peer, '')) <> ''
      GROUP BY group_id
    `);
    this.stmtGetPresentSeqsInRange = this.db.prepare(`
      SELECT author_seq FROM (
        SELECT author_seq
        FROM rchat_event_headers
        WHERE group_id = ?
          AND author_address = ?
          AND author_stream_id = ?
          AND author_seq >= ?
          AND author_seq <= ?
        UNION
        SELECT author_seq
        FROM rchat_expired_event_markers
        WHERE group_id = ?
          AND author_address = ?
          AND author_stream_id = ?
          AND author_seq >= ?
          AND author_seq <= ?
      )
      ORDER BY author_seq ASC
    `);
    this.stmtPruneMissingRangePeerUnavailable = this.db.prepare(`
      DELETE FROM rchat_missing_range_peer_observations
      WHERE observed_at < ?
    `);
    this.stmtUpsertMissingRangePeerUnavailable = this.db.prepare(`
      INSERT INTO rchat_missing_range_peer_observations
        (group_id, author_address, author_stream_id, from_seq, to_seq, peer_hash, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, author_address, author_stream_id, from_seq, to_seq, peer_hash)
      DO UPDATE SET observed_at = excluded.observed_at
    `);
    this.stmtCountMissingRangePeerUnavailable = this.db.prepare(`
      SELECT COUNT(DISTINCT peer_hash) AS count
      FROM rchat_missing_range_peer_observations
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq <= ? AND to_seq >= ? AND observed_at >= ?
    `);
    this.stmtGetMissingRangePeerUnavailable = this.db.prepare(`
      SELECT MAX(observed_at) AS observed_at
      FROM rchat_missing_range_peer_observations
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq <= ? AND to_seq >= ? AND peer_hash = ?
      LIMIT 1
    `);
    this.stmtClearMissingRangePeerUnavailable = this.db.prepare(`
      DELETE FROM rchat_missing_range_peer_observations
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq <= ? AND to_seq >= ?
    `);
    this.stmtUpsertKnownUnavailableRange = this.db.prepare(`
      INSERT INTO rchat_known_unavailable_ranges
        (group_id, author_address, author_stream_id, from_seq, to_seq,
         confirmed_at, recheck_at, peer_hashes_json)
      VALUES
        (@group_id, @author_address, @author_stream_id, @from_seq, @to_seq,
         @confirmed_at, @recheck_at, @peer_hashes_json)
      ON CONFLICT(group_id, author_address, author_stream_id, from_seq, to_seq)
      DO UPDATE SET
        confirmed_at = excluded.confirmed_at,
        recheck_at = excluded.recheck_at,
        peer_hashes_json = excluded.peer_hashes_json
    `);
    this.stmtParkKnownUnavailableRange = this.db.prepare(`
      UPDATE rchat_missing_stream_ranges
      SET next_attempt_at = MAX(next_attempt_at, @recheck_at)
      WHERE group_id = @group_id
        AND author_address = @author_address
        AND author_stream_id = @author_stream_id
        AND from_seq = @from_seq
        AND to_seq = @to_seq
    `);
    this.stmtGetKnownUnavailableRange = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq,
             confirmed_at, recheck_at, peer_hashes_json
      FROM rchat_known_unavailable_ranges
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq = ? AND to_seq = ?
      LIMIT 1
    `);
    this.stmtGetKnownUnavailableRangesForGroup = this.db.prepare(`
      SELECT group_id, author_address, author_stream_id, from_seq, to_seq,
             confirmed_at, recheck_at, peer_hashes_json
      FROM rchat_known_unavailable_ranges
      WHERE group_id = ?
    `);
    this.stmtWakeKnownUnavailableRangesForGroup = this.db.prepare(`
      UPDATE rchat_missing_stream_ranges
      SET next_attempt_at = MIN(next_attempt_at, @next_attempt_at)
      WHERE group_id = @group_id
        AND EXISTS (
          SELECT 1 FROM rchat_known_unavailable_ranges unavailable
          WHERE unavailable.group_id = rchat_missing_stream_ranges.group_id
            AND unavailable.author_address = rchat_missing_stream_ranges.author_address
            AND unavailable.author_stream_id = rchat_missing_stream_ranges.author_stream_id
            AND unavailable.from_seq = rchat_missing_stream_ranges.from_seq
            AND unavailable.to_seq = rchat_missing_stream_ranges.to_seq
        )
    `);
    this.stmtClearKnownUnavailableRange = this.db.prepare(`
      DELETE FROM rchat_known_unavailable_ranges
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq <= ? AND to_seq >= ?
    `);
    this.stmtClearKnownUnavailableRangesForGroup = this.db.prepare(`
      DELETE FROM rchat_known_unavailable_ranges
      WHERE group_id = ?
    `);
    this.stmtPruneKnownUnavailableRanges = this.db.prepare(`
      DELETE FROM rchat_known_unavailable_ranges
      WHERE rowid NOT IN (
        SELECT rowid FROM rchat_known_unavailable_ranges
        ORDER BY confirmed_at DESC, rowid DESC
        LIMIT ?
      )
    `);
    this.stmtDeleteMissingRange = this.db.prepare(`
      DELETE FROM rchat_missing_stream_ranges
      WHERE group_id = ?
        AND author_address = ?
        AND author_stream_id = ?
        AND from_seq = ?
        AND to_seq = ?
    `);
    this.stmtInsertMissingRangeRaw = this.db.prepare(`
      INSERT OR IGNORE INTO rchat_missing_stream_ranges
        (group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at)
      VALUES
        (@group_id, @author_address, @author_stream_id, @from_seq, @to_seq, @preferred_peer, @attempts, @next_attempt_at)
    `);
    this.stmtGetRejectedEventMarker = this.db.prepare(`
      SELECT group_id, event_id, event_fingerprint, author_address,
             author_stream_id, author_seq, digest_fingerprint, rejected_at,
             next_revalidate_at, revalidation_attempts
      FROM rchat_rejected_event_markers
      WHERE group_id = ? AND event_id = ?
      LIMIT 1
    `);
    this.stmtHasRejectedDigestMarker = this.db.prepare(`
      SELECT 1
      FROM rchat_rejected_digest_markers
      WHERE group_id = ?
        AND digest_fingerprint = ?
      LIMIT 1
    `);
    this.stmtGetRejectedAuthorSeqs = this.db.prepare(`
      SELECT author_seq
      FROM rchat_rejected_event_markers
      WHERE group_id = ?
        AND author_address = ?
        AND author_stream_id = ?
        AND author_seq BETWEEN ? AND ?
      ORDER BY author_seq ASC
    `);
    this.stmtUpsertRejectedEventMarker = this.db.prepare(`
      INSERT INTO rchat_rejected_event_markers
        (group_id, event_id, event_fingerprint, author_address,
         author_stream_id, author_seq, digest_fingerprint, rejected_at,
         next_revalidate_at, revalidation_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, event_id) DO UPDATE SET
        event_fingerprint = excluded.event_fingerprint,
        author_address = excluded.author_address,
        author_stream_id = excluded.author_stream_id,
        author_seq = excluded.author_seq,
        digest_fingerprint = excluded.digest_fingerprint,
        rejected_at = excluded.rejected_at,
        next_revalidate_at = excluded.next_revalidate_at,
        revalidation_attempts = excluded.revalidation_attempts
    `);
    this.stmtDeleteRejectedEventMarker = this.db.prepare(`
      DELETE FROM rchat_rejected_event_markers
      WHERE group_id = ? AND event_id = ?
    `);
    this.stmtUpsertRejectedDigestMarker = this.db.prepare(`
      INSERT INTO rchat_rejected_digest_markers
        (group_id, event_id, event_fingerprint, digest_fingerprint,
         rejected_at, next_revalidate_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, event_id, digest_fingerprint) DO UPDATE SET
        event_fingerprint = excluded.event_fingerprint,
        rejected_at = excluded.rejected_at,
        next_revalidate_at = excluded.next_revalidate_at
    `);
    this.stmtDeleteRejectedDigestMarkers = this.db.prepare(`
      DELETE FROM rchat_rejected_digest_markers
      WHERE group_id = ? AND event_id = ?
    `);
    this.stmtInsertRelayBlob = this.db.prepare(`
      INSERT INTO rchat_relay_cache
        (blob_id, event_id, group_id, group_hash, created_at, expires_at, size_bytes,
         encoding, encryption, key_epoch, encrypted_key_id, payload_json, source_peer_hash,
         served_count, last_served_at)
      VALUES
        (@blob_id, @event_id, @group_id, @group_hash, @created_at, @expires_at, @size_bytes,
         @encoding, @encryption, @key_epoch, @encrypted_key_id, @payload_json, @source_peer_hash,
         0, NULL)
    `);
    this.stmtGetRelayBlobByEvent = this.db.prepare(`
      SELECT * FROM rchat_relay_cache
      WHERE group_id = ? AND event_id = ? AND expires_at > ?
      LIMIT 1
    `);
    this.stmtListRelayDigestEntries = this.db.prepare(`
      SELECT * FROM rchat_relay_cache
      WHERE group_id = ? AND expires_at > ?
      ORDER BY created_at ASC, event_id ASC
      LIMIT ? OFFSET ?
    `);
    this.stmtMarkRelayBlobServed = this.db.prepare(`
      UPDATE rchat_relay_cache
      SET served_count = served_count + 1,
          last_served_at = ?
      WHERE blob_id = ?
    `);
    this.stmtDeleteRelayExpired = this.db.prepare(
      'DELETE FROM rchat_relay_cache WHERE expires_at <= ?'
    );
    this.stmtTotalRelayBytes = this.db.prepare(`
      SELECT COALESCE(SUM(size_bytes), 0) AS total
      FROM rchat_relay_cache
    `);
    this.stmtRelayEvictCandidate = this.db.prepare(`
      SELECT blob_id FROM rchat_relay_cache
      ORDER BY expires_at ASC, created_at ASC
      LIMIT 1
    `);
    this.stmtDeleteRelayBlob = this.db.prepare(
      'DELETE FROM rchat_relay_cache WHERE blob_id = ?'
    );
    this.stmtDeleteRelayByEvent = this.db.prepare(
      'DELETE FROM rchat_relay_cache WHERE event_id = ?'
    );
    this.stmtGetRelayEventsForGroup = this.db.prepare(
      'SELECT event_id, payload_json FROM rchat_relay_cache WHERE group_id = ?'
    );
    this.stmtGetDeleteEvents = this.db.prepare(`
      SELECT event_id, target_event_id, timestamp
      FROM reticulum_chat_events
      WHERE event_type = 'delete'
        AND target_event_id IS NOT NULL
      ORDER BY timestamp ASC, event_id ASC
    `);
    this.stmtUpdateScrubbedEvent = this.db.prepare(`
      UPDATE reticulum_chat_events
      SET encrypted_payload = ?,
          payload_hash = ?,
          mention_address_hashes = '[]',
          mention_targets = '[]',
          wire_bytes = ?,
          scrubbed_at = ?
      WHERE event_id = ?
    `);
    this.stmtInsertScrubbedEvent = this.db.prepare(`
      INSERT OR REPLACE INTO reticulum_chat_events
        (event_id, group_id, author_address, author_public_key, author_stream_id, author_seq,
         timestamp, feed_timestamp, event_type, target_event_id, reply_to_event_id,
         encrypted_payload, payload_hash, mention_address_hashes, mention_targets, signature, own_event,
         last_served_at, stored_at, accepted_at, wire_bytes, channel_id, scrubbed_at, expires_at,
         message_expiry_duration_ms)
      VALUES
        (@event_id, @group_id, @author_address, @author_public_key, @author_stream_id, @author_seq,
         @timestamp, @feed_timestamp, @event_type, @target_event_id, @reply_to_event_id,
         @encrypted_payload, @payload_hash, '[]', '[]', @signature, @own_event,
         @last_served_at, @stored_at, @accepted_at, @wire_bytes, @channel_id, @scrubbed_at, @expires_at,
         @message_expiry_duration_ms)
    `);
    this.stmtUpsertGroupKey = this.db.prepare(`
      INSERT OR REPLACE INTO rchat_group_keys
        (group_id, epoch, key_id, key_bytes_base64, created_by, created_at,
         status, admin_public_key, admin_signature)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetActiveGroupKey = this.db.prepare(`
      SELECT * FROM rchat_group_keys
      WHERE group_id = ? AND status = 'active'
      ORDER BY epoch DESC, key_id ASC, created_at ASC
      LIMIT 1
    `);
    this.stmtGetGroupKey = this.db.prepare(`
      SELECT * FROM rchat_group_keys
      WHERE group_id = ? AND epoch = ? AND key_id = ?
      LIMIT 1
    `);
    this.stmtUpsertGroupKeyDigest = this.db.prepare(`
      INSERT OR REPLACE INTO rchat_group_key_digests
        (group_id, epoch, key_id, created_by, created_at, admin_public_key,
         admin_signature, source_peer_hash, seen_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetLatestGroupKeyDigest = this.db.prepare(`
      SELECT * FROM rchat_group_key_digests
      WHERE group_id = ?
      ORDER BY epoch DESC, created_at DESC, key_id ASC
      LIMIT 1
    `);
    this.stmtListGroupKeyDigests = this.db.prepare(`
      SELECT * FROM rchat_group_key_digests
      WHERE group_id = ?
      ORDER BY epoch DESC, created_at DESC, key_id ASC
      LIMIT ?
    `);
    this.stmtUpsertGroupKeyRequest = this.db.prepare(`
      INSERT OR REPLACE INTO rchat_group_key_requests
        (group_id, epoch, key_id, request_id, requested_at, attempts, status)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetPendingGroupKeyRequests = this.db.prepare(`
      SELECT * FROM rchat_group_key_requests
      WHERE status = 'pending'
      ORDER BY requested_at ASC
      LIMIT ?
    `);
    this.stmtMarkGroupKeyRequestStatus = this.db.prepare(`
      UPDATE rchat_group_key_requests
      SET status = ?
      WHERE group_id = ? AND epoch = ? AND key_id = ?
    `);
    this.migrateAuthorGapPeerRetryBackoff();
    this.pruneSatisfiedMissingRanges();
    this.backfillMessageProjection();
    this.backfillSearchIndex();
    this.migrateProjectedSearchIndex();
    this.scrubExistingDeletedMessagePayloads();
    this.pruneExpiredMessages();
    this.pruneExpiredDirectMessages();
  }

  close(): void {
    try {
      this.db
        .prepare(
          `
        DELETE FROM rchat_author_sequence_leases WHERE owner_id = ?
      `
        )
        .run(this.sequenceLeaseOwnerId);
    } finally {
      ReticulumChatDatabase.activeSequenceLeaseOwners.delete(
        this.sequenceLeaseOwnerId
      );
      this.channelSummaryCache.clear();
      if (this.ftsCheckTimer) clearTimeout(this.ftsCheckTimer);
      this.ftsCheckTimer = null;
      this.db.close();
    }
  }

  getGroupDigestRevision(groupId: number): number {
    if (!Number.isInteger(groupId) || groupId <= 0) return 0;
    const row = this.stmtGetGroupDigestRevision.get(groupId) as
      | { revision?: number | bigint }
      | undefined;
    const revision = Number(row?.revision);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }

  getNextGroupEventExpiryAt(groupId: number, now = Date.now()): number | null {
    if (!Number.isInteger(groupId) || groupId <= 0) return null;
    const row = this.db
      .prepare(
        `SELECT MIN(expires_at) AS expires_at
         FROM reticulum_chat_events
         WHERE group_id = ? AND expires_at IS NOT NULL AND expires_at > ?`
      )
      .get(groupId, now) as { expires_at?: number | null } | undefined;
    const expiresAt = Number(row?.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : null;
  }

  private pruneStaleAuthorSequenceLeases(): void {
    const leases = this.db
      .prepare(
        `
      SELECT group_id, author_address, author_stream_id, author_seq,
             owner_id, owner_pid, created_at
      FROM rchat_author_sequence_leases
    `
      )
      .all() as Array<{
      group_id?: number;
      author_address?: string;
      author_stream_id?: string;
      author_seq?: number;
      owner_id?: string;
      owner_pid?: number;
      created_at?: number;
    }>;
    const now = Date.now();
    for (const lease of leases) {
      const ownerId = typeof lease.owner_id === 'string' ? lease.owner_id : '';
      const ownerPid = Number(lease.owner_pid || 0);
      const createdAt = Number(lease.created_at || 0);
      if (!ownerId) continue;
      let ownerAlive = false;
      if (
        now - createdAt < RETICULUM_CHAT_AUTHOR_SEQUENCE_LEASE_TTL_MS &&
        ownerPid === process.pid
      ) {
        ownerAlive =
          ReticulumChatDatabase.activeSequenceLeaseOwners.has(ownerId);
      } else if (
        now - createdAt < RETICULUM_CHAT_AUTHOR_SEQUENCE_LEASE_TTL_MS &&
        Number.isInteger(ownerPid) &&
        ownerPid > 0
      ) {
        try {
          process.kill(ownerPid, 0);
          ownerAlive = true;
        } catch (error) {
          ownerAlive = (error as NodeJS.ErrnoException)?.code === 'EPERM';
        }
      }
      if (ownerAlive) continue;
      this.db
        .prepare(
          `
        DELETE FROM rchat_author_sequence_leases
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
          AND author_seq = ? AND owner_id = ?
      `
        )
        .run(
          Number(lease.group_id),
          String(lease.author_address || ''),
          String(lease.author_stream_id || ''),
          Number(lease.author_seq),
          ownerId
        );
    }
  }

  private recordExpiredDirectEventMarker(
    event: ReticulumDmEvent,
    expiredAt = Date.now()
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO rchat_dm_expired_event_markers
          (event_id, conversation_id, sender_address, recipient_address,
           sender_stream_id, sender_seq, timestamp, expired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.eventId,
        event.conversationId,
        event.senderAddress,
        event.recipientAddress,
        normalizeReticulumChatAuthorStreamId(event.senderStreamId),
        event.senderSeq,
        event.timestamp,
        expiredAt
      );
  }

  hasDirectExpiredEventMarker(eventId: string): boolean {
    if (!eventId) return false;
    return !!this.db
      .prepare(
        `SELECT 1 FROM rchat_dm_expired_event_markers
         WHERE event_id = ? LIMIT 1`
      )
      .get(eventId);
  }

  private directEventExpiryState(event: ReticulumDmEvent): {
    valid: boolean;
    expiresAt: number | null;
    messageExpiryDurationMs: number | null;
    targetExpired: boolean;
  } {
    if (event.eventType === 'message') {
      const expiry = directMessageExpiryFromPayload(event.payload);
      if (!expiry.valid) {
        return {
          valid: false,
          expiresAt: null,
          messageExpiryDurationMs: null,
          targetExpired: false,
        };
      }
      return {
        valid: true,
        expiresAt:
          expiry.specified && expiry.durationMs != null
            ? event.timestamp + expiry.durationMs
            : null,
        messageExpiryDurationMs:
          expiry.specified && expiry.durationMs != null
            ? expiry.durationMs
            : null,
        targetExpired: false,
      };
    }
    if (!event.targetEventId) {
      return {
        valid: true,
        expiresAt: null,
        messageExpiryDurationMs: null,
        targetExpired: false,
      };
    }
    const target = this.db
      .prepare(
        `SELECT expires_at FROM rchat_dm_events
         WHERE event_id = ? AND conversation_id = ? LIMIT 1`
      )
      .get(event.targetEventId, event.conversationId) as
      | { expires_at?: number | null }
      | undefined;
    return {
      valid: true,
      expiresAt: target?.expires_at == null ? null : Number(target.expires_at),
      messageExpiryDurationMs: null,
      targetExpired:
        !target && this.hasDirectExpiredEventMarker(event.targetEventId),
    };
  }

  insertDirectEvent(
    event: ReticulumDmEvent,
    ownEvent: boolean,
    deliveryStatus?: 'pending' | 'sent' | 'received'
  ): boolean {
    const conversationId = normalizeReticulumDmConversationId(
      event.conversationId
    );
    if (!conversationId) return false;
    if (event.eventType === 'edit' || event.eventType === 'delete') {
      if (!event.targetEventId) return false;
      const target = this.db
        .prepare(
          `
          SELECT conversation_id, sender_address, event_type
          FROM rchat_dm_events
          WHERE event_id = ?
          LIMIT 1
        `
        )
        .get(event.targetEventId) as
        | {
            conversation_id?: string;
            sender_address?: string;
            event_type?: string;
          }
        | undefined;
      const expiredTarget = !target
        ? (this.db
            .prepare(
              `SELECT conversation_id, sender_address
               FROM rchat_dm_expired_event_markers
               WHERE event_id = ? LIMIT 1`
            )
            .get(event.targetEventId) as
            | { conversation_id?: string; sender_address?: string }
            | undefined)
        : undefined;
      const validLiveTarget =
        target?.conversation_id === conversationId &&
        target.sender_address === event.senderAddress &&
        target.event_type === 'message';
      const validExpiredTarget =
        expiredTarget?.conversation_id === conversationId &&
        expiredTarget.sender_address === event.senderAddress;
      if (!validLiveTarget && !validExpiredTarget) {
        return false;
      }
    }
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const expiry = this.directEventExpiryState(event);
    if (!expiry.valid) return false;
    if (
      expiry.targetExpired ||
      (expiry.expiresAt !== null && expiry.expiresAt <= now)
    ) {
      this.recordExpiredDirectEventMarker(event, now);
      return false;
    }
    const status = deliveryStatus || (ownEvent ? 'pending' : 'received');
    const readWatermarkRow = this.stmtGetDirectWatermark.get(
      conversationId,
      event.recipientAddress
    ) as { timestamp?: number } | undefined;
    const readWatermark = Math.max(0, Number(readWatermarkRow?.timestamp) || 0);
    const result = this.db
      .prepare(
        `
      INSERT OR IGNORE INTO rchat_dm_events
        (event_id, conversation_id, sender_address, recipient_address, sender_public_key,
         sender_stream_id, sender_seq, timestamp, event_type, target_event_id, reply_to_event_id, payload,
         payload_hash, signature, legacy_signature, own_event, read_at, stored_at, wire_bytes,
         delivery_status, delivery_updated_at, expires_at,
         message_expiry_duration_ms)
      VALUES
        (@event_id, @conversation_id, @sender_address, @recipient_address, @sender_public_key,
         @sender_stream_id, @sender_seq, @timestamp, @event_type, @target_event_id, @reply_to_event_id, @payload,
         @payload_hash, @signature, @legacy_signature, @own_event, @read_at, @stored_at, @wire_bytes,
         @delivery_status, @delivery_updated_at, @expires_at,
         @message_expiry_duration_ms)
    `
      )
      .run({
        event_id: event.eventId,
        conversation_id: conversationId,
        sender_address: event.senderAddress,
        recipient_address: event.recipientAddress,
        sender_public_key: event.senderPublicKey,
        sender_stream_id: normalizeReticulumChatAuthorStreamId(
          event.senderStreamId
        ),
        sender_seq: event.senderSeq,
        timestamp: event.timestamp,
        event_type: event.eventType,
        target_event_id: event.targetEventId ?? null,
        reply_to_event_id: event.replyToEventId ?? null,
        payload: event.payload,
        payload_hash: event.payloadHash,
        signature: event.signature,
        legacy_signature: event.legacySignature ?? null,
        own_event: ownEvent ? 1 : 0,
        read_at: ownEvent || event.timestamp <= readWatermark ? now : 0,
        stored_at: now,
        wire_bytes: Buffer.byteLength(JSON.stringify(event), 'utf8'),
        delivery_status: status,
        delivery_updated_at: now,
        expires_at: expiry.expiresAt,
        message_expiry_duration_ms: expiry.messageExpiryDurationMs,
      });
    return result.changes > 0;
  }

  markDirectDeliveryStatus(
    eventId: string,
    status: 'pending' | 'sent' | 'received'
  ): void {
    if (!eventId) return;
    this.db
      .prepare(
        `
        UPDATE rchat_dm_events
        SET delivery_status = ?,
            delivery_updated_at = ?
        WHERE event_id = ?
      `
      )
      .run(status, Date.now(), eventId);
  }

  setSilence(
    ownerAddress: string,
    targetAddress: string,
    scopeType: ReticulumChatSilenceScope,
    scopeId: string,
    durationMs: number | null,
    now = Date.now()
  ): ReticulumChatSilenceRecord | null {
    const owner = String(ownerAddress || '').trim();
    const target = String(targetAddress || '').trim();
    const normalizedScopeId = String(scopeId || '').trim();
    if (
      !owner ||
      !target ||
      owner === target ||
      (scopeType !== 'group' && scopeType !== 'dm') ||
      !normalizedScopeId
    ) {
      return null;
    }
    const createdAt = Math.max(1, Math.floor(now));
    const expiresAt =
      durationMs == null
        ? null
        : createdAt + Math.max(1, Math.floor(durationMs));
    const ignoredThrough = expiresAt ?? createdAt;
    this.db
      .prepare(
        `
          INSERT INTO rchat_silences
            (owner_address, target_address, scope_type, scope_id, created_at,
             expires_at, ignored_through, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_address, target_address, scope_type, scope_id)
          DO UPDATE SET
            created_at = excluded.created_at,
            expires_at = excluded.expires_at,
            ignored_through = excluded.ignored_through,
            updated_at = excluded.updated_at
        `
      )
      .run(
        owner,
        target,
        scopeType,
        normalizedScopeId,
        createdAt,
        expiresAt,
        ignoredThrough,
        createdAt
      );
    if (scopeType === 'group') {
      const groupId = Number(normalizedScopeId);
      if (Number.isInteger(groupId) && groupId > 0) {
        this.invalidateChatSummaryCache(groupId, undefined, owner);
      }
    }
    return this.getSilence(owner, target, scopeType, normalizedScopeId);
  }

  clearSilence(
    ownerAddress: string,
    targetAddress: string,
    scopeType: ReticulumChatSilenceScope,
    scopeId: string,
    now = Date.now()
  ): ReticulumChatSilenceRecord | null {
    const owner = String(ownerAddress || '').trim();
    const target = String(targetAddress || '').trim();
    const normalizedScopeId = String(scopeId || '').trim();
    if (!owner || !target || !normalizedScopeId) return null;
    const clearedAt = Math.max(1, Math.floor(now));
    this.db
      .prepare(
        `
          UPDATE rchat_silences
          SET expires_at = 0,
              ignored_through = ?,
              updated_at = ?
          WHERE owner_address = ?
            AND target_address = ?
            AND scope_type = ?
            AND scope_id = ?
        `
      )
      .run(clearedAt, clearedAt, owner, target, scopeType, normalizedScopeId);
    if (scopeType === 'group') {
      const groupId = Number(normalizedScopeId);
      if (Number.isInteger(groupId) && groupId > 0) {
        this.invalidateChatSummaryCache(groupId, undefined, owner);
      }
    }
    return this.getSilence(owner, target, scopeType, normalizedScopeId);
  }

  getSilence(
    ownerAddress: string,
    targetAddress: string,
    scopeType: ReticulumChatSilenceScope,
    scopeId: string
  ): ReticulumChatSilenceRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT * FROM rchat_silences
          WHERE owner_address = ?
            AND target_address = ?
            AND scope_type = ?
            AND scope_id = ?
          LIMIT 1
        `
      )
      .get(
        String(ownerAddress || '').trim(),
        String(targetAddress || '').trim(),
        scopeType,
        String(scopeId || '').trim()
      ) as SilenceRow | undefined;
    return row ? silenceRowToRecord(row) : null;
  }

  listSilences(
    ownerAddress: string,
    scopeType?: ReticulumChatSilenceScope,
    scopeId?: string
  ): ReticulumChatSilenceRecord[] {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const clauses = ['owner_address = ?'];
    const params: string[] = [owner];
    if (scopeType) {
      clauses.push('scope_type = ?');
      params.push(scopeType);
    }
    if (scopeId != null) {
      clauses.push('scope_id = ?');
      params.push(String(scopeId).trim());
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM rchat_silences
         WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at DESC, target_address ASC`
      )
      .all(...params) as SilenceRow[];
    return rows.map(silenceRowToRecord);
  }

  hasDirectEvent(eventId: string): boolean {
    if (!eventId) return false;
    const row = this.db
      .prepare('SELECT 1 FROM rchat_dm_events WHERE event_id = ? LIMIT 1')
      .get(eventId);
    return !!row;
  }

  getDirectEvent(eventId: string): ReticulumDmEvent | null {
    if (!eventId) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM rchat_dm_events
         WHERE event_id = ? AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`
      )
      .get(eventId, Date.now()) as DirectEventRow | undefined;
    return row ? rowToDirectEvent(row) : null;
  }

  /**
   * Own outbound DM events the recipient has not pulled yet. Self-DMs are
   * excluded: they are marked `sent` at publish time and synced by the
   * own-device path.
   */
  listPendingOwnDirectEvents(
    senderAddress: string,
    sinceTimestamp: number,
    limit = 16,
    now = Date.now()
  ): ReticulumDmEvent[] {
    const sender = String(senderAddress || '').trim();
    if (!sender) return [];
    const safeLimit = Math.max(
      1,
      Math.min(64, Math.floor(Number(limit) || 16))
    );
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const rows = this.db
      .prepare(
        `SELECT * FROM rchat_dm_events
         WHERE delivery_status = 'pending'
           AND sender_address = ?
           AND recipient_address != sender_address
           AND own_event = 1
           AND timestamp >= ?
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY timestamp DESC, event_id DESC
         LIMIT ?`
      )
      .all(sender, since, now, safeLimit) as DirectEventRow[];
    return rows.map(rowToDirectEvent);
  }

  /**
   * Cheap existence check for listPendingOwnDirectEvents' window, used to
   * decide whether the pending-delivery sweep needs to stay armed.
   */
  hasPendingOwnDirectEvents(
    senderAddress: string,
    sinceTimestamp: number,
    now = Date.now()
  ): boolean {
    const sender = String(senderAddress || '').trim();
    if (!sender) return false;
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    return !!this.db
      .prepare(
        `SELECT 1 FROM rchat_dm_events
         WHERE delivery_status = 'pending'
           AND sender_address = ?
           AND recipient_address != sender_address
           AND own_event = 1
           AND timestamp >= ?
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`
      )
      .get(sender, since, now);
  }

  /**
   * Counts for the own outbox state, one indexed read: own outbound DM
   * events the recipient has not pulled yet since `sinceTimestamp`
   * (`pending`), those no verified own device has pulled either
   * (`uncopied`), and those at or after `activeSinceTimestamp` (`active`).
   * Same shape filter as listPendingOwnDirectEvents. Rows the premature
   * 'sent' repair turned back into 'pending' (repairPrematureDmSent) are
   * counted in `repaired` only: most of them were delivered, so they are no
   * more 'waiting to send' now than before the repair
   * (prematureSentRepairedRowSql).
   */
  countPendingOwnDirectEvents(
    senderAddress: string,
    sinceTimestamp: number,
    activeSinceTimestamp: number,
    now = Date.now()
  ): { pending: number; uncopied: number; active: number; repaired: number } {
    const sender = String(senderAddress || '').trim();
    if (!sender) return { pending: 0, uncopied: 0, active: 0, repaired: 0 };
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const activeSince = Math.max(
      since,
      Math.floor(Number(activeSinceTimestamp) || 0)
    );
    const row = this.db
      .prepare(
        `SELECT SUM(1 - repaired) AS pending_count,
                SUM(CASE WHEN repaired = 0 AND own_device_copied_at IS NULL
                         THEN 1 ELSE 0 END) AS uncopied_count,
                SUM(CASE WHEN repaired = 0 AND timestamp >= ?
                         THEN 1 ELSE 0 END) AS active_count,
                SUM(repaired) AS repaired_count
         FROM (
           SELECT e.own_device_copied_at AS own_device_copied_at,
                  e.timestamp AS timestamp,
                  CASE WHEN ${prematureSentRepairedRowSql('e')}
                       THEN 1 ELSE 0 END AS repaired
           FROM rchat_dm_events e
           WHERE e.delivery_status = 'pending'
             AND e.sender_address = ?
             AND e.recipient_address != e.sender_address
             AND e.own_event = 1
             AND e.timestamp >= ?
             AND (e.expires_at IS NULL OR e.expires_at > ?)
         )`
      )
      .get(activeSince, sender, since, now) as
      | {
          pending_count?: unknown;
          uncopied_count?: unknown;
          active_count?: unknown;
          repaired_count?: unknown;
        }
      | undefined;
    const count = (value: unknown) =>
      Math.max(0, Math.floor(Number(value) || 0));
    return {
      pending: count(row?.pending_count),
      uncopied: count(row?.uncopied_count),
      active: count(row?.active_count),
      repaired: count(row?.repaired_count),
    };
  }

  /**
   * Newest own outbound DM event per conversation that the recipient has not
   * pulled yet and that no verified own device has pulled either, newest
   * first; `limit` counts conversations, so one busy conversation cannot
   * starve the others. Same shape filter as listPendingOwnDirectEvents. Two
   * events sharing a conversation's newest timestamp may both be returned.
   */
  listUncopiedPendingOwnDirectEvents(
    senderAddress: string,
    sinceTimestamp: number,
    limit = 64,
    now = Date.now()
  ): ReticulumDmEvent[] {
    const sender = String(senderAddress || '').trim();
    if (!sender) return [];
    const safeLimit = Math.max(
      1,
      Math.min(256, Math.floor(Number(limit) || 64))
    );
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const rows = this.db
      .prepare(
        `SELECT d.* FROM rchat_dm_events d
         JOIN (
           SELECT conversation_id AS head_conversation_id,
                  MAX(timestamp) AS head_timestamp
           FROM rchat_dm_events
           WHERE delivery_status = 'pending'
             AND sender_address = ?
             AND recipient_address != sender_address
             AND own_event = 1
             AND own_device_copied_at IS NULL
             AND timestamp >= ?
             AND (expires_at IS NULL OR expires_at > ?)
           GROUP BY conversation_id
         ) h
           ON d.conversation_id = h.head_conversation_id
          AND d.timestamp = h.head_timestamp
         WHERE d.delivery_status = 'pending'
           AND d.sender_address = ?
           AND d.timestamp >= ?
           AND d.recipient_address != d.sender_address
           AND d.own_event = 1
           AND d.own_device_copied_at IS NULL
           AND (d.expires_at IS NULL OR d.expires_at > ?)
         ORDER BY d.timestamp DESC, d.event_id DESC
         LIMIT ?`
      )
      .all(
        sender,
        since,
        now,
        sender,
        since,
        now,
        safeLimit
      ) as DirectEventRow[];
    return rows.map(rowToDirectEvent);
  }

  /**
   * Own outbound DM events of one conversation that the recipient has not
   * pulled yet, with `fromTimestamp <= timestamp <= toTimestamp`, oldest
   * first; with `uncopiedOnly`, only those no own device has pulled either.
   * Serves events a puller's cursor has already passed.
   */
  listPendingOwnDirectEventsBetween(
    senderAddress: string,
    conversationId: string,
    fromTimestamp: number,
    toTimestamp: number,
    options: { uncopiedOnly?: boolean; limit?: number; now?: number } = {}
  ): ReticulumDmEvent[] {
    const sender = String(senderAddress || '').trim();
    const conversation = normalizeReticulumDmConversationId(conversationId);
    if (!sender || !conversation) return [];
    const from = Math.max(0, Math.floor(Number(fromTimestamp) || 0));
    const to = Math.floor(Number(toTimestamp) || 0);
    if (to < from) return [];
    const safeLimit = Math.max(
      1,
      Math.min(50, Math.floor(Number(options.limit) || 50))
    );
    const rows = this.db
      .prepare(
        `SELECT * FROM rchat_dm_events
         WHERE delivery_status = 'pending'
           AND sender_address = ?
           AND timestamp >= ?
           AND timestamp <= ?
           AND conversation_id = ?
           AND recipient_address != sender_address
           AND own_event = 1${options.uncopiedOnly ? '\n           AND own_device_copied_at IS NULL' : ''}
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY timestamp ASC, event_id ASC
         LIMIT ?`
      )
      .all(
        sender,
        from,
        to,
        conversation,
        options.now ?? Date.now(),
        safeLimit
      ) as DirectEventRow[];
    return (rows ?? []).map(rowToDirectEvent);
  }

  /**
   * Newest pending own outbound DM event per conversation (the sweep's one
   * candidate per conversation: a pull fetches everything after the
   * recipient's cursor), with its persisted retry state. Heads older than
   * `uncopiedOnlyBefore` are returned only while no own device has pulled
   * them (the slow tail stops once the home Hub holds a copy), or, for a
   * head the premature 'sent' repair re-pended, until its first re-announce
   * without `lc`. Due heads come first, so a busy conversation cannot starve
   * the others.
   */
  listPendingOwnDirectConversationHeads(
    senderAddress: string,
    sinceTimestamp: number,
    uncopiedOnlyBefore: number,
    limit = 16,
    now = Date.now()
  ): ReticulumPendingOwnDirectHead[] {
    const sender = String(senderAddress || '').trim();
    if (!sender) return [];
    const safeLimit = Math.max(
      1,
      Math.min(64, Math.floor(Number(limit) || 16))
    );
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const copiedCutoff = Math.max(
      since,
      Math.floor(Number(uncopiedOnlyBefore) || 0)
    );
    const rows = this.db
      .prepare(
        `SELECT d.* ${PENDING_OWN_DIRECT_HEADS_FROM}
         ORDER BY COALESCE(d.next_delivery_attempt_at, 0) ASC,
                  d.timestamp DESC, d.event_id DESC
         LIMIT ?`
      )
      .all(
        sender,
        since,
        now,
        sender,
        since,
        now,
        copiedCutoff,
        safeLimit
      ) as DirectEventRow[];
    const seen = new Set<string>();
    const heads: ReticulumPendingOwnDirectHead[] = [];
    for (const row of rows ?? []) {
      // Two events with the same newest timestamp: keep one.
      if (!row?.event_id || seen.has(row.conversation_id)) continue;
      seen.add(row.conversation_id);
      heads.push(rowToPendingOwnDirectHead(row));
    }
    return heads;
  }

  /**
   * listPendingOwnDirectConversationHeads for one conversation: its head, or
   * null. Indexed by conversation and time.
   */
  getPendingOwnDirectConversationHead(
    senderAddress: string,
    conversationId: string,
    sinceTimestamp: number,
    uncopiedOnlyBefore: number,
    now = Date.now()
  ): ReticulumPendingOwnDirectHead | null {
    const sender = String(senderAddress || '').trim();
    const conversation = String(conversationId || '').trim();
    if (!sender || !conversation) return null;
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const copiedCutoff = Math.max(
      since,
      Math.floor(Number(uncopiedOnlyBefore) || 0)
    );
    const row = this.db
      .prepare(
        `SELECT d.* ${PENDING_OWN_DIRECT_CONVERSATION_HEAD_FROM}
         ORDER BY d.event_id DESC
         LIMIT 1`
      )
      .get(
        sender,
        conversation,
        since,
        now,
        sender,
        since,
        now,
        copiedCutoff
      ) as DirectEventRow | undefined;
    return row?.event_id ? rowToPendingOwnDirectHead(row) : null;
  }

  /**
   * Earliest persisted due time over listPendingOwnDirectConversationHeads'
   * heads (0 when a head was never attempted), or null when there is no
   * head at all. One indexed read; used to arm (or not arm) the sweep timer.
   */
  nextPendingOwnDirectDeliveryDueAt(
    senderAddress: string,
    sinceTimestamp: number,
    uncopiedOnlyBefore: number,
    now = Date.now()
  ): number | null {
    const sender = String(senderAddress || '').trim();
    if (!sender) return null;
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const copiedCutoff = Math.max(
      since,
      Math.floor(Number(uncopiedOnlyBefore) || 0)
    );
    const row = this.db
      .prepare(
        `SELECT MIN(COALESCE(d.next_delivery_attempt_at, 0)) AS next_due_at
         ${PENDING_OWN_DIRECT_HEADS_FROM}`
      )
      .get(sender, since, now, sender, since, now, copiedCutoff) as
      | { next_due_at?: unknown }
      | undefined;
    if (row?.next_due_at == null) return null;
    const dueAt = Number(row.next_due_at);
    return Number.isFinite(dueAt) ? Math.max(0, Math.floor(dueAt)) : null;
  }

  /** Persist the sweep's retry state for one own event (local only). */
  setDirectEventDeliveryRetry(
    eventId: string,
    attempts: number,
    nextAttemptAt: number
  ): void {
    if (!eventId) return;
    this.db
      .prepare(
        `UPDATE rchat_dm_events
         SET delivery_attempts = ?,
             next_delivery_attempt_at = ?
         WHERE event_id = ? AND own_event = 1`
      )
      .run(
        Math.max(0, Math.floor(Number(attempts) || 0)),
        Math.max(0, Math.floor(Number(nextAttemptAt) || 0)),
        eventId
      );
  }

  /**
   * Local-only marker: a verified own device pulled a page holding these own
   * events. One UPDATE per served page; rows already marked keep their time.
   */
  markDirectEventsOwnDeviceCopied(
    eventIds: string[],
    copiedAt: number
  ): number {
    const ids = [...new Set(eventIds.filter(Boolean))].slice(0, 256);
    if (ids.length === 0) return 0;
    const result = this.db
      .prepare(
        `UPDATE rchat_dm_events
         SET own_device_copied_at = ?
         WHERE own_device_copied_at IS NULL
           AND event_id IN (${ids.map(() => '?').join(', ')})`
      )
      .run(Math.max(1, Math.floor(Number(copiedAt) || Date.now())), ...ids);
    return Number(result?.changes ?? 0);
  }

  /**
   * Once per sender address (an rchat_sync_state guard row written in the
   * same transaction): own outbound DM events of the last 7 days that are
   * 'sent' become 'pending' again, with three attempts counted (so the first
   * re-announce leaves `lc` out and every recipient pulls from its own
   * cursor) and a staggered next attempt: the conversation with the newest
   * such event at `now` + 2 min, each next one 75 s later. Own-device copy
   * marks stay: an own device that holds a row is not asked again, and a
   * copied head still gets that first re-announce from the slow tail. Their
   * delivery_updated_at is `now`, the guard row's time, which marks them as
   * repaired (prematureSentRepairedRowSql) until a delivered page settles
   * them; the outbox counts leave them out meanwhile. Older builds marked a
   * page's events 'sent' when the bridge accepted the authorize, before any
   * byte arrived, and no record tells those from real deliveries; only rows the
   * recipient has answered (a reply or a reaction to them) prove delivery
   * and stay 'sent'. Self-DMs, copies, expired rows and rows changed at or
   * after `now` are left alone. Returns null when the guard was already
   * there (nothing done). Local only, never synced.
   */
  repairPrematureDmSent(
    senderAddress: string,
    now: number
  ): ReticulumDmPrematureSentRepairResult | null {
    const sender = String(senderAddress || '').trim();
    const at = Math.floor(Number(now));
    if (!sender || !Number.isFinite(at) || at <= 0) return null;
    const run = this.db.transaction(
      (): ReticulumDmPrematureSentRepairResult | null => {
        const guard = this.db
          .prepare(
            `SELECT 1 AS present FROM rchat_sync_state
             WHERE scope = ? AND group_id = 0 AND peer_hash = '' AND state_key = ?`
          )
          .get(DM_PREMATURE_SENT_REPAIR_SCOPE, sender);
        if (guard) return null;
        const candidates = (this.db
          .prepare(
            `SELECT d.event_id AS event_id,
                    d.conversation_id AS conversation_id,
                    d.recipient_address AS recipient_address
             FROM rchat_dm_events d
             WHERE d.delivery_status = 'sent'
               AND d.sender_address = ?
               AND d.timestamp >= ?
               AND d.own_event = 1
               AND d.recipient_address != d.sender_address
               AND (d.expires_at IS NULL OR d.expires_at > ?)
               AND d.delivery_updated_at < ?
               AND NOT EXISTS (
                 SELECT 1 FROM rchat_dm_events r
                 WHERE r.conversation_id = d.conversation_id
                   AND r.sender_address = d.recipient_address
                   AND (r.reply_to_event_id = d.event_id
                        OR r.target_event_id = d.event_id)
               )
             ORDER BY d.timestamp DESC, d.event_id DESC`
          )
          .all(
            sender,
            at - RETICULUM_DM_PREMATURE_SENT_REPAIR_WINDOW_MS,
            at,
            at
          ) ?? []) as Array<{
          event_id: string;
          conversation_id: string;
          recipient_address: string;
        }>;
        // Newest first: the conversation whose newest candidate is newest
        // goes first.
        const byConversation = new Map<
          string,
          { recipientAddress: string; eventIds: string[] }
        >();
        for (const row of candidates) {
          let entry = byConversation.get(row.conversation_id);
          if (!entry) {
            entry = { recipientAddress: row.recipient_address, eventIds: [] };
            byConversation.set(row.conversation_id, entry);
          }
          entry.eventIds.push(row.event_id);
        }
        const update = this.db.prepare(
          `UPDATE rchat_dm_events
           SET delivery_status = 'pending',
               delivery_updated_at = ?,
               delivery_attempts = ?,
               next_delivery_attempt_at = ?
           WHERE event_id = ? AND delivery_status = 'sent'`
        );
        const result: ReticulumDmPrematureSentRepairResult = {
          rows: 0,
          conversations: [],
        };
        for (const [conversationId, entry] of byConversation) {
          const nextAttemptAt =
            at +
            RETICULUM_DM_PREMATURE_SENT_REPAIR_FIRST_DUE_MS +
            result.conversations.length *
              RETICULUM_DM_PREMATURE_SENT_REPAIR_SPACING_MS;
          let changed = 0;
          for (const eventId of entry.eventIds) {
            changed += Number(
              update.run(
                at,
                RETICULUM_DM_PREMATURE_SENT_REPAIR_SEED_ATTEMPTS,
                nextAttemptAt,
                eventId
              )?.changes ?? 0
            );
          }
          if (changed === 0) continue;
          result.rows += changed;
          result.conversations.push({
            conversationId,
            recipientAddress: entry.recipientAddress,
            nextAttemptAt,
          });
        }
        this.db
          .prepare(
            `INSERT INTO rchat_sync_state
               (scope, group_id, peer_hash, state_key, state_value, updated_at)
             VALUES (?, 0, '', ?, ?, ?)`
          )
          .run(
            DM_PREMATURE_SENT_REPAIR_SCOPE,
            sender,
            JSON.stringify({
              v: 1,
              at,
              rows: result.rows,
              conversations: result.conversations.length,
            }),
            at
          );
        return result;
      }
    );
    return run();
  }

  /**
   * Saved Messages (self conversation) events authored on this installation,
   * newest first: only id and timestamp, for cursor comparisons.
   */
  listOwnSelfDirectEventCursors(
    conversationId: string,
    sinceTimestamp: number,
    limit = 16,
    now = Date.now()
  ): Array<{ eventId: string; timestamp: number }> {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized) return [];
    const safeLimit = Math.max(
      1,
      Math.min(64, Math.floor(Number(limit) || 16))
    );
    const since = Math.max(0, Math.floor(Number(sinceTimestamp) || 0));
    const rows = this.db
      .prepare(
        `SELECT event_id, timestamp, own_event FROM rchat_dm_events
         WHERE conversation_id = ?
           AND own_event = 1
           AND sender_address = recipient_address
           AND timestamp >= ?
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY timestamp DESC, event_id DESC
         LIMIT ?`
      )
      .all(normalized, since, now, safeLimit) as Array<{
      event_id?: unknown;
      timestamp?: unknown;
      own_event?: unknown;
    }>;
    return rows
      .filter(
        (row) =>
          typeof row.event_id === 'string' &&
          Number(row.own_event) === 1 &&
          Number.isFinite(Number(row.timestamp))
      )
      .map((row) => ({
        eventId: row.event_id as string,
        timestamp: Number(row.timestamp),
      }))
      .sort(
        (a, b) =>
          b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
      );
  }

  /**
   * Newest Saved Messages event authored on this device that one own device
   * (by peer hash) confirmed holding, or null. Local only, never synced.
   */
  getSelfDmConfirmedCursor(
    ownerAddress: string,
    peerHash: string
  ): { eventId: string; timestamp: number } | null {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerHash || '').trim();
    if (!owner || !peer) return null;
    const row = this.db
      .prepare(
        `SELECT state_value FROM rchat_sync_state
         WHERE scope = ? AND group_id = 0 AND peer_hash = ? AND state_key = ?`
      )
      .get(SELF_DM_CONFIRMED_SCOPE, peer, owner) as
      | { state_value?: unknown }
      | undefined;
    if (typeof row?.state_value !== 'string') return null;
    try {
      const parsed = JSON.parse(row.state_value) as {
        e?: unknown;
        t?: unknown;
      };
      const timestamp = Number(parsed?.t);
      if (typeof parsed?.e !== 'string' || !Number.isFinite(timestamp)) {
        return null;
      }
      return { eventId: parsed.e, timestamp };
    } catch {
      return null;
    }
  }

  /**
   * Persist getSelfDmConfirmedCursor's answer, and drop confirmations last
   * written before `pruneBefore` (older than any cursor they could cover).
   */
  setSelfDmConfirmedCursor(
    ownerAddress: string,
    peerHash: string,
    event: { eventId: string; timestamp: number },
    now: number,
    pruneBefore: number
  ): void {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerHash || '').trim();
    if (!owner || !peer || !event?.eventId) return;
    this.db
      .prepare(
        `DELETE FROM rchat_sync_state WHERE scope = ? AND updated_at < ?`
      )
      .run(SELF_DM_CONFIRMED_SCOPE, Math.floor(Number(pruneBefore) || 0));
    this.db
      .prepare(
        `INSERT OR REPLACE INTO rchat_sync_state
           (scope, group_id, peer_hash, state_key, state_value, updated_at)
         VALUES (?, 0, ?, ?, ?, ?)`
      )
      .run(
        SELF_DM_CONFIRMED_SCOPE,
        peer,
        owner,
        JSON.stringify({
          e: event.eventId,
          t: Math.floor(Number(event.timestamp) || 0),
        }),
        Math.floor(Number(now) || 0)
      );
  }

  /**
   * The sender cursor (timestamp) a completed DM look-back from one source
   * device started at, or null. Local only, never synced.
   */
  getDirectDmLookbackMark(
    sourcePeerHash: string,
    conversationId: string
  ): number | null {
    const peer = String(sourcePeerHash || '').trim();
    const conversation = normalizeReticulumDmConversationId(conversationId);
    if (!peer || !conversation) return null;
    const row = this.db
      .prepare(
        `SELECT state_value FROM rchat_sync_state
         WHERE scope = ? AND group_id = 0 AND peer_hash = ? AND state_key = ?`
      )
      .get(DM_LOOKBACK_DONE_SCOPE, peer, conversation) as
      | { state_value?: unknown }
      | undefined;
    if (typeof row?.state_value !== 'string') return null;
    try {
      const cursor = Number(
        (JSON.parse(row.state_value) as { c?: unknown })?.c
      );
      return Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : null;
    } catch {
      return null;
    }
  }

  /**
   * Persist getDirectDmLookbackMark's answer (never lowering it), and drop
   * marks last written before `pruneBefore`.
   */
  setDirectDmLookbackMark(
    sourcePeerHash: string,
    conversationId: string,
    cursor: number,
    now: number,
    pruneBefore: number
  ): void {
    const peer = String(sourcePeerHash || '').trim();
    const conversation = normalizeReticulumDmConversationId(conversationId);
    const value = Math.floor(Number(cursor) || 0);
    if (!peer || !conversation || value <= 0) return;
    this.db
      .prepare(
        `DELETE FROM rchat_sync_state WHERE scope = ? AND updated_at < ?`
      )
      .run(DM_LOOKBACK_DONE_SCOPE, Math.floor(Number(pruneBefore) || 0));
    const previous = this.getDirectDmLookbackMark(peer, conversation);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO rchat_sync_state
           (scope, group_id, peer_hash, state_key, state_value, updated_at)
         VALUES (?, 0, ?, ?, ?, ?)`
      )
      .run(
        DM_LOOKBACK_DONE_SCOPE,
        peer,
        conversation,
        JSON.stringify({ c: Math.max(value, previous ?? 0) }),
        Math.floor(Number(now) || 0)
      );
  }

  /** Newest events of a conversation (any author): id and timestamp only. */
  getDirectRecentEventCursors(
    conversationId: string,
    limit = 5
  ): Array<{ eventId: string; timestamp: number }> {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized) return [];
    const safeLimit = Math.max(1, Math.min(16, Math.floor(Number(limit) || 5)));
    const rows = this.db
      .prepare(
        `SELECT event_id, timestamp FROM rchat_dm_events
         WHERE conversation_id = ?
         ORDER BY timestamp DESC, event_id DESC
         LIMIT ?`
      )
      .all(normalized, safeLimit) as Array<{
      event_id?: unknown;
      timestamp?: unknown;
    }>;
    return rows
      .filter(
        (row) =>
          typeof row.event_id === 'string' &&
          Number.isFinite(Number(row.timestamp))
      )
      .map((row) => ({
        eventId: row.event_id as string,
        timestamp: Number(row.timestamp),
      }));
  }

  /** Stored signature of a DM event, or null when the event is not stored. */
  getDirectEventSignature(eventId: string): string | null {
    if (!eventId) return null;
    const row = this.db
      .prepare('SELECT signature FROM rchat_dm_events WHERE event_id = ?')
      .get(eventId) as { signature?: unknown } | undefined;
    return typeof row?.signature === 'string' ? row.signature : null;
  }

  isDirectEventDeleted(eventId: string): boolean {
    if (!eventId) return false;
    return !!this.db
      .prepare(
        `
        SELECT 1
        FROM rchat_dm_events deletion
        JOIN rchat_dm_events target
          ON target.event_id = deletion.target_event_id
        WHERE deletion.event_type = 'delete'
          AND deletion.target_event_id = ?
          AND deletion.conversation_id = target.conversation_id
          AND deletion.sender_address = target.sender_address
          AND target.event_type = 'message'
        LIMIT 1
      `
      )
      .get(eventId);
  }

  getDirectHistory(
    conversationId: string,
    limit = 100,
    excludedSenderAddresses: readonly string[] = []
  ): ReticulumDmEvent[] {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized) return [];
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const excludedSenders = [
      ...new Set(
        excludedSenderAddresses
          .map((address) => String(address || '').trim())
          .filter(Boolean)
      ),
    ].slice(0, 100);
    const excludedClause = excludedSenders.length
      ? `AND sender_address NOT IN (${excludedSenders.map(() => '?').join(', ')})`
      : '';
    const rows = this.db
      .prepare(
        `
        SELECT * FROM (
          SELECT * FROM rchat_dm_events
          WHERE conversation_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
            ${excludedClause}
          ORDER BY timestamp DESC, event_id DESC
          LIMIT ?
        )
        ORDER BY timestamp ASC, event_id ASC
      `
      )
      .all(normalized, now, ...excludedSenders, safeLimit) as DirectEventRow[];
    return rows.map(rowToDirectEvent);
  }

  /**
   * GO friend restore: the account's own `dm_friend_added` events in one DM
   * and its own deletes of them, oldest first, however much was said since
   * (getDirectHistory only returns the newest 500). Local read; nothing on
   * the wire changes.
   */
  getOwnDirectFriendEvents(
    conversationId: string,
    senderAddress: string,
    limit = 50
  ): ReticulumDmEvent[] {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    const sender = String(senderAddress || '').trim();
    if (!normalized || !sender) return [];
    const now = Date.now();
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const adds = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ?
          AND sender_address = ?
          AND event_type = 'message'
          AND payload LIKE '%dm_friend_added%'
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY timestamp DESC, event_id DESC
        LIMIT ?
      `
      )
      .all(normalized, sender, now, safeLimit) as DirectEventRow[];
    if (adds.length === 0) return [];
    const addIds = adds.map((row) => row.event_id);
    const deletes = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ?
          AND sender_address = ?
          AND event_type = 'delete'
          AND target_event_id IN (${addIds.map(() => '?').join(', ')})
      `
      )
      .all(normalized, sender, ...addIds) as DirectEventRow[];
    return [...adds, ...deletes]
      .map(rowToDirectEvent)
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      );
  }

  /**
   * A DM conversation from the event `fromEventId` on, oldest first (at most
   * `limit` events), after up to `before` events just ahead of it for
   * context: what a search result older than the loaded history opens at.
   * Empty when the conversation has no such event.
   */
  getDirectHistoryFrom(
    conversationId: string,
    fromEventId: string,
    limit = 1000,
    before = 20,
    excludedSenderAddresses: readonly string[] = []
  ): ReticulumDmEvent[] {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    const eventId = String(fromEventId || '').trim();
    if (!normalized || !eventId) return [];
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const anchor = this.db
      .prepare(
        `SELECT timestamp FROM rchat_dm_events WHERE event_id = ? AND conversation_id = ?`
      )
      .get(eventId, normalized) as { timestamp?: number } | undefined;
    const from = Number(anchor?.timestamp);
    if (!Number.isFinite(from)) return [];
    const safeLimit = Math.max(1, Math.min(2000, Math.floor(limit) || 1));
    const safeBefore = Math.max(0, Math.min(100, Math.floor(before) || 0));
    const excludedSenders = [
      ...new Set(
        excludedSenderAddresses
          .map((address) => String(address || '').trim())
          .filter(Boolean)
      ),
    ].slice(0, 100);
    const excludedClause = excludedSenders.length
      ? `AND sender_address NOT IN (${excludedSenders.map(() => '?').join(', ')})`
      : '';
    const fromRows = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
          AND timestamp >= ?
          ${excludedClause}
        ORDER BY timestamp ASC, event_id ASC
        LIMIT ?
      `
      )
      .all(
        normalized,
        now,
        from,
        ...excludedSenders,
        safeLimit
      ) as DirectEventRow[];
    const beforeRows =
      safeBefore > 0
        ? (this.db
            .prepare(
              `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
          AND timestamp < ?
          ${excludedClause}
        ORDER BY timestamp DESC, event_id DESC
        LIMIT ?
      `
            )
            .all(
              normalized,
              now,
              from,
              ...excludedSenders,
              safeBefore
            ) as DirectEventRow[])
        : [];
    return [...beforeRows.reverse(), ...fromRows].map(rowToDirectEvent);
  }

  /**
   * The account's direct messages whose text contains `query`, newest first:
   * messages and edits (an edited message is found by its latest text only),
   * not deleted, not expired. The payload is matched as stored JSON, so the
   * caller checks the visible text and builds the snippet. Local only.
   */
  searchDirectMessages(
    myAddress: string,
    query: string,
    limit = 60
  ): ReticulumDmEvent[] {
    const address = String(myAddress || '').trim();
    const needle = String(query || '').trim();
    if (!address || needle.length < 2) return [];
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const pattern = `%${needle.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const rows = this.db
      .prepare(
        `
        SELECT e.* FROM rchat_dm_events e
        WHERE (e.sender_address = ? OR e.recipient_address = ?)
          AND e.event_type IN ('message', 'edit')
          AND (e.expires_at IS NULL OR e.expires_at > ?)
          AND (
            CASE WHEN json_valid(e.payload)
              THEN COALESCE(json_extract(e.payload, '$.messageText'), '')
              ELSE e.payload
            END
          ) LIKE ? ESCAPE '\\'
          AND NOT EXISTS (
            SELECT 1 FROM rchat_dm_events d
            WHERE d.conversation_id = e.conversation_id
              AND d.event_type = 'delete'
              AND d.target_event_id = COALESCE(e.target_event_id, e.event_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM rchat_dm_events x
            WHERE x.conversation_id = e.conversation_id
              AND x.event_type = 'edit'
              AND x.target_event_id = COALESCE(e.target_event_id, e.event_id)
              AND (
                e.event_type = 'message'
                OR x.timestamp > e.timestamp
                OR (x.timestamp = e.timestamp AND x.event_id > e.event_id)
              )
          )
        ORDER BY e.timestamp DESC, e.event_id DESC
        LIMIT ?
      `
      )
      .all(address, address, now, pattern, safeLimit) as DirectEventRow[];
    return rows.map(rowToDirectEvent);
  }

  getDirectEventsAfter(
    conversationId: string,
    afterTimestamp: number,
    limit = 50
  ): ReticulumDmEvent[] {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized) return [];
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const rows = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ? AND timestamp > ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY timestamp ASC, event_id ASC
        LIMIT ?
      `
      )
      .all(
        normalized,
        Math.max(0, Math.floor(afterTimestamp || 0)),
        now,
        safeLimit
      ) as DirectEventRow[];
    return rows.map(rowToDirectEvent);
  }

  /** Events with fromExclusive < timestamp <= toInclusive, oldest first. */
  getDirectEventsBetween(
    conversationId: string,
    fromExclusive: number,
    toInclusive: number,
    limit = 50
  ): ReticulumDmEvent[] {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized) return [];
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const rows = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ? AND timestamp > ? AND timestamp <= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY timestamp ASC, event_id ASC
        LIMIT ?
      `
      )
      .all(
        normalized,
        Math.max(0, Math.floor(fromExclusive || 0)),
        Math.max(0, Math.floor(toInclusive || 0)),
        now,
        safeLimit
      ) as DirectEventRow[];
    return rows.map(rowToDirectEvent);
  }

  getDirectLatestEvent(conversationId: string): ReticulumDmEvent | null {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized) return null;
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const row = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY timestamp DESC, event_id DESC
        LIMIT 1
      `
      )
      .get(normalized, now) as DirectEventRow | undefined;
    return row ? rowToDirectEvent(row) : null;
  }

  getDirectLatestEventFromSender(
    conversationId: string,
    senderAddress: string
  ): ReticulumDmEvent | null {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    const sender = String(senderAddress || '').trim();
    if (!normalized || !sender) return null;
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const row = this.db
      .prepare(
        `
        SELECT * FROM rchat_dm_events
        WHERE conversation_id = ? AND sender_address = ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY timestamp DESC, event_id DESC
        LIMIT 1
      `
      )
      .get(normalized, sender, now) as DirectEventRow | undefined;
    return row ? rowToDirectEvent(row) : null;
  }

  getDirectSyncCursorFromSender(
    conversationId: string,
    senderAddress: string
  ): { eventId: string; timestamp: number; senderAddress: string } | null {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    const sender = String(senderAddress || '').trim();
    if (!normalized || !sender) return null;
    const row = this.db
      .prepare(
        `SELECT event_id, timestamp, sender_address
         FROM (
           SELECT event_id, timestamp, sender_address
           FROM rchat_dm_events
           WHERE conversation_id = ? AND sender_address = ?
           UNION ALL
           SELECT event_id, timestamp, sender_address
           FROM rchat_dm_expired_event_markers
           WHERE conversation_id = ? AND sender_address = ?
         )
         ORDER BY timestamp DESC, event_id DESC
         LIMIT 1`
      )
      .get(normalized, sender, normalized, sender) as
      | { event_id?: string; timestamp?: number; sender_address?: string }
      | undefined;
    if (!row?.event_id || !Number.isFinite(Number(row.timestamp))) return null;
    return {
      eventId: row.event_id,
      timestamp: Number(row.timestamp),
      senderAddress: String(row.sender_address || sender),
    };
  }

  getDirectAuthorMaxSeq(conversationId: string, senderAddress: string): number {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    if (!normalized || !senderAddress) return 0;
    const row = this.db
      .prepare(
        `
        SELECT MAX(sender_seq) AS max_seq FROM (
          SELECT sender_seq FROM rchat_dm_events
          WHERE conversation_id = ? AND sender_address = ?
          UNION ALL
          SELECT sender_seq FROM rchat_dm_expired_event_markers
          WHERE conversation_id = ? AND sender_address = ?
        )
      `
      )
      .get(normalized, senderAddress, normalized, senderAddress) as
      | { max_seq?: number | null }
      | undefined;
    return Number(row?.max_seq || 0);
  }

  getOrCreateDirectAuthorStreamId(authorAddress: string): string {
    const address = String(authorAddress || '').trim();
    if (!address) throw new Error('Invalid direct-message author address');
    this.db
      .prepare(
        `INSERT OR IGNORE INTO rchat_author_streams
           (author_address, stream_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(address, nodeCrypto.randomBytes(16).toString('hex'), Date.now());
    const row = this.db
      .prepare(
        `SELECT stream_id FROM rchat_author_streams WHERE author_address = ?`
      )
      .get(address) as { stream_id?: string } | undefined;
    const streamId = normalizeReticulumChatAuthorStreamId(row?.stream_id);
    if (!streamId) throw new Error('Failed to resolve DM author stream');
    return streamId;
  }

  getDirectExpiryPreference(
    ownerAddress: string,
    peerAddress: string
  ): ReticulumDmExpiryPreference {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerAddress || '').trim();
    const row = this.db
      .prepare(
        `SELECT duration_ms, updated_at
         FROM rchat_dm_expiry_preferences
         WHERE owner_address = ? AND peer_address = ? LIMIT 1`
      )
      .get(owner, peer) as
      | { duration_ms?: number | null; updated_at?: number }
      | undefined;
    return {
      ownerAddress: owner,
      peerAddress: peer,
      durationMs:
        row === undefined
          ? RETICULUM_DM_DEFAULT_EXPIRY_MS
          : row.duration_ms == null
            ? null
            : Number(row.duration_ms),
      updatedAt: Number(row?.updated_at || 0),
    };
  }

  setDirectExpiryPreference(
    ownerAddress: string,
    peerAddress: string,
    durationMs: number | null,
    now = Date.now()
  ): ReticulumDmExpiryPreference | null {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerAddress || '').trim();
    if (!owner || !peer) return null;
    if (
      durationMs !== null &&
      (!Number.isSafeInteger(durationMs) ||
        !RETICULUM_DM_ALLOWED_EXPIRY_MS.has(durationMs))
    ) {
      return null;
    }
    this.db
      .prepare(
        `INSERT INTO rchat_dm_expiry_preferences
          (owner_address, peer_address, duration_ms, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_address, peer_address) DO UPDATE SET
           duration_ms = excluded.duration_ms,
           updated_at = excluded.updated_at`
      )
      .run(owner, peer, durationMs, Math.max(1, Math.floor(now)));
    return this.getDirectExpiryPreference(owner, peer);
  }

  getDirectSummaries(
    myAddress: string,
    peerAddress?: string
  ): ReticulumDmSummary[] {
    const address = String(myAddress || '').trim();
    if (!address) return [];
    const peer = String(peerAddress || '').trim();
    const conversationId = peer ? reticulumDmConversationId(address, peer) : '';
    if (peer && !conversationId) return [];
    const conversationClause = conversationId
      ? 'AND e.conversation_id = ?'
      : '';
    const now = Date.now();
    this.pruneExpiredDirectMessagesThrottled(now);
    const rows = this.db
      .prepare(
        `
        SELECT e.*
        FROM rchat_dm_events e
        WHERE (e.sender_address = ? OR e.recipient_address = ?)
          ${conversationClause}
          AND (e.expires_at IS NULL OR e.expires_at > ?)
          AND e.event_id = (
            SELECT latest.event_id
            FROM rchat_dm_events latest
            WHERE latest.conversation_id = e.conversation_id
              AND (latest.expires_at IS NULL OR latest.expires_at > ?)
            ORDER BY latest.timestamp DESC, latest.event_id DESC
            LIMIT 1
          )
        ORDER BY e.timestamp DESC, e.event_id DESC
      `
      )
      .all(
        address,
        address,
        ...(conversationId ? [conversationId] : []),
        now,
        now
      ) as DirectEventRow[];
    return rows.map((row) => {
      const event = rowToDirectEvent(row);
      const peerAddress =
        event.senderAddress === address
          ? event.recipientAddress
          : event.senderAddress;
      const unread = this.db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM rchat_dm_events incoming
          WHERE incoming.conversation_id = ?
            AND incoming.recipient_address = ?
            AND incoming.sender_address <> ?
            AND incoming.event_type = 'message'
            AND incoming.read_at = 0
            AND (incoming.expires_at IS NULL OR incoming.expires_at > ?)
            AND NOT EXISTS (
              SELECT 1
              FROM rchat_silences silence
              WHERE silence.owner_address = ?
                AND silence.target_address = incoming.sender_address
                AND silence.scope_type = 'dm'
                AND silence.scope_id = incoming.conversation_id
                AND (
                  silence.expires_at IS NULL
                  OR silence.expires_at > ?
                  OR incoming.timestamp <= silence.ignored_through
                )
            )
        `
        )
        .get(event.conversationId, address, address, now, address, now) as
        | { count?: number }
        | undefined;
      return {
        peerAddress,
        conversationId: event.conversationId,
        lastEvent: event,
        unreadCount: Number(unread?.count || 0),
        updatedAt: event.timestamp,
      };
    });
  }

  markDirectRead(
    conversationId: string,
    myAddress: string,
    upToTimestamp: number
  ): void {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    const address = String(myAddress || '').trim();
    if (!normalized || !address || !Number.isFinite(upToTimestamp)) return;
    const watermark = Math.max(0, Math.floor(upToTimestamp));
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO rchat_dm_read_watermarks
          (conversation_id, address, timestamp)
        VALUES (?, ?, ?)
        ON CONFLICT(conversation_id, address) DO UPDATE SET
          timestamp = MAX(timestamp, excluded.timestamp)
      `
        )
        .run(normalized, address, watermark);
      this.db
        .prepare(
          `
        UPDATE rchat_dm_events
        SET read_at = MAX(read_at, ?)
        WHERE conversation_id = ?
          AND recipient_address = ?
          AND timestamp <= ?
          AND read_at = 0
      `
        )
        .run(Date.now(), normalized, address, watermark);
      this.db
        .prepare(
          `UPDATE rchat_direct_call_history
           SET read_at = MAX(read_at, ?)
           WHERE owner_address = ?
             AND conversation_id = ?
             AND direction = 'incoming'
             AND outcome = 'missed'
             AND ended_at <= ?
             AND read_at = 0`
        )
        .run(Date.now(), address, normalized, watermark);
    });
    transaction();
  }

  upsertDirectCallHistory(
    record: ReticulumDirectCallHistoryRecord
  ): { changed: boolean; record: ReticulumDirectCallHistoryRecord } | null {
    const ownerAddress = String(record.ownerAddress || '').trim();
    const peerAddress = String(record.peerAddress || '').trim();
    const callId = String(record.callId || '').trim();
    const conversationId = reticulumDmConversationId(ownerAddress, peerAddress);
    if (!ownerAddress || !peerAddress || !callId || !conversationId)
      return null;
    const outcomeRank: Record<
      ReticulumDirectCallHistoryRecord['outcome'],
      number
    > = {
      missed: 1,
      no_answer: 1,
      cancelled: 2,
      declined: 3,
      answered: 4,
    };
    const existing = this.db
      .prepare(
        `SELECT * FROM rchat_direct_call_history
         WHERE owner_address = ? AND call_id = ?`
      )
      .get(ownerAddress, callId) as
      | {
          owner_address: string;
          call_id: string;
          conversation_id: string;
          peer_address: string;
          direction: string;
          outcome: ReticulumDirectCallHistoryRecord['outcome'];
          started_at: number;
          ended_at: number;
          updated_at: number;
          author_public_key: string;
          signature: string;
          read_at: number;
        }
      | undefined;
    if (
      existing &&
      (outcomeRank[existing.outcome] > outcomeRank[record.outcome] ||
        (outcomeRank[existing.outcome] === outcomeRank[record.outcome] &&
          Number(existing.updated_at) >= Number(record.updatedAt)))
    ) {
      return { changed: false, record: this.directCallRowToRecord(existing) };
    }
    const readAt =
      record.outcome === 'missed' && record.direction === 'incoming'
        ? Math.max(0, Number(record.readAt) || 0)
        : Math.max(Date.now(), Number(record.readAt) || 0);
    this.db
      .prepare(
        `INSERT INTO rchat_direct_call_history
          (owner_address, call_id, conversation_id, peer_address, direction,
           outcome, started_at, ended_at, updated_at, author_public_key,
           signature, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_address, call_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           peer_address = excluded.peer_address,
           direction = excluded.direction,
           outcome = excluded.outcome,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           updated_at = excluded.updated_at,
           author_public_key = excluded.author_public_key,
           signature = excluded.signature,
           read_at = MAX(rchat_direct_call_history.read_at, excluded.read_at)`
      )
      .run(
        ownerAddress,
        callId,
        conversationId,
        peerAddress,
        record.direction,
        record.outcome,
        Math.floor(record.startedAt),
        Math.floor(record.endedAt),
        Math.floor(record.updatedAt),
        record.authorPublicKey,
        record.signature,
        readAt
      );
    const stored = this.db
      .prepare(
        `SELECT * FROM rchat_direct_call_history
         WHERE owner_address = ? AND call_id = ?`
      )
      .get(ownerAddress, callId) as any;
    if (!stored) return null;
    return {
      changed: true,
      record: this.directCallRowToRecord(stored),
    };
  }

  getDirectCallHistory(
    ownerAddress: string,
    peerAddress?: string,
    limit = 100,
    unreadOnly = false
  ): ReticulumDirectCallHistoryRecord[] {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerAddress || '').trim();
    if (!owner || (peerAddress != null && !peer)) return [];
    const safeLimit = Math.max(1, Math.min(250, Math.floor(limit) || 100));
    const rows = this.db
      .prepare(
        `SELECT * FROM rchat_direct_call_history
         WHERE owner_address = ?
           ${peer ? 'AND peer_address = ?' : ''}
           ${unreadOnly ? "AND direction = 'incoming' AND outcome = 'missed' AND read_at = 0" : ''}
         ORDER BY ended_at DESC, call_id DESC
         LIMIT ?`
      )
      .all(owner, ...(peer ? [peer] : []), safeLimit) as any[];
    return rows.map((row) => this.directCallRowToRecord(row));
  }

  getDirectCallSummaries(ownerAddress: string): Array<{
    peerAddress: string;
    lastCall: ReticulumDirectCallHistoryRecord;
    unreadMissedCallCount: number;
  }> {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const rows = this.db
      .prepare(
        `SELECT h.*,
          (SELECT COUNT(*)
             FROM rchat_direct_call_history unread
            WHERE unread.owner_address = h.owner_address
              AND unread.peer_address = h.peer_address
              AND unread.direction = 'incoming'
              AND unread.outcome = 'missed'
              AND unread.read_at = 0) AS unread_missed_count
         FROM rchat_direct_call_history h
         WHERE h.owner_address = ?
           AND h.call_id = (
             SELECT latest.call_id
             FROM rchat_direct_call_history latest
             WHERE latest.owner_address = h.owner_address
               AND latest.peer_address = h.peer_address
             ORDER BY latest.ended_at DESC, latest.call_id DESC
             LIMIT 1
           )
         ORDER BY h.ended_at DESC, h.call_id DESC`
      )
      .all(owner) as Array<any>;
    return rows.map((row) => ({
      peerAddress: String(row.peer_address || ''),
      lastCall: this.directCallRowToRecord(row),
      unreadMissedCallCount: Number(row.unread_missed_count || 0),
    }));
  }

  private directCallRowToRecord(row: any): ReticulumDirectCallHistoryRecord {
    return {
      ownerAddress: String(row.owner_address || ''),
      callId: String(row.call_id || ''),
      conversationId: String(row.conversation_id || ''),
      peerAddress: String(row.peer_address || ''),
      direction: row.direction === 'incoming' ? 'incoming' : 'outgoing',
      outcome: row.outcome,
      startedAt: Number(row.started_at || 0),
      endedAt: Number(row.ended_at || 0),
      updatedAt: Number(row.updated_at || 0),
      authorPublicKey: String(row.author_public_key || ''),
      signature: String(row.signature || ''),
      readAt: Number(row.read_at || 0),
    };
  }

  getDirectReadWatermark(conversationId: string, myAddress: string): number {
    const normalized = normalizeReticulumDmConversationId(conversationId);
    const address = String(myAddress || '').trim();
    if (!normalized || !address) return 0;
    const row = this.stmtGetDirectWatermark.get(normalized, address) as
      | { timestamp?: number }
      | undefined;
    return Math.max(0, Number(row?.timestamp) || 0);
  }

  upsertDeviceReadState(state: ReticulumChatDeviceReadState): boolean {
    const ownerAddress = String(state.ownerAddress || '').trim();
    const scopeType = state.scopeType;
    const scopeId = String(state.scopeId || '').trim();
    const upToTimestamp = Math.floor(Number(state.upToTimestamp));
    const signedAt = Math.floor(Number(state.signedAt));
    if (
      !ownerAddress ||
      (scopeType !== 'group' && scopeType !== 'dm') ||
      !scopeId ||
      !Number.isFinite(upToTimestamp) ||
      upToTimestamp <= 0 ||
      !Number.isFinite(signedAt) ||
      signedAt <= 0 ||
      !state.authorPublicKey ||
      !state.signature
    ) {
      return false;
    }
    const result = this.db
      .prepare(
        `
        INSERT INTO rchat_device_read_state
          (owner_address, scope_type, scope_id, group_id, channel_id,
           conversation_id, peer_address, up_to_timestamp, signed_at, author_public_key,
           signature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_address, scope_type, scope_id) DO UPDATE SET
          group_id = excluded.group_id,
          channel_id = excluded.channel_id,
          conversation_id = excluded.conversation_id,
          peer_address = excluded.peer_address,
          up_to_timestamp = excluded.up_to_timestamp,
          signed_at = excluded.signed_at,
          author_public_key = excluded.author_public_key,
          signature = excluded.signature
        WHERE excluded.up_to_timestamp > rchat_device_read_state.up_to_timestamp
           OR (
             excluded.up_to_timestamp = rchat_device_read_state.up_to_timestamp
             AND excluded.signed_at > rchat_device_read_state.signed_at
           )
      `
      )
      .run(
        ownerAddress,
        scopeType,
        scopeId,
        state.groupId ?? null,
        state.channelId ?? null,
        state.conversationId ?? null,
        state.peerAddress ?? null,
        upToTimestamp,
        signedAt,
        state.authorPublicKey,
        state.signature
      );
    return result.changes > 0;
  }

  getDeviceReadStates(
    ownerAddress: string,
    limit = 2_000
  ): ReticulumChatDeviceReadState[] {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit || 2_000)));
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM rchat_device_read_state
        WHERE owner_address = ?
        ORDER BY signed_at DESC, scope_type ASC, scope_id ASC
        LIMIT ?
      `
      )
      .all(owner, safeLimit) as Array<{
      owner_address: string;
      scope_type: 'group' | 'dm';
      scope_id: string;
      group_id?: number | null;
      channel_id?: string | null;
      conversation_id?: string | null;
      peer_address?: string | null;
      up_to_timestamp: number;
      signed_at: number;
      author_public_key: string;
      signature: string;
    }>;
    return rows.map((row) => ({
      ownerAddress: row.owner_address,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      ...(typeof row.group_id === 'number' ? { groupId: row.group_id } : {}),
      ...(row.channel_id ? { channelId: row.channel_id } : {}),
      ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
      ...(row.peer_address ? { peerAddress: row.peer_address } : {}),
      upToTimestamp: row.up_to_timestamp,
      signedAt: row.signed_at,
      authorPublicKey: row.author_public_key,
      signature: row.signature,
    }));
  }

  getDeviceReadState(
    ownerAddress: string,
    scopeType: 'group' | 'dm',
    scopeId: string
  ): ReticulumChatDeviceReadState | null {
    const owner = String(ownerAddress || '').trim();
    const id = String(scopeId || '').trim();
    if (!owner || !id) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM rchat_device_read_state
         WHERE owner_address = ? AND scope_type = ? AND scope_id = ?
         LIMIT 1`
      )
      .get(owner, scopeType, id) as
      | {
          owner_address: string;
          scope_type: 'group' | 'dm';
          scope_id: string;
          group_id?: number | null;
          channel_id?: string | null;
          conversation_id?: string | null;
          peer_address?: string | null;
          up_to_timestamp: number;
          signed_at: number;
          author_public_key: string;
          signature: string;
        }
      | undefined;
    return row
      ? {
          ownerAddress: row.owner_address,
          scopeType: row.scope_type,
          scopeId: row.scope_id,
          ...(typeof row.group_id === 'number'
            ? { groupId: row.group_id }
            : {}),
          ...(row.channel_id ? { channelId: row.channel_id } : {}),
          ...(row.conversation_id
            ? { conversationId: row.conversation_id }
            : {}),
          ...(row.peer_address ? { peerAddress: row.peer_address } : {}),
          upToTimestamp: row.up_to_timestamp,
          signedAt: row.signed_at,
          authorPublicKey: row.author_public_key,
          signature: row.signature,
        }
      : null;
  }

  upsertPendingDeviceReadState(
    state: ReticulumChatPendingDeviceReadState
  ): void {
    this.db
      .prepare(
        `
        INSERT INTO rchat_pending_device_read_state
          (owner_address, scope_type, scope_id, group_id, channel_id,
           conversation_id, peer_address, up_to_timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_address, scope_type, scope_id) DO UPDATE SET
          group_id = excluded.group_id,
          channel_id = excluded.channel_id,
          conversation_id = excluded.conversation_id,
          peer_address = excluded.peer_address,
          up_to_timestamp = MAX(
            rchat_pending_device_read_state.up_to_timestamp,
            excluded.up_to_timestamp
          ),
          updated_at = excluded.updated_at
      `
      )
      .run(
        state.ownerAddress,
        state.scopeType,
        state.scopeId,
        state.groupId ?? null,
        state.channelId ?? null,
        state.conversationId ?? null,
        state.peerAddress ?? null,
        state.upToTimestamp,
        state.updatedAt
      );
  }

  getPendingDeviceReadStates(
    ownerAddress: string,
    limit = 5_000
  ): ReticulumChatPendingDeviceReadState[] {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `
        SELECT pending.*
        FROM rchat_pending_device_read_state pending
        LEFT JOIN rchat_device_read_state signed
          ON signed.owner_address = pending.owner_address
         AND signed.scope_type = pending.scope_type
         AND signed.scope_id = pending.scope_id
        WHERE pending.owner_address = ?
          AND pending.up_to_timestamp > COALESCE(signed.up_to_timestamp, 0)
        ORDER BY pending.updated_at ASC, pending.scope_type ASC, pending.scope_id ASC
        LIMIT ?
      `
      )
      .all(owner, safeLimit) as Array<{
      owner_address: string;
      scope_type: 'group' | 'dm';
      scope_id: string;
      group_id?: number | null;
      channel_id?: string | null;
      conversation_id?: string | null;
      peer_address?: string | null;
      up_to_timestamp: number;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      ownerAddress: row.owner_address,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      ...(typeof row.group_id === 'number' ? { groupId: row.group_id } : {}),
      ...(row.channel_id ? { channelId: row.channel_id } : {}),
      ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
      ...(row.peer_address ? { peerAddress: row.peer_address } : {}),
      upToTimestamp: row.up_to_timestamp,
      updatedAt: row.updated_at,
    }));
  }

  deletePendingDeviceReadState(
    ownerAddress: string,
    scopeType: 'group' | 'dm',
    scopeId: string,
    upToTimestamp: number
  ): void {
    this.db
      .prepare(
        `DELETE FROM rchat_pending_device_read_state
         WHERE owner_address = ? AND scope_type = ? AND scope_id = ?
           AND up_to_timestamp <= ?`
      )
      .run(ownerAddress, scopeType, scopeId, upToTimestamp);
  }

  private mapDeviceStateRow(row: {
    owner_address: string;
    key: string;
    value?: string | null;
    signed_at: number;
    expires_at?: number | null;
    author_public_key: string;
    signature: string;
  }): ReticulumChatDeviceStateRecord {
    return {
      ownerAddress: String(row.owner_address),
      key: String(row.key),
      value: row.value == null ? null : String(row.value),
      signedAt: Number(row.signed_at) || 0,
      expiresAt: row.expires_at == null ? null : Number(row.expires_at) || 0,
      authorPublicKey: String(row.author_public_key),
      signature: String(row.signature),
    };
  }

  private normalizeDeviceStateExpiresAt(
    expiresAt: unknown
  ): number | null | undefined {
    if (expiresAt == null) return null;
    const value = Math.floor(Number(expiresAt));
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return value;
  }

  upsertDeviceState(record: ReticulumChatDeviceStateRecord): boolean {
    const ownerAddress = String(record.ownerAddress || '').trim();
    const key = String(record.key || '');
    const signedAt = Math.floor(Number(record.signedAt));
    const expiresAt = this.normalizeDeviceStateExpiresAt(record.expiresAt);
    const value = record.value == null ? null : String(record.value);
    if (
      !ownerAddress ||
      !key ||
      !Number.isFinite(signedAt) ||
      signedAt <= 0 ||
      expiresAt === undefined ||
      !record.authorPublicKey ||
      !record.signature
    ) {
      return false;
    }
    const result = this.db
      .prepare(
        `
        INSERT INTO rchat_device_state
          (owner_address, key, value, signed_at, expires_at,
           author_public_key, signature)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_address, key) DO UPDATE SET
          value = excluded.value,
          signed_at = excluded.signed_at,
          expires_at = excluded.expires_at,
          author_public_key = excluded.author_public_key,
          signature = excluded.signature
        WHERE excluded.signed_at > rchat_device_state.signed_at
      `
      )
      .run(
        ownerAddress,
        key,
        value,
        signedAt,
        expiresAt,
        record.authorPublicKey,
        record.signature
      );
    return result.changes > 0;
  }

  getDeviceState(
    ownerAddress: string,
    key: string
  ): ReticulumChatDeviceStateRecord | null {
    const owner = String(ownerAddress || '').trim();
    const normalizedKey = String(key || '');
    if (!owner || !normalizedKey) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM rchat_device_state
         WHERE owner_address = ? AND key = ?
         LIMIT 1`
      )
      .get(owner, normalizedKey) as
      | Parameters<ReticulumChatDatabase['mapDeviceStateRow']>[0]
      | undefined;
    return row ? this.mapDeviceStateRow(row) : null;
  }

  getDeviceStates(
    ownerAddress: string,
    keyPrefix?: string,
    limit = 5_000
  ): ReticulumChatDeviceStateRecord[] {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit || 5_000)));
    // Exact-case prefix match: keys are case-sensitive ASCII and SQLite's
    // LIKE folds ASCII case by default. `key >= ?` lets the primary key
    // index seek to the prefix; `substr` (characters) bounds it.
    const prefix = String(keyPrefix || '');
    const now = Date.now();
    const rows = (
      prefix
        ? this.db
            .prepare(
              `
              SELECT *
              FROM rchat_device_state
              WHERE owner_address = ?
                AND key >= ?
                AND substr(key, 1, ?) = ?
                AND (expires_at IS NULL OR expires_at > ?)
              ORDER BY signed_at ASC, key ASC
              LIMIT ?
            `
            )
            .all(owner, prefix, prefix.length, prefix, now, safeLimit)
        : this.db
            .prepare(
              `
              SELECT *
              FROM rchat_device_state
              WHERE owner_address = ?
                AND (expires_at IS NULL OR expires_at > ?)
              ORDER BY signed_at ASC, key ASC
              LIMIT ?
            `
            )
            .all(owner, now, safeLimit)
    ) as Array<Parameters<ReticulumChatDatabase['mapDeviceStateRow']>[0]>;
    return rows.map((row) => this.mapDeviceStateRow(row));
  }

  getDeviceStatesSince(
    ownerAddress: string,
    sinceSignedAt: number,
    limit = 5_000
  ): ReticulumChatDeviceStateRecord[] {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const since = Math.max(0, Math.floor(Number(sinceSignedAt) || 0));
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit || 5_000)));
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM rchat_device_state
        WHERE owner_address = ?
          AND signed_at > ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY signed_at ASC, key ASC
        LIMIT ?
      `
      )
      .all(owner, since, Date.now(), safeLimit) as Array<
      Parameters<ReticulumChatDatabase['mapDeviceStateRow']>[0]
    >;
    return rows.map((row) => this.mapDeviceStateRow(row));
  }

  getDeviceStatesForReplay(
    ownerAddress: string,
    peerHash: string,
    limit = 5_000
  ): ReticulumChatDeviceStateRecord[] {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerHash || '').trim();
    if (!owner || !peer) return [];
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit || 5_000)));
    const rows = this.db
      .prepare(
        `
        SELECT s.*
        FROM rchat_device_state s
        LEFT JOIN rchat_device_state_ack a
          ON a.owner_address = s.owner_address
         AND a.key = s.key
         AND a.peer_hash = ?
        WHERE s.owner_address = ?
          AND (a.signed_at IS NULL OR a.signed_at < s.signed_at)
          AND (s.expires_at IS NULL OR s.expires_at > ?)
        ORDER BY s.signed_at ASC, s.key ASC
        LIMIT ?
      `
      )
      .all(peer, owner, Date.now(), safeLimit) as Array<
      Parameters<ReticulumChatDatabase['mapDeviceStateRow']>[0]
    >;
    return rows.map((row) => this.mapDeviceStateRow(row));
  }

  /** Newest signed_at held for an owner (0 when none); uses the owner/time index. */
  getNewestDeviceStateSignedAt(ownerAddress: string): number {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return 0;
    const row = this.db
      .prepare(
        `SELECT signed_at
         FROM rchat_device_state
         WHERE owner_address = ?
         ORDER BY signed_at DESC
         LIMIT 1`
      )
      .get(owner) as { signed_at?: number } | undefined;
    const newest = Number(row?.signed_at);
    return Number.isFinite(newest) && newest > 0 ? Math.floor(newest) : 0;
  }

  countDeviceStates(ownerAddress: string): number {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return 0;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM rchat_device_state
         WHERE owner_address = ?`
      )
      .get(owner) as { count?: number } | undefined;
    return Math.max(0, Number(row?.count) || 0);
  }

  upsertDeviceStateAck(
    ownerAddress: string,
    peerHash: string,
    key: string,
    signedAt: number
  ): void {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerHash || '').trim();
    const normalizedKey = String(key || '');
    const at = Math.floor(Number(signedAt));
    if (!owner || !peer || !normalizedKey || !Number.isFinite(at) || at <= 0) {
      return;
    }
    this.db
      .prepare(
        `
        INSERT INTO rchat_device_state_ack
          (owner_address, peer_hash, key, signed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_address, peer_hash, key) DO UPDATE SET
          signed_at = excluded.signed_at
      `
      )
      .run(owner, peer, normalizedKey, at);
  }

  getDeviceStateAck(
    ownerAddress: string,
    peerHash: string,
    key: string
  ): number {
    const owner = String(ownerAddress || '').trim();
    const peer = String(peerHash || '').trim();
    const normalizedKey = String(key || '');
    if (!owner || !peer || !normalizedKey) return 0;
    const row = this.db
      .prepare(
        `SELECT signed_at
         FROM rchat_device_state_ack
         WHERE owner_address = ? AND peer_hash = ? AND key = ?
         LIMIT 1`
      )
      .get(owner, peer, normalizedKey) as { signed_at?: number } | undefined;
    return Math.max(0, Number(row?.signed_at) || 0);
  }

  upsertPendingDeviceState(state: ReticulumChatPendingDeviceState): void {
    const owner = String(state.ownerAddress || '').trim();
    const key = String(state.key || '');
    const updatedAt = Math.floor(Number(state.updatedAt));
    const expiresAt = this.normalizeDeviceStateExpiresAt(state.expiresAt);
    if (
      !owner ||
      !key ||
      !Number.isFinite(updatedAt) ||
      updatedAt <= 0 ||
      expiresAt === undefined
    ) {
      return;
    }
    // Newer updated_at wins; an equal timestamp (two writes in the same
    // millisecond) keeps the latest write so the pending row never lags the
    // caller's most recent value.
    this.db
      .prepare(
        `
        INSERT INTO rchat_pending_device_state
          (owner_address, key, value, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_address, key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= rchat_pending_device_state.updated_at
      `
      )
      .run(
        owner,
        key,
        state.value == null ? null : String(state.value),
        expiresAt,
        updatedAt
      );
  }

  getPendingDeviceStates(
    ownerAddress: string,
    limit = 5_000
  ): ReticulumChatPendingDeviceState[] {
    const owner = String(ownerAddress || '').trim();
    if (!owner) return [];
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit || 5_000)));
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM rchat_pending_device_state
        WHERE owner_address = ?
        ORDER BY updated_at ASC, key ASC
        LIMIT ?
      `
      )
      .all(owner, safeLimit) as Array<{
      owner_address: string;
      key: string;
      value?: string | null;
      expires_at?: number | null;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      ownerAddress: String(row.owner_address),
      key: String(row.key),
      value: row.value == null ? null : String(row.value),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at) || 0,
      updatedAt: Number(row.updated_at) || 0,
    }));
  }

  deletePendingDeviceState(
    ownerAddress: string,
    key: string,
    upToUpdatedAt: number
  ): void {
    const owner = String(ownerAddress || '').trim();
    const normalizedKey = String(key || '');
    if (!owner || !normalizedKey) return;
    this.db
      .prepare(
        `DELETE FROM rchat_pending_device_state
         WHERE owner_address = ? AND key = ?
           AND updated_at <= ?`
      )
      .run(owner, normalizedKey, Math.floor(Number(upToUpdatedAt) || 0));
  }

  pruneDeviceStates(now = Date.now()): {
    expired: number;
    tombstones: number;
  } {
    const at = Math.floor(Number(now) || Date.now());
    const tombstoneCutoff = at - RETICULUM_CHAT_DEVICE_STATE_TOMBSTONE_TTL_MS;
    const tx = this.db.transaction(() => {
      // Acks first: they reference the rows about to disappear and would
      // otherwise linger forever (nothing re-acks a deleted key).
      this.db
        .prepare(
          `
          DELETE FROM rchat_device_state_ack
          WHERE EXISTS (
            SELECT 1 FROM rchat_device_state s
            WHERE s.owner_address = rchat_device_state_ack.owner_address
              AND s.key = rchat_device_state_ack.key
              AND s.expires_at IS NOT NULL
              AND s.expires_at <= ?
          )
        `
        )
        .run(at);
      const expired = this.db
        .prepare(
          `DELETE FROM rchat_device_state
           WHERE expires_at IS NOT NULL AND expires_at <= ?`
        )
        .run(at).changes;
      this.db
        .prepare(
          `
          DELETE FROM rchat_device_state_ack
          WHERE EXISTS (
            SELECT 1 FROM rchat_device_state s
            WHERE s.owner_address = rchat_device_state_ack.owner_address
              AND s.key = rchat_device_state_ack.key
              AND s.value IS NULL
              AND s.signed_at < ?
          )
        `
        )
        .run(tombstoneCutoff);
      const tombstones = this.db
        .prepare(
          `DELETE FROM rchat_device_state
           WHERE value IS NULL AND signed_at < ?`
        )
        .run(tombstoneCutoff).changes;
      return {
        expired: Math.max(0, Number(expired) || 0),
        tombstones: Math.max(0, Number(tombstones) || 0),
      };
    });
    return tx();
  }

  pruneExpiredMessages(now = Date.now(), limit = 5000): number {
    const batchLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const roots = this.db
      .prepare(
        `
          SELECT root_event_id, group_id, channel_id
          FROM rchat_message_projection
          WHERE expires_at IS NOT NULL AND expires_at <= ?
          ORDER BY expires_at ASC, root_event_id ASC
          LIMIT ?
        `
      )
      .all(now, batchLimit) as Array<{
      root_event_id?: string;
      group_id?: number;
      channel_id?: string;
    }>;
    if (roots.length === 0) {
      this.lastExpiryPruneAt = now;
      return 0;
    }
    const rootIds = roots
      .map((row) =>
        typeof row.root_event_id === 'string' ? row.root_event_id : ''
      )
      .filter(Boolean);
    const getThreadEvents = this.db.prepare(`
      SELECT event_id, group_id, channel_id, author_address, author_stream_id, author_seq, timestamp
      FROM reticulum_chat_events
      WHERE event_id = ? OR target_event_id = ?
    `);
    const insertExpiredMarker = this.db.prepare(`
      INSERT OR IGNORE INTO rchat_expired_event_markers
        (event_id, group_id, channel_id, author_address, author_stream_id, author_seq, timestamp, expired_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const dropOwnPostDelivery = this.ownPostDeliveryDropper('group');
    const tx = this.db.transaction((ids: string[]) => {
      for (const rootEventId of ids) {
        const rows = getThreadEvents.all(rootEventId, rootEventId) as Array<{
          event_id?: string;
          group_id?: number;
          channel_id?: string;
          author_address?: string;
          author_stream_id?: string;
          author_seq?: number;
          timestamp?: number;
        }>;
        const eventIds = rows
          .map((row) => (typeof row.event_id === 'string' ? row.event_id : ''))
          .filter(Boolean);
        for (const row of rows) {
          if (
            typeof row.event_id !== 'string' ||
            typeof row.author_address !== 'string' ||
            !Number.isInteger(row.group_id) ||
            !Number.isInteger(row.author_seq) ||
            !Number.isFinite(row.timestamp)
          ) {
            continue;
          }
          insertExpiredMarker.run(
            row.event_id,
            row.group_id,
            normalizeReticulumChatChannelId(row.channel_id),
            row.author_address,
            normalizeReticulumChatAuthorStreamId(row.author_stream_id),
            row.author_seq,
            Math.floor(Number(row.timestamp)),
            now
          );
        }
        for (const eventId of eventIds) {
          this.memoryMeta.delete(eventId);
          this.memoryEvents.delete(eventId);
          this.memoryScrubbedEvents.delete(eventId);
          this.memoryScrubbedEventOverrides.delete(eventId);
          this.memorySearchText.delete(eventId);
          this.memoryMentions.delete(eventId);
          this.memoryRelayCache.delete(eventId);
          this.stmtDeleteSearchText.run(eventId);
          this.stmtDeleteSearchMirror.run(eventId);
          this.stmtDeleteMentionsForEvent.run(eventId);
          this.stmtDeleteRelayByEvent.run(eventId);
          this.stmtDeleteEvent.run(eventId);
          dropOwnPostDelivery(eventId);
        }
        this.stmtDeleteMessageProjection.run(rootEventId);
        this.memorySearchText.delete(rootEventId);
        this.stmtDeleteSearchText.run(rootEventId);
        this.stmtDeleteSearchMirror.run(rootEventId);
        this.stmtDeleteMentionsForEvent.run(rootEventId);
        this.stmtDeleteRelayByEvent.run(rootEventId);
      }
    });
    tx(rootIds);
    for (const root of roots) {
      const groupId = Number(root.group_id);
      if (!Number.isInteger(groupId) || groupId <= 0) continue;
      this.invalidateChatSummaryCache(groupId, root.channel_id);
    }
    this.lastExpiryPruneAt = now;
    return rootIds.length;
  }

  private pruneExpiredMessagesThrottled(now = Date.now()): void {
    if (now - this.lastExpiryPruneAt < RETICULUM_CHAT_EXPIRY_PRUNE_INTERVAL_MS)
      return;
    this.pruneExpiredMessages(now);
  }

  pruneExpiredDirectMessages(
    now = Date.now(),
    limit = 250
  ): ReticulumDmExpiryPruneResult {
    const batchLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const roots = this.db
      .prepare(
        `SELECT event_id
         FROM rchat_dm_events
         WHERE event_type = 'message'
           AND expires_at IS NOT NULL
           AND expires_at <= ?
         ORDER BY expires_at ASC, event_id ASC
         LIMIT ?`
      )
      .all(now, batchLimit) as Array<{ event_id?: string }>;
    const rootIds = roots
      .map((row) => String(row.event_id || ''))
      .filter(Boolean);
    if (rootIds.length === 0) {
      this.lastDirectExpiryPruneAt = now;
      return { eventIds: [], conversations: [] };
    }
    const getEvents = this.db.prepare(
      `SELECT * FROM rchat_dm_events
       WHERE event_id = ? OR target_event_id = ?`
    );
    const deleteEvent = this.db.prepare(
      `DELETE FROM rchat_dm_events WHERE event_id = ?`
    );
    const dropOwnPostDelivery = this.ownPostDeliveryDropper('self_dm');
    const affectedEventIds: string[] = [];
    const affectedConversations = new Map<string, Set<string>>();
    const transaction = this.db.transaction((ids: string[]) => {
      for (const rootEventId of ids) {
        const rows = getEvents.all(
          rootEventId,
          rootEventId
        ) as DirectEventRow[];
        for (const row of rows) {
          const event = rowToDirectEvent(row);
          this.recordExpiredDirectEventMarker(event, now);
          deleteEvent.run(event.eventId);
          dropOwnPostDelivery(event.eventId);
          affectedEventIds.push(event.eventId);
          const peers =
            affectedConversations.get(event.conversationId) ??
            new Set<string>();
          peers.add(event.senderAddress);
          peers.add(event.recipientAddress);
          affectedConversations.set(event.conversationId, peers);
        }
      }
    });
    transaction(rootIds);
    this.lastDirectExpiryPruneAt = now;
    return {
      eventIds: affectedEventIds,
      conversations: [...affectedConversations].map(
        ([conversationId, peerAddresses]) => ({
          conversationId,
          peerAddresses: [...peerAddresses],
        })
      ),
    };
  }

  private pruneExpiredDirectMessagesThrottled(now = Date.now()): void {
    if (
      now - this.lastDirectExpiryPruneAt <
      RETICULUM_CHAT_EXPIRY_PRUNE_INTERVAL_MS
    ) {
      return;
    }
    this.pruneExpiredDirectMessages(now);
  }

  /**
   * Starts tracking an own post written on this device. A second start for
   * the same event changes nothing. Returns whether a row was added.
   */
  startOwnPostDelivery(record: {
    eventId: string;
    scope: ReticulumOwnPostDeliveryScope;
    groupId?: number;
    channelId?: string;
    conversationId?: string;
    authorAddress: string;
    createdAt: number;
  }): boolean {
    const eventId = String(record.eventId || '');
    const authorAddress = String(record.authorAddress || '');
    const createdAt = positiveTimestampOrNull(record.createdAt);
    if (
      !eventId ||
      !authorAddress ||
      createdAt === null ||
      (record.scope !== 'group' && record.scope !== 'self_dm')
    ) {
      return false;
    }
    const groupId =
      record.scope === 'group' && Number.isInteger(record.groupId)
        ? Number(record.groupId)
        : null;
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO rchat_own_post_delivery
           (event_id, scope, group_id, channel_id, conversation_id,
            author_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        record.scope,
        groupId,
        record.scope === 'group' ? String(record.channelId || '') : null,
        record.scope === 'self_dm' ? String(record.conversationId || '') : null,
        authorAddress,
        createdAt
      );
    return Number(result.changes) > 0;
  }

  /**
   * Records proofs in one transaction. Forward-only: a time already set is
   * never replaced, and a member's proof keeps the first member's peer.
   * Returns the ids of the rows that changed.
   */
  markOwnPostDelivery(marks: ReticulumOwnPostDeliveryMark[]): string[] {
    const valid = (Array.isArray(marks) ? marks : []).filter(
      (mark) =>
        mark &&
        typeof mark.eventId === 'string' &&
        mark.eventId.length > 0 &&
        (positiveTimestampOrNull(mark.ownDeviceAt) !== null ||
          positiveTimestampOrNull(mark.memberAt) !== null)
    );
    if (valid.length === 0) return [];
    const markOwnDevice = this.db.prepare(
      `UPDATE rchat_own_post_delivery
       SET own_device_at = COALESCE(own_device_at, ?),
           proof_kind = COALESCE(proof_kind, ?)
       WHERE event_id = ? AND own_device_at IS NULL`
    );
    const markMember = this.db.prepare(
      `UPDATE rchat_own_post_delivery
       SET member_at = COALESCE(member_at, ?),
           member_peer_hash = ?,
           proof_kind = ?
       WHERE event_id = ? AND member_at IS NULL`
    );
    const changed = new Set<string>();
    const tx = this.db.transaction((items: ReticulumOwnPostDeliveryMark[]) => {
      for (const mark of items) {
        const proofKind = mark.proofKind ? String(mark.proofKind) : null;
        const ownDeviceAt = positiveTimestampOrNull(mark.ownDeviceAt);
        if (
          ownDeviceAt !== null &&
          Number(
            markOwnDevice.run(ownDeviceAt, proofKind, mark.eventId).changes
          ) > 0
        ) {
          changed.add(mark.eventId);
        }
        const memberAt = positiveTimestampOrNull(mark.memberAt);
        if (
          memberAt !== null &&
          Number(
            markMember.run(
              memberAt,
              mark.memberPeerHash ? String(mark.memberPeerHash) : null,
              proofKind,
              mark.eventId
            ).changes
          ) > 0
        ) {
          changed.add(mark.eventId);
        }
      }
    });
    tx(valid);
    return [...changed];
  }

  /** Tracked own posts created at or after `sinceMs`, oldest first. */
  listOwnPostDelivery(sinceMs: number): ReticulumOwnPostDeliveryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, scope, group_id, channel_id, conversation_id,
                author_address, created_at, own_device_at, member_at,
                member_peer_hash, proof_kind
         FROM rchat_own_post_delivery
         WHERE created_at >= ?
         ORDER BY created_at ASC, event_id ASC`
      )
      .all(
        Math.max(0, Math.floor(Number(sinceMs) || 0))
      ) as OwnPostDeliveryRow[];
    const records: ReticulumOwnPostDeliveryRecord[] = [];
    for (const row of rows) {
      const scope: ReticulumOwnPostDeliveryScope | null =
        row.scope === 'group'
          ? 'group'
          : row.scope === 'self_dm'
            ? 'self_dm'
            : null;
      const createdAt = positiveTimestampOrNull(row.created_at);
      if (
        !scope ||
        typeof row.event_id !== 'string' ||
        !row.event_id ||
        typeof row.author_address !== 'string' ||
        createdAt === null
      ) {
        continue;
      }
      records.push({
        eventId: row.event_id,
        scope,
        groupId: Number.isInteger(row.group_id) ? Number(row.group_id) : null,
        channelId: typeof row.channel_id === 'string' ? row.channel_id : null,
        conversationId:
          typeof row.conversation_id === 'string' ? row.conversation_id : null,
        authorAddress: row.author_address,
        createdAt,
        ownDeviceAt: positiveTimestampOrNull(row.own_device_at),
        memberAt: positiveTimestampOrNull(row.member_at),
        memberPeerHash:
          typeof row.member_peer_hash === 'string'
            ? row.member_peer_hash
            : null,
        proofKind: typeof row.proof_kind === 'string' ? row.proof_kind : null,
      });
    }
    return records;
  }

  /**
   * For one expiry prune pass: drops the delivery row of an expiring post.
   * The tracked ids (30 days of own posts; none on desktop) are read once,
   * and the delete is prepared only when one of them expires, so untracked
   * posts cost nothing.
   */
  private ownPostDeliveryDropper(
    scope: ReticulumOwnPostDeliveryScope
  ): (eventId: string) => void {
    const rows = this.db
      .prepare(
        `SELECT event_id FROM rchat_own_post_delivery
         WHERE created_at >= ? AND scope = ?`
      )
      .all(0, scope) as Array<{ event_id?: unknown }>;
    const tracked = new Set<string>();
    for (const row of rows) {
      if (typeof row.event_id === 'string' && row.event_id) {
        tracked.add(row.event_id);
      }
    }
    if (tracked.size === 0) return () => {};
    let deleteRow: Statement | null = null;
    return (eventId: string) => {
      if (!tracked.has(eventId)) return;
      if (!deleteRow) {
        deleteRow = this.db.prepare(
          `DELETE FROM rchat_own_post_delivery WHERE event_id = ?`
        );
      }
      deleteRow.run(eventId);
    };
  }

  /** Drops tracked own posts created before `beforeMs`. */
  pruneOwnPostDelivery(beforeMs: number): number {
    const result = this.db
      .prepare(`DELETE FROM rchat_own_post_delivery WHERE created_at < ?`)
      .run(Math.max(0, Math.floor(Number(beforeMs) || 0)));
    return Number(result.changes) || 0;
  }

  getNextDirectExpiryAt(now = Date.now()): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(expires_at) AS expires_at
         FROM rchat_dm_events
         WHERE expires_at IS NOT NULL`
      )
      .get() as { expires_at?: number | null } | undefined;
    if (row?.expires_at == null) return null;
    const expiresAt = Number(row?.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
    // If a large expiry batch exceeds the bounded prune transaction, schedule
    // another immediate batch instead of leaving overdue rows behind.
    return expiresAt > now ? expiresAt : now + 1;
  }

  private rootMessageExpiryState(root: ReticulumChatEvent): {
    expiresAt: number | null;
    messageExpiryDurationMs?: number;
  } {
    if (
      root.eventType !== 'message' &&
      root.eventType !== 'attachment_manifest'
    ) {
      return { expiresAt: null };
    }
    const channel = this.getChannel(
      root.groupId,
      normalizeReticulumChatChannelId(root.channelId)
    );
    const channelExpiry = normalizeReticulumChatExpiryDurationMs(
      channel?.expiryDurationMs
    );
    const messageExpiry = messageExpiryDurationFromPayload(
      root.encryptedPayload
    );
    const createdAt = Number(root.timestamp);
    return {
      expiresAt: this.resolveMessageExpiresAt(
        root.channelId,
        createdAt,
        channelExpiry,
        messageExpiry
      ),
      ...(messageExpiry !== undefined
        ? { messageExpiryDurationMs: messageExpiry }
        : {}),
    };
  }

  private resolveMessageExpiresAt(
    channelId: unknown,
    createdAt: number,
    channelExpiryDurationMs?: number,
    messageExpiryDurationMs?: number
  ): number | null {
    if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const channelExpiryBase =
      normalizedChannelId === RETICULUM_CHAT_DEFAULT_CHANNEL_ID &&
      this.generalChannelExpiryPolicyAppliedAt > 0
        ? Math.max(createdAt, this.generalChannelExpiryPolicyAppliedAt)
        : createdAt;
    const candidates: number[] = [];
    if (channelExpiryDurationMs !== undefined) {
      candidates.push(channelExpiryBase + channelExpiryDurationMs);
    }
    if (messageExpiryDurationMs !== undefined) {
      candidates.push(createdAt + messageExpiryDurationMs);
    }
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  private rootMessageExpiresAt(root: ReticulumChatEvent): number | null {
    return this.rootMessageExpiryState(root).expiresAt;
  }

  private eventExpiresAt(event: ReticulumChatEvent): number | null {
    if (
      event.eventType === 'message' ||
      event.eventType === 'attachment_manifest'
    ) {
      return this.rootMessageExpiresAt(event);
    }
    if (
      (event.eventType === 'edit' || event.eventType === 'delete') &&
      event.targetEventId
    ) {
      const targetRow = this.stmtGetEvent.get(event.targetEventId) as
        | EventRow
        | undefined;
      if (targetRow?.expires_at) return Number(targetRow.expires_at);
      if (targetRow) return this.rootMessageExpiresAt(rowToEvent(targetRow));
    }
    return null;
  }

  private eventExpiryIsVisible(
    expiresAt: number | null | undefined,
    now = Date.now()
  ): boolean {
    return expiresAt == null || expiresAt > now;
  }

  private eventIsVisible(event: ReticulumChatEvent, now = Date.now()): boolean {
    const meta = this.memoryMeta.get(event.eventId);
    if (meta) return this.eventExpiryIsVisible(meta.expiresAt, now);
    return this.eventExpiryIsVisible(this.eventExpiresAt(event), now);
  }

  getEventExpiresAt(eventId: string): number | null {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return null;
    const row = this.stmtGetEvent.get(normalizedEventId) as
      | EventRow
      | undefined;
    const expiresAt = Number(row?.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null;
  }

  getEventExpiresAtForRenderer(event: ReticulumChatEvent): number | null {
    const projectedExpiry = rendererExpiresAtByEvent.get(event);
    if (projectedExpiry !== undefined) return projectedExpiry;
    const memoryExpiry = this.memoryMeta.get(event.eventId);
    if (memoryExpiry) return memoryExpiry.expiresAt;
    return this.getEventExpiresAt(event.eventId);
  }

  getChannelExpiryReconciliationTargets(groupId?: number): Array<{
    groupId: number;
    channelId: string;
  }> {
    const scoped = Number.isInteger(groupId) && Number(groupId) > 0;
    const rows = this.db
      .prepare(
        `
          SELECT group_id, channel_id
          FROM rchat_channel_expiry_reconciliation
          ${scoped ? 'WHERE group_id = ?' : ''}
          ORDER BY group_id ASC, channel_id ASC
        `
      )
      .all(...(scoped ? [groupId] : [])) as Array<{
      group_id?: number;
      channel_id?: string;
    }>;
    return rows
      .map((row) => ({
        groupId: Number(row.group_id),
        channelId:
          typeof row.channel_id === 'string'
            ? normalizeReticulumChatChannelId(row.channel_id)
            : '',
      }))
      .filter(
        (row) =>
          Number.isInteger(row.groupId) && row.groupId > 0 && !!row.channelId
      );
  }

  reconcileChannelMessageExpiries(
    groupId: number,
    channelId: string,
    limit = 200,
    now = Date.now()
  ): {
    resolutions: Array<{ eventId: string; expiresAt: number | null }>;
    hasMore: boolean;
    pruned: number;
  } {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return { resolutions: [], hasMore: false, pruned: 0 };
    }
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const reconciliation = this.db
      .prepare(
        `
          SELECT group_id, channel_id, revision, expiry_duration_ms,
                 after_timestamp, after_event_id
          FROM rchat_channel_expiry_reconciliation
          WHERE group_id = ? AND channel_id = ?
          LIMIT 1
        `
      )
      .get(groupId, normalizedChannelId) as
      | ChannelExpiryReconciliationRow
      | undefined;
    if (!reconciliation) {
      return { resolutions: [], hasMore: false, pruned: 0 };
    }
    const batchLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `
          SELECT event_id, timestamp, encrypted_payload, expires_at,
                 message_expiry_duration_ms
          FROM reticulum_chat_events
          WHERE group_id = ? AND channel_id = ?
            AND event_type IN ('message', 'attachment_manifest')
            AND (
              timestamp > ?
              OR (timestamp = ? AND event_id > ?)
            )
          ORDER BY timestamp ASC, event_id ASC
          LIMIT ?
        `
      )
      .all(
        groupId,
        normalizedChannelId,
        reconciliation.after_timestamp,
        reconciliation.after_timestamp,
        reconciliation.after_event_id,
        batchLimit
      ) as Array<{
      event_id: string;
      timestamp: number;
      encrypted_payload?: string | null;
      expires_at?: number | null;
      message_expiry_duration_ms?: number | null;
    }>;
    if (rows.length === 0) {
      const deleted = this.db
        .prepare(
          `DELETE FROM rchat_channel_expiry_reconciliation
           WHERE group_id = ? AND channel_id = ?
             AND revision = ? AND after_timestamp = ? AND after_event_id = ?`
        )
        .run(
          groupId,
          normalizedChannelId,
          reconciliation.revision,
          reconciliation.after_timestamp,
          reconciliation.after_event_id
        );
      return {
        resolutions: [],
        hasMore:
          deleted.changes === 0 &&
          !!this.db
            .prepare(
              `SELECT 1 FROM rchat_channel_expiry_reconciliation
               WHERE group_id = ? AND channel_id = ? LIMIT 1`
            )
            .get(groupId, normalizedChannelId),
        pruned: 0,
      };
    }

    const channelExpiryDurationMs = normalizeReticulumChatExpiryDurationMs(
      reconciliation.expiry_duration_ms
    );
    const resolutions = rows.map((row) => {
      const storedMessageExpiry = normalizeReticulumChatExpiryDurationMs(
        row.message_expiry_duration_ms
      );
      const messageExpiryDurationMs =
        storedMessageExpiry ??
        messageExpiryDurationFromPayload(row.encrypted_payload ?? '');
      const timestamp = Number(row.timestamp);
      const previousExpiresAt = Number(row.expires_at);
      const alreadyExpired =
        Number.isFinite(previousExpiresAt) &&
        previousExpiresAt > 0 &&
        previousExpiresAt <= now;
      let expiresAt: number | null = null;
      if (alreadyExpired) {
        expiresAt = previousExpiresAt;
      } else {
        expiresAt = this.resolveMessageExpiresAt(
          normalizedChannelId,
          timestamp,
          channelExpiryDurationMs,
          messageExpiryDurationMs
        );
      }
      return {
        eventId: row.event_id,
        expiresAt,
        messageExpiryDurationMs: messageExpiryDurationMs ?? null,
      };
    });

    const updateRoot = this.db.prepare(`
      UPDATE reticulum_chat_events
      SET expires_at = ?, message_expiry_duration_ms = ?
      WHERE event_id = ?
    `);
    const updateMutations = this.db.prepare(`
      UPDATE reticulum_chat_events SET expires_at = ? WHERE target_event_id = ?
    `);
    const updateRootHeader = this.db.prepare(`
      UPDATE rchat_event_headers
      SET expires_at = ?, message_expiry_duration_ms = ?
      WHERE event_id = ?
    `);
    const updateMutationHeaders = this.db.prepare(`
      UPDATE rchat_event_headers SET expires_at = ? WHERE target_event_id = ?
    `);
    const updateProjection = this.db.prepare(`
      UPDATE rchat_message_projection SET expires_at = ? WHERE root_event_id = ?
    `);
    const tx = this.db.transaction(
      (
        items: Array<{
          eventId: string;
          expiresAt: number | null;
          messageExpiryDurationMs: number | null;
        }>
      ): boolean => {
        const last = rows[rows.length - 1];
        const cursorResult =
          rows.length >= batchLimit && last
            ? this.db
                .prepare(
                  `
                  UPDATE rchat_channel_expiry_reconciliation
                  SET after_timestamp = ?, after_event_id = ?, updated_at = ?
                  WHERE group_id = ? AND channel_id = ?
                    AND revision = ? AND after_timestamp = ? AND after_event_id = ?
                `
                )
                .run(
                  Math.floor(Number(last.timestamp)),
                  last.event_id,
                  now,
                  groupId,
                  normalizedChannelId,
                  reconciliation.revision,
                  reconciliation.after_timestamp,
                  reconciliation.after_event_id
                )
            : this.db
                .prepare(
                  `DELETE FROM rchat_channel_expiry_reconciliation
                 WHERE group_id = ? AND channel_id = ?
                   AND revision = ? AND after_timestamp = ? AND after_event_id = ?`
                )
                .run(
                  groupId,
                  normalizedChannelId,
                  reconciliation.revision,
                  reconciliation.after_timestamp,
                  reconciliation.after_event_id
                );
        if (cursorResult.changes === 0) return false;
        for (const item of items) {
          updateRoot.run(
            item.expiresAt,
            item.messageExpiryDurationMs,
            item.eventId
          );
          updateMutations.run(item.expiresAt, item.eventId);
          updateRootHeader.run(
            item.expiresAt,
            item.messageExpiryDurationMs,
            item.eventId
          );
          updateMutationHeaders.run(item.expiresAt, item.eventId);
          updateProjection.run(item.expiresAt, item.eventId);
        }
        return true;
      }
    );
    const applied = tx(resolutions);
    const hasMore = !!this.db
      .prepare(
        `SELECT 1 FROM rchat_channel_expiry_reconciliation
         WHERE group_id = ? AND channel_id = ? LIMIT 1`
      )
      .get(groupId, normalizedChannelId);
    if (!applied) {
      return { resolutions: [], hasMore, pruned: 0 };
    }
    this.invalidateChatSummaryCache(groupId, normalizedChannelId);

    const resolutionByRoot = new Map(
      resolutions.map((item) => [item.eventId, item] as const)
    );
    for (const [eventId, event] of this.memoryEvents) {
      const rootEventId =
        event.eventType === 'message' ||
        event.eventType === 'attachment_manifest'
          ? event.eventId
          : event.targetEventId;
      if (!rootEventId) continue;
      const resolution = resolutionByRoot.get(rootEventId);
      if (!resolution) continue;
      const meta = this.memoryMeta.get(eventId);
      if (!meta) continue;
      meta.expiresAt = resolution.expiresAt;
      if (eventId === rootEventId) {
        if (resolution.messageExpiryDurationMs != null) {
          meta.messageExpiryDurationMs = resolution.messageExpiryDurationMs;
        } else {
          delete meta.messageExpiryDurationMs;
        }
      }
    }

    const pruned = resolutions.some(
      (item) => item.expiresAt !== null && item.expiresAt <= now
    )
      ? this.pruneExpiredMessages(now, batchLimit)
      : 0;
    return {
      resolutions: resolutions.map(({ eventId, expiresAt }) => ({
        eventId,
        expiresAt,
      })),
      hasMore,
      pruned,
    };
  }

  private recordExpiredEventMarker(
    event: ReticulumChatEvent,
    expiredAt = Date.now()
  ): void {
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO rchat_expired_event_markers
            (event_id, group_id, channel_id, author_address, author_stream_id, author_seq, timestamp, expired_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.eventId,
        event.groupId,
        normalizeReticulumChatChannelId(event.channelId),
        event.authorAddress,
        normalizeReticulumChatAuthorStreamId(event.authorStreamId),
        event.authorSeq,
        event.timestamp,
        expiredAt
      );
  }

  insertEvent(
    event: ReticulumChatEvent,
    ownEvent: boolean,
    privilegedMentionStatus = 0
  ): boolean {
    const authorStreamId = normalizeReticulumChatAuthorStreamId(
      event.authorStreamId
    );
    if (!authorStreamId) return false;
    if (!this.isAuthorizedMessageMutation(event)) return false;
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    // The event row and everything derived from it (v2 header, projection,
    // search text, mentions, scrubs, relay cache trim) commit together. Each
    // was its own autocommit: on GO's OPFS rollback journal that is about 5
    // flushes apiece, ~25 per stored message, ~5 now. Same rows either way;
    // inside another transaction this is a savepoint.
    const hadMemoryEvent = this.memoryEvents.has(event.eventId);
    try {
      return this.runWriteBatch(() =>
        this.insertEventRows(
          event,
          ownEvent,
          privilegedMentionStatus,
          authorStreamId,
          now
        )
      );
    } catch (err) {
      // The rows rolled back. A copy left in memory would make hasEvent say
      // stored, and the event could not be stored again this session.
      if (!hadMemoryEvent) {
        this.memoryEvents.delete(event.eventId);
        this.memoryMeta.delete(event.eventId);
      }
      throw err;
    }
  }

  private insertEventRows(
    event: ReticulumChatEvent,
    ownEvent: boolean,
    privilegedMentionStatus: number,
    authorStreamId: string,
    now: number
  ): boolean {
    const feedTimestamp = this.normalizeFeedTimestamp(event.timestamp, now);
    const rootExpiryState =
      event.eventType === 'message' || event.eventType === 'attachment_manifest'
        ? this.rootMessageExpiryState(event)
        : null;
    const expiresAt = rootExpiryState?.expiresAt ?? this.eventExpiresAt(event);
    const messageExpiryDurationMs = rootExpiryState?.messageExpiryDurationMs;
    if (expiresAt !== null && expiresAt <= now) {
      this.recordExpiredEventMarker(event, now);
      this.clearMissingRangePeerUnavailable(
        event.groupId,
        event.authorAddress,
        authorStreamId,
        event.authorSeq,
        event.authorSeq
      );
      this.pruneSatisfiedMissingRange(
        event.groupId,
        event.authorAddress,
        authorStreamId,
        event.authorSeq,
        event.authorSeq
      );
      return false;
    }
    const result = this.stmtInsertEvent.run({
      event_id: event.eventId,
      group_id: event.groupId,
      channel_id: normalizeReticulumChatChannelId(event.channelId),
      author_address: event.authorAddress,
      author_public_key: event.authorPublicKey,
      author_stream_id: authorStreamId,
      author_seq: event.authorSeq,
      timestamp: event.timestamp,
      feed_timestamp: feedTimestamp,
      event_type: event.eventType,
      target_event_id: event.targetEventId ?? null,
      reply_to_event_id: event.replyToEventId ?? null,
      encrypted_payload: event.encryptedPayload,
      payload_hash: event.payloadHash,
      mention_address_hashes: serializeMentionAddressHashes(
        event.mentionAddressHashes
      ),
      mention_targets: serializeMentionTargets(event.mentionTargets),
      signature: event.signature,
      own_event: ownEvent ? 1 : 0,
      last_served_at: now,
      stored_at: now,
      accepted_at: now,
      wire_bytes: eventWireBytes(event),
      expires_at: expiresAt,
      message_expiry_duration_ms: messageExpiryDurationMs ?? null,
      privileged_mention_status:
        privilegedMentionStatus === 1
          ? 1
          : privilegedMentionStatus === 2
            ? 2
            : 0,
    });
    const inserted = result.changes > 0;
    if (inserted) {
      this.insertEventV2Mirror(
        event,
        ownEvent,
        feedTimestamp,
        now,
        expiresAt,
        messageExpiryDurationMs
      );
      if (ownEvent) {
        this.db
          .prepare(
            `
          DELETE FROM rchat_author_sequence_leases
          WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
            AND author_seq = ? AND owner_id = ?
        `
          )
          .run(
            event.groupId,
            event.authorAddress,
            authorStreamId,
            event.authorSeq,
            this.sequenceLeaseOwnerId
          );
      }
      this.clearMissingRangesForEvent(event);
      this.memoryEvents.set(event.eventId, event);
      this.memoryMeta.set(event.eventId, {
        ownEvent,
        lastServedAt: now,
        storedAt: now,
        wireBytes: eventWireBytes(event),
        expiresAt,
        ...(messageExpiryDurationMs !== undefined
          ? { messageExpiryDurationMs }
          : {}),
      });
      this.applyMessageProjectionEvent(event);
      this.refreshMessageProjectionIndexes(event);
      this.applyDeleteScrubForEvent(event);
      this.invalidateChatSummaryCache(event.groupId, event.channelId);
    }
    if (!ownEvent) this.enforceRelayCacheLimit();
    return inserted;
  }

  getPrivilegedMentionStatus(eventId: string): 0 | 1 | 2 {
    const row = this.stmtGetPrivilegedMentionStatus.get(eventId) as
      | { status?: number }
      | undefined;
    return row?.status === 1 ? 1 : row?.status === 2 ? 2 : 0;
  }

  getCurrentProjectedEventId(rootEventId: string): string | null {
    if (typeof rootEventId !== 'string' || !rootEventId) return null;
    const row = this.stmtGetCurrentProjectedEventId.get(rootEventId) as
      | { event_id?: string }
      | undefined;
    return typeof row?.event_id === 'string' && row.event_id
      ? row.event_id
      : null;
  }

  updatePrivilegedMentionStatus(eventId: string, status: 0 | 1): boolean {
    const changed =
      this.stmtUpdatePrivilegedMentionStatus.run(status, eventId).changes > 0;
    if (changed) {
      const event = this.getEvent(eventId);
      if (event) {
        this.invalidateChatSummaryCache(event.groupId, event.channelId);
      } else {
        this.invalidateChatSummaryCache();
      }
    }
    return changed;
  }

  getPendingPrivilegedMentionEvents(limit = 500): ReticulumChatEvent[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM reticulum_chat_events
           WHERE privileged_mention_status = 2
           ORDER BY accepted_at ASC
           LIMIT ?`
        )
        .all(Math.max(1, Math.min(5000, Math.floor(limit)))) as EventRow[]
    ).map(rowToEvent);
  }

  reserveAuthorSequence(
    groupId: number,
    authorAddress: string
  ): { authorStreamId: string; authorSeq: number } {
    const address = String(authorAddress || '').trim();
    if (!Number.isInteger(groupId) || groupId <= 0 || !address) {
      throw new Error('Invalid group author sequence request');
    }
    this.pruneStaleAuthorSequenceLeases();
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO rchat_author_streams (author_address, stream_id, created_at)
      VALUES (@author_address, @stream_id, @created_at)
    `
      )
      .run({
        author_address: address,
        stream_id: nodeCrypto.randomBytes(16).toString('hex'),
        created_at: Date.now(),
      });
    const streamRow = this.db
      .prepare(
        `
      SELECT stream_id FROM rchat_author_streams WHERE author_address = ?
    `
      )
      .get(address) as { stream_id?: string } | undefined;
    const authorStreamId = normalizeReticulumChatAuthorStreamId(
      streamRow?.stream_id
    );
    if (!authorStreamId) {
      throw new Error('Failed to resolve group author stream');
    }
    const reserve = () => {
      const unresolved = this.db
        .prepare(
          `
        SELECT author_seq FROM rchat_author_sequence_leases
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        LIMIT 1
      `
        )
        .get(groupId, address, authorStreamId) as
        | { author_seq?: number }
        | undefined;
      if (unresolved) {
        throw new ReticulumChatSequenceLeaseBusyError();
      }
      const maxSeq = (table: string): number => {
        const row = this.db
          .prepare(
            `
          SELECT COALESCE(MAX(author_seq), 0) AS max_seq
          FROM ${table}
          WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        `
          )
          .get(groupId, address, authorStreamId) as
          | { max_seq?: number }
          | undefined;
        return Number(row?.max_seq ?? 0);
      };
      const sequence =
        Math.max(
          maxSeq('rchat_event_headers'),
          maxSeq('rchat_expired_event_markers')
        ) + 1;
      if (!Number.isInteger(sequence) || sequence <= 0) {
        throw new Error('Failed to reserve group author sequence');
      }
      this.db
        .prepare(
          `
        INSERT INTO rchat_author_sequence_leases
          (group_id, author_address, author_stream_id, author_seq, owner_id, owner_pid, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          groupId,
          address,
          authorStreamId,
          sequence,
          this.sequenceLeaseOwnerId,
          process.pid,
          Date.now()
        );
      return sequence;
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const authorSeq = reserve();
      this.db.exec('COMMIT');
      return { authorStreamId, authorSeq };
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  releaseAuthorSequence(
    groupId: number,
    authorAddress: string,
    authorStreamId: string,
    authorSeq: number
  ): boolean {
    const address = String(authorAddress || '').trim();
    const streamId = normalizeReticulumChatAuthorStreamId(authorStreamId);
    if (!Number.isInteger(groupId) || groupId <= 0 || !address || !streamId)
      return false;
    if (!Number.isInteger(authorSeq) || authorSeq <= 0) return false;
    const result = this.db
      .prepare(
        `
      DELETE FROM rchat_author_sequence_leases
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND author_seq = ? AND owner_id = ?
    `
      )
      .run(groupId, address, streamId, authorSeq, this.sequenceLeaseOwnerId);
    return result.changes > 0;
  }

  private insertEventV2Mirror(
    event: ReticulumChatEvent,
    ownEvent: boolean,
    feedTimestamp: number,
    now: number,
    expiresAt: number | null,
    messageExpiryDurationMs?: number
  ): void {
    const wireBytes = eventWireBytes(event);
    this.stmtInsertEventHeaderV2.run({
      event_id: event.eventId,
      group_id: event.groupId,
      channel_id: normalizeReticulumChatChannelId(event.channelId),
      author_address: event.authorAddress,
      author_public_key: event.authorPublicKey,
      author_stream_id: normalizeReticulumChatAuthorStreamId(
        event.authorStreamId
      ),
      author_seq: event.authorSeq,
      timestamp: event.timestamp,
      feed_timestamp: feedTimestamp,
      event_type: event.eventType,
      target_event_id: event.targetEventId ?? null,
      reply_to_event_id: event.replyToEventId ?? null,
      payload_hash: event.payloadHash,
      mention_address_hashes: serializeMentionAddressHashes(
        event.mentionAddressHashes
      ),
      mention_targets: serializeMentionTargets(event.mentionTargets),
      signature: event.signature,
      own_event: ownEvent ? 1 : 0,
      last_served_at: now,
      stored_at: now,
      accepted_at: now,
      wire_bytes: wireBytes,
      retention_state: 'full',
      scrubbed_at: null,
      expires_at: expiresAt,
      message_expiry_duration_ms: messageExpiryDurationMs ?? null,
    });
  }

  private isAuthorizedMessageMutation(event: ReticulumChatEvent): boolean {
    if (event.eventType !== 'edit' && event.eventType !== 'delete') return true;
    if (!event.targetEventId) return false;
    const target = this.db
      .prepare(
        `
        SELECT group_id, channel_id, author_address, event_type
        FROM reticulum_chat_events
        WHERE event_id = ?
        LIMIT 1
      `
      )
      .get(event.targetEventId) as
      | {
          group_id?: number;
          channel_id?: string;
          author_address?: string;
          event_type?: string;
        }
      | undefined;
    // Repair pages can arrive out of order. Keep an orphan mutation so it can
    // be applied when its root arrives, but never apply it without matching
    // the root's author and scope.
    if (!target) return true;
    if (
      target.event_type !== 'message' &&
      target.event_type !== 'attachment_manifest'
    ) {
      return false;
    }
    return (
      Number(target.group_id) === event.groupId &&
      normalizeReticulumChatChannelId(target.channel_id) ===
        normalizeReticulumChatChannelId(event.channelId) &&
      target.author_address === event.authorAddress
    );
  }

  private isMutationForMessageRoot(
    event: ReticulumChatEvent,
    root: ReticulumChatEvent
  ): boolean {
    return (
      (event.eventType === 'edit' || event.eventType === 'delete') &&
      event.targetEventId === root.eventId &&
      event.groupId === root.groupId &&
      normalizeReticulumChatChannelId(event.channelId) ===
        normalizeReticulumChatChannelId(root.channelId) &&
      event.authorAddress === root.authorAddress
    );
  }

  private applyDeleteScrubForEvent(event: ReticulumChatEvent): void {
    if (event.eventType === 'delete' && event.targetEventId) {
      this.scrubDeletedMessageThread(
        event.targetEventId,
        event.eventId,
        event.timestamp
      );
      return;
    }
    if (
      (event.eventType === 'message' ||
        event.eventType === 'attachment_manifest') &&
      event.eventId
    ) {
      const deleteRow = this.findDeleteTombstone(event.eventId);
      if (deleteRow) {
        this.scrubDeletedMessageThread(
          event.eventId,
          deleteRow.eventId,
          deleteRow.timestamp || Date.now()
        );
      }
      return;
    }
    if (event.eventType === 'edit' && event.targetEventId) {
      const deleteRow = this.findDeleteTombstone(event.targetEventId);
      if (deleteRow) {
        this.scrubDeletedMessageThread(
          event.targetEventId,
          deleteRow.eventId,
          deleteRow.timestamp || Date.now()
        );
      }
    }
  }

  private scrubExistingDeletedMessagePayloads(): void {
    const rows = this.stmtGetDeleteEvents.all() as Array<{
      event_id?: string;
      target_event_id?: string;
      timestamp?: number;
    }>;
    for (const row of rows) {
      if (typeof row.target_event_id !== 'string' || !row.target_event_id)
        continue;
      this.scrubDeletedMessageThread(
        row.target_event_id,
        typeof row.event_id === 'string' ? row.event_id : null,
        Number(row.timestamp) || Date.now()
      );
    }
  }

  private findDeleteTombstone(
    rootEventId: string
  ): { eventId: string; timestamp: number } | null {
    if (typeof rootEventId !== 'string' || !rootEventId) return null;
    const rows = this.stmtGetMessageProjectionEvents.all(
      rootEventId,
      rootEventId
    ) as EventRow[];
    const events = rows.map(rowToEvent);
    for (const event of this.memoryEvents.values()) {
      if (
        event.eventId === rootEventId ||
        event.targetEventId === rootEventId
      ) {
        events.push(event);
      }
    }
    const root = events.find((event) => event.eventId === rootEventId);
    if (!root) return null;
    const deleteEvent = events
      .filter(
        (event) =>
          event.eventType === 'delete' &&
          this.isMutationForMessageRoot(event, root)
      )
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      )[0];
    if (!deleteEvent) return null;
    return { eventId: deleteEvent.eventId, timestamp: deleteEvent.timestamp };
  }

  private scrubDeletedMessageThread(
    rootEventId: string,
    deletedEventId: string | null,
    scrubbedAt: number
  ): void {
    if (typeof rootEventId !== 'string' || !rootEventId) return;
    const rootEvent = this.getEvent(rootEventId);
    if (!rootEvent) return;
    const candidates = new Map<string, ReticulumChatEvent>();
    candidates.set(rootEvent.eventId, rootEvent);
    try {
      const rows = this.db
        .prepare(
          `
          SELECT *
          FROM reticulum_chat_events
          WHERE group_id = ?
            AND (event_id = ? OR target_event_id = ?)
        `
        )
        .all(rootEvent.groupId, rootEventId, rootEventId) as EventRow[];
      for (const row of rows) {
        const event = rowToEvent(row);
        candidates.set(event.eventId, event);
      }
    } catch {
      // The in-memory write-through cache below still covers current-runtime deletes.
    }
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== rootEvent.groupId) continue;
      if (
        event.eventId === rootEventId ||
        event.targetEventId === rootEventId
      ) {
        candidates.set(event.eventId, event);
      }
    }
    if (deletedEventId) {
      const deleteEvent = candidates.get(deletedEventId);
      if (
        !deleteEvent ||
        deleteEvent.eventType !== 'delete' ||
        !this.isMutationForMessageRoot(deleteEvent, rootEvent)
      ) {
        return;
      }
    }
    const deletedThreadEvents = [...candidates.values()].filter((event) => {
      if (event.eventId === rootEventId) return true;
      return (
        event.eventType === 'edit' &&
        this.isMutationForMessageRoot(event, rootEvent)
      );
    });
    if (deletedThreadEvents.length === 0) return;

    const groupIds = new Set<number>();
    for (const event of deletedThreadEvents) {
      const eventId = event.eventId;
      if (!eventId) continue;
      if (Number.isInteger(event.groupId) && event.groupId > 0) {
        groupIds.add(event.groupId);
      }
      const scrubbedPayload = deletedPayloadScrubMarker(
        eventId,
        deletedEventId
      );
      const scrubbedHash = hashReticulumChatDbPayload(scrubbedPayload);
      const scrubbedEvent: ReticulumChatEvent = {
        ...event,
        encryptedPayload: scrubbedPayload,
        payloadHash: scrubbedHash,
        mentionAddressHashes: [],
        mentionTargets: [],
      };
      const meta = this.memoryMeta.get(eventId);
      const existingRow = this.stmtGetEvent.get(eventId) as
        | EventRow
        | undefined;
      this.memoryEvents.delete(eventId);
      this.memoryScrubbedEvents.add(eventId);
      this.memoryScrubbedEventOverrides.set(eventId, scrubbedEvent);
      this.memorySearchText.delete(eventId);
      this.memoryMentions.delete(eventId);
      const scrubbedWireBytes = Buffer.byteLength(scrubbedPayload, 'utf8');
      const updateResult = this.stmtUpdateScrubbedEvent.run(
        scrubbedPayload,
        scrubbedHash,
        scrubbedWireBytes,
        scrubbedAt,
        eventId
      );
      if (updateResult.changes === 0) {
        this.stmtInsertScrubbedEvent.run({
          event_id: event.eventId,
          group_id: event.groupId,
          author_address: event.authorAddress,
          author_public_key: event.authorPublicKey,
          author_stream_id: normalizeReticulumChatAuthorStreamId(
            event.authorStreamId
          ),
          author_seq: event.authorSeq,
          timestamp: event.timestamp,
          feed_timestamp:
            existingRow?.feed_timestamp ??
            this.normalizeFeedTimestamp(event.timestamp),
          event_type: event.eventType,
          target_event_id: event.targetEventId ?? null,
          reply_to_event_id: event.replyToEventId ?? null,
          encrypted_payload: scrubbedPayload,
          payload_hash: scrubbedHash,
          signature: event.signature,
          own_event: existingRow?.own_event ?? (meta?.ownEvent ? 1 : 0),
          last_served_at:
            existingRow?.last_served_at ?? meta?.lastServedAt ?? scrubbedAt,
          stored_at: existingRow?.stored_at ?? meta?.storedAt ?? scrubbedAt,
          accepted_at: existingRow?.accepted_at ?? scrubbedAt,
          wire_bytes: scrubbedWireBytes,
          channel_id: normalizeReticulumChatChannelId(event.channelId),
          scrubbed_at: scrubbedAt,
          expires_at:
            existingRow?.expires_at ??
            meta?.expiresAt ??
            this.eventExpiresAt(event),
          message_expiry_duration_ms:
            existingRow?.message_expiry_duration_ms ??
            meta?.messageExpiryDurationMs ??
            null,
        });
      }
      this.stmtDeleteSearchText.run(eventId);
      this.stmtDeleteSearchMirror.run(eventId);
      this.stmtDeleteMentionsForEvent.run(eventId);
      this.stmtDeleteRelayByEvent.run(eventId);
      this.memoryRelayCache.delete(eventId);
    }

    for (const groupId of groupIds) {
      this.deleteRelayPayloadsForDeletedRoot(groupId, rootEventId);
    }
    this.rebuildMessageProjection(rootEventId);
  }

  private deleteRelayPayloadsForDeletedRoot(
    groupId: number,
    rootEventId: string
  ): void {
    for (const [eventId, entry] of [...this.memoryRelayCache.entries()]) {
      if (entry.groupId !== groupId) continue;
      if (eventId === rootEventId) {
        this.memoryRelayCache.delete(eventId);
        this.stmtDeleteRelayByEvent.run(eventId);
        continue;
      }
      try {
        const candidate = JSON.parse(
          entry.payloadJson
        ) as Partial<ReticulumChatEvent>;
        if (
          candidate.eventType === 'edit' &&
          candidate.targetEventId === rootEventId
        ) {
          this.memoryRelayCache.delete(eventId);
          this.stmtDeleteRelayByEvent.run(eventId);
        }
      } catch {
        // Malformed relay payloads are ignored here; normal relay validation handles them.
      }
    }
    const rows = this.stmtGetRelayEventsForGroup.all(groupId) as Array<{
      event_id?: string;
      payload_json?: string;
    }>;
    for (const row of rows) {
      const eventId = typeof row.event_id === 'string' ? row.event_id : '';
      if (!eventId) continue;
      if (eventId === rootEventId) {
        this.stmtDeleteRelayByEvent.run(eventId);
        this.memoryRelayCache.delete(eventId);
        continue;
      }
      try {
        const candidate = JSON.parse(
          String(row.payload_json || '')
        ) as Partial<ReticulumChatEvent>;
        if (
          candidate.eventType === 'edit' &&
          candidate.targetEventId === rootEventId
        ) {
          this.stmtDeleteRelayByEvent.run(eventId);
          this.memoryRelayCache.delete(eventId);
        }
      } catch {
        // Malformed relay payloads are ignored here; normal relay validation handles them.
      }
    }
  }

  hasEvent(eventId: string): boolean {
    return (
      this.memoryEvents.has(eventId) ||
      this.memoryScrubbedEventOverrides.has(eventId) ||
      !!this.stmtHasEvent.get(eventId)
    );
  }

  /** Stored signature of a group event (deleted/scrubbed rows keep it), or null when not stored. */
  getEventSignature(eventId: string): string | null {
    if (typeof eventId !== 'string' || !eventId) return null;
    const cached =
      this.memoryEvents.get(eventId) ??
      this.memoryScrubbedEventOverrides.get(eventId);
    if (cached) {
      return typeof cached.signature === 'string' ? cached.signature : null;
    }
    // Runs only after hasEvent() is true, so an ad-hoc prepare is fine.
    const row = this.db
      .prepare(
        'SELECT signature FROM reticulum_chat_events WHERE event_id = ? LIMIT 1'
      )
      .get(eventId) as { signature?: unknown } | undefined;
    return typeof row?.signature === 'string' ? row.signature : null;
  }

  getRejectedEventMarker(
    groupId: number,
    eventId: string
  ): ReticulumChatRejectedEventMarker | null {
    if (!Number.isInteger(groupId) || groupId <= 0 || !eventId) return null;
    const row = this.stmtGetRejectedEventMarker.get(groupId, eventId) as
      | {
          group_id: number;
          event_id: string;
          event_fingerprint: string;
          author_address: string;
          author_stream_id: string;
          author_seq: number;
          digest_fingerprint: string;
          rejected_at: number;
          next_revalidate_at: number;
          revalidation_attempts: number;
        }
      | undefined;
    if (!row) return null;
    return {
      groupId: row.group_id,
      eventId: row.event_id,
      eventFingerprint: row.event_fingerprint,
      authorAddress: row.author_address,
      authorStreamId: normalizeReticulumChatAuthorStreamId(
        row.author_stream_id
      ),
      // Zero is the migration sentinel for markers written before author
      // sequence tracking existed. Keep it distinct from the real sequence 1;
      // newly written markers are still required to use a positive sequence.
      authorSeq: Math.max(0, Math.floor(Number(row.author_seq))),
      digestFingerprint: row.digest_fingerprint,
      rejectedAt: row.rejected_at,
      nextRevalidateAt: row.next_revalidate_at,
      revalidationAttempts: row.revalidation_attempts,
    };
  }

  hasRejectedDigestMarker(groupId: number, digestFingerprint: string): boolean {
    if (!Number.isInteger(groupId) || groupId <= 0 || !digestFingerprint) {
      return false;
    }
    return !!this.stmtHasRejectedDigestMarker.get(groupId, digestFingerprint);
  }

  getRejectedAuthorSeqs(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): number[] {
    const author = authorAddress.trim();
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) {
      return [];
    }
    return (
      this.stmtGetRejectedAuthorSeqs.all(
        groupId,
        author,
        normalizeReticulumChatAuthorStreamId(authorStreamId),
        from,
        to
      ) as Array<{ author_seq?: number }>
    )
      .map((row) => Number(row.author_seq))
      .filter(
        (seq, index, values) =>
          Number.isInteger(seq) &&
          seq >= from &&
          seq <= to &&
          (index === 0 || seq !== values[index - 1])
      );
  }

  upsertRejectedEventMarker(marker: ReticulumChatRejectedEventMarker): void {
    const result = this.stmtUpsertRejectedEventMarker.run(
      marker.groupId,
      marker.eventId,
      marker.eventFingerprint,
      marker.authorAddress,
      normalizeReticulumChatAuthorStreamId(marker.authorStreamId),
      Math.max(1, Math.floor(marker.authorSeq)),
      marker.digestFingerprint,
      marker.rejectedAt,
      marker.nextRevalidateAt,
      marker.revalidationAttempts
    );
    if (result.changes !== 1) {
      throw new Error('Failed to persist rejected Reticulum chat event marker');
    }
  }

  upsertRejectedDigestMarker(
    marker: ReticulumChatRejectedEventMarker,
    digestFingerprint: string
  ): void {
    const digest = digestFingerprint.trim().toLowerCase();
    if (!digest) return;
    const result = this.stmtUpsertRejectedDigestMarker.run(
      marker.groupId,
      marker.eventId,
      marker.eventFingerprint,
      digest,
      marker.rejectedAt,
      marker.nextRevalidateAt
    );
    if (result.changes !== 1) {
      throw new Error(
        'Failed to persist rejected Reticulum chat digest marker'
      );
    }
  }

  deleteRejectedEventMarker(groupId: number, eventId: string): void {
    const tx = this.db.transaction(() => {
      this.stmtDeleteRejectedDigestMarkers.run(groupId, eventId);
      this.stmtDeleteRejectedEventMarker.run(groupId, eventId);
    });
    tx();
  }

  clearMissingRangesForRejectedEvent(event: ReticulumChatEvent): void {
    this.clearMissingRangesForEvent(event);
  }

  maintainRejectedEventMarkers(now: number, retentionMs: number): number {
    const safeNow = Math.max(0, Math.floor(now));
    const safeRetention = Math.max(1, Math.floor(retentionMs));
    const tx = this.db.transaction(() => {
      // Intermediate builds used this column as a short revalidation timer.
      // Extend those rows to the full protocol-valid lifetime before pruning.
      this.db
        .prepare(
          `UPDATE rchat_rejected_event_markers
           SET next_revalidate_at = rejected_at + ?
           WHERE next_revalidate_at < rejected_at + ?`
        )
        .run(safeRetention, safeRetention);
      this.db
        .prepare(
          `UPDATE rchat_rejected_digest_markers
           SET next_revalidate_at = (
             SELECT events.next_revalidate_at
             FROM rchat_rejected_event_markers AS events
             WHERE events.group_id = rchat_rejected_digest_markers.group_id
               AND events.event_id = rchat_rejected_digest_markers.event_id
           )
           WHERE EXISTS (
             SELECT 1 FROM rchat_rejected_event_markers AS events
             WHERE events.group_id = rchat_rejected_digest_markers.group_id
               AND events.event_id = rchat_rejected_digest_markers.event_id
               AND rchat_rejected_digest_markers.next_revalidate_at <
                   events.next_revalidate_at
           )`
        )
        .run();
      const expired = this.db
        .prepare(
          `DELETE FROM rchat_rejected_event_markers
           WHERE next_revalidate_at <= ?`
        )
        .run(safeNow).changes;
      const orphaned = this.db
        .prepare(
          `DELETE FROM rchat_rejected_digest_markers
           WHERE NOT EXISTS (
             SELECT 1 FROM rchat_rejected_event_markers AS events
             WHERE events.group_id = rchat_rejected_digest_markers.group_id
               AND events.event_id = rchat_rejected_digest_markers.event_id
           )`
        )
        .run().changes;
      return expired + orphaned;
    });
    return tx();
  }

  isEventPayloadScrubbed(eventId: string): boolean {
    if (typeof eventId !== 'string' || !eventId) return false;
    if (this.memoryScrubbedEvents.has(eventId)) return true;
    const row = this.stmtIsEventScrubbed.get(eventId) as
      | {
          event_type?: string | null;
          target_event_id?: string | null;
          scrubbed_at?: number | null;
          encrypted_payload?: string | null;
        }
      | undefined;
    const rootEventId =
      row?.event_type === 'edit' && typeof row.target_event_id === 'string'
        ? row.target_event_id
        : eventId;
    return (
      Number.isFinite(row?.scrubbed_at ?? NaN) ||
      isDeletedPayloadScrubMarker(row?.encrypted_payload) ||
      (row?.event_type !== 'delete' &&
        this.findDeleteTombstone(rootEventId) !== null)
    );
  }

  getEvent(eventId: string): ReticulumChatEvent | null {
    const scrubbed = this.memoryScrubbedEventOverrides.get(eventId);
    if (scrubbed) {
      const meta = this.memoryMeta.get(eventId);
      return this.eventExpiryIsVisible(meta?.expiresAt) ? scrubbed : null;
    }
    const inMemory = this.memoryEvents.get(eventId);
    if (inMemory) {
      const meta = this.memoryMeta.get(eventId);
      if (!this.eventExpiryIsVisible(meta?.expiresAt)) return null;
      if (inMemory.eventType === 'delete') return inMemory;
      const deleteRow = this.findDeleteTombstone(
        inMemory.eventType === 'edit'
          ? inMemory.targetEventId || ''
          : inMemory.eventId
      );
      if (!deleteRow) return inMemory;
      const scrubbedPayload = deletedPayloadScrubMarker(
        inMemory.eventId,
        deleteRow.eventId
      );
      return {
        ...inMemory,
        encryptedPayload: scrubbedPayload,
        payloadHash: hashReticulumChatDbPayload(scrubbedPayload),
        mentionAddressHashes: [],
        mentionTargets: [],
      };
    }
    const row = this.stmtGetEvent.get(eventId) as EventRow | undefined;
    if (!row) return null;
    const event = rowToEvent(row);
    if (!this.eventExpiryIsVisible(row.expires_at)) return null;
    if (event.eventType === 'delete') return event;
    const deleteRow = this.findDeleteTombstone(
      event.eventType === 'edit' ? event.targetEventId || '' : event.eventId
    );
    if (!deleteRow) return event;
    const scrubbedPayload = deletedPayloadScrubMarker(
      event.eventId,
      deleteRow.eventId
    );
    return {
      ...event,
      encryptedPayload: scrubbedPayload,
      payloadHash: hashReticulumChatDbPayload(scrubbedPayload),
      mentionAddressHashes: [],
      mentionTargets: [],
    };
  }

  private applyMessageProjectionEvent(event: ReticulumChatEvent): void {
    if (
      event.eventType === 'message' ||
      event.eventType === 'attachment_manifest'
    ) {
      this.rebuildMessageProjection(event.eventId);
      return;
    }
    if (
      (event.eventType === 'edit' || event.eventType === 'delete') &&
      event.targetEventId
    ) {
      this.rebuildMessageProjection(event.targetEventId);
    }
  }

  private rebuildMessageProjection(rootEventId: string): void {
    if (typeof rootEventId !== 'string' || !rootEventId) return;
    const rows = this.stmtGetMessageProjectionEvents.all(
      rootEventId,
      rootEventId
    ) as EventRow[];
    const eventsById = new Map<string, ReticulumChatEvent>();
    const rowsById = new Map<string, EventRow>();
    for (const row of rows) {
      const event = rowToEvent(row);
      eventsById.set(event.eventId, event);
      rowsById.set(event.eventId, row);
    }
    const events = [...eventsById.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
    );
    const root = events.find(
      (candidate) =>
        candidate.eventId === rootEventId &&
        (candidate.eventType === 'message' ||
          candidate.eventType === 'attachment_manifest')
    );
    if (!root) return;
    const rootRow = rowsById.get(root.eventId);
    const expiresAt = Number.isFinite(rootRow?.expires_at ?? NaN)
      ? Number(rootRow?.expires_at)
      : null;
    if (expiresAt !== null && expiresAt <= Date.now()) {
      this.pruneExpiredMessages(Date.now());
      return;
    }

    let current = root;
    let deletedAt: number | null = null;
    let deletedEventId: string | null = null;
    for (const event of events) {
      if (event.eventId === root.eventId) continue;
      if (!this.isMutationForMessageRoot(event, root)) continue;
      if (event.eventType === 'edit') {
        if (deletedAt !== null) continue;
        current = event;
        continue;
      }
      if (event.eventType === 'delete') {
        deletedAt = event.timestamp;
        deletedEventId = event.eventId;
      }
    }

    this.stmtUpsertMessageProjection.run({
      root_event_id: root.eventId,
      group_id: root.groupId,
      channel_id: normalizeReticulumChatChannelId(root.channelId),
      author_address: root.authorAddress,
      author_public_key: root.authorPublicKey,
      author_stream_id: normalizeReticulumChatAuthorStreamId(
        root.authorStreamId
      ),
      author_seq: root.authorSeq,
      created_at: root.timestamp,
      root_event_type: root.eventType,
      current_event_id: current.eventId,
      updated_at: current.timestamp,
      reply_to_event_id: root.replyToEventId ?? null,
      encrypted_payload: current.encryptedPayload,
      payload_hash: current.payloadHash,
      mention_address_hashes: serializeMentionAddressHashes(
        current.mentionAddressHashes
      ),
      mention_targets: serializeMentionTargets(current.mentionTargets),
      signature: root.signature,
      deleted_at: deletedAt,
      deleted_event_id: deletedEventId,
      expires_at: expiresAt,
      has_attachment:
        root.eventType === 'attachment_manifest' ||
        payloadHasReticulumFileAttachment(current.encryptedPayload)
          ? 1
          : 0,
    });
  }

  private deleteCachedEvent(eventId: string): void {
    const event = this.getEvent(eventId);
    this.memoryMeta.delete(eventId);
    this.memoryEvents.delete(eventId);
    this.memoryScrubbedEvents.delete(eventId);
    this.memoryScrubbedEventOverrides.delete(eventId);
    this.memorySearchText.delete(eventId);
    this.memoryMentions.delete(eventId);
    this.stmtDeleteSearchText.run(eventId);
    this.stmtDeleteSearchMirror.run(eventId);
    this.stmtDeleteMentionsForEvent.run(eventId);
    this.stmtDeleteEvent.run(eventId);
    if (!event) return;
    this.invalidateChatSummaryCache(event.groupId, event.channelId);
    if (
      event.eventType === 'message' ||
      event.eventType === 'attachment_manifest'
    ) {
      this.stmtDeleteMessageProjection.run(event.eventId);
      return;
    }
    if (
      (event.eventType === 'edit' || event.eventType === 'delete') &&
      event.targetEventId
    ) {
      this.rebuildMessageProjection(event.targetEventId);
    }
  }

  private relayEntryToDigestEntry(
    entry: ReticulumChatRelayCacheEntry,
    now = Date.now()
  ): ReticulumChatRelayDigestEntry | null {
    if (entry.expiresAt <= now) return null;
    try {
      const event = JSON.parse(
        entry.payloadJson
      ) as Partial<ReticulumChatEvent>;
      if (
        event.groupId !== entry.groupId ||
        event.eventId !== entry.eventId ||
        typeof event.channelId !== 'string' ||
        typeof event.authorAddress !== 'string' ||
        !Number.isInteger(event.authorSeq) ||
        typeof event.timestamp !== 'number' ||
        typeof event.payloadHash !== 'string'
      ) {
        return null;
      }
      return {
        blobId: entry.blobId,
        eventId: entry.eventId,
        groupId: entry.groupId,
        channelId: event.channelId,
        authorAddress: event.authorAddress,
        authorStreamId: normalizeReticulumChatAuthorStreamId(
          event.authorStreamId
        ),
        authorSeq: event.authorSeq,
        timestamp: event.timestamp,
        payloadHash: event.payloadHash,
        createdAt: entry.createdAt,
      };
    } catch {
      return null;
    }
  }

  storeRelayEventBlob(
    event: ReticulumChatEvent,
    payloadJson: string,
    sourcePeerHash: string,
    now = Date.now()
  ):
    | { ok: true; blobId: string; stored: boolean }
    | { ok: false; reason: string } {
    if (!Number.isInteger(event.groupId) || event.groupId <= 0) {
      return { ok: false, reason: 'invalid-group' };
    }
    if (event.eventType === 'attachment_manifest') {
      return { ok: false, reason: 'attachment-events-not-relayed' };
    }
    if (event.eventType === 'delete' && event.targetEventId) {
      this.deleteRelayPayloadsForDeletedRoot(
        event.groupId,
        event.targetEventId
      );
    }
    if (
      (event.eventType === 'message' || event.eventType === 'edit') &&
      this.eventHasDeleteTombstone(
        event.eventType === 'edit' ? event.targetEventId : event.eventId
      )
    ) {
      return { ok: false, reason: 'event-deleted' };
    }
    if (typeof payloadJson !== 'string' || !payloadJson.trim()) {
      return { ok: false, reason: 'empty-payload' };
    }
    const sizeBytes = Buffer.byteLength(payloadJson, 'utf8');
    if (sizeBytes <= 0 || sizeBytes > RETICULUM_CHAT_RELAY_EVENT_MAX_BYTES) {
      return { ok: false, reason: 'payload-too-large' };
    }
    const blobId = reticulumChatRelayBlobId(payloadJson);
    this.stmtDeleteRelayByEvent.run(event.eventId);
    this.stmtDeleteRelayBlob.run(blobId);
    const inserted = this.stmtInsertRelayBlob.run({
      blob_id: blobId,
      event_id: event.eventId,
      group_id: event.groupId,
      group_hash: reticulumChatRelayGroupHash(event.groupId),
      created_at: now,
      expires_at: now + RETICULUM_CHAT_RELAY_CACHE_MAX_AGE_MS,
      size_bytes: sizeBytes,
      encoding: 'plain-json-v1',
      encryption: 'none',
      key_epoch: null,
      encrypted_key_id: null,
      payload_json: payloadJson,
      source_peer_hash: sourcePeerHash.trim().toLowerCase(),
    });
    this.memoryRelayCache.set(event.eventId, {
      blobId,
      eventId: event.eventId,
      groupId: event.groupId,
      groupHash: reticulumChatRelayGroupHash(event.groupId),
      createdAt: now,
      expiresAt: now + RETICULUM_CHAT_RELAY_CACHE_MAX_AGE_MS,
      sizeBytes,
      encoding: 'plain-json-v1',
      encryption: 'none',
      keyEpoch: null,
      encryptedKeyId: null,
      payloadJson,
      sourcePeerHash: sourcePeerHash.trim().toLowerCase(),
      servedCount: 0,
      lastServedAt: null,
    });
    this.enforceOfflineRelayCacheLimit(now);
    return {
      ok: true,
      blobId,
      stored: inserted.changes > 0 || this.memoryRelayCache.has(event.eventId),
    };
  }

  private eventHasDeleteTombstone(rootEventId: string | undefined): boolean {
    if (typeof rootEventId !== 'string' || !rootEventId) return false;
    return this.findDeleteTombstone(rootEventId) !== null;
  }

  getRelayEventBlob(
    groupId: number,
    eventId: string,
    now = Date.now()
  ): ReticulumChatRelayCacheEntry | null {
    const memoryEntry = this.memoryRelayCache.get(eventId);
    if (
      memoryEntry &&
      memoryEntry.groupId === groupId &&
      memoryEntry.expiresAt > now
    ) {
      const served = {
        ...memoryEntry,
        servedCount: memoryEntry.servedCount + 1,
        lastServedAt: now,
      };
      this.memoryRelayCache.set(eventId, served);
      return served;
    }
    if (memoryEntry && memoryEntry.expiresAt <= now)
      this.memoryRelayCache.delete(eventId);
    this.stmtDeleteRelayExpired.run(now);
    const row = this.stmtGetRelayBlobByEvent.get(groupId, eventId, now) as
      | RelayCacheRow
      | undefined;
    if (!row) return null;
    this.stmtMarkRelayBlobServed.run(now, row.blob_id);
    return relayRowToEntry(row);
  }

  listRelayDigestEntries(
    groupId: number,
    offset = 0,
    limit = 32,
    now = Date.now()
  ): ReticulumChatRelayDigestEntry[] {
    if (!Number.isInteger(groupId) || groupId <= 0) return [];
    const boundedOffset = Math.max(0, Math.floor(offset));
    const boundedLimit = Math.max(1, Math.min(256, Math.floor(limit)));
    this.stmtDeleteRelayExpired.run(now);
    const byEventId = new Map<string, ReticulumChatRelayDigestEntry>();
    for (const [eventId, entry] of this.memoryRelayCache) {
      if (entry.expiresAt <= now) {
        this.memoryRelayCache.delete(eventId);
        continue;
      }
      if (entry.groupId !== groupId) continue;
      const digestEntry = this.relayEntryToDigestEntry(entry, now);
      if (digestEntry) byEventId.set(digestEntry.eventId, digestEntry);
    }
    const rows = this.stmtListRelayDigestEntries.all(
      groupId,
      now,
      boundedLimit + boundedOffset,
      0
    ) as RelayCacheRow[];
    for (const row of rows) {
      const digestEntry = this.relayEntryToDigestEntry(
        relayRowToEntry(row),
        now
      );
      if (digestEntry && !byEventId.has(digestEntry.eventId)) {
        byEventId.set(digestEntry.eventId, digestEntry);
      }
    }
    return [...byEventId.values()]
      .sort(
        (a, b) =>
          a.createdAt - b.createdAt || a.eventId.localeCompare(b.eventId)
      )
      .slice(boundedOffset, boundedOffset + boundedLimit);
  }

  upsertGroupKey(key: ReticulumChatGroupKey): void {
    const groupId = Number(key.groupId);
    const epoch = Number(key.epoch);
    const keyId =
      typeof key.keyId === 'string' ? key.keyId.trim().toLowerCase() : '';
    const normalized: ReticulumChatGroupKey = {
      ...key,
      groupId,
      epoch,
      keyId,
    };
    this.memoryGroupKeys.set(`${groupId}:${epoch}:${keyId}`, normalized);
    this.stmtUpsertGroupKey.run(
      groupId,
      epoch,
      keyId,
      key.keyBytesBase64,
      key.createdBy,
      key.createdAt,
      key.status,
      key.adminPublicKey,
      key.adminSignature
    );
  }

  getActiveGroupKey(groupId: number): ReticulumChatGroupKey | null {
    if (!Number.isInteger(groupId) || groupId <= 0) return null;
    const memory = [...this.memoryGroupKeys.values()]
      .filter((key) => key.groupId === groupId && key.status === 'active')
      .sort(
        (a, b) =>
          b.epoch - a.epoch ||
          a.keyId.localeCompare(b.keyId) ||
          a.createdAt - b.createdAt
      )[0];
    if (memory) return memory;
    const row = this.stmtGetActiveGroupKey.get(groupId) as
      | GroupKeyRow
      | undefined;
    return row ? groupKeyRowToEntry(row) : null;
  }

  getGroupKey(
    groupId: number,
    epoch: number,
    keyId: string
  ): ReticulumChatGroupKey | null {
    if (!Number.isInteger(groupId) || groupId <= 0) return null;
    if (!Number.isInteger(epoch) || epoch <= 0) return null;
    const normalizedKeyId =
      typeof keyId === 'string' ? keyId.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(normalizedKeyId)) return null;
    const memory = this.memoryGroupKeys.get(
      `${groupId}:${epoch}:${normalizedKeyId}`
    );
    if (memory) return memory;
    const row = this.stmtGetGroupKey.get(groupId, epoch, normalizedKeyId) as
      | GroupKeyRow
      | undefined;
    return row ? groupKeyRowToEntry(row) : null;
  }

  upsertGroupKeyDigest(digest: ReticulumChatGroupKeyDigest): void {
    if (!Number.isInteger(digest.groupId) || digest.groupId <= 0) return;
    if (!Number.isInteger(digest.epoch) || digest.epoch <= 0) return;
    if (!/^[0-9a-f]{64}$/i.test(digest.keyId)) return;
    const key = `${digest.groupId}:${digest.epoch}:${digest.keyId.toLowerCase()}`;
    this.memoryGroupKeyDigests.set(key, {
      ...digest,
      keyId: digest.keyId.toLowerCase(),
      sourcePeerHash: digest.sourcePeerHash.trim().toLowerCase(),
    });
    this.stmtUpsertGroupKeyDigest.run(
      digest.groupId,
      digest.epoch,
      digest.keyId.toLowerCase(),
      digest.createdBy,
      digest.createdAt,
      digest.adminPublicKey,
      digest.adminSignature,
      digest.sourcePeerHash.trim().toLowerCase(),
      digest.seenAt
    );
  }

  getLatestGroupKeyDigest(groupId: number): ReticulumChatGroupKeyDigest | null {
    if (!Number.isInteger(groupId) || groupId <= 0) return null;
    const memory = [...this.memoryGroupKeyDigests.values()]
      .filter((digest) => digest.groupId === groupId)
      .sort(
        (a, b) =>
          b.epoch - a.epoch ||
          b.createdAt - a.createdAt ||
          a.keyId.localeCompare(b.keyId)
      )[0];
    if (memory) return memory;
    const row = this.stmtGetLatestGroupKeyDigest.get(groupId) as
      | GroupKeyDigestRow
      | undefined;
    return row ? groupKeyDigestRowToEntry(row) : null;
  }

  listGroupKeyDigests(
    groupId: number,
    limit = 4
  ): ReticulumChatGroupKeyDigest[] {
    if (!Number.isInteger(groupId) || groupId <= 0) return [];
    const boundedLimit = Math.max(1, Math.min(16, Math.floor(limit)));
    const rows = this.stmtListGroupKeyDigests.all(
      groupId,
      boundedLimit
    ) as GroupKeyDigestRow[];
    const byKey = new Map<string, ReticulumChatGroupKeyDigest>();
    for (const row of rows) {
      const entry = groupKeyDigestRowToEntry(row);
      byKey.set(`${entry.groupId}:${entry.epoch}:${entry.keyId}`, entry);
    }
    for (const entry of this.memoryGroupKeyDigests.values()) {
      if (entry.groupId === groupId)
        byKey.set(`${entry.groupId}:${entry.epoch}:${entry.keyId}`, entry);
    }
    return [...byKey.values()]
      .sort(
        (a, b) =>
          b.epoch - a.epoch ||
          b.createdAt - a.createdAt ||
          a.keyId.localeCompare(b.keyId)
      )
      .slice(0, boundedLimit);
  }

  upsertGroupKeyRequest(request: ReticulumChatGroupKeyRequest): void {
    if (!Number.isInteger(request.groupId) || request.groupId <= 0) return;
    if (!Number.isInteger(request.epoch) || request.epoch <= 0) return;
    if (!/^[0-9a-f]{64}$/i.test(request.keyId)) return;
    if (!/^[0-9a-f]{8,64}$/i.test(request.requestId)) return;
    const normalized: ReticulumChatGroupKeyRequest = {
      ...request,
      keyId: request.keyId.toLowerCase(),
      requestId: request.requestId.toLowerCase(),
      attempts: Math.max(0, Math.floor(request.attempts)),
    };
    this.memoryGroupKeyRequests.set(
      `${request.groupId}:${request.epoch}:${request.keyId.toLowerCase()}`,
      normalized
    );
    this.stmtUpsertGroupKeyRequest.run(
      request.groupId,
      request.epoch,
      request.keyId.toLowerCase(),
      request.requestId.toLowerCase(),
      request.requestedAt,
      Math.max(0, Math.floor(request.attempts)),
      request.status
    );
  }

  listPendingGroupKeyRequests(limit = 64): ReticulumChatGroupKeyRequest[] {
    const boundedLimit = Math.max(1, Math.min(256, Math.floor(limit)));
    const rows = this.stmtGetPendingGroupKeyRequests.all(
      boundedLimit
    ) as GroupKeyRequestRow[];
    const byKey = new Map<string, ReticulumChatGroupKeyRequest>();
    for (const row of rows) {
      const entry: ReticulumChatGroupKeyRequest = {
        groupId: row.group_id,
        epoch: row.epoch,
        keyId: row.key_id,
        requestId: row.request_id,
        requestedAt: row.requested_at,
        attempts: row.attempts,
        status:
          row.status === 'fulfilled' || row.status === 'failed'
            ? row.status
            : 'pending',
      };
      byKey.set(`${entry.groupId}:${entry.epoch}:${entry.keyId}`, entry);
    }
    for (const entry of this.memoryGroupKeyRequests.values()) {
      if (entry.status === 'pending')
        byKey.set(`${entry.groupId}:${entry.epoch}:${entry.keyId}`, entry);
    }
    return [...byKey.values()]
      .filter((entry) => entry.status === 'pending')
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .slice(0, boundedLimit);
  }

  markGroupKeyRequestStatus(
    groupId: number,
    epoch: number,
    keyId: string,
    status: 'pending' | 'fulfilled' | 'failed'
  ): void {
    if (!Number.isInteger(groupId) || groupId <= 0) return;
    if (!Number.isInteger(epoch) || epoch <= 0) return;
    if (!/^[0-9a-f]{64}$/i.test(keyId)) return;
    const normalizedKeyId = keyId.toLowerCase();
    const memory = this.memoryGroupKeyRequests.get(
      `${groupId}:${epoch}:${normalizedKeyId}`
    );
    if (memory) {
      this.memoryGroupKeyRequests.set(
        `${groupId}:${epoch}:${normalizedKeyId}`,
        {
          ...memory,
          status,
        }
      );
    }
    this.stmtMarkGroupKeyRequestStatus.run(
      status,
      groupId,
      epoch,
      keyId.toLowerCase()
    );
  }

  getOfflineRelayCacheBytes(now = Date.now()): number {
    this.stmtDeleteRelayExpired.run(now);
    let memoryTotal = 0;
    for (const [eventId, entry] of this.memoryRelayCache) {
      if (entry.expiresAt <= now) {
        this.memoryRelayCache.delete(eventId);
        continue;
      }
      memoryTotal += entry.sizeBytes;
    }
    const row = this.stmtTotalRelayBytes.get() as
      | { total?: number }
      | undefined;
    const sqliteTotal = typeof row?.total === 'number' ? row.total : 0;
    return Math.max(sqliteTotal, memoryTotal);
  }

  upsertSearchText(
    event: ReticulumChatEvent,
    text: string,
    replaceExisting = true
  ): void {
    const normalized = normalizeSearchText(text);
    if (!normalized) return;
    this.memorySearchText.set(event.eventId, normalized);
    if (replaceExisting) this.stmtDeleteSearchText.run(event.eventId);
    this.stmtUpsertSearchMirror.run(
      event.eventId,
      event.groupId,
      normalizeReticulumChatChannelId(event.channelId),
      event.authorAddress,
      event.timestamp,
      event.eventType,
      normalized
    );
    this.stmtUpsertSearchText.run(
      event.eventId,
      event.groupId,
      normalizeReticulumChatChannelId(event.channelId),
      event.authorAddress,
      event.timestamp,
      event.eventType,
      normalized
    );
  }

  private rootEventIdForIndexEvent(event: ReticulumChatEvent): string {
    return event.eventType === 'edit' && event.targetEventId
      ? event.targetEventId
      : event.eventId;
  }

  private computeMessageProjectionForRoot(
    rootEventId: string
  ): MessageProjectionRow | null {
    if (typeof rootEventId !== 'string' || !rootEventId) return null;
    const rows = this.stmtGetMessageProjectionEvents.all(
      rootEventId,
      rootEventId
    ) as EventRow[];
    const eventsById = new Map<string, ReticulumChatEvent>();
    for (const row of rows) {
      const event = rowToEvent(row);
      eventsById.set(event.eventId, event);
    }
    for (const event of this.memoryEvents.values()) {
      if (
        event.eventId === rootEventId ||
        event.targetEventId === rootEventId
      ) {
        eventsById.set(event.eventId, event);
      }
    }
    const events = [...eventsById.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
    );
    const root = events.find(
      (candidate) =>
        candidate.eventId === rootEventId &&
        (candidate.eventType === 'message' ||
          candidate.eventType === 'attachment_manifest')
    );
    if (!root) return null;
    const expiresAt = this.rootMessageExpiresAt(root);
    if (expiresAt !== null && expiresAt <= Date.now()) return null;

    let current = root;
    let deletedAt: number | null = null;
    let deletedEventId: string | null = null;
    for (const event of events) {
      if (event.eventId === root.eventId) continue;
      if (!this.isMutationForMessageRoot(event, root)) continue;
      if (event.eventType === 'edit') {
        if (deletedAt !== null) continue;
        current = event;
        continue;
      }
      if (event.eventType === 'delete') {
        deletedAt = event.timestamp;
        deletedEventId = event.eventId;
      }
    }

    return {
      root_event_id: root.eventId,
      group_id: root.groupId,
      channel_id: normalizeReticulumChatChannelId(root.channelId),
      author_address: root.authorAddress,
      author_public_key: root.authorPublicKey,
      author_stream_id: normalizeReticulumChatAuthorStreamId(
        root.authorStreamId
      ),
      author_seq: root.authorSeq,
      created_at: root.timestamp,
      root_event_type: root.eventType,
      current_event_id: current.eventId,
      updated_at: current.timestamp,
      reply_to_event_id: root.replyToEventId ?? null,
      encrypted_payload: current.encryptedPayload,
      payload_hash: current.payloadHash,
      mention_address_hashes: serializeMentionAddressHashes(
        current.mentionAddressHashes
      ),
      mention_targets: serializeMentionTargets(current.mentionTargets),
      signature: root.signature,
      deleted_at: deletedAt,
      deleted_event_id: deletedEventId,
      expires_at: expiresAt,
      has_attachment:
        root.eventType === 'attachment_manifest' ||
        payloadHasReticulumFileAttachment(current.encryptedPayload)
          ? 1
          : 0,
    };
  }

  private currentMessageProjectionForIndexEvent(
    event: ReticulumChatEvent
  ): MessageProjectionRow | null {
    const rootEventId = this.rootEventIdForIndexEvent(event);
    if (!rootEventId) return null;
    const row = this.computeMessageProjectionForRoot(rootEventId);
    if (!row || row.deleted_at !== null) return null;
    if (row.current_event_id !== event.eventId) return null;
    return row;
  }

  private upsertProjectedSearchText(
    projection: MessageProjectionRow,
    text: string
  ): void {
    const normalized = normalizeSearchText(text);
    const rootEventId = projection.root_event_id;
    this.memorySearchText.delete(rootEventId);
    if (normalized) this.memorySearchText.set(rootEventId, normalized);
    const row = [
      rootEventId,
      projection.group_id,
      normalizeReticulumChatChannelId(projection.channel_id),
      projection.author_address,
      projection.created_at,
      projection.root_event_type,
      normalized,
    ] as const;
    // The FTS table finds a row by event_id only with a full scan (the
    // column is UNINDEXED), and this runs for every stored message and every
    // re-index from the UI. The mirror row (a primary key lookup) says
    // whether there is anything to replace; ensureSearchFtsMatchesMirror
    // made sure the two tables agree.
    if (this.ensureSearchFtsMatchesMirror()) {
      const mirror = this.stmtGetSearchMirrorRow.get(rootEventId) as
        | {
            group_id?: number;
            channel_id?: string;
            author_address?: string;
            timestamp?: number;
            event_type?: string;
            search_text?: string;
          }
        | undefined;
      if (!mirror) {
        this.indexWriteStats.searchNoMirror += 1;
        if (!normalized) return;
        this.runWriteBatch(() => {
          this.stmtUpsertSearchMirror.run(...row);
          this.stmtUpsertSearchText.run(...row);
        });
        return;
      }
      if (
        normalized &&
        Number(mirror.group_id) === Number(row[1]) &&
        mirror.channel_id === row[2] &&
        mirror.author_address === row[3] &&
        Number(mirror.timestamp) === Number(row[4]) &&
        mirror.event_type === row[5] &&
        mirror.search_text === normalized
      ) {
        // Rewriting would store the very same mirror and FTS rows.
        this.indexWriteStats.searchUnchanged += 1;
        return;
      }
    }
    this.indexWriteStats.searchWritten += 1;
    this.runWriteBatch(() => {
      this.stmtDeleteSearchText.run(rootEventId);
      this.stmtDeleteSearchMirror.run(rootEventId);
      if (!normalized) return;
      this.stmtUpsertSearchMirror.run(...row);
      this.stmtUpsertSearchText.run(...row);
    });
  }

  /**
   * True once the FTS table is known to hold exactly the mirror's rows, which
   * upsertProjectedSearchText's shortcuts rely on ("no mirror row, no FTS
   * row"). Every writer adds and removes the two together, but a database
   * from an older build may not have. Checked once per open, on first use:
   * if the row counts differ, the FTS table is rebuilt from the mirror. If
   * the counts cannot be read, the shortcuts stay off.
   */
  private ensureSearchFtsMatchesMirror(): boolean {
    const check = this.indexWriteStats.ftsCheck;
    if (check.state !== 'unchecked') return check.state === 'trusted';
    // Usually the first use is inside insertEvent's transaction. A rebuild
    // there would roll back with a failed insert while the state already
    // said trusted, so this write takes the full path and the check runs
    // right after the transaction, which also keeps the two counts off that
    // message's commit.
    if (this.db.inTransaction) {
      if (!this.ftsCheckTimer) {
        this.ftsCheckTimer = setTimeout(() => {
          this.ftsCheckTimer = null;
          this.ensureSearchFtsMatchesMirror();
        }, 0);
        (this.ftsCheckTimer as { unref?: () => void }).unref?.();
      }
      return false;
    }
    check.state = 'untrusted';
    try {
      const mirrorRows = Number(
        (
          this.db
            .prepare(
              'SELECT COUNT(*) AS mirror_rows FROM reticulum_chat_search_index'
            )
            .get() as { mirror_rows?: number } | undefined
        )?.mirror_rows
      );
      const ftsRows = Number(
        (
          this.db
            .prepare(
              'SELECT COUNT(*) AS fts_rows FROM reticulum_chat_search_fts'
            )
            .get() as { fts_rows?: number } | undefined
        )?.fts_rows
      );
      if (!Number.isFinite(mirrorRows) || !Number.isFinite(ftsRows))
        return false;
      check.mirrorRows = mirrorRows;
      check.ftsRows = ftsRows;
      if (mirrorRows !== ftsRows) {
        this.runWriteBatch(() => {
          this.db.prepare('DELETE FROM reticulum_chat_search_fts').run();
          this.db
            .prepare(
              `
                INSERT INTO reticulum_chat_search_fts
                  (event_id, group_id, channel_id, author_address, timestamp, event_type, search_text)
                SELECT event_id, group_id, channel_id, author_address, timestamp, event_type, search_text
                FROM reticulum_chat_search_index
              `
            )
            .run();
        });
        check.rebuilt = true;
      }
      check.state = 'trusted';
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Counters for the search/mention write shortcuts (plain increments) and
   * the FTS check, for diagnostics.
   */
  getIndexWriteStats(): {
    searchWritten: number;
    searchUnchanged: number;
    searchNoMirror: number;
    mentionsWritten: number;
    mentionsUnchanged: number;
    ftsCheck: {
      state: 'unchecked' | 'trusted' | 'untrusted';
      mirrorRows: number | null;
      ftsRows: number | null;
      rebuilt: boolean;
    };
  } {
    return {
      ...this.indexWriteStats,
      ftsCheck: { ...this.indexWriteStats.ftsCheck },
    };
  }

  private refreshMessageProjectionIndexes(event: ReticulumChatEvent): void {
    if (event.eventType === 'delete' && event.targetEventId) {
      this.deleteSearchText(event.targetEventId);
      this.deleteMentionsForEvent(event.targetEventId);
      return;
    }
    if (
      event.eventType !== 'message' &&
      event.eventType !== 'attachment_manifest' &&
      event.eventType !== 'edit'
    ) {
      return;
    }
    const rootEventId = this.rootEventIdForIndexEvent(event);
    const projection = this.stmtGetMessageProjection.get(rootEventId) as
      | MessageProjectionRow
      | undefined;
    if (
      !projection ||
      projection.deleted_at !== null ||
      projection.current_event_id !== event.eventId
    ) {
      return;
    }
    const projectedSearchText = projectedSearchTextFromPayload(
      projection.encrypted_payload
    );
    if (projectedSearchText !== null) {
      this.upsertProjectedSearchText(projection, projectedSearchText);
    }
    const mentionedAddresses = mentionedAddressesFromPayload(
      projection.encrypted_payload
    );
    if (
      mentionedAddresses !== null &&
      (mentionedAddresses.length > 0 || event.eventType === 'edit')
    ) {
      this.replaceMentionsForProjection(projection, mentionedAddresses);
    }
  }

  indexSearchText(eventId: string, text: string): boolean {
    const event = this.getEvent(eventId);
    if (!event) return false;
    const projection = this.currentMessageProjectionForIndexEvent(event);
    if (!projection) return false;
    this.upsertProjectedSearchText(projection, text);
    return true;
  }

  deleteSearchText(eventId: string): boolean {
    if (typeof eventId !== 'string' || !eventId) return false;
    this.memorySearchText.delete(eventId);
    this.stmtDeleteSearchText.run(eventId);
    this.stmtDeleteSearchMirror.run(eventId);
    return true;
  }

  replaceMentionsForEvent(
    eventId: string,
    mentionedAddresses: string[]
  ): boolean {
    return this.replaceMentionsForEventDetailed(eventId, mentionedAddresses)
      .applied;
  }

  /**
   * replaceMentionsForEvent, also saying whether the stored mentions
   * changed: the UI re-sends the same mentions for events the engine already
   * indexed, and an unchanged set needs no summary refresh.
   */
  replaceMentionsForEventDetailed(
    eventId: string,
    mentionedAddresses: string[]
  ): { applied: boolean; changed: boolean } {
    const event = this.getEvent(eventId);
    if (!event) return { applied: false, changed: false };
    const projection = this.currentMessageProjectionForIndexEvent(event);
    if (!projection) return { applied: false, changed: false };
    return {
      applied: true,
      changed: this.replaceMentionsForProjection(
        projection,
        mentionedAddresses
      ),
    };
  }

  /** False when the stored rows already were exactly these (nothing written). */
  private replaceMentionsForProjection(
    projection: MessageProjectionRow,
    mentionedAddresses: string[]
  ): boolean {
    const rootEventId = projection.root_event_id;
    const mentionTargets = parseMentionTargets(projection.mention_targets);
    const hasPrivilegedTarget =
      mentionTargets.some(
        (target) => target.type === 'everyone' || target.type === 'here'
      ) ||
      reticulumChatPayloadHasPrivilegedMention(projection.encrypted_payload);
    const privilegedMentionAuthorized =
      this.getPrivilegedMentionStatus(projection.current_event_id) === 1;
    const signedMentionHashes = new Set(
      parseMentionAddressHashes(projection.mention_address_hashes).slice(
        0,
        RETICULUM_CHAT_MAX_EFFECTIVE_MENTION_HASHES
      )
    );
    const uniqueMentionedAddresses = [
      ...new Set(
        mentionedAddresses
          .map((address) => (typeof address === 'string' ? address.trim() : ''))
          .filter(
            (address) =>
              !!address &&
              (!hasPrivilegedTarget || privilegedMentionAuthorized) &&
              signedMentionHashes.has(hashReticulumChatMentionAddress(address))
          )
      ),
    ];
    const previousMemoryMentions = this.memoryMentions.get(rootEventId);
    const nextMemoryMentions = uniqueMentionedAddresses.map(
      (mentionedAddress) => ({
        groupId: projection.group_id,
        channelId: normalizeReticulumChatChannelId(projection.channel_id),
        mentionedAddress,
        authorAddress: projection.author_address,
        timestamp: projection.updated_at,
        readAt: 0,
      })
    );
    this.memoryMentions.set(rootEventId, nextMemoryMentions);
    // Unchanged only if the session copy (when there is one) and the stored
    // rows both already hold exactly this.
    if (
      (previousMemoryMentions === undefined ||
        sameMentionRecords(previousMemoryMentions, nextMemoryMentions)) &&
      this.storedMentionRowsMatch(
        rootEventId,
        projection,
        uniqueMentionedAddresses
      )
    ) {
      this.indexWriteStats.mentionsUnchanged += 1;
      return false;
    }
    this.indexWriteStats.mentionsWritten += 1;
    const tx = this.db.transaction(() => {
      this.stmtDeleteMentionsForEvent.run(rootEventId);
      for (const mentionedAddress of uniqueMentionedAddresses) {
        this.stmtUpsertMention.run(
          rootEventId,
          projection.group_id,
          normalizeReticulumChatChannelId(projection.channel_id),
          mentionedAddress,
          projection.author_address,
          projection.updated_at
        );
      }
    });
    tx();
    this.invalidateChatSummaryCache(projection.group_id, projection.channel_id);
    return true;
  }

  /**
   * True when the event's stored mention rows are exactly the rows
   * replaceMentionsForProjection would write (same addresses, fields and an
   * unread read_at), so deleting and re-inserting them would change nothing.
   */
  private storedMentionRowsMatch(
    rootEventId: string,
    projection: MessageProjectionRow,
    mentionedAddresses: readonly string[]
  ): boolean {
    const rows = this.stmtGetMentionRows.all(rootEventId) as Array<{
      group_id?: number;
      channel_id?: string;
      mentioned_address?: string;
      author_address?: string;
      timestamp?: number;
      read_at?: number;
    }>;
    if (!Array.isArray(rows) || rows.length !== mentionedAddresses.length) {
      return false;
    }
    const wanted = new Set(mentionedAddresses);
    const channelId = normalizeReticulumChatChannelId(projection.channel_id);
    return rows.every(
      (row) =>
        typeof row.mentioned_address === 'string' &&
        wanted.has(row.mentioned_address) &&
        Number(row.group_id) === Number(projection.group_id) &&
        row.channel_id === channelId &&
        row.author_address === projection.author_address &&
        Number(row.timestamp) === Number(projection.updated_at) &&
        Number(row.read_at) === 0
    );
  }

  deleteMentionsForEvent(eventId: string): boolean {
    if (typeof eventId !== 'string' || !eventId) return false;
    const event = this.getEvent(eventId);
    this.memoryMentions.delete(eventId);
    this.stmtDeleteMentionsForEvent.run(eventId);
    if (event) {
      this.invalidateChatSummaryCache(event.groupId, event.channelId);
    } else {
      this.invalidateChatSummaryCache();
    }
    return true;
  }

  searchEvents(
    query: string,
    options: ReticulumChatSearchOptions = {}
  ): ReticulumChatSearchResult[] {
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    const ftsQuery = buildFtsQuery(query);
    const terms = buildSearchTerms(query);
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
    const offset = Math.max(
      0,
      Math.min(10_000, Math.floor(options.offset ?? 0))
    );
    const groupIds = (options.groupIds ?? [])
      .filter((groupId) => Number.isInteger(groupId) && groupId > 0)
      .slice(0, 500);
    const allowedGroups = groupIds.length > 0 ? new Set(groupIds) : null;
    const channelIds = (options.channelIds ?? [])
      .map(normalizeReticulumChatChannelId)
      .filter(Boolean);
    const allowedChannels = channelIds.length > 0 ? new Set(channelIds) : null;
    const authorAddresses = (options.authorAddresses ?? [])
      .map((address) => (typeof address === 'string' ? address.trim() : ''))
      .filter(Boolean)
      .slice(0, 500);
    const allowedAuthors =
      authorAddresses.length > 0 ? new Set(authorAddresses) : null;
    const excludedAuthors = new Set(
      normalizeExcludedAuthors(options.excludedAuthorAddresses ?? [])
    );
    const excludedAuthorsByGroup = new Map<number, Set<string>>();
    for (const [rawGroupId, addresses] of Object.entries(
      options.excludedAuthorAddressesByGroup ?? {}
    )) {
      const groupId = Number(rawGroupId);
      const normalized = normalizeExcludedAuthors(addresses);
      if (!Number.isInteger(groupId) || groupId <= 0 || normalized.length === 0)
        continue;
      excludedAuthorsByGroup.set(groupId, new Set(normalized));
    }
    const eventTypes = (options.eventTypes ?? [])
      .filter(
        (eventType) =>
          eventType === 'message' || eventType === 'attachment_manifest'
      )
      .slice(0, 2);
    const hasAttachment = options.hasAttachment === true;
    const normalizedEventTypes = eventTypes;
    const allowedEventTypes =
      normalizedEventTypes.length > 0 ? new Set(normalizedEventTypes) : null;
    const beforeTimestamp = Number.isFinite(Number(options.beforeTimestamp))
      ? Number(options.beforeTimestamp)
      : null;
    const afterTimestamp = Number.isFinite(Number(options.afterTimestamp))
      ? Number(options.afterTimestamp)
      : null;
    const hasLink = options.hasLink === true;
    const sort =
      options.sort === 'newest' || options.sort === 'oldest'
        ? options.sort
        : 'relevance';
    const effectiveCursorSort: 'newest' | 'oldest' | null =
      sort === 'oldest'
        ? 'oldest'
        : sort === 'newest' || !ftsQuery
          ? 'newest'
          : null;
    const cursor = effectiveCursorSort
      ? normalizeSearchCursor(options.cursor)
      : null;
    const includeAdminPrivate = options.includeAdminPrivate === true;
    const hasAnyFilter =
      groupIds.length > 0 ||
      channelIds.length > 0 ||
      authorAddresses.length > 0 ||
      normalizedEventTypes.length > 0 ||
      beforeTimestamp !== null ||
      afterTimestamp !== null ||
      hasAttachment ||
      hasLink;
    if (!ftsQuery && !hasAnyFilter) return [];

    const usesFts = Boolean(ftsQuery);
    const searchTextExpression = usesFts
      ? 'reticulum_chat_search_fts.search_text'
      : 'reticulum_chat_search_index.search_text';
    const clauses = [
      'p.deleted_at IS NULL',
      '(p.expires_at IS NULL OR p.expires_at > ?)',
    ];
    const params: Array<string | number> = [now];
    if (usesFts) {
      clauses.unshift('reticulum_chat_search_fts MATCH ?');
      params.unshift(ftsQuery);
    }
    if (groupIds.length > 0) {
      clauses.push(`p.group_id IN (${groupIds.map(() => '?').join(', ')})`);
      params.push(...groupIds);
    }
    if (channelIds.length > 0) {
      clauses.push(`p.channel_id IN (${channelIds.map(() => '?').join(', ')})`);
      params.push(...channelIds);
    }
    if (authorAddresses.length > 0) {
      clauses.push(
        `p.author_address IN (${authorAddresses.map(() => '?').join(', ')})`
      );
      params.push(...authorAddresses);
    }
    if (excludedAuthors.size > 0) {
      clauses.push(
        `p.author_address NOT IN (${[...excludedAuthors].map(() => '?').join(', ')})`
      );
      params.push(...excludedAuthors);
    }
    if (excludedAuthorsByGroup.size > 0) {
      const groupClauses: string[] = [];
      for (const [groupId, authors] of excludedAuthorsByGroup) {
        groupClauses.push(
          `(p.group_id = ? AND p.author_address IN (${[...authors].map(() => '?').join(', ')}))`
        );
        params.push(groupId, ...authors);
      }
      clauses.push(`NOT (${groupClauses.join(' OR ')})`);
    }
    if (normalizedEventTypes.length > 0) {
      clauses.push(
        `p.root_event_type IN (${normalizedEventTypes.map(() => '?').join(', ')})`
      );
      params.push(...normalizedEventTypes);
    }
    if (afterTimestamp !== null) {
      clauses.push('p.created_at >= ?');
      params.push(afterTimestamp);
    }
    if (beforeTimestamp !== null) {
      clauses.push('p.created_at < ?');
      params.push(beforeTimestamp);
    }
    if (hasAttachment) {
      clauses.push('p.has_attachment = 1');
    }
    if (hasLink) {
      clauses.push(
        `(lower(COALESCE(${searchTextExpression}, '')) LIKE ? OR lower(COALESCE(${searchTextExpression}, '')) LIKE ?)`
      );
      params.push('%http%', '%www.%');
    }
    if (!includeAdminPrivate) {
      clauses.push("(c.read_mode IS NULL OR c.read_mode != 'admins')");
    }
    if (cursor && effectiveCursorSort === 'oldest') {
      clauses.push(
        '(p.created_at > ? OR (p.created_at = ? AND p.root_event_id > ?))'
      );
      params.push(cursor.createdAt, cursor.createdAt, cursor.eventId);
    } else if (cursor && effectiveCursorSort === 'newest') {
      clauses.push(
        '(p.created_at < ? OR (p.created_at = ? AND p.root_event_id < ?))'
      );
      params.push(cursor.createdAt, cursor.createdAt, cursor.eventId);
    }
    const orderBy =
      sort === 'oldest'
        ? 'p.created_at ASC, p.root_event_id ASC'
        : sort === 'newest' || !usesFts
          ? 'p.created_at DESC, p.root_event_id DESC'
          : 'bm25(reticulum_chat_search_fts) ASC, p.created_at DESC, p.root_event_id DESC';
    params.push(limit, cursor ? 0 : offset);
    const sql = usesFts
      ? `
          SELECT
            p.*,
            reticulum_chat_search_fts.search_text AS search_text,
            snippet(reticulum_chat_search_fts, 6, '<mark>', '</mark>', '...', 18) AS snippet
          FROM reticulum_chat_search_fts
          JOIN rchat_message_projection p
            ON p.root_event_id = reticulum_chat_search_fts.event_id
          LEFT JOIN reticulum_chat_channels c
            ON c.group_id = p.group_id AND c.channel_id = p.channel_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY ${orderBy}
          LIMIT ? OFFSET ?
        `
      : `
          SELECT
            p.*,
            reticulum_chat_search_index.search_text AS search_text,
            NULL AS snippet
          FROM rchat_message_projection p
          LEFT JOIN reticulum_chat_search_index
            ON reticulum_chat_search_index.event_id = p.root_event_id
          LEFT JOIN reticulum_chat_channels c
            ON c.group_id = p.group_id AND c.channel_id = p.channel_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY ${orderBy}
          LIMIT ? OFFSET ?
        `;
    const rows = this.db.prepare(sql).all(...params) as Array<
      MessageProjectionRow & { search_text?: string; snippet?: string }
    >;
    const results: ReticulumChatSearchResult[] = [];
    for (const row of rows) {
      if (this.isEventPayloadScrubbed(row.root_event_id)) continue;
      results.push({
        event: messageProjectionRowToEvent(row),
        snippet: row.snippet || buildPlainSnippet(row.search_text ?? '', terms),
        cursor: searchCursorFromProjection(row),
      });
      if (results.length >= limit) break;
    }
    if (results.length > 0) return results;
    const mirrorResults = this.searchEventsMirror(
      terms,
      allowedGroups,
      allowedChannels,
      allowedAuthors,
      excludedAuthors,
      excludedAuthorsByGroup,
      allowedEventTypes,
      includeAdminPrivate,
      beforeTimestamp,
      afterTimestamp,
      hasAttachment,
      hasLink,
      sort,
      now,
      limit,
      cursor ? 0 : offset,
      cursor,
      effectiveCursorSort
    );
    return mirrorResults.length > 0
      ? mirrorResults
      : this.searchEventsMemory(
          terms,
          allowedGroups,
          allowedChannels,
          allowedAuthors,
          excludedAuthors,
          excludedAuthorsByGroup,
          allowedEventTypes,
          includeAdminPrivate,
          beforeTimestamp,
          afterTimestamp,
          hasAttachment,
          hasLink,
          sort,
          now,
          limit,
          cursor ? 0 : offset,
          cursor,
          effectiveCursorSort
        );
  }

  getMessageWindowAroundEvent(
    groupId: number,
    channelId: string,
    eventId: string,
    options: ReticulumChatMessageWindowOptions = {}
  ): ReticulumChatEvent[] {
    if (!Number.isInteger(groupId) || groupId <= 0) return [];
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const rootEventId = typeof eventId === 'string' ? eventId.trim() : '';
    if (!normalizedChannelId || !rootEventId) return [];
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    const includeAdminPrivate = options.includeAdminPrivate === true;
    const readClause = includeAdminPrivate
      ? ''
      : "AND (c.read_mode IS NULL OR c.read_mode != 'admins')";
    const excludedAuthors = normalizeExcludedAuthors(
      options.excludedAuthorAddresses ?? []
    );
    const excludedClause = excludedAuthors.length
      ? `AND p.author_address NOT IN (${excludedAuthors.map(() => '?').join(', ')})`
      : '';
    const target = this.db
      .prepare(
        `
          SELECT p.*
          FROM rchat_message_projection p
          LEFT JOIN reticulum_chat_channels c
            ON c.group_id = p.group_id AND c.channel_id = p.channel_id
          WHERE p.group_id = ?
            AND p.channel_id = ?
            AND p.root_event_id = ?
            AND p.deleted_at IS NULL
            AND (p.expires_at IS NULL OR p.expires_at > ?)
            ${excludedClause}
            ${readClause}
          LIMIT 1
        `
      )
      .get(
        groupId,
        normalizedChannelId,
        rootEventId,
        now,
        ...excludedAuthors
      ) as MessageProjectionRow | undefined;
    if (!target) return [];
    const beforeLimit = Math.max(
      0,
      Math.min(250, Math.floor(options.beforeLimit ?? 80))
    );
    const afterLimit = Math.max(
      0,
      Math.min(250, Math.floor(options.afterLimit ?? 40))
    );
    const beforeRows =
      beforeLimit > 0
        ? (this.db
            .prepare(
              `
              SELECT p.*
              FROM rchat_message_projection p
              LEFT JOIN reticulum_chat_channels c
                ON c.group_id = p.group_id AND c.channel_id = p.channel_id
              WHERE p.group_id = ?
                AND p.channel_id = ?
                AND p.deleted_at IS NULL
                AND (p.expires_at IS NULL OR p.expires_at > ?)
                AND (
                  p.created_at < ?
                  OR (p.created_at = ? AND p.root_event_id < ?)
                )
                ${excludedClause}
                ${readClause}
              ORDER BY p.created_at DESC, p.root_event_id DESC
              LIMIT ?
            `
            )
            .all(
              groupId,
              normalizedChannelId,
              now,
              target.created_at,
              target.created_at,
              target.root_event_id,
              ...excludedAuthors,
              beforeLimit
            ) as MessageProjectionRow[])
        : [];
    const afterRows =
      afterLimit > 0
        ? (this.db
            .prepare(
              `
              SELECT p.*
              FROM rchat_message_projection p
              LEFT JOIN reticulum_chat_channels c
                ON c.group_id = p.group_id AND c.channel_id = p.channel_id
              WHERE p.group_id = ?
                AND p.channel_id = ?
                AND p.deleted_at IS NULL
                AND (p.expires_at IS NULL OR p.expires_at > ?)
                AND (
                  p.created_at > ?
                  OR (p.created_at = ? AND p.root_event_id > ?)
                )
                ${excludedClause}
                ${readClause}
              ORDER BY p.created_at ASC, p.root_event_id ASC
              LIMIT ?
            `
            )
            .all(
              groupId,
              normalizedChannelId,
              now,
              target.created_at,
              target.created_at,
              target.root_event_id,
              ...excludedAuthors,
              afterLimit
            ) as MessageProjectionRow[])
        : [];
    return [...beforeRows.reverse(), target, ...afterRows].map(
      messageProjectionRowToEvent
    );
  }

  getRecentEvents(
    groupId: number,
    limit: number,
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    this.pruneExpiredMessagesThrottled();
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedAuthorSet = new Set(excludedAuthors);
    if (excludedAuthors.length > 0) {
      const channelClause =
        normalizedChannelId == null ? '' : 'AND channel_id = ?';
      const exclusionClause = `AND (event_type IN (${RETICULUM_CHAT_METADATA_EVENT_TYPES_SQL}) OR author_address NOT IN (${excludedAuthors
        .map(() => '?')
        .join(', ')}))`;
      const rows = this.db
        .prepare(
          `
          SELECT * FROM (
            SELECT * FROM reticulum_chat_events
            WHERE group_id = ?
              ${channelClause}
              AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
              ${exclusionClause}
            ORDER BY timestamp DESC, event_id DESC
            LIMIT ?
          )
          ORDER BY timestamp ASC, event_id ASC
        `
        )
        .all(
          groupId,
          ...(normalizedChannelId == null ? [] : [normalizedChannelId]),
          ...excludedAuthors,
          limit
        ) as EventRow[];
      return this.mergeWindowEvents(
        rows.map(rowToEvent),
        this.memoryEvents
          .eventsInGroup(groupId)
          .filter(
            (event) =>
              event.groupId === groupId &&
              (normalizedChannelId == null ||
                normalizeReticulumChatChannelId(event.channelId) ===
                  normalizedChannelId) &&
              this.eventIsVisible(event) &&
              eventPassesAuthorExclusion(event, excludedAuthorSet)
          )
          .sort(
            (a, b) =>
              b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
          )
          .slice(0, limit),
        limit
      );
    }
    if (normalizedChannelId == null) {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM (
            SELECT * FROM reticulum_chat_events
            WHERE group_id = ? AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
            ORDER BY timestamp DESC, event_id DESC
            LIMIT ?
          )
          ORDER BY timestamp ASC, event_id ASC
        `
        )
        .all(groupId, limit) as EventRow[];
      return this.mergeWindowEvents(
        rows.map(rowToEvent),
        this.memoryEvents
          .eventsInGroup(groupId)
          .filter(
            (event) => event.groupId === groupId && this.eventIsVisible(event)
          )
          .sort(
            (a, b) =>
              b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
          )
          .slice(0, limit),
        limit
      );
    }
    return this.mergeWindowEvents(
      (
        this.stmtGetRecentEvents.all(
          groupId,
          normalizedChannelId,
          limit
        ) as EventRow[]
      ).map(rowToEvent),
      this.memoryEvents
        .eventsInGroup(groupId)
        .filter(
          (event) =>
            event.groupId === groupId &&
            normalizeReticulumChatChannelId(event.channelId) ===
              normalizedChannelId &&
            this.eventIsVisible(event)
        )
        .sort(
          (a, b) =>
            b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
        )
        .slice(0, limit),
      limit
    );
  }

  getRecentMessageEvents(
    groupId: number,
    limit: number,
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    let rows: MessageProjectionRow[];
    if (excludedAuthors.length === 0) {
      rows =
        normalizedChannelId == null
          ? (this.stmtGetRecentMessageEventsAllChannels.all(
              groupId,
              now,
              safeLimit
            ) as MessageProjectionRow[])
          : (this.stmtGetRecentMessageEvents.all(
              groupId,
              normalizedChannelId,
              now,
              safeLimit
            ) as MessageProjectionRow[]);
    } else {
      const channelClause =
        normalizedChannelId == null ? '' : 'AND channel_id = ?';
      const excludedClause = `AND author_address NOT IN (${excludedAuthors
        .map(() => '?')
        .join(', ')})`;
      rows = this.db
        .prepare(
          `
            SELECT * FROM (
              SELECT * FROM rchat_message_projection
              WHERE group_id = ?
                ${channelClause}
                AND deleted_at IS NULL
                AND (expires_at IS NULL OR expires_at > ?)
                ${excludedClause}
              ORDER BY created_at DESC, root_event_id DESC
              LIMIT ?
            )
            ORDER BY created_at ASC, root_event_id ASC
          `
        )
        .all(
          groupId,
          ...(normalizedChannelId == null ? [] : [normalizedChannelId]),
          now,
          ...excludedAuthors,
          safeLimit
        ) as MessageProjectionRow[];
    }
    return rows.map(messageProjectionRowToEvent);
  }

  getReactionEventsForTargets(
    groupId: number,
    targetEventIds: readonly string[],
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const targets = Array.from(
      new Set(
        targetEventIds
          .map((eventId) => String(eventId || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 500);
    if (!Number.isInteger(groupId) || groupId <= 0 || targets.length === 0) {
      return [];
    }
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedAuthorSet = new Set(excludedAuthors);
    const targetSet = new Set(targets);
    const channelClause =
      normalizedChannelId == null ? '' : 'AND channel_id = ?';
    const rows = this.db
      .prepare(
        `
          SELECT * FROM reticulum_chat_events
          INDEXED BY idx_reticulum_chat_events_target
          WHERE group_id = ?
            ${channelClause}
            AND event_type IN ('reaction_add', 'reaction_remove')
            AND target_event_id IN (${targets.map(() => '?').join(', ')})
            AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
          ORDER BY timestamp ASC, event_id ASC
        `
      )
      .all(
        groupId,
        ...(normalizedChannelId == null ? [] : [normalizedChannelId]),
        ...targets
      ) as EventRow[];
    const eventsById = new Map<string, ReticulumChatEvent>();
    for (const row of rows) {
      const event = rowToEvent(row);
      if (excludedAuthorSet.has(event.authorAddress)) continue;
      eventsById.set(event.eventId, event);
    }
    for (const event of this.memoryEvents.values()) {
      if (
        event.groupId !== groupId ||
        (normalizedChannelId != null &&
          normalizeReticulumChatChannelId(event.channelId) !==
            normalizedChannelId) ||
        (event.eventType !== 'reaction_add' &&
          event.eventType !== 'reaction_remove') ||
        !event.targetEventId ||
        !targetSet.has(event.targetEventId) ||
        excludedAuthorSet.has(event.authorAddress) ||
        !this.eventIsVisible(event)
      ) {
        continue;
      }
      eventsById.set(event.eventId, event);
    }
    return [...eventsById.values()].sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.eventId.localeCompare(right.eventId)
    );
  }

  getDiscussionIndex(
    groupId: number,
    channelId: string,
    excludedAuthorAddresses: readonly string[] = []
  ): {
    replyCounts: Record<string, number>;
    rootByEventId: Record<string, string>;
  } {
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedClause = excludedAuthors.length
      ? `AND projection.author_address NOT IN (${excludedAuthors.map(() => '?').join(', ')})`
      : '';
    const rows = this.db
      .prepare(
        `
          WITH RECURSIVE discussion_tree(event_id, discussion_root_id) AS (
            SELECT root_event_id, root_event_id
            FROM rchat_message_projection
            WHERE group_id = ?
              AND channel_id = ?
              AND reply_to_event_id IS NULL
            UNION
            SELECT child.root_event_id, tree.discussion_root_id
            FROM rchat_message_projection AS child
            JOIN discussion_tree AS tree
              ON child.reply_to_event_id = tree.event_id
            WHERE child.group_id = ?
              AND child.channel_id = ?
          )
          SELECT tree.discussion_root_id, COUNT(*) AS reply_count
          FROM discussion_tree AS tree
          JOIN rchat_message_projection AS projection
            ON projection.root_event_id = tree.event_id
          WHERE projection.deleted_at IS NULL
            AND (projection.expires_at IS NULL OR projection.expires_at > ?)
            AND tree.event_id <> tree.discussion_root_id
            ${excludedClause}
          GROUP BY tree.discussion_root_id
        `
      )
      .all(
        groupId,
        normalizedChannelId,
        groupId,
        normalizedChannelId,
        now,
        ...excludedAuthors
      ) as Array<{ discussion_root_id: string; reply_count: number }>;

    return buildReticulumDiscussionIndex(rows);
  }

  getDiscussionMessages(
    groupId: number,
    channelId: string,
    eventId: string,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return [];
    const now = Date.now();
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const discussionRoot = this.db
      .prepare(
        `
          WITH RECURSIVE ancestors(event_id, reply_to_event_id, depth) AS (
            SELECT root_event_id, reply_to_event_id, 0
            FROM rchat_message_projection
            WHERE group_id = ?
              AND channel_id = ?
              AND root_event_id = ?
            UNION
            SELECT parent.root_event_id, parent.reply_to_event_id, child.depth + 1
            FROM rchat_message_projection AS parent
            JOIN ancestors AS child
              ON parent.root_event_id = child.reply_to_event_id
            WHERE parent.group_id = ?
              AND parent.channel_id = ?
              AND child.depth < 1000
          )
          SELECT event_id
          FROM ancestors
          WHERE reply_to_event_id IS NULL
          ORDER BY depth DESC
          LIMIT 1
        `
      )
      .get(
        groupId,
        normalizedChannelId,
        normalizedEventId,
        groupId,
        normalizedChannelId
      ) as { event_id?: string } | undefined;
    const discussionRootId = String(discussionRoot?.event_id || '');
    if (!discussionRootId) return [];
    const excludedClause = excludedAuthors.length
      ? `AND projection.author_address NOT IN (${excludedAuthors.map(() => '?').join(', ')})`
      : '';
    const rows = this.db
      .prepare(
        `
          WITH RECURSIVE descendants(event_id) AS (
            SELECT ?
            UNION
            SELECT child.root_event_id
            FROM rchat_message_projection AS child
            JOIN descendants AS parent
              ON child.reply_to_event_id = parent.event_id
            WHERE child.group_id = ?
              AND child.channel_id = ?
          )
          SELECT projection.*
          FROM descendants
          JOIN rchat_message_projection AS projection
            ON projection.root_event_id = descendants.event_id
          WHERE projection.group_id = ?
            AND projection.channel_id = ?
            AND projection.deleted_at IS NULL
            AND (projection.expires_at IS NULL OR projection.expires_at > ?)
            ${excludedClause}
          ORDER BY
            CASE WHEN projection.root_event_id = ? THEN 0 ELSE 1 END,
            projection.created_at ASC,
            projection.root_event_id ASC
        `
      )
      .all(
        discussionRootId,
        groupId,
        normalizedChannelId,
        groupId,
        normalizedChannelId,
        now,
        ...excludedAuthors,
        discussionRootId
      ) as MessageProjectionRow[];
    return rows.map(messageProjectionRowToEvent);
  }

  getMessageEventsBefore(
    groupId: number,
    beforeTimestamp: number,
    limit: number,
    beforeEventId?: string,
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const channelClause =
      normalizedChannelId == null ? '' : 'AND channel_id = ?';
    const cursorClause = beforeEventId
      ? 'AND (created_at < ? OR (created_at = ? AND root_event_id < ?))'
      : 'AND created_at < ?';
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedClause = excludedAuthors.length
      ? `AND author_address NOT IN (${excludedAuthors.map(() => '?').join(', ')})`
      : '';
    const params =
      normalizedChannelId == null
        ? beforeEventId
          ? [
              groupId,
              now,
              beforeTimestamp,
              beforeTimestamp,
              beforeEventId,
              ...excludedAuthors,
              safeLimit,
            ]
          : [groupId, now, beforeTimestamp, ...excludedAuthors, safeLimit]
        : beforeEventId
          ? [
              groupId,
              normalizedChannelId,
              now,
              beforeTimestamp,
              beforeTimestamp,
              beforeEventId,
              ...excludedAuthors,
              safeLimit,
            ]
          : [
              groupId,
              normalizedChannelId,
              now,
              beforeTimestamp,
              ...excludedAuthors,
              safeLimit,
            ];
    const rows = this.db
      .prepare(
        `
      SELECT * FROM (
        SELECT * FROM rchat_message_projection
        WHERE group_id = ?
          ${channelClause}
          AND deleted_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
          ${cursorClause}
          ${excludedClause}
        ORDER BY created_at DESC, root_event_id DESC
        LIMIT ?
      )
      ORDER BY created_at ASC, root_event_id ASC
    `
      )
      .all(...params) as MessageProjectionRow[];
    return rows.map(messageProjectionRowToEvent);
  }

  getMessageEventsAfter(
    groupId: number,
    afterTimestamp: number,
    limit: number,
    afterEventId?: string,
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const now = Date.now();
    this.pruneExpiredMessagesThrottled(now);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const channelClause =
      normalizedChannelId == null ? '' : 'AND channel_id = ?';
    const cursorClause = afterEventId
      ? 'AND (created_at > ? OR (created_at = ? AND root_event_id > ?))'
      : 'AND created_at > ?';
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedClause = excludedAuthors.length
      ? `AND author_address NOT IN (${excludedAuthors.map(() => '?').join(', ')})`
      : '';
    const params =
      normalizedChannelId == null
        ? afterEventId
          ? [
              groupId,
              now,
              afterTimestamp,
              afterTimestamp,
              afterEventId,
              ...excludedAuthors,
              safeLimit,
            ]
          : [groupId, now, afterTimestamp, ...excludedAuthors, safeLimit]
        : afterEventId
          ? [
              groupId,
              normalizedChannelId,
              now,
              afterTimestamp,
              afterTimestamp,
              afterEventId,
              ...excludedAuthors,
              safeLimit,
            ]
          : [
              groupId,
              normalizedChannelId,
              now,
              afterTimestamp,
              ...excludedAuthors,
              safeLimit,
            ];
    const rows = this.db
      .prepare(
        `
      SELECT * FROM rchat_message_projection
      WHERE group_id = ?
        ${channelClause}
        AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        ${cursorClause}
        ${excludedClause}
      ORDER BY created_at ASC, root_event_id ASC
      LIMIT ?
    `
      )
      .all(...params) as MessageProjectionRow[];
    return rows.map(messageProjectionRowToEvent);
  }

  private isChannelMetadataEventType(eventType: string): boolean {
    return (
      eventType === 'channel_create' ||
      eventType === 'channel_update' ||
      eventType === 'channel_archive' ||
      eventType === 'channel_restore' ||
      eventType === 'channel_reorder' ||
      eventType === 'category_create' ||
      eventType === 'category_update' ||
      eventType === 'category_delete'
    );
  }

  getChannelMetadataEvents(
    groupId: number,
    limit: number
  ): ReticulumChatEvent[] {
    const maxLimit = Math.max(1, Math.min(500, limit));
    const seen = new Set<string>();
    return [
      ...(
        this.stmtGetChannelMetadataEvents.all(groupId, maxLimit) as EventRow[]
      ).map(rowToEvent),
      [...this.memoryEvents.values()]
        .filter(
          (event) =>
            event.groupId === groupId &&
            this.isChannelMetadataEventType(event.eventType)
        )
        .sort(
          (a, b) =>
            b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
        )
        .slice(0, maxLimit),
    ]
      .flat()
      .filter((event) => {
        if (!this.isChannelMetadataEventType(event.eventType)) return false;
        if (seen.has(event.eventId)) return false;
        seen.add(event.eventId);
        return true;
      })
      .sort(
        (a, b) =>
          b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
      )
      .slice(0, maxLimit)
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      );
  }

  getChannelMetadataEventsForChannel(
    groupId: number,
    channelId: string
  ): ReticulumChatEvent[] {
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    if (!Number.isInteger(groupId) || groupId <= 0 || !normalizedChannelId)
      return [];
    const matches = (event: ReticulumChatEvent): boolean =>
      event.groupId === groupId &&
      normalizeReticulumChatChannelId(event.channelId) ===
        normalizedChannelId &&
      event.eventType.startsWith('channel_');
    const seen = new Set<string>();
    return [
      ...(
        this.db
          .prepare(
            `
        SELECT * FROM reticulum_chat_events
        WHERE group_id = ?
          AND channel_id = ?
          AND event_type IN (
            'channel_create',
            'channel_update',
            'channel_archive',
            'channel_restore',
            'channel_reorder'
          )
        ORDER BY timestamp ASC, event_id ASC
      `
          )
          .all(groupId, normalizedChannelId) as EventRow[]
      ).map(rowToEvent),
      ...[...this.memoryEvents.values()].filter(matches),
    ]
      .filter((event) => {
        if (!matches(event) || seen.has(event.eventId)) return false;
        seen.add(event.eventId);
        return true;
      })
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      );
  }

  getUnprojectedChannelCreateEvents(
    groupId: number,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `
      SELECT events.*
      FROM reticulum_chat_events AS events
      LEFT JOIN reticulum_chat_channels AS channels
        ON channels.group_id = events.group_id
       AND channels.channel_id = events.channel_id
      WHERE events.group_id = ?
        AND events.event_type = 'channel_create'
        AND channels.channel_id IS NULL
      ORDER BY events.timestamp ASC, events.event_id ASC
      LIMIT ?
    `
      )
      .all(groupId, safeLimit) as EventRow[];
    const seen = new Set(rows.map((row) => row.event_id));
    return [
      ...rows.map(rowToEvent),
      // The group's own session events only (same result as a full scan).
      ...this.memoryEvents
        .eventsInGroup(groupId)
        .filter(
          (event) =>
            event.groupId === groupId &&
            event.eventType === 'channel_create' &&
            !this.getChannel(groupId, event.channelId) &&
            !seen.has(event.eventId)
        ),
    ]
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      )
      .slice(0, safeLimit);
  }

  hasRemoteChannelMetadataEvents(groupId: number): boolean {
    const row = this.db
      .prepare(
        `
      SELECT 1 AS present
      FROM reticulum_chat_events
      WHERE group_id = ?
        AND own_event = 0
        AND event_type IN (
          'channel_create', 'channel_update', 'channel_archive', 'channel_restore',
          'channel_reorder', 'category_create', 'category_update', 'category_delete'
        )
      LIMIT 1
    `
      )
      .get(groupId) as { present?: number } | undefined;
    return row?.present === 1;
  }

  getChannelMetadataPageAfter(
    groupId: number,
    cursor: ReticulumChatFeedCursor | null,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const effectiveCursor = cursor ?? { feedTimestamp: -1, eventId: '' };
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (!this.isChannelMetadataEventType(event.eventType)) return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          effectiveCursor
        ) > 0
      );
    };
    return this.mergeWindowEvents(
      (
        this.stmtGetChannelMetadataPageAfter.all(
          groupId,
          effectiveCursor.feedTimestamp,
          effectiveCursor.feedTimestamp,
          effectiveCursor.eventId,
          safeLimit
        ) as EventRow[]
      )
        .map(rowToEvent)
        .filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getChannelMetadataPageBefore(
    groupId: number,
    cursor: ReticulumChatFeedCursor,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (!this.isChannelMetadataEventType(event.eventType)) return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          cursor
        ) < 0
      );
    };
    return this.mergeNewestWindowEvents(
      (
        this.stmtGetChannelMetadataPageBefore.all(
          groupId,
          cursor.feedTimestamp,
          cursor.feedTimestamp,
          cursor.eventId,
          safeLimit
        ) as EventRow[]
      )
        .map(rowToEvent)
        .filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getChannelMetadataPageAtOrBefore(
    groupId: number,
    cursor: ReticulumChatFeedCursor,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (!this.isChannelMetadataEventType(event.eventType)) return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          cursor
        ) <= 0
      );
    };
    return this.mergeNewestWindowEvents(
      (
        this.stmtGetChannelMetadataPageAtOrBefore.all(
          groupId,
          cursor.feedTimestamp,
          cursor.feedTimestamp,
          cursor.eventId,
          safeLimit
        ) as EventRow[]
      )
        .map(rowToEvent)
        .filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getEventsAfter(
    groupId: number,
    afterTimestamp: number,
    limit: number,
    afterEventId?: string,
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedAuthorSet = new Set(excludedAuthors);
    const exclusionClause = excludedAuthors.length
      ? `AND (event_type IN (${RETICULUM_CHAT_METADATA_EVENT_TYPES_SQL}) OR author_address NOT IN (${excludedAuthors
          .map(() => '?')
          .join(', ')}))`
      : '';
    const sqliteRows =
      excludedAuthors.length > 0
        ? (this.db
            .prepare(
              `
              SELECT * FROM reticulum_chat_events
              WHERE group_id = ?
                ${normalizedChannelId == null ? '' : 'AND channel_id = ?'}
                ${
                  afterEventId
                    ? 'AND (timestamp > ? OR (timestamp = ? AND event_id > ?))'
                    : 'AND timestamp > ?'
                }
                AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
                ${exclusionClause}
              ORDER BY timestamp ASC, event_id ASC
              LIMIT ?
            `
            )
            .all(
              groupId,
              ...(normalizedChannelId == null ? [] : [normalizedChannelId]),
              afterTimestamp,
              ...(afterEventId ? [afterTimestamp, afterEventId] : []),
              ...excludedAuthors,
              limit
            ) as EventRow[])
        : afterEventId
          ? normalizedChannelId == null
            ? (this.db
                .prepare(
                  `
              SELECT * FROM reticulum_chat_events
              WHERE group_id = ? AND (timestamp > ? OR (timestamp = ? AND event_id > ?))
                AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
              ORDER BY timestamp ASC, event_id ASC
              LIMIT ?
            `
                )
                .all(
                  groupId,
                  afterTimestamp,
                  afterTimestamp,
                  afterEventId,
                  limit
                ) as EventRow[])
            : (this.stmtGetEventsAfterCursor.all(
                groupId,
                normalizedChannelId,
                afterTimestamp,
                afterTimestamp,
                afterEventId,
                limit
              ) as EventRow[])
          : normalizedChannelId == null
            ? (this.db
                .prepare(
                  `
              SELECT * FROM reticulum_chat_events
              WHERE group_id = ? AND timestamp > ?
                AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
              ORDER BY timestamp ASC, event_id ASC
              LIMIT ?
            `
                )
                .all(groupId, afterTimestamp, limit) as EventRow[])
            : (this.stmtGetEventsAfter.all(
                groupId,
                normalizedChannelId,
                afterTimestamp,
                limit
              ) as EventRow[]);
    const matchesAfter = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (!this.eventIsVisible(event)) return false;
      if (!eventPassesAuthorExclusion(event, excludedAuthorSet)) return false;
      if (
        normalizedChannelId != null &&
        normalizeReticulumChatChannelId(event.channelId) !== normalizedChannelId
      )
        return false;
      if (!afterEventId) return event.timestamp > afterTimestamp;
      return (
        event.timestamp > afterTimestamp ||
        (event.timestamp === afterTimestamp && event.eventId > afterEventId)
      );
    };
    return this.mergeWindowEvents(
      sqliteRows.map(rowToEvent).filter(matchesAfter),
      [...this.memoryEvents.values()]
        .filter(matchesAfter)
        .sort(
          (a, b) =>
            a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
        )
        .slice(0, limit),
      limit
    );
  }

  getEventsBefore(
    groupId: number,
    beforeTimestamp: number,
    limit: number,
    beforeEventId?: string,
    channelId: string | null = null,
    excludedAuthorAddresses: readonly string[] = []
  ): ReticulumChatEvent[] {
    const normalizedChannelId =
      channelId == null ? null : normalizeReticulumChatChannelId(channelId);
    const excludedAuthors = normalizeExcludedAuthors(excludedAuthorAddresses);
    const excludedAuthorSet = new Set(excludedAuthors);
    const exclusionClause = excludedAuthors.length
      ? `AND (event_type IN (${RETICULUM_CHAT_METADATA_EVENT_TYPES_SQL}) OR author_address NOT IN (${excludedAuthors
          .map(() => '?')
          .join(', ')}))`
      : '';
    const sqliteRows =
      excludedAuthors.length > 0
        ? (this.db
            .prepare(
              `
              SELECT * FROM (
                SELECT * FROM reticulum_chat_events
                WHERE group_id = ?
                  ${normalizedChannelId == null ? '' : 'AND channel_id = ?'}
                  ${
                    beforeEventId
                      ? 'AND (timestamp < ? OR (timestamp = ? AND event_id < ?))'
                      : 'AND timestamp < ?'
                  }
                  AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
                  ${exclusionClause}
                ORDER BY timestamp DESC, event_id DESC
                LIMIT ?
              )
              ORDER BY timestamp ASC, event_id ASC
            `
            )
            .all(
              groupId,
              ...(normalizedChannelId == null ? [] : [normalizedChannelId]),
              beforeTimestamp,
              ...(beforeEventId ? [beforeTimestamp, beforeEventId] : []),
              ...excludedAuthors,
              limit
            ) as EventRow[])
        : beforeEventId
          ? normalizedChannelId == null
            ? (this.db
                .prepare(
                  `
              SELECT * FROM (
                SELECT * FROM reticulum_chat_events
                WHERE group_id = ? AND (timestamp < ? OR (timestamp = ? AND event_id < ?))
                  AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
                ORDER BY timestamp DESC, event_id DESC
                LIMIT ?
              )
              ORDER BY timestamp ASC, event_id ASC
            `
                )
                .all(
                  groupId,
                  beforeTimestamp,
                  beforeTimestamp,
                  beforeEventId,
                  limit
                ) as EventRow[])
            : (this.stmtGetEventsBeforeCursor.all(
                groupId,
                normalizedChannelId,
                beforeTimestamp,
                beforeTimestamp,
                beforeEventId,
                limit
              ) as EventRow[])
          : normalizedChannelId == null
            ? (this.db
                .prepare(
                  `
              SELECT * FROM (
                SELECT * FROM reticulum_chat_events
                WHERE group_id = ? AND timestamp < ?
                  AND ${RETICULUM_CHAT_VISIBLE_EVENT_SQL}
                ORDER BY timestamp DESC, event_id DESC
                LIMIT ?
              )
              ORDER BY timestamp ASC, event_id ASC
            `
                )
                .all(groupId, beforeTimestamp, limit) as EventRow[])
            : (this.stmtGetEventsBefore.all(
                groupId,
                normalizedChannelId,
                beforeTimestamp,
                limit
              ) as EventRow[]);
    const matchesBefore = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (!this.eventIsVisible(event)) return false;
      if (!eventPassesAuthorExclusion(event, excludedAuthorSet)) return false;
      if (
        normalizedChannelId != null &&
        normalizeReticulumChatChannelId(event.channelId) !== normalizedChannelId
      )
        return false;
      if (!beforeEventId) return event.timestamp < beforeTimestamp;
      return (
        event.timestamp < beforeTimestamp ||
        (event.timestamp === beforeTimestamp && event.eventId < beforeEventId)
      );
    };
    return this.mergeWindowEvents(
      sqliteRows.map(rowToEvent).filter(matchesBefore),
      [...this.memoryEvents.values()]
        .filter(matchesBefore)
        .sort(
          (a, b) =>
            b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
        )
        .slice(0, limit),
      limit
    );
  }

  getLatestFeedCursor(
    groupId: number,
    channelId: string
  ): ReticulumChatFeedCursor | null {
    const row = this.stmtGetLatestCursor.get(
      groupId,
      normalizeReticulumChatChannelId(channelId)
    ) as { event_id?: string; feed_timestamp?: number } | undefined;
    if (!row?.event_id || !Number.isFinite(row.feed_timestamp)) return null;
    let cursor: ReticulumChatFeedCursor = {
      eventId: row.event_id,
      feedTimestamp: Number(row.feed_timestamp),
    };
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      if (!this.eventIsVisible(event)) continue;
      if (
        normalizeReticulumChatChannelId(event.channelId) !==
        normalizeReticulumChatChannelId(channelId)
      )
        continue;
      const next = {
        eventId: event.eventId,
        feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
      };
      if (this.compareFeedCursors(next, cursor) > 0) cursor = next;
    }
    return cursor;
  }

  getOldestFeedCursor(
    groupId: number,
    channelId: string
  ): ReticulumChatFeedCursor | null {
    const row = this.stmtGetOldestCursor.get(
      groupId,
      normalizeReticulumChatChannelId(channelId)
    ) as { event_id?: string; feed_timestamp?: number } | undefined;
    if (!row?.event_id || !Number.isFinite(row.feed_timestamp)) return null;
    let cursor: ReticulumChatFeedCursor = {
      eventId: row.event_id,
      feedTimestamp: Number(row.feed_timestamp),
    };
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      if (!this.eventIsVisible(event)) continue;
      if (
        normalizeReticulumChatChannelId(event.channelId) !==
        normalizeReticulumChatChannelId(channelId)
      )
        continue;
      const next = {
        eventId: event.eventId,
        feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
      };
      if (this.compareFeedCursors(next, cursor) < 0) cursor = next;
    }
    return cursor;
  }

  getChannelDigestPage(
    groupId: number,
    limit: number,
    offset = 0
  ): {
    channels: ReticulumChatChannelDigest[];
    hasMore: boolean;
    nextOffset?: number;
  } {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.stmtGetChannelDigests.all(
      groupId,
      safeOffset + safeLimit + 1,
      0
    ) as Array<{
      channel_id?: string;
    }>;
    const sqliteChannelIds = rows.map((row) =>
      normalizeReticulumChatChannelId(row.channel_id)
    );
    const memoryChannelIds = [...this.memoryEvents.values()]
      .filter(
        (event) => event.groupId === groupId && this.eventIsVisible(event)
      )
      .map((event) => normalizeReticulumChatChannelId(event.channelId));
    const allChannelIds = [
      ...new Set([...sqliteChannelIds, ...memoryChannelIds]),
    ];
    const channels = allChannelIds
      .sort((a, b) => {
        const cursorA = this.getLatestFeedCursor(groupId, a);
        const cursorB = this.getLatestFeedCursor(groupId, b);
        if (!cursorA && !cursorB) return a.localeCompare(b);
        if (!cursorA) return 1;
        if (!cursorB) return -1;
        return this.compareFeedCursors(cursorB, cursorA) || a.localeCompare(b);
      })
      .slice(safeOffset, safeOffset + safeLimit)
      .map((channelId) => {
        const events = this.getRecentEvents(groupId, 25, channelId);
        return {
          groupId,
          channelId,
          latestCursor: this.getLatestFeedCursor(groupId, channelId),
          oldestCursor: this.getOldestFeedCursor(groupId, channelId),
          visibleWindowHash: this.computeWindowHash(events),
        };
      });
    const hasMore = allChannelIds.length > safeOffset + channels.length;
    return {
      channels,
      hasMore,
      ...(hasMore ? { nextOffset: safeOffset + channels.length } : {}),
    };
  }

  getFeedPageAfter(
    groupId: number,
    channelId: string,
    cursor: ReticulumChatFeedCursor | null,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const effectiveCursor = cursor ?? { feedTimestamp: -1, eventId: '' };
    const rows = this.stmtGetFeedPageAfter.all(
      groupId,
      normalizedChannelId,
      effectiveCursor.feedTimestamp,
      effectiveCursor.feedTimestamp,
      effectiveCursor.eventId,
      safeLimit
    ) as EventRow[];
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (this.isEventPayloadScrubbed(event.eventId)) return false;
      if (!this.eventIsVisible(event)) return false;
      if (
        normalizeReticulumChatChannelId(event.channelId) !== normalizedChannelId
      )
        return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          effectiveCursor
        ) > 0
      );
    };
    return this.mergeWindowEvents(
      rows.map(rowToEvent).filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getFeedPageBefore(
    groupId: number,
    channelId: string,
    cursor: ReticulumChatFeedCursor,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const rows = this.stmtGetFeedPageBefore.all(
      groupId,
      normalizedChannelId,
      cursor.feedTimestamp,
      cursor.feedTimestamp,
      cursor.eventId,
      safeLimit
    ) as EventRow[];
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (this.isEventPayloadScrubbed(event.eventId)) return false;
      if (!this.eventIsVisible(event)) return false;
      if (
        normalizeReticulumChatChannelId(event.channelId) !== normalizedChannelId
      )
        return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          cursor
        ) < 0
      );
    };
    return this.mergeNewestWindowEvents(
      rows.map(rowToEvent).filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  private mergeNewestWindowEvents(
    primary: ReticulumChatEvent[],
    secondary: ReticulumChatEvent[],
    limit: number
  ): ReticulumChatEvent[] {
    const seen = new Set<string>();
    return [...primary, ...secondary]
      .filter((event) => {
        if (seen.has(event.eventId)) return false;
        seen.add(event.eventId);
        return true;
      })
      .sort(
        (a, b) =>
          b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
      )
      .slice(0, limit)
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      );
  }

  getFeedPageAtOrBefore(
    groupId: number,
    channelId: string,
    cursor: ReticulumChatFeedCursor,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const rows = this.stmtGetFeedPageAtOrBefore.all(
      groupId,
      normalizedChannelId,
      cursor.feedTimestamp,
      cursor.feedTimestamp,
      cursor.eventId,
      safeLimit
    ) as EventRow[];
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (this.isEventPayloadScrubbed(event.eventId)) return false;
      if (!this.eventIsVisible(event)) return false;
      if (
        normalizeReticulumChatChannelId(event.channelId) !== normalizedChannelId
      )
        return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          cursor
        ) <= 0
      );
    };
    return this.mergeNewestWindowEvents(
      rows.map(rowToEvent).filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getGroupFeedPageAfter(
    groupId: number,
    cursor: ReticulumChatFeedCursor | null,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const effectiveCursor = cursor ?? { feedTimestamp: -1, eventId: '' };
    const rows = cursor
      ? this.stmtGetGroupEventsAfterCursor.all(
          groupId,
          effectiveCursor.feedTimestamp,
          effectiveCursor.feedTimestamp,
          effectiveCursor.eventId,
          safeLimit
        )
      : this.stmtGetGroupEventsAfter.all(
          groupId,
          effectiveCursor.feedTimestamp,
          safeLimit
        );
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (this.isEventPayloadScrubbed(event.eventId)) return false;
      if (!this.eventIsVisible(event)) return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          effectiveCursor
        ) > 0
      );
    };
    return this.mergeWindowEvents(
      (rows as EventRow[]).map(rowToEvent).filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getGroupFeedPageBefore(
    groupId: number,
    cursor: ReticulumChatFeedCursor,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const rows = this.stmtGetGroupEventsBeforeCursor.all(
      groupId,
      cursor.feedTimestamp,
      cursor.feedTimestamp,
      cursor.eventId,
      safeLimit
    ) as EventRow[];
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (this.isEventPayloadScrubbed(event.eventId)) return false;
      if (!this.eventIsVisible(event)) return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          cursor
        ) < 0
      );
    };
    return this.mergeNewestWindowEvents(
      rows.map(rowToEvent).filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getGroupFeedPageAtOrBefore(
    groupId: number,
    cursor: ReticulumChatFeedCursor,
    limit: number
  ): ReticulumChatEvent[] {
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const rows = this.stmtGetGroupEventsAtOrBeforeCursor.all(
      groupId,
      cursor.feedTimestamp,
      cursor.feedTimestamp,
      cursor.eventId,
      safeLimit
    ) as EventRow[];
    const matches = (event: ReticulumChatEvent): boolean => {
      if (event.groupId !== groupId) return false;
      if (this.isEventPayloadScrubbed(event.eventId)) return false;
      if (!this.eventIsVisible(event)) return false;
      return (
        this.compareFeedCursors(
          {
            eventId: event.eventId,
            feedTimestamp: this.normalizeFeedTimestamp(event.timestamp),
          },
          cursor
        ) <= 0
      );
    };
    return this.mergeNewestWindowEvents(
      rows.map(rowToEvent).filter(matches),
      [...this.memoryEvents.values()].filter(matches),
      safeLimit
    );
  }

  getAuthorEventsRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    limit: number
  ): ReticulumChatEvent[] {
    const safeFrom = Math.max(1, Math.floor(fromSeq));
    const safeTo = Math.max(safeFrom, Math.floor(toSeq));
    const safeLimit = Math.max(1, Math.min(101, Math.floor(limit)));
    const rows = this.stmtGetAuthorEventsRange.all(
      groupId,
      authorAddress,
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      safeFrom,
      safeTo,
      safeLimit
    ) as EventRow[];
    const byId = new Map<string, ReticulumChatEvent>();
    for (const event of rows.map(rowToEvent)) {
      byId.set(event.eventId, event);
    }
    const memoryMatches = [...this.memoryEvents.values()].filter(
      (event) =>
        event.groupId === groupId &&
        !this.isEventPayloadScrubbed(event.eventId) &&
        event.authorAddress === authorAddress &&
        normalizeReticulumChatAuthorStreamId(event.authorStreamId) ===
          normalizeReticulumChatAuthorStreamId(authorStreamId) &&
        event.authorSeq >= safeFrom &&
        event.authorSeq <= safeTo
    );
    for (const event of memoryMatches) {
      byId.set(event.eventId, event);
    }
    return [...byId.values()]
      .sort(
        (a, b) =>
          b.authorSeq - a.authorSeq ||
          b.timestamp - a.timestamp ||
          b.eventId.localeCompare(a.eventId)
      )
      .slice(0, safeLimit);
  }

  computeWindowHash(events: ReticulumChatEvent[]): string {
    const eventsById = new Map<string, ReticulumChatEvent>();
    for (const event of events) {
      if (!eventsById.has(event.eventId)) {
        eventsById.set(event.eventId, event);
      }
    }
    const ids = [...eventsById.keys()].sort((a, b) => {
      const eventA = eventsById.get(a);
      const eventB = eventsById.get(b);
      if (!eventA || !eventB) return a.localeCompare(b);
      return (
        this.normalizeFeedTimestamp(eventA.timestamp) -
          this.normalizeFeedTimestamp(eventB.timestamp) ||
        eventA.eventId.localeCompare(eventB.eventId)
      );
    });
    return nodeCrypto
      .createHash('sha256')
      .update(JSON.stringify(ids), 'utf8')
      .digest('hex');
  }

  upsertPeerGroupState(
    peerHash: string,
    groupId: number,
    latestCursor: ReticulumChatFeedCursor | null,
    digestHash = '',
    updatedAt = Date.now()
  ): void {
    const key = peerHash.trim().toLowerCase();
    if (!key || !Number.isInteger(groupId) || groupId <= 0) return;
    this.stmtUpsertPeerGroupState.run({
      peer_hash: key,
      group_id: groupId,
      latest_event_id: latestCursor?.eventId ?? null,
      latest_feed_timestamp: latestCursor?.feedTimestamp ?? null,
      digest_hash: digestHash || null,
      updated_at: updatedAt,
    });
  }

  upsertPeerChannelState(
    peerHash: string,
    state: ReticulumChatChannelDigest,
    updatedAt = Date.now()
  ): void {
    const key = peerHash.trim().toLowerCase();
    if (!key || !Number.isInteger(state.groupId) || state.groupId <= 0) return;
    const channelId = normalizeReticulumChatChannelId(state.channelId);
    this.stmtUpsertPeerChannelState.run({
      peer_hash: key,
      group_id: state.groupId,
      channel_id: channelId,
      latest_event_id: state.latestCursor?.eventId ?? null,
      latest_feed_timestamp: state.latestCursor?.feedTimestamp ?? null,
      oldest_event_id: state.oldestCursor?.eventId ?? null,
      oldest_feed_timestamp: state.oldestCursor?.feedTimestamp ?? null,
      visible_window_hash: state.visibleWindowHash || null,
      updated_at: updatedAt,
    });
  }

  upsertVerifiedWindow(
    groupId: number,
    channelId: string,
    start: ReticulumChatFeedCursor,
    end: ReticulumChatFeedCursor,
    windowHash: string,
    verifiedAt = Date.now()
  ): void {
    if (!Number.isInteger(groupId) || groupId <= 0) return;
    if (!windowHash) return;
    this.stmtUpsertVerifiedWindow.run({
      group_id: groupId,
      channel_id: normalizeReticulumChatChannelId(channelId),
      start_event_id: start.eventId,
      start_feed_timestamp: start.feedTimestamp,
      end_event_id: end.eventId,
      end_feed_timestamp: end.feedTimestamp,
      window_hash: windowHash,
      verified_at: verifiedAt,
    });
  }

  upsertMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    preferredPeer = '',
    nextAttemptAt = 0
  ): void {
    const author =
      typeof authorAddress === 'string' ? authorAddress.trim() : '';
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const peer =
      typeof preferredPeer === 'string'
        ? preferredPeer.trim().toLowerCase()
        : '';
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return;
    const key = this.missingRangeKey(groupId, author, stream, from, to);
    const alreadyTracked = this.memoryMissingRanges.has(key);
    const knownUnavailable = this.getMissingRangeKnownUnavailable(
      groupId,
      author,
      stream,
      from,
      to
    );
    this.stmtUpsertMissingRange.run({
      group_id: groupId,
      author_address: author,
      author_stream_id: stream,
      from_seq: from,
      to_seq: to,
      preferred_peer: peer || null,
      next_attempt_at: nextAttemptAt,
    });
    this.missingRangeWrites += 1;
    const existing = this.memoryMissingRanges.get(key);
    this.memoryMissingRanges.set(key, {
      groupId,
      authorAddress: author,
      authorStreamId: stream,
      fromSeq: from,
      toSeq: to,
      preferredPeer: knownUnavailable
        ? existing?.preferredPeer || peer
        : peer || existing?.preferredPeer || '',
      attempts: existing?.attempts ?? 0,
      nextAttemptAt: existing
        ? knownUnavailable
          ? Math.max(
              existing.nextAttemptAt,
              knownUnavailable.recheckAt,
              Math.max(0, Math.floor(nextAttemptAt))
            )
          : Math.min(
              existing.nextAttemptAt,
              Math.max(0, Math.floor(nextAttemptAt))
            )
        : Math.max(0, Math.floor(nextAttemptAt)),
    });
    if (!alreadyTracked) {
      this.pruneSatisfiedMissingRange(groupId, author, stream, from, to);
    }
  }

  ensureMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    preferredPeer = ''
  ): void {
    const author =
      typeof authorAddress === 'string' ? authorAddress.trim() : '';
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const peer =
      typeof preferredPeer === 'string'
        ? preferredPeer.trim().toLowerCase()
        : '';
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return;
    const key = this.missingRangeKey(groupId, author, stream, from, to);
    const alreadyTracked = this.memoryMissingRanges.has(key);
    const result = this.stmtEnsureMissingRange.run({
      group_id: groupId,
      author_address: author,
      author_stream_id: stream,
      from_seq: from,
      to_seq: to,
      preferred_peer: peer || null,
      next_attempt_at: 0,
    });
    if (result.changes > 0) this.missingRangeWrites += 1;
    if (!this.memoryMissingRanges.has(key)) {
      this.memoryMissingRanges.set(key, {
        groupId,
        authorAddress: author,
        authorStreamId: stream,
        fromSeq: from,
        toSeq: to,
        preferredPeer: peer,
        attempts: 0,
        nextAttemptAt: 0,
      });
    }
    if (!alreadyTracked || result.changes > 0) {
      this.pruneSatisfiedMissingRange(groupId, author, stream, from, to);
    }
  }

  scheduleMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    preferredPeer: string,
    nextAttemptAt: number
  ): ReticulumChatMissingRangeState | null {
    this.ensureMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq,
      preferredPeer
    );
    const current = this.getMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq
    );
    if (!current) return null;
    const knownUnavailable = this.getMissingRangeKnownUnavailable(
      current.groupId,
      current.authorAddress,
      current.authorStreamId,
      current.fromSeq,
      current.toSeq
    );
    const peer = knownUnavailable
      ? current.preferredPeer
      : preferredPeer.trim().toLowerCase() || current.preferredPeer;
    const next = Math.max(
      current.nextAttemptAt,
      knownUnavailable?.recheckAt ?? 0,
      Math.floor(nextAttemptAt)
    );
    // Rewriting a row's own values still dirties the page; on GO's OPFS
    // rollback journal that is about 5 flushes. Skip it.
    if (peer !== current.preferredPeer || next !== current.nextAttemptAt) {
      this.stmtUpdateMissingRangeBackoff.run({
        group_id: current.groupId,
        author_address: current.authorAddress,
        author_stream_id: current.authorStreamId,
        from_seq: current.fromSeq,
        to_seq: current.toSeq,
        preferred_peer: peer || null,
        attempts: current.attempts,
        next_attempt_at: next,
      });
      this.missingRangeWrites += 1;
    }
    const updated = {
      ...current,
      preferredPeer: peer,
      nextAttemptAt: next,
    };
    this.memoryMissingRanges.set(
      this.missingRangeKey(
        current.groupId,
        current.authorAddress,
        current.authorStreamId,
        current.fromSeq,
        current.toSeq
      ),
      updated
    );
    return updated;
  }

  rescheduleMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    preferredPeer: string,
    nextAttemptAt: number,
    expectedPreferredPeer?: string
  ): ReticulumChatMissingRangeState | null {
    const current = this.getMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq
    );
    if (!current) return null;
    const knownUnavailable = this.getMissingRangeKnownUnavailable(
      current.groupId,
      current.authorAddress,
      current.authorStreamId,
      current.fromSeq,
      current.toSeq
    );
    const peer = knownUnavailable
      ? current.preferredPeer
      : preferredPeer.trim().toLowerCase() || current.preferredPeer;
    const next = Math.max(
      knownUnavailable?.recheckAt ?? 0,
      Math.max(0, Math.floor(nextAttemptAt))
    );
    const expectedPeer =
      typeof expectedPreferredPeer === 'string'
        ? expectedPreferredPeer.trim().toLowerCase()
        : null;
    const params = {
      group_id: current.groupId,
      author_address: current.authorAddress,
      author_stream_id: current.authorStreamId,
      from_seq: current.fromSeq,
      to_seq: current.toSeq,
      preferred_peer: peer || null,
      next_attempt_at: next,
    };
    const result =
      expectedPeer == null
        ? this.stmtRescheduleMissingRangeAny.run(params)
        : this.stmtRescheduleMissingRange.run({
            ...params,
            expected_peer: expectedPeer,
          });
    this.missingRangeWrites += 1;
    if (result.changes === 0) {
      const persistedRow = this.stmtGetMissingRangeExact.get(
        current.groupId,
        current.authorAddress,
        current.authorStreamId,
        current.fromSeq,
        current.toSeq
      ) as ReticulumChatMissingRangeRow | undefined;
      if (persistedRow) {
        // A conditional reschedule can lose a race to another route update.
        // Keep the in-memory mirror aligned with the authoritative row; a
        // stale due value here would otherwise keep the repair scheduler
        // waking even though SQLite already contains a future retry.
        const persisted = this.missingRangeRowToState(persistedRow);
        this.memoryMissingRanges.set(
          this.missingRangeKey(
            persisted.groupId,
            persisted.authorAddress,
            persisted.authorStreamId,
            persisted.fromSeq,
            persisted.toSeq
          ),
          persisted
        );
        return persisted;
      }
      if (
        expectedPeer != null &&
        current.preferredPeer.trim().toLowerCase() !== expectedPeer
      ) {
        return current;
      }
    }
    const updated = { ...current, preferredPeer: peer, nextAttemptAt: next };
    this.memoryMissingRanges.set(
      this.missingRangeKey(
        current.groupId,
        current.authorAddress,
        current.authorStreamId,
        current.fromSeq,
        current.toSeq
      ),
      updated
    );
    return updated;
  }

  getMissingRangeOverlaps(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): ReticulumChatMissingRangeState[] {
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const safeFrom = Math.max(1, Math.floor(fromSeq));
    const safeTo = Math.max(safeFrom, Math.floor(toSeq));
    const rows = this.stmtGetMissingRangeOverlaps.all({
      group_id: groupId,
      author_address: authorAddress,
      author_stream_id: stream,
      from_seq: safeFrom,
      to_seq: safeTo,
    }) as ReticulumChatMissingRangeRow[];
    return this.dedupeMissingRangeRows([
      ...rows,
      ...[...this.memoryMissingRanges.values()]
        .filter(
          (range) =>
            range.groupId === groupId &&
            range.authorAddress === authorAddress &&
            range.authorStreamId === stream &&
            range.fromSeq <= safeTo &&
            range.toSeq >= safeFrom
        )
        .map((range) => this.missingRangeStateToRow(range)),
    ]).map((row) => this.missingRangeRowToState(row));
  }

  recordMissingRangePeerUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    peerHash: string,
    observedAt = Date.now(),
    observationMaxAgeMs = Number.POSITIVE_INFINITY
  ): number {
    const author = String(authorAddress || '').trim();
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const peer = String(peerHash || '')
      .trim()
      .toLowerCase();
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    if (
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !author ||
      !stream ||
      !peer
    )
      return 0;
    const oldestAcceptedAt = Number.isFinite(observationMaxAgeMs)
      ? Math.floor(observedAt) - Math.max(0, Math.floor(observationMaxAgeMs))
      : Number.NEGATIVE_INFINITY;
    // The prune is a whole-table DELETE and every reader already filters by
    // the cutoff, so once a minute is enough: on GO's rollback journal it was
    // one more autocommit write (about 5 flushes) per denial.
    if (
      Number.isFinite(oldestAcceptedAt) &&
      (this.missingRangeObservationPrunedAt === 0 ||
        Math.abs(
          Math.floor(observedAt) - this.missingRangeObservationPrunedAt
        ) >= 60_000)
    ) {
      this.stmtPruneMissingRangePeerUnavailable.run(oldestAcceptedAt);
      this.missingRangeObservationPrunedAt = Math.max(
        1,
        Math.floor(observedAt)
      );
    }
    this.stmtUpsertMissingRangePeerUnavailable.run(
      groupId,
      author,
      stream,
      from,
      to,
      peer,
      Math.floor(observedAt)
    );
    return this.countMissingRangePeerUnavailable(
      groupId,
      author,
      stream,
      from,
      to,
      oldestAcceptedAt
    );
  }

  countMissingRangePeerUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    observedAfter = 0
  ): number {
    const row = this.stmtCountMissingRangePeerUnavailable.get(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      Math.max(1, Math.floor(fromSeq)),
      Math.max(Math.max(1, Math.floor(fromSeq)), Math.floor(toSeq)),
      Math.max(0, Math.floor(observedAfter))
    ) as { count?: number } | undefined;
    return Math.max(0, Math.floor(Number(row?.count || 0)));
  }

  hasMissingRangePeerUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    peerHash: string,
    observedAfter = 0
  ): boolean {
    const row = this.stmtGetMissingRangePeerUnavailable.get(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      Math.max(1, Math.floor(fromSeq)),
      Math.max(Math.max(1, Math.floor(fromSeq)), Math.floor(toSeq)),
      String(peerHash || '')
        .trim()
        .toLowerCase()
    );
    const observedAt = Number(
      (row as { observed_at?: number | null } | undefined)?.observed_at
    );
    return (
      Number.isFinite(observedAt) &&
      observedAt > 0 &&
      observedAt >= observedAfter
    );
  }

  clearMissingRangePeerUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): void {
    this.stmtClearMissingRangePeerUnavailable.run(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      Math.max(1, Math.floor(toSeq)),
      Math.max(1, Math.floor(fromSeq))
    );
  }

  markMissingRangeKnownUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    peerHashes: string[],
    confirmedAt: number,
    recheckAt: number,
    maxRecords = 4_096,
    // GO (authorGapAgeAware): an old row parks even when no peer was asked
    // (only GO peers around, which never serve it).
    allowNoPeers = false
  ): ReticulumChatKnownUnavailableRange | null {
    const author = String(authorAddress || '').trim();
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    const peers = [
      ...new Set(peerHashes.map((peer) => peer.trim().toLowerCase())),
    ]
      .filter(Boolean)
      .sort()
      .slice(0, 64);
    if (
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !author ||
      (peers.length === 0 && !allowNoPeers)
    )
      return null;
    const confirmed = Math.max(0, Math.floor(confirmedAt));
    const recheck = Math.max(confirmed, Math.floor(recheckAt));
    const params = {
      group_id: groupId,
      author_address: author,
      author_stream_id: stream,
      from_seq: from,
      to_seq: to,
      confirmed_at: confirmed,
      recheck_at: recheck,
      peer_hashes_json: JSON.stringify(peers),
    };
    const persist = this.db.transaction(() => {
      const parked = this.stmtParkKnownUnavailableRange.run(params);
      this.missingRangeWrites += 1;
      if (parked.changes === 0) return false;
      this.stmtUpsertKnownUnavailableRange.run(params);
      this.stmtPruneKnownUnavailableRanges.run(
        Math.max(1, Math.floor(maxRecords))
      );
      return true;
    });
    if (!persist()) return null;
    const key = this.missingRangeKey(groupId, author, stream, from, to);
    const memoryRange = this.memoryMissingRanges.get(key);
    if (memoryRange) {
      this.memoryMissingRanges.set(key, {
        ...memoryRange,
        nextAttemptAt: Math.max(memoryRange.nextAttemptAt, recheck),
      });
    }
    return {
      groupId,
      authorAddress: author,
      authorStreamId: stream,
      fromSeq: from,
      toSeq: to,
      confirmedAt: confirmed,
      recheckAt: recheck,
      peerHashes: peers,
    };
  }

  getMissingRangeKnownUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): ReticulumChatKnownUnavailableRange | null {
    const row = this.stmtGetKnownUnavailableRange.get(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      Math.max(1, Math.floor(fromSeq)),
      Math.max(Math.max(1, Math.floor(fromSeq)), Math.floor(toSeq))
    ) as
      | {
          group_id: number;
          author_address: string;
          author_stream_id: string;
          from_seq: number;
          to_seq: number;
          confirmed_at: number;
          recheck_at: number;
          peer_hashes_json: string;
        }
      | undefined;
    if (!row) return null;
    let peerHashes: string[] = [];
    try {
      const parsed = JSON.parse(row.peer_hashes_json);
      if (Array.isArray(parsed)) {
        peerHashes = parsed
          .map((peer) =>
            String(peer || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean);
      }
    } catch {
      peerHashes = [];
    }
    return {
      groupId: row.group_id,
      authorAddress: row.author_address,
      authorStreamId: normalizeReticulumChatAuthorStreamId(
        row.author_stream_id
      ),
      fromSeq: row.from_seq,
      toSeq: row.to_seq,
      confirmedAt: row.confirmed_at,
      recheckAt: row.recheck_at,
      peerHashes,
    };
  }

  clearMissingRangeKnownUnavailable(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): void {
    this.stmtClearKnownUnavailableRange.run(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      Math.max(1, Math.floor(toSeq)),
      Math.max(1, Math.floor(fromSeq))
    );
  }

  wakeKnownUnavailableRangesForGroup(
    groupId: number,
    nextAttemptAt = Date.now()
  ): number {
    if (!Number.isInteger(groupId) || groupId <= 0) return 0;
    const markerRows = this.stmtGetKnownUnavailableRangesForGroup.all(
      groupId
    ) as Array<{
      author_address: string;
      author_stream_id: string;
      from_seq: number;
      to_seq: number;
    }>;
    if (markerRows.length === 0) return 0;
    const next = Math.max(0, Math.floor(nextAttemptAt));
    const wake = this.db.transaction(() => {
      this.stmtWakeKnownUnavailableRangesForGroup.run({
        group_id: groupId,
        next_attempt_at: next,
      });
      this.missingRangeWrites += 1;
      this.stmtClearKnownUnavailableRangesForGroup.run(groupId);
    });
    wake();
    for (const row of markerRows) {
      const key = this.missingRangeKey(
        groupId,
        row.author_address,
        row.author_stream_id,
        row.from_seq,
        row.to_seq
      );
      const range = this.memoryMissingRanges.get(key);
      if (!range) continue;
      this.memoryMissingRanges.set(key, {
        ...range,
        nextAttemptAt: Math.min(range.nextAttemptAt, next),
      });
    }
    return markerRows.length;
  }

  /**
   * GO (mobileProfile authorGapAgeAware): the own timestamp of the stored
   * message right after a gap row (author_seq = toSeq + 1), or null when none
   * is stored (a tail row, or its neighbour was rejected). SQL only, one read
   * on the unique author-sequence index: getAuthorSeqTimestamp also walks the
   * session's events, too costly on every peer pick.
   */
  getMissingRangeNeighbourTimestamp(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    toSeq: number
  ): number | null {
    const author = String(authorAddress || '').trim();
    const seq = Math.max(1, Math.floor(toSeq)) + 1;
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return null;
    if (!Number.isSafeInteger(seq)) return null;
    this.stmtGetMissingRangeNeighbourTimestamp ??= this.db.prepare(`
      SELECT timestamp FROM rchat_event_headers
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND author_seq = ?
      LIMIT 1
    `);
    const row = this.stmtGetMissingRangeNeighbourTimestamp.get(
      groupId,
      author,
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      seq
    ) as { timestamp?: unknown } | undefined;
    const at = Number(row?.timestamp);
    return row && Number.isFinite(at) && at > 0 ? at : null;
  }

  // GO (mobileProfile authorGapAgeAware): who already answered for an old gap
  // row, how many answers its current round had and when a new provider last
  // woke it. Its own table, so a group-wide wake (which clears the
  // known-unavailable markers on an access change) does not forget who was
  // asked. Created on first use: desktop never creates or reads it.
  private ensureOldGapAskSchema(): void {
    if (this.oldGapAskSchemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_old_gap_asks (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        peer_hashes_json TEXT NOT NULL DEFAULT '[]',
        cycle_asks INTEGER NOT NULL DEFAULT 0,
        woken_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, author_address, author_stream_id, from_seq, to_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_old_gap_asks_updated
        ON rchat_old_gap_asks (updated_at);
    `);
    // Inside a write batch the CREATE is undone if the batch rolls back, so
    // only a CREATE outside any transaction counts as done; until then each
    // call runs the (cheap, idempotent) CREATE again.
    if (!this.db.inTransaction) this.oldGapAskSchemaReady = true;
  }

  private getOldGapAskExactRow(
    groupId: number,
    author: string,
    stream: string,
    from: number,
    to: number
  ):
    | {
        peer_hashes_json?: string;
        cycle_asks?: number;
        woken_at?: number;
      }
    | undefined {
    this.ensureOldGapAskSchema();
    this.stmtGetOldGapAskExact ??= this.db.prepare(`
      SELECT peer_hashes_json, cycle_asks, woken_at
      FROM rchat_old_gap_asks
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq = ? AND to_seq = ?
      LIMIT 1
    `);
    return this.stmtGetOldGapAskExact.get(groupId, author, stream, from, to) as
      | {
          peer_hashes_json?: string;
          cycle_asks?: number;
          woken_at?: number;
        }
      | undefined;
  }

  private writeOldGapAsk(
    groupId: number,
    author: string,
    stream: string,
    from: number,
    to: number,
    peers: string[],
    cycleAsks: number,
    wokenAt: number,
    now: number
  ): void {
    this.stmtUpsertOldGapAsk ??= this.db.prepare(`
      INSERT INTO rchat_old_gap_asks
        (group_id, author_address, author_stream_id, from_seq, to_seq,
         peer_hashes_json, cycle_asks, woken_at, updated_at)
      VALUES
        (@group_id, @author_address, @author_stream_id, @from_seq, @to_seq,
         @peer_hashes_json, @cycle_asks, @woken_at, @updated_at)
      ON CONFLICT(group_id, author_address, author_stream_id, from_seq, to_seq)
      DO UPDATE SET
        peer_hashes_json = excluded.peer_hashes_json,
        cycle_asks = excluded.cycle_asks,
        woken_at = excluded.woken_at,
        updated_at = excluded.updated_at
    `);
    this.stmtUpsertOldGapAsk.run({
      group_id: groupId,
      author_address: author,
      author_stream_id: stream,
      from_seq: from,
      to_seq: to,
      peer_hashes_json: JSON.stringify(
        peers.slice(-RETICULUM_CHAT_OLD_GAP_ASKS_MAX_PEERS)
      ),
      cycle_asks: Math.max(0, Math.floor(cycleAsks)),
      woken_at: Math.max(0, Math.floor(wokenAt)),
      updated_at: Math.max(0, Math.floor(now)),
    });
    this.missingRangeWrites += 1;
    this.pruneOldGapAsks(now);
  }

  // At most once an hour: rows whose gap is gone (every row they cover was
  // filled) and rows past the cap, least recently touched first.
  private pruneOldGapAsks(now: number): void {
    const at = Math.floor(now);
    if (
      this.oldGapAskPrunedAt !== 0 &&
      Math.abs(at - this.oldGapAskPrunedAt) <
        RETICULUM_CHAT_OLD_GAP_ASKS_PRUNE_INTERVAL_MS
    ) {
      return;
    }
    this.oldGapAskPrunedAt = Math.max(1, at);
    this.db
      .prepare(
        `
      DELETE FROM rchat_old_gap_asks
      WHERE NOT EXISTS (
        SELECT 1 FROM rchat_missing_stream_ranges r
        WHERE r.group_id = rchat_old_gap_asks.group_id
          AND r.author_address = rchat_old_gap_asks.author_address
          AND r.author_stream_id = rchat_old_gap_asks.author_stream_id
          AND r.from_seq >= rchat_old_gap_asks.from_seq
          AND r.to_seq <= rchat_old_gap_asks.to_seq
      )
    `
      )
      .run();
    this.db
      .prepare(
        `
      DELETE FROM rchat_old_gap_asks
      WHERE rowid NOT IN (
        SELECT rowid FROM rchat_old_gap_asks
        ORDER BY updated_at DESC, rowid DESC
        LIMIT ?
      )
    `
      )
      .run(RETICULUM_CHAT_OLD_GAP_ASKS_MAX_ROWS);
    this.missingRangeWrites += 2;
  }

  /**
   * GO (mobileProfile authorGapAgeAware): the old row's asked peers (from its
   * own entry and from any entry covering it: a peer that had none of a range
   * has none of a part of it), its round's answer count and last wake.
   */
  getOldGapAskState(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): ReticulumChatOldGapAskState {
    const author = String(authorAddress || '').trim();
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) {
      return { askedPeers: [], cycleAsks: 0, wokenAt: 0 };
    }
    this.ensureOldGapAskSchema();
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    this.stmtGetOldGapAsksCovering ??= this.db.prepare(`
      SELECT from_seq, to_seq, peer_hashes_json, cycle_asks, woken_at
      FROM rchat_old_gap_asks
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND from_seq <= ? AND to_seq >= ?
      ORDER BY from_seq DESC
      LIMIT 32
    `);
    const rows = (this.stmtGetOldGapAsksCovering.all(
      groupId,
      author,
      stream,
      from,
      to
    ) ?? []) as Array<{
      from_seq?: number;
      to_seq?: number;
      peer_hashes_json?: string;
      cycle_asks?: number;
      woken_at?: number;
    }>;
    const peers = new Set<string>();
    let cycleAsks = 0;
    let wokenAt = 0;
    for (const row of rows) {
      for (const peer of parseOldGapAskPeers(row.peer_hashes_json)) {
        peers.add(peer);
      }
      if (Number(row.from_seq) === from && Number(row.to_seq) === to) {
        cycleAsks = Math.max(0, Math.floor(Number(row.cycle_asks) || 0));
        wokenAt = Math.max(0, Math.floor(Number(row.woken_at) || 0));
      }
    }
    return { askedPeers: [...peers], cycleAsks, wokenAt };
  }

  /**
   * GO (mobileProfile authorGapAgeAware): `peerHash` answered that it has
   * none of this old row. Remembers the peer and counts the answer in the
   * row's round; returns the round's answer count after it.
   */
  noteOldGapAnswer(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    peerHash: string,
    now: number
  ): number {
    const author = String(authorAddress || '').trim();
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return 0;
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    const exact = this.getOldGapAskExactRow(groupId, author, stream, from, to);
    const peers = parseOldGapAskPeers(exact?.peer_hashes_json);
    const peer = String(peerHash || '')
      .trim()
      .toLowerCase();
    if (peer && !peers.includes(peer)) peers.push(peer);
    const cycleAsks =
      Math.max(0, Math.floor(Number(exact?.cycle_asks) || 0)) + 1;
    this.writeOldGapAsk(
      groupId,
      author,
      stream,
      from,
      to,
      peers,
      cycleAsks,
      Math.max(0, Math.floor(Number(exact?.woken_at) || 0)),
      now
    );
    return cycleAsks;
  }

  /**
   * GO (mobileProfile authorGapAgeAware): set an old row's round answer count
   * (0 when it parks) and, for a wake, when it was woken. The asked peers are
   * kept. A row with nothing to remember is not written.
   */
  setOldGapAskRound(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    cycleAsks: number,
    now: number,
    wokenAt?: number
  ): void {
    const author = String(authorAddress || '').trim();
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return;
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    const cycle = Math.max(0, Math.floor(cycleAsks));
    const exact = this.getOldGapAskExactRow(groupId, author, stream, from, to);
    const storedCycle = Math.max(0, Math.floor(Number(exact?.cycle_asks) || 0));
    if (wokenAt == null && storedCycle === cycle) return;
    this.writeOldGapAsk(
      groupId,
      author,
      stream,
      from,
      to,
      parseOldGapAskPeers(exact?.peer_hashes_json),
      cycle,
      wokenAt ?? Math.max(0, Math.floor(Number(exact?.woken_at) || 0)),
      now
    );
  }

  /**
   * GO (mobileProfile authorGapAgeAware): forget who was asked for the
   * group's old rows. A Hub's "none" can depend on this account's read
   * access (it filters admin-only channels), so after access grows each Hub
   * may be asked once more. Returns the number of entries removed.
   */
  clearOldGapAsksForGroup(groupId: number): number {
    if (!Number.isInteger(groupId) || groupId <= 0) return 0;
    this.ensureOldGapAskSchema();
    this.stmtClearOldGapAsksForGroup ??= this.db.prepare(
      'DELETE FROM rchat_old_gap_asks WHERE group_id = ?'
    );
    const changes = Number(
      this.stmtClearOldGapAsksForGroup.run(groupId)?.changes ?? 0
    );
    if (changes > 0) this.missingRangeWrites += 1;
    return changes;
  }

  getMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): ReticulumChatMissingRangeState | null {
    const author =
      typeof authorAddress === 'string' ? authorAddress.trim() : '';
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return null;
    const row = this.stmtGetMissingRangeExact.get(
      groupId,
      author,
      stream,
      from,
      to
    ) as ReticulumChatMissingRangeRow | undefined;
    return row
      ? this.missingRangeRowToState(row)
      : (this.memoryMissingRanges.get(
          this.missingRangeKey(groupId, author, stream, from, to)
        ) ?? null);
  }

  claimMissingRangeAttempt(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    preferredPeer: string,
    now: number,
    nextAttemptAt: number
  ): ReticulumChatMissingRangeState | null {
    this.ensureMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq,
      preferredPeer
    );
    const current = this.getMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq
    );
    if (!current || current.nextAttemptAt > now) return null;
    const attempts = Math.max(0, Math.floor(current.attempts || 0)) + 1;
    this.stmtUpdateMissingRangeAttempt.run({
      group_id: current.groupId,
      author_address: current.authorAddress,
      author_stream_id: current.authorStreamId,
      from_seq: current.fromSeq,
      to_seq: current.toSeq,
      preferred_peer: preferredPeer.trim().toLowerCase() || null,
      attempts,
      next_attempt_at: Math.max(now, Math.floor(nextAttemptAt)),
    });
    this.missingRangeWrites += 1;
    const updated = {
      ...current,
      preferredPeer:
        preferredPeer.trim().toLowerCase() || current.preferredPeer,
      attempts,
      nextAttemptAt: Math.max(now, Math.floor(nextAttemptAt)),
    };
    this.memoryMissingRanges.set(
      this.missingRangeKey(
        current.groupId,
        current.authorAddress,
        current.authorStreamId,
        current.fromSeq,
        current.toSeq
      ),
      updated
    );
    return updated;
  }

  /**
   * GO (mobileProfile keepMembershipDeferredPulls): gives back the attempt a
   * claim took when the page came back with every event waiting on the
   * membership check. Sets attempts and the next try as given; a
   * known-unavailable marker still holds the row until its recheck.
   */
  restoreMissingRangeAttempt(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    attempts: number,
    nextAttemptAt: number
  ): ReticulumChatMissingRangeState | null {
    const current = this.getMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq
    );
    if (!current) return null;
    const knownUnavailable = this.getMissingRangeKnownUnavailable(
      current.groupId,
      current.authorAddress,
      current.authorStreamId,
      current.fromSeq,
      current.toSeq
    );
    const restoredAttempts = Math.max(0, Math.floor(attempts || 0));
    const next = Math.max(
      knownUnavailable?.recheckAt ?? 0,
      Math.max(0, Math.floor(nextAttemptAt))
    );
    if (
      restoredAttempts === current.attempts &&
      next === current.nextAttemptAt
    ) {
      return current;
    }
    this.stmtUpdateMissingRangeAttempt.run({
      group_id: current.groupId,
      author_address: current.authorAddress,
      author_stream_id: current.authorStreamId,
      from_seq: current.fromSeq,
      to_seq: current.toSeq,
      preferred_peer: null,
      attempts: restoredAttempts,
      next_attempt_at: next,
    });
    this.missingRangeWrites += 1;
    const updated = {
      ...current,
      attempts: restoredAttempts,
      nextAttemptAt: next,
    };
    this.memoryMissingRanges.set(
      this.missingRangeKey(
        current.groupId,
        current.authorAddress,
        current.authorStreamId,
        current.fromSeq,
        current.toSeq
      ),
      updated
    );
    return updated;
  }

  /**
   * GO (mobileProfile gapDenialBackoff): one more explicit "no such events"
   * from a provider for this exact row; returns the row's denial streak after
   * it (0 when the row is gone). The streak is not the lifetime attempts
   * count: local, route and auth failures never touch it, and a row that is
   * rewritten or split (an event in it arrived) starts again at 0.
   */
  noteMissingRangeDenial(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): number {
    const author = String(authorAddress || '').trim();
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const from = Math.max(1, Math.floor(fromSeq));
    const to = Math.max(from, Math.floor(toSeq));
    if (!Number.isInteger(groupId) || groupId <= 0 || !author) return 0;
    if (!this.stmtBumpMissingRangeDenialStreak) {
      this.stmtBumpMissingRangeDenialStreak = this.db.prepare(`
        UPDATE rchat_missing_stream_ranges
        SET denial_streak = denial_streak + 1
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
          AND from_seq = ? AND to_seq = ?
      `);
    }
    const result = this.stmtBumpMissingRangeDenialStreak.run(
      groupId,
      author,
      stream,
      from,
      to
    );
    if (!(Number(result?.changes) > 0)) return 0;
    this.missingRangeWrites += 1;
    return this.getMissingRangeDenialStreak(groupId, author, stream, from, to);
  }

  getMissingRangeDenialStreak(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): number {
    const from = Math.max(1, Math.floor(fromSeq));
    if (!this.stmtGetMissingRangeDenialStreak) {
      this.stmtGetMissingRangeDenialStreak = this.db.prepare(`
        SELECT denial_streak
        FROM rchat_missing_stream_ranges
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
          AND from_seq = ? AND to_seq = ?
        LIMIT 1
      `);
    }
    const row = this.stmtGetMissingRangeDenialStreak.get(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      from,
      Math.max(from, Math.floor(toSeq))
    ) as { denial_streak?: number | null } | undefined;
    return Math.max(0, Math.floor(Number(row?.denial_streak ?? 0) || 0));
  }

  /**
   * Newest unavailable observation (any peer) covering the range at or after
   * observedAfter, or null. GO uses it to date a row's last denial.
   */
  getMissingRangeLastUnavailableAt(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    observedAfter = 0
  ): number | null {
    const from = Math.max(1, Math.floor(fromSeq));
    if (!this.stmtGetMissingRangeLastUnavailableAt) {
      this.stmtGetMissingRangeLastUnavailableAt = this.db.prepare(`
        SELECT MAX(observed_at) AS last_observed_at
        FROM rchat_missing_range_peer_observations
        WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
          AND from_seq <= ? AND to_seq >= ? AND observed_at >= ?
      `);
    }
    const row = this.stmtGetMissingRangeLastUnavailableAt.get(
      groupId,
      String(authorAddress || '').trim(),
      normalizeReticulumChatAuthorStreamId(authorStreamId),
      from,
      Math.max(from, Math.floor(toSeq)),
      Math.max(0, Math.floor(observedAfter))
    ) as { last_observed_at?: number | null } | undefined;
    const at = Number(row?.last_observed_at);
    return Number.isFinite(at) && at > 0 ? at : null;
  }

  deferMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number,
    preferredPeer: string,
    nextAttemptAt: number,
    attempts = 1
  ): ReticulumChatMissingRangeState | null {
    this.ensureMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq,
      preferredPeer
    );
    const current = this.getMissingRange(
      groupId,
      authorAddress,
      authorStreamId,
      fromSeq,
      toSeq
    );
    if (!current) return null;
    const knownUnavailable = this.getMissingRangeKnownUnavailable(
      current.groupId,
      current.authorAddress,
      current.authorStreamId,
      current.fromSeq,
      current.toSeq
    );
    const peer = knownUnavailable
      ? current.preferredPeer
      : preferredPeer.trim().toLowerCase() || current.preferredPeer;
    const nextAttempts = Math.max(
      Math.max(0, Math.floor(current.attempts || 0)),
      Math.max(1, Math.floor(attempts || 1))
    );
    this.stmtUpdateMissingRangeBackoff.run({
      group_id: current.groupId,
      author_address: current.authorAddress,
      author_stream_id: current.authorStreamId,
      from_seq: current.fromSeq,
      to_seq: current.toSeq,
      preferred_peer: peer || null,
      attempts: nextAttempts,
      next_attempt_at: Math.max(
        Math.floor(nextAttemptAt),
        knownUnavailable?.recheckAt ?? 0,
        current.nextAttemptAt
      ),
    });
    this.missingRangeWrites += 1;
    const updated = {
      ...current,
      preferredPeer: peer,
      attempts: nextAttempts,
      nextAttemptAt: Math.max(
        Math.floor(nextAttemptAt),
        knownUnavailable?.recheckAt ?? 0,
        current.nextAttemptAt
      ),
    };
    this.memoryMissingRanges.set(
      this.missingRangeKey(
        current.groupId,
        current.authorAddress,
        current.authorStreamId,
        current.fromSeq,
        current.toSeq
      ),
      updated
    );
    return updated;
  }

  private missingRangeKey(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    fromSeq: number,
    toSeq: number
  ): string {
    return `${groupId}:${authorAddress}:${normalizeReticulumChatAuthorStreamId(authorStreamId)}:${fromSeq}:${toSeq}`;
  }

  private missingRangeRowToState(
    row: ReticulumChatMissingRangeRow
  ): ReticulumChatMissingRangeState {
    return {
      groupId: Number(row.group_id),
      authorAddress: String(row.author_address || ''),
      authorStreamId: normalizeReticulumChatAuthorStreamId(
        row.author_stream_id
      ),
      fromSeq: Math.max(1, Math.floor(Number(row.from_seq || 1))),
      toSeq: Math.max(1, Math.floor(Number(row.to_seq || row.from_seq || 1))),
      preferredPeer:
        typeof row.preferred_peer === 'string' ? row.preferred_peer : '',
      attempts: Math.max(0, Math.floor(Number(row.attempts || 0))),
      nextAttemptAt: Math.max(0, Math.floor(Number(row.next_attempt_at || 0))),
    };
  }

  private clearMissingRangesForEvent(event: ReticulumChatEvent): void {
    const rows = this.dedupeMissingRangeRows([
      ...(this.stmtGetMissingRangesForSeq.all(
        event.groupId,
        event.authorAddress,
        normalizeReticulumChatAuthorStreamId(event.authorStreamId),
        event.authorSeq,
        event.authorSeq
      ) as ReticulumChatMissingRangeRow[]),
      ...this.getMemoryMissingRangeRowsForSeq(
        event.groupId,
        event.authorAddress,
        normalizeReticulumChatAuthorStreamId(event.authorStreamId),
        event.authorSeq
      ),
    ]);
    if (rows.length === 0) return;
    // Durable markers are created only for persisted missing ranges. Avoid a
    // marker lookup/delete on the normal event-insert hot path, while still
    // ensuring a valid late event immediately overrides unavailable evidence.
    this.clearMissingRangeKnownUnavailable(
      event.groupId,
      event.authorAddress,
      event.authorStreamId,
      event.authorSeq,
      event.authorSeq
    );
    this.clearMissingRangePeerUnavailable(
      event.groupId,
      event.authorAddress,
      event.authorStreamId,
      event.authorSeq,
      event.authorSeq
    );
    this.rewriteMissingRanges(rows, (row) => new Set([event.authorSeq]));
  }

  private pruneSatisfiedMissingRanges(): void {
    const rows = this.dedupeMissingRangeRows([
      ...(this.stmtGetAllMissingRanges.all() as ReticulumChatMissingRangeRow[]),
      ...[...this.memoryMissingRanges.values()].map((range) =>
        this.missingRangeStateToRow(range)
      ),
    ]);
    if (rows.length === 0) return;
    this.rewriteMissingRanges(rows, (row) => {
      const presentRows = this.stmtGetPresentSeqsInRange.all(
        row.group_id,
        row.author_address,
        row.author_stream_id,
        row.from_seq,
        row.to_seq,
        row.group_id,
        row.author_address,
        row.author_stream_id,
        row.from_seq,
        row.to_seq
      ) as Array<{ author_seq?: number }>;
      return new Set(
        presentRows
          .map((present) => Number(present.author_seq))
          .filter((seq) => Number.isInteger(seq))
      );
    });
  }

  private pruneSatisfiedMissingRange(
    groupId: number,
    authorAddress: string,
    authorStreamId: string,
    fromSeq: number,
    toSeq: number
  ): void {
    const rows = this.dedupeMissingRangeRows([
      ...(this.stmtGetMissingRangeOverlaps.all({
        group_id: groupId,
        author_address: authorAddress,
        author_stream_id: authorStreamId,
        from_seq: fromSeq,
        to_seq: toSeq,
      }) as ReticulumChatMissingRangeRow[]),
      ...[...this.memoryMissingRanges.values()]
        .filter(
          (range) =>
            range.groupId === groupId &&
            range.authorAddress === authorAddress &&
            range.authorStreamId === authorStreamId &&
            range.fromSeq <= toSeq &&
            range.toSeq >= fromSeq
        )
        .map((range) => this.missingRangeStateToRow(range)),
    ]);
    if (rows.length === 0) return;
    this.rewriteMissingRanges(rows, (row) => {
      const presentRows = this.stmtGetPresentSeqsInRange.all(
        row.group_id,
        row.author_address,
        row.author_stream_id,
        row.from_seq,
        row.to_seq,
        row.group_id,
        row.author_address,
        row.author_stream_id,
        row.from_seq,
        row.to_seq
      ) as Array<{ author_seq?: number }>;
      return new Set(
        presentRows
          .map((present) => Number(present.author_seq))
          .filter((seq) => Number.isInteger(seq))
      );
    });
  }

  private rewriteMissingRanges(
    rows: ReticulumChatMissingRangeRow[],
    presentSeqsForRow: (row: ReticulumChatMissingRangeRow) => Set<number>
  ): void {
    const tx = this.db.transaction(
      (rangeRows: ReticulumChatMissingRangeRow[]) => {
        for (const row of rangeRows) {
          const groupId = Number(row.group_id);
          const authorAddress =
            typeof row.author_address === 'string' ? row.author_address : '';
          const authorStreamId = normalizeReticulumChatAuthorStreamId(
            row.author_stream_id
          );
          const fromSeq = Math.max(1, Math.floor(Number(row.from_seq)));
          const toSeq = Math.max(fromSeq, Math.floor(Number(row.to_seq)));
          if (!Number.isInteger(groupId) || groupId <= 0 || !authorAddress)
            continue;
          const presentSeqs = presentSeqsForRow(row);
          if (presentSeqs.size === 0) continue;
          this.clearMissingRangePeerUnavailable(
            groupId,
            authorAddress,
            authorStreamId,
            fromSeq,
            toSeq
          );
          this.clearMissingRangeKnownUnavailable(
            groupId,
            authorAddress,
            authorStreamId,
            fromSeq,
            toSeq
          );
          this.stmtDeleteMissingRange.run(
            groupId,
            authorAddress,
            authorStreamId,
            fromSeq,
            toSeq
          );
          this.missingRangeWrites += 1;
          this.memoryMissingRanges.delete(
            this.missingRangeKey(
              groupId,
              authorAddress,
              authorStreamId,
              fromSeq,
              toSeq
            )
          );
          let segmentStart = fromSeq;
          const sortedPresentSeqs = [...presentSeqs]
            .filter(
              (seq) => Number.isInteger(seq) && seq >= fromSeq && seq <= toSeq
            )
            .sort((a, b) => a - b);
          for (const seq of sortedPresentSeqs) {
            if (segmentStart <= seq - 1) {
              this.insertMissingRangeRaw(row, segmentStart, seq - 1);
            }
            segmentStart = seq + 1;
          }
          if (segmentStart <= toSeq) {
            this.insertMissingRangeRaw(row, segmentStart, toSeq);
          }
        }
      }
    );
    tx(rows);
  }

  private insertMissingRangeRaw(
    row: ReticulumChatMissingRangeRow,
    fromSeq: number,
    toSeq: number
  ): void {
    if (fromSeq > toSeq) return;
    const inserted = this.stmtInsertMissingRangeRaw.run({
      group_id: row.group_id,
      author_address: row.author_address,
      author_stream_id: normalizeReticulumChatAuthorStreamId(
        row.author_stream_id
      ),
      from_seq: fromSeq,
      to_seq: toSeq,
      preferred_peer: row.preferred_peer ?? null,
      attempts: Number.isInteger(row.attempts) ? row.attempts : 0,
      next_attempt_at: Number.isInteger(row.next_attempt_at)
        ? row.next_attempt_at
        : 0,
    });
    this.missingRangeWrites += 1;
    if (!(Number(inserted?.changes) > 0)) {
      // INSERT OR IGNORE hit an existing alias row (e.g. [5-7] already stored
      // when [5-10] splits there). SQL kept that row's own values; mirror
      // them instead of the split row's.
      const persisted = this.stmtGetMissingRangeExact.get(
        row.group_id,
        row.author_address,
        normalizeReticulumChatAuthorStreamId(row.author_stream_id),
        fromSeq,
        toSeq
      ) as ReticulumChatMissingRangeRow | undefined;
      if (persisted) {
        this.memoryMissingRanges.set(
          this.missingRangeKey(
            row.group_id,
            row.author_address,
            row.author_stream_id,
            fromSeq,
            toSeq
          ),
          this.missingRangeRowToState(persisted)
        );
        return;
      }
    }
    this.memoryMissingRanges.set(
      this.missingRangeKey(
        row.group_id,
        row.author_address,
        row.author_stream_id,
        fromSeq,
        toSeq
      ),
      {
        groupId: row.group_id,
        authorAddress: row.author_address,
        authorStreamId: normalizeReticulumChatAuthorStreamId(
          row.author_stream_id
        ),
        fromSeq,
        toSeq,
        preferredPeer: row.preferred_peer ?? '',
        attempts: Number.isInteger(row.attempts) ? row.attempts : 0,
        nextAttemptAt: Number.isInteger(row.next_attempt_at)
          ? row.next_attempt_at
          : 0,
      }
    );
  }

  private getMemoryMissingRangeRowsForSeq(
    groupId: number,
    authorAddress: string,
    authorStreamId: string,
    seq: number
  ): ReticulumChatMissingRangeRow[] {
    return [...this.memoryMissingRanges.values()]
      .filter(
        (range) =>
          range.groupId === groupId &&
          range.authorAddress === authorAddress &&
          range.authorStreamId ===
            normalizeReticulumChatAuthorStreamId(authorStreamId) &&
          range.fromSeq <= seq &&
          range.toSeq >= seq
      )
      .map((range) => this.missingRangeStateToRow(range));
  }

  private missingRangeStateToRow(
    range: ReticulumChatMissingRangeState
  ): ReticulumChatMissingRangeRow {
    return {
      group_id: range.groupId,
      author_address: range.authorAddress,
      author_stream_id: range.authorStreamId,
      from_seq: range.fromSeq,
      to_seq: range.toSeq,
      preferred_peer: range.preferredPeer || null,
      attempts: range.attempts,
      next_attempt_at: range.nextAttemptAt,
    };
  }

  private dedupeMissingRangeRows(
    rows: ReticulumChatMissingRangeRow[]
  ): ReticulumChatMissingRangeRow[] {
    const byKey = new Map<string, ReticulumChatMissingRangeRow>();
    for (const row of rows) {
      const groupId = Number(row.group_id);
      const author = String(row.author_address || '');
      const stream = normalizeReticulumChatAuthorStreamId(row.author_stream_id);
      const from = Math.max(1, Math.floor(Number(row.from_seq || 1)));
      const to = Math.max(
        from,
        Math.floor(Number(row.to_seq || row.from_seq || 1))
      );
      byKey.set(this.missingRangeKey(groupId, author, stream, from, to), row);
    }
    return [...byKey.values()];
  }

  getReadyMissingRanges(
    now = Date.now(),
    limit = 10
  ): ReticulumChatMissingRangeState[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.stmtGetReadyMissingRanges.all(
      Math.max(0, Math.floor(now)),
      safeLimit
    ) as ReticulumChatMissingRangeRow[];
    return this.dedupeMissingRangeRows([
      ...rows,
      ...[...this.memoryMissingRanges.values()]
        .filter((range) => range.nextAttemptAt <= now)
        .map((range) => this.missingRangeStateToRow(range)),
    ])
      .slice(0, safeLimit)
      .map((row) => this.missingRangeRowToState(row));
  }

  /** Modifying statements issued against rchat_missing_stream_ranges since open. */
  getMissingRangeWriteCount(): number {
    return this.missingRangeWrites;
  }

  /**
   * Runs fn in one transaction, or in a SAVEPOINT when one is already open
   * (better-sqlite3, the GO shim and the test adapters all nest). On GO's
   * OPFS rollback journal each autocommit write costs about 5 flushes; one
   * batch costs about 5 in total, and a batch that writes nothing costs none
   * (bench d: 500 read-only transactions added 0 flushes).
   */
  runWriteBatch<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Background scanner pick: per requested group, the oldest due row and the
   * oldest due row of one of ownAddresses, in one query. SQL is
   * authoritative whenever it has the row, as in getMissingRange and
   * claimMissingRangeAttempt, which do the actual try. A mirror copy that
   * drifted from its SQL row (an INSERT OR IGNORE alias collision, a
   * rolled-back batch) is reset to the SQL values here. A due mirror row the
   * query did not return is checked with one exact read before it can win:
   * when SQL has the row the mirror takes the SQL values and the row drops
   * out (whatever SQL has due is already in the query result); a mirror-only
   * row (the vitest mock, a rolled-back insert) stays a candidate. A group
   * whose check budget runs out before it has a pick is returned in
   * staleGroupIds so the scanner holds it for 5 s; the next run checks the
   * rest. scanned counts the distinct rows returned.
   */
  getBackgroundMissingRangeCandidates(
    now: number,
    groupIds: Iterable<number>,
    ownAddresses: Iterable<string>,
    oldBefore = 0
  ): {
    candidates: Map<number, ReticulumChatBackgroundMissingRangeCandidate>;
    staleGroupIds: number[];
    scanned: number;
  } {
    const groups = new Set(
      [...groupIds].filter((id) => Number.isInteger(id) && id > 0)
    );
    const candidates = new Map<
      number,
      ReticulumChatBackgroundMissingRangeCandidate
    >();
    if (groups.size === 0) return { candidates, staleGroupIds: [], scanned: 0 };
    const own = new Set(
      [...ownAddresses].map((a) => String(a || '').trim()).filter(Boolean)
    );
    const safeNow = Math.max(0, Math.floor(now));
    // GO (recentGapsFirst): oldBefore > 0 dates each row by its stored event
    // at to_seq + 1, and rows older than that go after every other due row of
    // their group, so a recent missing message does not wait behind hundreds
    // of old rows that peers can no longer serve. A row with no stored
    // neighbour counts as recent. 0 keeps the upstream statement and order.
    const safeOldBefore = Math.max(0, Math.floor(Number(oldBefore) || 0));
    const recentFirst = safeOldBefore > 0;
    const params = {
      now: safeNow,
      group_ids: JSON.stringify([...groups]),
      own_addresses: JSON.stringify([...own]),
    };
    const rows = (
      recentFirst
        ? this.backgroundMissingRangeCandidatesRecentFirst().all({
            ...params,
            old_before: safeOldBefore,
          })
        : this.stmtGetBackgroundMissingRangeCandidates.all(params)
    ) as Array<ReticulumChatMissingRangeRow & { aged?: number }>;
    const fromSql = new WeakSet<ReticulumChatMissingRangeState>();
    const agedSql = new WeakSet<ReticulumChatMissingRangeState>();
    // A mirror-only row has no date. It ranks with the old rows, so a mirror
    // copy of a row SQL holds can never jump ahead of SQL's recent pick and
    // cost an exact read each run (the mirror is not dated).
    const isAged = (range: ReticulumChatMissingRangeState): boolean =>
      recentFirst && (fromSql.has(range) ? agedSql.has(range) : true);
    const scanOrder = (
      a: ReticulumChatMissingRangeState,
      b: ReticulumChatMissingRangeState
    ): number => {
      if (recentFirst) {
        const aAged = isAged(a);
        if (aAged !== isAged(b)) return aAged ? 1 : -1;
      }
      return compareMissingRangeScanOrder(a, b);
    };
    const consider = (range: ReticulumChatMissingRangeState): void => {
      if (!groups.has(range.groupId) || range.nextAttemptAt > safeNow) return;
      const isOwn = own.has(range.authorAddress);
      const entry = candidates.get(range.groupId);
      if (!entry) {
        candidates.set(range.groupId, {
          oldest: range,
          ownOldest: isOwn ? range : null,
        });
        return;
      }
      if (scanOrder(range, entry.oldest) < 0) {
        entry.oldest = range;
      }
      if (
        isOwn &&
        (!entry.ownOldest || scanOrder(range, entry.ownOldest) < 0)
      ) {
        entry.ownOldest = range;
      }
    };
    const sqlKeys = new Set<string>();
    for (const row of rows) {
      const state = this.missingRangeRowToState(row);
      if (recentFirst) {
        fromSql.add(state);
        if (Number(row.aged) === 1) agedSql.add(state);
      }
      const key = this.missingRangeKey(
        state.groupId,
        state.authorAddress,
        state.authorStreamId,
        state.fromSeq,
        state.toSeq
      );
      // The plain and the own pick can be the same row.
      if (sqlKeys.has(key)) continue;
      sqlKeys.add(key);
      const mirrored = this.memoryMissingRanges.get(key);
      if (mirrored && !sameMissingRangeState(mirrored, state)) {
        this.memoryMissingRanges.set(key, { ...state });
      }
      consider(state);
    }
    // Due mirror rows the query did not return (under the vitest mock these
    // are all the rows), oldest first per group. Only a row that would win a
    // pick costs a read; while the mirror matches SQL none does.
    const mirrorOnly = new Map<
      number,
      Array<{ key: string; range: ReticulumChatMissingRangeState }>
    >();
    for (const [key, range] of this.memoryMissingRanges) {
      if (
        sqlKeys.has(key) ||
        !groups.has(range.groupId) ||
        range.nextAttemptAt > safeNow
      ) {
        continue;
      }
      const list = mirrorOnly.get(range.groupId);
      if (list) list.push({ key, range });
      else mirrorOnly.set(range.groupId, [{ key, range }]);
    }
    const held = new Set<number>();
    for (const [groupId, list] of mirrorOnly) {
      list.sort((a, b) => scanOrder(a.range, b.range));
      let checks = 0;
      for (const { key, range } of list) {
        const entry = candidates.get(groupId);
        const wins =
          !entry ||
          scanOrder(range, entry.oldest) < 0 ||
          (own.has(range.authorAddress) &&
            (!entry.ownOldest || scanOrder(range, entry.ownOldest) < 0));
        if (!wins) continue;
        if (checks >= RETICULUM_CHAT_MISSING_RANGE_MIRROR_PICK_CHECKS) {
          held.add(groupId);
          break;
        }
        checks += 1;
        const persisted = this.stmtGetMissingRangeExact.get(
          range.groupId,
          range.authorAddress,
          range.authorStreamId,
          range.fromSeq,
          range.toSeq
        ) as ReticulumChatMissingRangeRow | undefined;
        if (persisted) {
          this.memoryMissingRanges.set(
            key,
            this.missingRangeRowToState(persisted)
          );
          continue;
        }
        consider(range);
      }
    }
    let scanned = 0;
    for (const entry of candidates.values()) {
      scanned += entry.ownOldest && entry.ownOldest !== entry.oldest ? 2 : 1;
    }
    return {
      candidates,
      staleGroupIds: [...held].filter((g) => !candidates.has(g)),
      scanned,
    };
  }

  /**
   * stmtGetBackgroundMissingRangeCandidates with old rows last in both picks:
   * aged = 1 when the stored event at to_seq + 1 (the unique author-sequence
   * index) is older than @old_before. Measured ~0.4 ms per run at 1,162 rows.
   */
  private backgroundMissingRangeCandidatesRecentFirst(): Statement {
    if (!this.stmtGetBackgroundMissingRangeCandidatesRecentFirst) {
      this.stmtGetBackgroundMissingRangeCandidatesRecentFirst = this.db
        .prepare(`
        SELECT group_id, author_address, author_stream_id, from_seq, to_seq,
               preferred_peer, attempts, next_attempt_at, own_row, aged
        FROM (
          SELECT r.group_id, r.author_address, r.author_stream_id, r.from_seq,
                 r.to_seq, r.preferred_peer, r.attempts, r.next_attempt_at,
                 0 AS own_row,
                 CASE WHEN h.timestamp IS NOT NULL AND h.timestamp < @old_before
                      THEN 1 ELSE 0 END AS aged,
                 ROW_NUMBER() OVER (
                   PARTITION BY r.group_id
                   ORDER BY CASE WHEN h.timestamp IS NOT NULL
                                  AND h.timestamp < @old_before
                                 THEN 1 ELSE 0 END ASC,
                            r.next_attempt_at ASC, r.author_address ASC,
                            r.author_stream_id ASC, r.from_seq ASC, r.to_seq ASC
                 ) AS rn
          FROM rchat_missing_stream_ranges r
          LEFT JOIN rchat_event_headers h
            ON h.group_id = r.group_id AND h.author_address = r.author_address
           AND h.author_stream_id = r.author_stream_id
           AND h.author_seq = r.to_seq + 1
          WHERE r.next_attempt_at <= @now
            AND r.group_id IN (SELECT value FROM json_each(@group_ids))
          UNION ALL
          SELECT o.group_id, o.author_address, o.author_stream_id, o.from_seq,
                 o.to_seq, o.preferred_peer, o.attempts, o.next_attempt_at,
                 1 AS own_row,
                 CASE WHEN h2.timestamp IS NOT NULL AND h2.timestamp < @old_before
                      THEN 1 ELSE 0 END AS aged,
                 ROW_NUMBER() OVER (
                   PARTITION BY o.group_id
                   ORDER BY CASE WHEN h2.timestamp IS NOT NULL
                                  AND h2.timestamp < @old_before
                                 THEN 1 ELSE 0 END ASC,
                            o.next_attempt_at ASC, o.author_address ASC,
                            o.author_stream_id ASC, o.from_seq ASC, o.to_seq ASC
                 ) AS rn
          FROM rchat_missing_stream_ranges o
          LEFT JOIN rchat_event_headers h2
            ON h2.group_id = o.group_id AND h2.author_address = o.author_address
           AND h2.author_stream_id = o.author_stream_id
           AND h2.author_seq = o.to_seq + 1
          WHERE o.next_attempt_at <= @now
            AND o.group_id IN (SELECT value FROM json_each(@group_ids))
            AND o.author_address IN (SELECT value FROM json_each(@own_addresses))
        )
        WHERE rn = 1
      `);
    }
    return this.stmtGetBackgroundMissingRangeCandidatesRecentFirst;
  }

  /** Per group, the earliest next attempt of a row with a preferred peer. */
  getNextMissingRangeAttemptsByGroup(groupIds: number[]): Map<number, number> {
    const groups = new Set(
      groupIds.filter((id) => Number.isInteger(id) && id > 0)
    );
    const next = new Map<number, number>();
    if (groups.size === 0) return next;
    const rows = this.stmtGetNextMissingRangeAttemptsByGroup.all(
      JSON.stringify([...groups])
    ) as Array<{ group_id?: number; next_attempt_at?: number | null }>;
    for (const row of rows) {
      const groupId = Number(row.group_id);
      const candidate = Math.max(
        0,
        Math.floor(Number(row.next_attempt_at ?? Number.NaN))
      );
      if (groups.has(groupId) && Number.isFinite(candidate)) {
        next.set(groupId, candidate);
      }
    }
    // Keep the in-memory fallback represented without scanning persisted rows.
    for (const range of this.memoryMissingRanges.values()) {
      if (!groups.has(range.groupId) || !range.preferredPeer.trim()) continue;
      const candidate = Math.max(0, Math.floor(range.nextAttemptAt));
      if (!Number.isFinite(candidate)) continue;
      const current = next.get(range.groupId);
      if (current == null || candidate < current) {
        next.set(range.groupId, candidate);
      }
    }
    return next;
  }

  getNextMissingRangeAttemptAt(groupIds: number[]): number | null {
    // This scheduler query runs after every repair pass. Reading and
    // materialising the full missing-range table here can dominate the main
    // process when one overdue row repeatedly wakes the scheduler. Ask SQLite
    // only for the minimum value needed by the timer.
    const byGroup = this.getNextMissingRangeAttemptsByGroup(groupIds);
    return byGroup.size ? Math.min(...byGroup.values()) : null;
  }

  /**
   * Copy diagnostics only: missing-range rows by state in one aggregate
   * query, plus the five groups with the most rows. Read-only. Under the
   * vitest statement mock (no aggregate row) the counts come from the
   * in-memory mirror and olderThanServeAge is 0.
   */
  getMissingRangeStateCounts(options: {
    now: number;
    eligibleGroupIds: number[];
    backoffUntil: number;
    oldBefore: number;
  }): ReticulumChatMissingRangeStateCounts {
    const now = Math.max(0, Math.floor(Number(options.now) || 0));
    const backoffUntil = Math.floor(Number(options.backoffUntil) || 0);
    const oldBefore = Math.floor(Number(options.oldBefore) || 0);
    const eligible = new Set(
      (options.eligibleGroupIds ?? []).filter(
        (id) => Number.isInteger(id) && id > 0
      )
    );
    if (!this.stmtCountMissingRangeStates) {
      this.stmtCountMissingRangeStates = this.db.prepare(`
        WITH classified AS (
          SELECT r.from_seq AS from_seq,
                 r.to_seq AS to_seq,
                 r.preferred_peer AS preferred_peer,
                 r.next_attempt_at AS next_attempt_at,
                 CASE WHEN r.group_id IN (SELECT value FROM json_each(@eligible_group_ids)) THEN 1 ELSE 0 END AS eligible,
                 CASE WHEN ku.group_id IS NULL THEN 0 ELSE 1 END AS parked,
                 h.timestamp AS neighbour_ts
          FROM rchat_missing_stream_ranges r
          LEFT JOIN rchat_known_unavailable_ranges ku
            ON ku.group_id = r.group_id AND ku.author_address = r.author_address
           AND ku.author_stream_id = r.author_stream_id
           AND ku.from_seq = r.from_seq AND ku.to_seq = r.to_seq
          LEFT JOIN rchat_event_headers h
            ON h.group_id = r.group_id AND h.author_address = r.author_address
           AND h.author_stream_id = r.author_stream_id
           AND h.author_seq = r.to_seq + 1
        )
        SELECT COUNT(*) AS total_rows,
          COALESCE(SUM(CASE WHEN eligible = 0 THEN 1 ELSE 0 END), 0) AS not_eligible,
          COALESCE(SUM(CASE WHEN eligible = 1 AND parked = 1 THEN 1 ELSE 0 END), 0) AS parked,
          COALESCE(SUM(CASE WHEN eligible = 1 AND parked = 0 AND next_attempt_at <= @now THEN 1 ELSE 0 END), 0) AS due,
          COALESCE(SUM(CASE WHEN eligible = 1 AND parked = 0 AND next_attempt_at > @now AND next_attempt_at <= @backoff_until THEN 1 ELSE 0 END), 0) AS backoff,
          COALESCE(SUM(CASE WHEN eligible = 1 AND parked = 0 AND next_attempt_at > @backoff_until THEN 1 ELSE 0 END), 0) AS quarantined,
          COALESCE(SUM(CASE WHEN from_seq = 1 THEN 1 ELSE 0 END), 0) AS from_seq_one,
          COALESCE(SUM(CASE WHEN TRIM(COALESCE(preferred_peer, '')) = '' THEN 1 ELSE 0 END), 0) AS no_peer,
          COALESCE(SUM(CASE WHEN neighbour_ts IS NOT NULL AND neighbour_ts < @old_before THEN 1 ELSE 0 END), 0) AS older_than_serve_age,
          COALESCE(SUM(CASE WHEN neighbour_ts IS NOT NULL AND neighbour_ts < @old_before AND eligible = 1 AND parked = 0 AND next_attempt_at <= @now THEN 1 ELSE 0 END), 0) AS older_due,
          COALESCE(SUM(CASE WHEN neighbour_ts IS NOT NULL AND neighbour_ts < @old_before AND eligible = 1 AND parked = 1 THEN 1 ELSE 0 END), 0) AS older_parked,
          COALESCE(SUM(CASE WHEN neighbour_ts IS NULL THEN 1 ELSE 0 END), 0) AS no_neighbour,
          COALESCE(SUM(CASE WHEN neighbour_ts IS NOT NULL AND from_seq = to_seq AND from_seq > 1 THEN 1 ELSE 0 END), 0) AS single_seq_interior
        FROM classified
      `);
    }
    const row = this.stmtCountMissingRangeStates.get({
      now,
      eligible_group_ids: JSON.stringify([...eligible]),
      backoff_until: backoffUntil,
      old_before: oldBefore,
    }) as Record<string, unknown> | undefined;
    if (row) {
      if (!this.stmtCountMissingRangeTopGroups) {
        this.stmtCountMissingRangeTopGroups = this.db.prepare(`
          SELECT group_id, COUNT(*) AS row_count,
                 COALESCE(SUM(CASE WHEN next_attempt_at <= ? THEN 1 ELSE 0 END), 0) AS due_count
          FROM rchat_missing_stream_ranges GROUP BY group_id ORDER BY row_count DESC, group_id ASC LIMIT 5
        `);
      }
      const topRows = this.stmtCountMissingRangeTopGroups.all(now) as Array<{
        group_id?: unknown;
        row_count?: unknown;
        due_count?: unknown;
      }>;
      return {
        source: 'sql',
        total: Number(row.total_rows) || 0,
        notEligible: Number(row.not_eligible) || 0,
        parked: Number(row.parked) || 0,
        due: Number(row.due) || 0,
        backoff: Number(row.backoff) || 0,
        quarantined: Number(row.quarantined) || 0,
        fromSeqOne: Number(row.from_seq_one) || 0,
        noPeer: Number(row.no_peer) || 0,
        olderThanServeAge: Number(row.older_than_serve_age) || 0,
        olderThanServeAgeDue: Number(row.older_due) || 0,
        olderThanServeAgeParked: Number(row.older_parked) || 0,
        noStoredNeighbour: Number(row.no_neighbour) || 0,
        singleSeqInterior: Number(row.single_seq_interior) || 0,
        topGroups: topRows
          .map((top) => {
            const groupId = Number(top.group_id) || 0;
            return {
              groupId,
              rows: Number(top.row_count) || 0,
              due: Number(top.due_count) || 0,
              eligible: eligible.has(groupId),
            };
          })
          .slice(0, RETICULUM_CHAT_MISSING_RANGE_TOP_GROUPS),
      };
    }
    // An aggregate always returns a row, so this is the vitest mock: count
    // the in-memory mirror instead.
    const counts: ReticulumChatMissingRangeStateCounts = {
      source: 'memory',
      total: 0,
      notEligible: 0,
      parked: 0,
      due: 0,
      backoff: 0,
      quarantined: 0,
      fromSeqOne: 0,
      noPeer: 0,
      olderThanServeAge: 0,
      topGroups: [],
    };
    const byGroup = new Map<number, { rows: number; due: number }>();
    for (const range of this.memoryMissingRanges.values()) {
      counts.total += 1;
      const group = byGroup.get(range.groupId) ?? { rows: 0, due: 0 };
      group.rows += 1;
      if (range.nextAttemptAt <= now) group.due += 1;
      byGroup.set(range.groupId, group);
      if (range.fromSeq === 1) counts.fromSeqOne += 1;
      if (!String(range.preferredPeer || '').trim()) counts.noPeer += 1;
      if (!eligible.has(range.groupId)) {
        counts.notEligible += 1;
      } else if (
        this.getMissingRangeKnownUnavailable(
          range.groupId,
          range.authorAddress,
          range.authorStreamId,
          range.fromSeq,
          range.toSeq
        )
      ) {
        counts.parked += 1;
      } else if (range.nextAttemptAt <= now) {
        counts.due += 1;
      } else if (range.nextAttemptAt <= backoffUntil) {
        counts.backoff += 1;
      } else {
        counts.quarantined += 1;
      }
    }
    counts.topGroups = [...byGroup.entries()]
      .sort((a, b) => b[1].rows - a[1].rows || a[0] - b[0])
      .slice(0, RETICULUM_CHAT_MISSING_RANGE_TOP_GROUPS)
      .map(([groupId, group]) => ({
        groupId,
        rows: group.rows,
        due: group.due,
        eligible: eligible.has(groupId),
      }));
    return counts;
  }

  /**
   * Copy diagnostics: when the stored message at `seq` of an author stream
   * was written (its own timestamp), or null when none is stored. One read
   * on the unique (group, author, stream, seq) index; the session mirror is
   * checked when SQL has no row.
   */
  getAuthorSeqTimestamp(
    groupId: number,
    authorAddress: string,
    authorStreamId: string,
    seq: number
  ): number | null {
    if (!Number.isInteger(seq) || seq <= 0) return null;
    this.stmtGetAuthorSeqTimestamp ??= this.db.prepare(`
      SELECT timestamp FROM rchat_event_headers
      WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        AND author_seq = ?
      LIMIT 1
    `);
    const row = this.stmtGetAuthorSeqTimestamp.get(
      groupId,
      authorAddress,
      authorStreamId,
      seq
    ) as { timestamp?: unknown } | undefined;
    const at = Number(row?.timestamp);
    if (row && Number.isFinite(at)) return at;
    for (const event of this.memoryEvents.eventsInGroup(groupId)) {
      if (
        event.authorAddress === authorAddress &&
        normalizeReticulumChatAuthorStreamId(event.authorStreamId) ===
          authorStreamId &&
        event.authorSeq === seq
      ) {
        return event.timestamp;
      }
    }
    return null;
  }

  /**
   * Copy diagnostics: database file size from its page counts (cheap), and
   * the stored event and search row counts. The counts walk an index, so
   * they are read once per open, on the first call (not at boot, where they
   * would delay the engine start), and then reported with their time.
   */
  getStorageDiagnostics(now = Date.now()): {
    sizeBytes: number | null;
    freeBytes: number | null;
    events: number | null;
    searchRows: number | null;
    countedAt: number;
  } {
    const pragmaNumber = (name: string): number | null => {
      try {
        const value = Number(this.db.pragma(name, { simple: true }));
        return Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    };
    const pageSize = pragmaNumber('page_size');
    const pageCount = pragmaNumber('page_count');
    const freePages = pragmaNumber('freelist_count');
    const count = (sql: string): number | null => {
      try {
        const value = Number(
          (this.db.prepare(sql).get() as { n?: unknown } | undefined)?.n
        );
        return Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    };
    this.storageRowCounts ??= {
      events: count('SELECT COUNT(*) AS n FROM rchat_event_headers'),
      searchRows: count(
        'SELECT COUNT(*) AS n FROM reticulum_chat_search_index'
      ),
      countedAt: now,
    };
    return {
      sizeBytes:
        pageSize != null && pageCount != null ? pageSize * pageCount : null,
      freeBytes:
        pageSize != null && freePages != null ? pageSize * freePages : null,
      ...this.storageRowCounts,
    };
  }

  getAuthorMaxSeq(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined
  ): number {
    const stream = normalizeReticulumChatAuthorStreamId(authorStreamId);
    const row = this.stmtGetAuthorMaxSeq.get(
      groupId,
      authorAddress,
      stream,
      groupId,
      authorAddress,
      stream
    ) as { seq?: number } | undefined;
    let maxSeq =
      typeof row?.seq === 'number' && Number.isFinite(row.seq) ? row.seq : 0;
    const markerRow = this.db
      .prepare(
        `
          SELECT MAX(author_seq) AS seq
          FROM rchat_expired_event_markers
          WHERE group_id = ? AND author_address = ? AND author_stream_id = ?
        `
      )
      .get(groupId, authorAddress, stream) as { seq?: number } | undefined;
    if (typeof markerRow?.seq === 'number' && Number.isFinite(markerRow.seq)) {
      maxSeq = Math.max(maxSeq, markerRow.seq);
    }
    for (const event of this.memoryEvents.values()) {
      if (
        event.groupId !== groupId ||
        event.authorAddress !== authorAddress ||
        normalizeReticulumChatAuthorStreamId(event.authorStreamId) !== stream
      )
        continue;
      maxSeq = Math.max(maxSeq, event.authorSeq);
    }
    return maxSeq;
  }

  getAuthorEventsAfter(
    groupId: number,
    authorAddress: string,
    authorStreamId: string | undefined,
    afterSeq: number,
    limit: number
  ): ReticulumChatEvent[] {
    const maxLimit = Math.max(1, limit);
    return this.mergeWindowEvents(
      (
        this.stmtGetAuthorEventsAfter.all(
          groupId,
          authorAddress,
          normalizeReticulumChatAuthorStreamId(authorStreamId),
          Math.max(0, afterSeq),
          maxLimit
        ) as EventRow[]
      ).map(rowToEvent),
      [...this.memoryEvents.values()]
        .filter(
          (event) =>
            event.groupId === groupId &&
            event.authorAddress === authorAddress &&
            normalizeReticulumChatAuthorStreamId(event.authorStreamId) ===
              normalizeReticulumChatAuthorStreamId(authorStreamId) &&
            event.authorSeq > afterSeq
        )
        .sort((a, b) => a.authorSeq - b.authorSeq || a.timestamp - b.timestamp)
        .slice(0, maxLimit),
      maxLimit
    ).sort((a, b) => a.authorSeq - b.authorSeq || a.timestamp - b.timestamp);
  }

  getAuthorHeads(
    groupId: number,
    limit: number,
    offset = 0
  ): ReticulumChatAuthorHead[] {
    const maxLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, Math.floor(offset));
    const heads = new Map<string, ReticulumChatAuthorHead>();
    const rows = this.stmtGetAuthorHeads.all(
      groupId,
      groupId,
      maxLimit + safeOffset,
      0
    ) as Array<{
      author_address: string;
      author_stream_id: string;
      max_seq: number;
      event_id: string;
      timestamp: number;
    }>;
    for (const row of rows) {
      const key = `${row.author_address}:${normalizeReticulumChatAuthorStreamId(row.author_stream_id)}`;
      heads.set(key, {
        authorAddress: row.author_address,
        authorStreamId: normalizeReticulumChatAuthorStreamId(
          row.author_stream_id
        ),
        maxSeq: row.max_seq,
        eventId: row.event_id,
        timestamp: row.timestamp,
      });
    }
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      const authorStreamId = normalizeReticulumChatAuthorStreamId(
        event.authorStreamId
      );
      const key = `${event.authorAddress}:${authorStreamId}`;
      const existing = heads.get(key);
      if (existing && existing.maxSeq >= event.authorSeq) continue;
      heads.set(key, {
        authorAddress: event.authorAddress,
        authorStreamId,
        maxSeq: event.authorSeq,
        eventId: event.eventId,
        timestamp: event.timestamp,
      });
    }
    return [...heads.values()]
      .sort(
        (a, b) =>
          b.timestamp - a.timestamp || b.eventId.localeCompare(a.eventId)
      )
      .slice(safeOffset)
      .slice(0, maxLimit);
  }

  getAllAuthorSequenceHeads(
    groupId: number
  ): ReticulumChatAuthorSequenceHead[] {
    const heads = new Map<string, ReticulumChatAuthorSequenceHead>();
    const rows = this.stmtGetAllAuthorSequenceHeads.all(
      groupId,
      groupId
    ) as Array<{
      author_address: string;
      author_stream_id: string;
      max_seq: number;
    }>;
    for (const row of rows) {
      const authorStreamId = normalizeReticulumChatAuthorStreamId(
        row.author_stream_id
      );
      if (
        !row.author_address ||
        !authorStreamId ||
        !Number.isInteger(row.max_seq)
      )
        continue;
      const key = `${row.author_address}:${authorStreamId}`;
      heads.set(key, {
        authorAddress: row.author_address,
        authorStreamId,
        maxSeq: row.max_seq,
      });
    }
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      const authorStreamId = normalizeReticulumChatAuthorStreamId(
        event.authorStreamId
      );
      if (!event.authorAddress || !authorStreamId) continue;
      const key = `${event.authorAddress}:${authorStreamId}`;
      const existing = heads.get(key);
      if (existing && existing.maxSeq >= event.authorSeq) continue;
      heads.set(key, {
        authorAddress: event.authorAddress,
        authorStreamId,
        maxSeq: event.authorSeq,
      });
    }
    return [...heads.values()].sort(
      (a, b) =>
        a.authorAddress.localeCompare(b.authorAddress) ||
        a.authorStreamId.localeCompare(b.authorStreamId)
    );
  }

  getAuthorSequenceGaps(
    groupId: number,
    limit: number
  ): ReticulumChatAuthorSequenceGap[] {
    if (!Number.isInteger(groupId) || groupId <= 0) return [];
    const maxLimit = Math.max(1, Math.floor(limit));
    const gaps = new Map<string, ReticulumChatAuthorSequenceGap>();

    for (const row of this.stmtGetAuthorSequenceGaps.all(
      groupId,
      groupId,
      maxLimit
    ) as Array<{
      author_address?: string;
      author_stream_id?: string;
      from_seq?: number;
      to_seq?: number;
    }>) {
      const authorAddress =
        typeof row.author_address === 'string' ? row.author_address : '';
      const authorStreamId = normalizeReticulumChatAuthorStreamId(
        row.author_stream_id
      );
      const fromSeq = Number(row.from_seq);
      const toSeq = Number(row.to_seq);
      if (
        !authorAddress ||
        !Number.isInteger(fromSeq) ||
        !Number.isInteger(toSeq) ||
        toSeq < fromSeq
      ) {
        continue;
      }
      gaps.set(`${authorAddress}:${authorStreamId}:${fromSeq}:${toSeq}`, {
        authorAddress,
        authorStreamId,
        fromSeq,
        toSeq,
      });
    }

    const memorySeqsByAuthor = new Map<string, number[]>();
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      const key = `${event.authorAddress}:${normalizeReticulumChatAuthorStreamId(event.authorStreamId)}`;
      const seqs = memorySeqsByAuthor.get(key) ?? [];
      seqs.push(event.authorSeq);
      memorySeqsByAuthor.set(key, seqs);
    }
    for (const [authorKey, seqs] of memorySeqsByAuthor) {
      const separator = authorKey.lastIndexOf(':');
      const authorAddress = authorKey.slice(0, separator);
      const authorStreamId = authorKey.slice(separator + 1);
      seqs.sort((a, b) => a - b);
      for (let index = 1; index < seqs.length; index += 1) {
        const previousSeq = seqs[index - 1];
        const currentSeq = seqs[index];
        if (currentSeq <= previousSeq + 1) continue;
        const fromSeq = previousSeq + 1;
        const toSeq = currentSeq - 1;
        gaps.set(`${authorAddress}:${authorStreamId}:${fromSeq}:${toSeq}`, {
          authorAddress,
          authorStreamId,
          fromSeq,
          toSeq,
        });
        if (gaps.size >= maxLimit) break;
      }
      if (gaps.size >= maxLimit) break;
    }

    return [...gaps.values()]
      .sort(
        (a, b) =>
          b.toSeq - a.toSeq ||
          a.authorAddress.localeCompare(b.authorAddress) ||
          a.authorStreamId.localeCompare(b.authorStreamId) ||
          b.fromSeq - a.fromSeq
      )
      .slice(0, maxLimit);
  }

  private mergeWindowEvents(
    primary: ReticulumChatEvent[],
    secondary: ReticulumChatEvent[],
    limit: number
  ): ReticulumChatEvent[] {
    const seen = new Set<string>();
    return [...primary, ...secondary]
      .filter((event) => {
        if (seen.has(event.eventId)) return false;
        seen.add(event.eventId);
        return true;
      })
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
      )
      .slice(0, limit);
  }

  private compareFeedCursors(
    a: ReticulumChatFeedCursor,
    b: ReticulumChatFeedCursor
  ): number {
    return (
      a.feedTimestamp - b.feedTimestamp || a.eventId.localeCompare(b.eventId)
    );
  }

  private normalizeFeedTimestamp(
    timestamp: number,
    acceptedAt = Date.now()
  ): number {
    return Number.isFinite(timestamp) && timestamp >= 0
      ? Math.floor(timestamp)
      : Math.floor(acceptedAt);
  }

  getSyncState(groupId: number): Record<string, number> {
    const rows = this.stmtGetGroupSeqs.all(groupId, groupId) as Array<{
      author_address: string;
      author_stream_id?: string;
      seq: number;
    }>;
    const out: Record<string, number> = {};
    for (const row of rows) {
      const stream = normalizeReticulumChatAuthorStreamId(row.author_stream_id);
      if (!stream) continue;
      const key = `${row.author_address}:${stream}`;
      out[key] = row.seq;
    }
    const markerRows = this.db
      .prepare(
        `
          SELECT author_address, author_stream_id, MAX(author_seq) AS seq
          FROM rchat_expired_event_markers
          WHERE group_id = ?
          GROUP BY author_address, author_stream_id
        `
      )
      .all(groupId) as Array<{
      author_address?: string;
      author_stream_id?: string;
      seq?: number;
    }>;
    for (const row of markerRows) {
      if (typeof row.author_address !== 'string') continue;
      const seq = Number(row.seq);
      if (!Number.isFinite(seq)) continue;
      const stream = normalizeReticulumChatAuthorStreamId(row.author_stream_id);
      if (!stream) continue;
      const key = `${row.author_address}:${stream}`;
      out[key] = Math.max(out[key] ?? 0, seq);
    }
    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      const stream = normalizeReticulumChatAuthorStreamId(event.authorStreamId);
      if (!stream) continue;
      const key = `${event.authorAddress}:${stream}`;
      out[key] = Math.max(out[key] ?? 0, event.authorSeq);
    }
    return out;
  }

  getChannels(
    groupId: number,
    includeArchived = false
  ): ReticulumGroupChannel[] {
    const rows = this.stmtGetChannels.all(groupId) as Array<{
      group_id: number;
      channel_id: string;
      category_id: string | null;
      name: string;
      description: string | null;
      position: number;
      archived: number;
      write_mode?: string | null;
      read_mode?: string | null;
      write_mode_updated_at?: number | null;
      expiry_duration_ms?: number | null;
      created_by: string;
      created_at: number;
      updated_at: number;
    }>;
    const channels = rows.map((row) => ({
      groupId: row.group_id,
      channelId: normalizeReticulumChatChannelId(row.channel_id),
      ...(normalizeReticulumChatCategoryId(row.category_id)
        ? { categoryId: normalizeReticulumChatCategoryId(row.category_id) }
        : {}),
      name: normalizeReticulumChatDisplayName(row.name, row.channel_id),
      ...(row.description ? { description: row.description } : {}),
      position: row.position,
      archived: row.archived === 1,
      writeMode: normalizeReticulumChannelWriteMode(row.write_mode),
      readMode: normalizeReticulumChannelReadMode(row.read_mode),
      writeModeUpdatedAt: Number.isFinite(row.write_mode_updated_at ?? NaN)
        ? Number(row.write_mode_updated_at)
        : 0,
      ...(normalizeReticulumChatExpiryDurationMs(row.expiry_duration_ms)
        ? {
            expiryDurationMs: normalizeReticulumChatExpiryDurationMs(
              row.expiry_duration_ms
            ),
          }
        : {}),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    for (let index = 0; index < channels.length; index += 1) {
      channels[index] = applyReticulumBuiltInChannelPolicy(channels[index]);
    }
    for (const channel of this.memoryChannels.values()) {
      if (channel.groupId !== groupId) continue;
      const existingIndex = channels.findIndex(
        (item) => item.channelId === channel.channelId
      );
      if (existingIndex >= 0) {
        channels[existingIndex] = applyReticulumBuiltInChannelPolicy(channel);
      } else {
        channels.push(applyReticulumBuiltInChannelPolicy(channel));
      }
    }
    if (
      !channels.some(
        (channel) => channel.channelId === RETICULUM_CHAT_DEFAULT_CHANNEL_ID
      )
    ) {
      channels.unshift(this.defaultChannel(groupId));
    }
    if (
      !channels.some(
        (channel) => channel.channelId === RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID
      )
    ) {
      channels.push(this.defaultQortalLandChannel(groupId));
    }
    return channels
      .filter((channel) => includeArchived || !channel.archived)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  readConsistent<T>(read: () => T): T {
    // A deferred SQLite read transaction pins every SELECT in the callback to
    // the same WAL snapshot. This matters when another Hub instance shares
    // this database and commits channel metadata between related reads.
    return this.db.transaction(read)();
  }

  getChannel(groupId: number, channelId: string): ReticulumGroupChannel | null {
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    if (normalizedChannelId === RETICULUM_CHAT_DEFAULT_CHANNEL_ID) {
      const row = this.stmtGetChannel.get(groupId, normalizedChannelId) as any;
      if (!row) return this.defaultChannel(groupId);
    }
    if (normalizedChannelId === RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID) {
      const row = this.stmtGetChannel.get(groupId, normalizedChannelId) as any;
      if (!row) return this.defaultQortalLandChannel(groupId);
    }
    return (
      this.getChannels(groupId, true).find(
        (channel) => channel.channelId === normalizedChannelId
      ) ?? null
    );
  }

  getBuiltInChannelBase(
    groupId: number,
    channelId: string
  ): ReticulumGroupChannel | null {
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    if (normalizedChannelId === RETICULUM_CHAT_DEFAULT_CHANNEL_ID) {
      return this.defaultChannel(groupId);
    }
    if (normalizedChannelId === RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID) {
      return this.defaultQortalLandChannel(groupId);
    }
    return null;
  }

  upsertChannel(channel: ReticulumGroupChannelInput): boolean {
    const normalizedChannelId = normalizeReticulumChatChannelId(
      channel.channelId
    );
    const expiryDurationMs = normalizeReticulumChatChannelExpiryDurationMs(
      normalizedChannelId,
      channel.expiryDurationMs
    );
    const existing = this.getChannel(channel.groupId, normalizedChannelId);
    const existingExpiryDurationMs = normalizeReticulumChatExpiryDurationMs(
      existing?.expiryDurationMs
    );
    const normalizedChannelCandidate: ReticulumGroupChannel = {
      ...channel,
      channelId: normalizedChannelId,
      categoryId:
        normalizeReticulumChatCategoryId(channel.categoryId) || undefined,
      name: normalizeReticulumChatDisplayName(channel.name, channel.channelId),
      position: Math.max(0, Math.floor(channel.position)),
      archived: channel.archived === true,
      writeMode: normalizeReticulumChannelWriteMode(channel.writeMode),
      readMode: normalizeReticulumChannelReadMode(channel.readMode),
      writeModeUpdatedAt: Number.isFinite(Number(channel.writeModeUpdatedAt))
        ? Math.max(0, Math.floor(Number(channel.writeModeUpdatedAt)))
        : Math.max(0, Math.floor(Number(channel.updatedAt))),
      expiryDurationMs,
      description: channel.description?.trim() || undefined,
    };
    const normalizedChannel = applyReticulumBuiltInChannelPolicy(
      normalizedChannelCandidate
    );
    const expiryPolicyChanged =
      existing === null || existingExpiryDurationMs !== expiryDurationMs;
    const tx = this.db.transaction(() => {
      const result = this.stmtUpsertChannel.run(
        normalizedChannel.groupId,
        normalizedChannel.channelId,
        normalizedChannel.categoryId ?? null,
        normalizedChannel.name,
        normalizedChannel.description ?? null,
        normalizedChannel.position,
        normalizedChannel.archived ? 1 : 0,
        normalizedChannel.writeMode,
        normalizedChannel.readMode,
        normalizedChannel.writeModeUpdatedAt,
        normalizedChannel.expiryDurationMs ?? null,
        normalizedChannel.createdBy,
        normalizedChannel.createdAt,
        normalizedChannel.updatedAt
      );
      if (expiryPolicyChanged) {
        this.db
          .prepare(
            `
              INSERT INTO rchat_channel_expiry_reconciliation
                (group_id, channel_id, revision, expiry_duration_ms,
                 after_timestamp, after_event_id, updated_at)
              VALUES (?, ?, 1, ?, -1, '', ?)
              ON CONFLICT(group_id, channel_id) DO UPDATE SET
                revision = rchat_channel_expiry_reconciliation.revision + 1,
                expiry_duration_ms = excluded.expiry_duration_ms,
                after_timestamp = -1,
                after_event_id = '',
                updated_at = excluded.updated_at
            `
          )
          .run(
            normalizedChannel.groupId,
            normalizedChannel.channelId,
            normalizedChannel.expiryDurationMs ?? null,
            Date.now()
          );
      }
      return result;
    });
    const result = tx();
    this.memoryChannels.set(
      `${normalizedChannel.groupId}:${normalizedChannel.channelId}`,
      normalizedChannel
    );
    return result.changes > 0;
  }

  private defaultChannel(groupId: number): ReticulumGroupChannel {
    return {
      groupId,
      channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      name: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      position: 0,
      archived: false,
      writeMode: RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS,
      readMode: RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS,
      writeModeUpdatedAt: 0,
      expiryDurationMs: RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS,
      createdBy: '',
      createdAt: 0,
      updatedAt: 0,
    };
  }

  private defaultQortalLandChannel(groupId: number): ReticulumGroupChannel {
    return {
      groupId,
      channelId: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
      name: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
      position: 1,
      archived: false,
      writeMode: RETICULUM_CHAT_CHANNEL_WRITE_MODE_MEMBERS,
      readMode: RETICULUM_CHAT_CHANNEL_READ_MODE_MEMBERS,
      writeModeUpdatedAt: 0,
      expiryDurationMs: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      createdBy: '',
      createdAt: 0,
      updatedAt: 0,
    };
  }

  getCategories(groupId: number): ReticulumGroupCategory[] {
    const rows = this.stmtGetCategories.all(groupId) as Array<{
      group_id: number;
      category_id: string;
      name: string;
      position: number;
      created_by: string;
      created_at: number;
      updated_at: number;
    }>;
    const categories = rows
      .map((row) => ({
        groupId: row.group_id,
        categoryId: normalizeReticulumChatCategoryId(row.category_id),
        name: normalizeReticulumChatDisplayName(row.name, row.category_id),
        position: Math.max(0, Math.floor(row.position)),
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
      .filter((category) => !!category.categoryId);
    for (const category of this.memoryCategories.values()) {
      if (category.groupId !== groupId) continue;
      const existingIndex = categories.findIndex(
        (item) => item.categoryId === category.categoryId
      );
      if (existingIndex >= 0) {
        categories[existingIndex] = category;
      } else {
        categories.push(category);
      }
    }
    return categories.sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name)
    );
  }

  getCategory(
    groupId: number,
    categoryId: string
  ): ReticulumGroupCategory | null {
    const normalizedCategoryId = normalizeReticulumChatCategoryId(categoryId);
    if (!normalizedCategoryId) return null;
    const row = this.stmtGetCategory.get(groupId, normalizedCategoryId) as
      | {
          group_id: number;
          category_id: string;
          name: string;
          position: number;
          created_by: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    const memory = this.memoryCategories.get(
      `${groupId}:${normalizedCategoryId}`
    );
    if (memory) return memory;
    if (!row) return null;
    return {
      groupId: row.group_id,
      categoryId: normalizeReticulumChatCategoryId(row.category_id),
      name: normalizeReticulumChatDisplayName(row.name, row.category_id),
      position: Math.max(0, Math.floor(row.position)),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  upsertCategory(category: ReticulumGroupCategory): boolean {
    const normalizedCategory: ReticulumGroupCategory = {
      ...category,
      categoryId: normalizeReticulumChatCategoryId(category.categoryId),
      name: normalizeReticulumChatDisplayName(
        category.name,
        category.categoryId
      ),
      position: Math.max(0, Math.floor(category.position)),
    };
    if (!normalizedCategory.categoryId) return false;
    this.memoryCategories.set(
      `${normalizedCategory.groupId}:${normalizedCategory.categoryId}`,
      normalizedCategory
    );
    const result = this.stmtUpsertCategory.run(
      normalizedCategory.groupId,
      normalizedCategory.categoryId,
      normalizedCategory.name,
      normalizedCategory.position,
      normalizedCategory.createdBy,
      normalizedCategory.createdAt,
      normalizedCategory.updatedAt
    );
    return result.changes > 0;
  }

  upsertMetadataSnapshot(
    snapshot: ReticulumChatMetadataSnapshotRecord
  ): boolean {
    if (!Number.isInteger(snapshot.groupId) || snapshot.groupId <= 0)
      return false;
    if (!snapshot.snapshotId || !snapshot.snapshotHash) return false;
    const result = this.stmtUpsertMetadataSnapshot.run({
      group_id: snapshot.groupId,
      snapshot_id: snapshot.snapshotId,
      scope: snapshot.scope,
      parent_snapshot_hash: snapshot.parentSnapshotHash,
      version: Math.max(1, Math.floor(snapshot.version)),
      created_at: Math.max(0, Math.floor(snapshot.createdAt)),
      latest_event_id: snapshot.latestEventId || '',
      latest_feed_timestamp: Math.max(
        0,
        Math.floor(snapshot.latestFeedTimestamp || 0)
      ),
      snapshot_hash: snapshot.snapshotHash,
      admin_address: snapshot.adminAddress,
      admin_public_key: snapshot.adminPublicKey,
      signature: snapshot.signature,
      channels_json: JSON.stringify(snapshot.channels),
      categories_json: JSON.stringify(snapshot.categories),
      revisions_json: JSON.stringify(snapshot.revisions),
    });
    return (
      result.changes > 0 ||
      !!this.getMetadataSnapshotByHash(snapshot.groupId, snapshot.snapshotHash)
    );
  }

  applyMetadataSnapshot(
    snapshot: ReticulumChatMetadataSnapshotRecord
  ): boolean {
    const previousChannels = new Map(
      [...this.memoryChannels.entries()].filter(([key]) =>
        key.startsWith(`${snapshot.groupId}:`)
      )
    );
    const previousCategories = new Map(
      [...this.memoryCategories.entries()].filter(([key]) =>
        key.startsWith(`${snapshot.groupId}:`)
      )
    );
    const tx = this.db.transaction(() => {
      if (
        !this.upsertMetadataSnapshot(snapshot) &&
        !this.getMetadataSnapshotByHash(snapshot.groupId, snapshot.snapshotHash)
      ) {
        return false;
      }
      return this.applyMetadataSnapshotProjection(snapshot);
    });
    try {
      return tx();
    } catch (error) {
      for (const key of [...this.memoryChannels.keys()]) {
        if (key.startsWith(`${snapshot.groupId}:`))
          this.memoryChannels.delete(key);
      }
      for (const [key, channel] of previousChannels)
        this.memoryChannels.set(key, channel);
      for (const key of [...this.memoryCategories.keys()]) {
        if (key.startsWith(`${snapshot.groupId}:`))
          this.memoryCategories.delete(key);
      }
      for (const [key, category] of previousCategories)
        this.memoryCategories.set(key, category);
      throw error;
    }
  }

  applyStoredMetadataSnapshotProjection(
    snapshot: ReticulumChatMetadataSnapshotRecord
  ): boolean {
    const previousChannels = new Map(
      [...this.memoryChannels.entries()].filter(([key]) =>
        key.startsWith(`${snapshot.groupId}:`)
      )
    );
    const previousCategories = new Map(
      [...this.memoryCategories.entries()].filter(([key]) =>
        key.startsWith(`${snapshot.groupId}:`)
      )
    );
    const tx = this.db.transaction(() =>
      this.applyMetadataSnapshotProjection(snapshot)
    );
    try {
      return tx();
    } catch (error) {
      for (const key of [...this.memoryChannels.keys()]) {
        if (key.startsWith(`${snapshot.groupId}:`))
          this.memoryChannels.delete(key);
      }
      for (const [key, channel] of previousChannels)
        this.memoryChannels.set(key, channel);
      for (const key of [...this.memoryCategories.keys()]) {
        if (key.startsWith(`${snapshot.groupId}:`))
          this.memoryCategories.delete(key);
      }
      for (const [key, category] of previousCategories)
        this.memoryCategories.set(key, category);
      throw error;
    }
  }

  private applyMetadataSnapshotProjection(
    snapshot: ReticulumChatMetadataSnapshotRecord
  ): boolean {
    const channels = new Map(
      snapshot.channels.map((channel) => {
        const normalizedChannel = applyReticulumBuiltInChannelPolicy(channel);
        return [
          normalizeReticulumChatChannelId(normalizedChannel.channelId),
          normalizedChannel,
        ];
      })
    );
    const categories = new Map(
      snapshot.categories.map((category) => [
        normalizeReticulumChatCategoryId(category.categoryId),
        category,
      ])
    );
    for (const revision of snapshot.revisions) {
      const revisionChannel =
        revision.entityType === 'channel' && !revision.deleted
          ? channels.get(normalizeReticulumChatChannelId(revision.entityId))
          : undefined;
      const projectedRevision =
        revisionChannel &&
        isReticulumChatBuiltInChannelId(revisionChannel.channelId)
          ? {
              ...revision,
              stateHash: hashReticulumChatMetadataEntityState(
                'channel',
                revisionChannel.channelId,
                revisionChannel
              ),
            }
          : revision;
      const currentRecord = this.getMetadataEntityRevisionRecord(
        snapshot.groupId,
        projectedRevision.entityType,
        projectedRevision.entityId
      );
      const current = currentRecord?.revision ?? null;
      const headComparison = current
        ? compareMetadataEntityRevisionHeads(projectedRevision, current)
        : 1;
      const comparison = current
        ? compareMetadataEntityRevisions(projectedRevision, current)
        : 1;
      if (
        headComparison < 0 ||
        (headComparison === 0 &&
          currentRecord?.source === 'snapshot' &&
          comparison < 0)
      )
        continue;
      if (projectedRevision.entityType === 'channel') {
        const channelId = normalizeReticulumChatChannelId(
          projectedRevision.entityId
        );
        const channel = channels.get(channelId);
        const projected = this.getChannel(snapshot.groupId, channelId);
        const projectedHash = hashReticulumChatMetadataEntityState(
          'channel',
          channelId,
          projected
        );
        if (
          comparison === 0 &&
          currentRecord?.source === 'snapshot' &&
          projectedHash === projectedRevision.stateHash
        )
          continue;
        if (projectedRevision.deleted) {
          if (
            channelId !== RETICULUM_CHAT_DEFAULT_CHANNEL_ID &&
            channelId !== RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID
          ) {
            this.memoryChannels.delete(`${snapshot.groupId}:${channelId}`);
            this.stmtDeleteChannel.run(snapshot.groupId, channelId);
          }
        } else if (channel) {
          this.upsertChannel(channel);
        } else {
          continue;
        }
      } else {
        const categoryId = normalizeReticulumChatCategoryId(
          projectedRevision.entityId
        );
        const category = categories.get(categoryId);
        const projected = this.getCategory(snapshot.groupId, categoryId);
        const projectedHash = hashReticulumChatMetadataEntityState(
          'category',
          categoryId,
          projected
        );
        if (
          comparison === 0 &&
          currentRecord?.source === 'snapshot' &&
          projectedHash === projectedRevision.stateHash
        )
          continue;
        if (projectedRevision.deleted) {
          this.deleteCategory(snapshot.groupId, categoryId, {
            clearChannelAssignments: false,
          });
        } else if (category) {
          this.upsertCategory(category);
        } else {
          continue;
        }
      }
      this.upsertMetadataEntityRevision(snapshot.groupId, projectedRevision, {
        replaceSameEvent: headComparison === 0,
        source: 'snapshot',
      });
    }
    this.clearDeletedCategoryAssignments(snapshot.groupId);
    return true;
  }

  private clearDeletedCategoryAssignments(groupId: number): void {
    const deletedCategoryIds = new Set(
      this.getMetadataEntityRevisions(groupId)
        .filter(
          (revision) => revision.entityType === 'category' && revision.deleted
        )
        .map((revision) => revision.entityId)
    );
    if (deletedCategoryIds.size === 0) return;
    for (const channel of this.getChannels(groupId, true)) {
      if (!channel.categoryId || !deletedCategoryIds.has(channel.categoryId))
        continue;
      const nextChannel = {
        ...channel,
        categoryId: undefined,
      };
      this.upsertChannel(nextChannel);
      const revision = this.getMetadataEntityRevision(
        groupId,
        'channel',
        channel.channelId
      );
      if (!revision) continue;
      this.upsertMetadataEntityRevision(
        groupId,
        {
          ...revision,
          stateHash: hashReticulumChatMetadataEntityState(
            'channel',
            channel.channelId,
            nextChannel
          ),
        },
        {
          replaceSameEvent: true,
          source: 'event',
        }
      );
    }
  }

  getMetadataEntityRevisionRecord(
    groupId: number,
    entityType: 'channel' | 'category',
    entityId: string
  ): ReticulumChatMetadataEntityRevisionRecord | null {
    const normalizedId =
      entityType === 'channel'
        ? normalizeReticulumChatChannelId(entityId)
        : normalizeReticulumChatCategoryId(entityId);
    if (!normalizedId) return null;
    const row = this.db
      .prepare(
        `
      SELECT
        entity_type,
        entity_id,
        event_id,
        event_type,
        event_timestamp,
        deleted,
        state_hash,
        source_kind
      FROM rchat_metadata_entity_revisions
      WHERE group_id = ? AND entity_type = ? AND entity_id = ?
      LIMIT 1
    `
      )
      .get(groupId, entityType, normalizedId) as
      | {
          entity_type: string;
          entity_id: string;
          event_id: string;
          event_type: string;
          event_timestamp: number;
          deleted: number;
          state_hash: string;
          source_kind: string;
        }
      | undefined;
    if (!row) return null;
    return {
      revision: {
        entityType: row.entity_type === 'category' ? 'category' : 'channel',
        entityId: row.entity_id,
        eventId: row.event_id,
        eventType: row.event_type,
        timestamp: row.event_timestamp,
        deleted: row.deleted === 1,
        stateHash: row.state_hash,
      },
      source: row.source_kind === 'snapshot' ? 'snapshot' : 'event',
    };
  }

  getMetadataEntityRevision(
    groupId: number,
    entityType: 'channel' | 'category',
    entityId: string
  ): ReticulumChatMetadataEntityRevision | null {
    return (
      this.getMetadataEntityRevisionRecord(groupId, entityType, entityId)
        ?.revision ?? null
    );
  }

  getMetadataEntityRevisions(
    groupId: number
  ): ReticulumChatMetadataEntityRevision[] {
    const rows = this.db
      .prepare(
        `
      SELECT entity_type, entity_id, event_id, event_type, event_timestamp, deleted, state_hash
      FROM rchat_metadata_entity_revisions
      WHERE group_id = ?
      ORDER BY entity_type ASC, entity_id ASC
    `
      )
      .all(groupId) as Array<{
      entity_type: string;
      entity_id: string;
      event_id: string;
      event_type: string;
      event_timestamp: number;
      deleted: number;
      state_hash: string;
    }>;
    return rows.map((row) => ({
      entityType: row.entity_type === 'category' ? 'category' : 'channel',
      entityId: row.entity_id,
      eventId: row.event_id,
      eventType: row.event_type,
      timestamp: row.event_timestamp,
      deleted: row.deleted === 1,
      stateHash: row.state_hash,
    }));
  }

  upsertMetadataEntityRevision(
    groupId: number,
    revision: ReticulumChatMetadataEntityRevision,
    options: {
      replaceSameEvent?: boolean;
      source?: ReticulumChatMetadataEntityRevisionSource;
    } = {}
  ): boolean {
    const normalizedId =
      revision.entityType === 'channel'
        ? normalizeReticulumChatChannelId(revision.entityId)
        : normalizeReticulumChatCategoryId(revision.entityId);
    if (
      !normalizedId ||
      !revision.eventId ||
      !/^[0-9a-f]{64}$/i.test(String(revision.stateHash || ''))
    )
      return false;
    const current = this.getMetadataEntityRevision(
      groupId,
      revision.entityType,
      normalizedId
    );
    const normalized = { ...revision, entityId: normalizedId };
    const source = options.source === 'snapshot' ? 'snapshot' : 'event';
    const replacesSameEvent =
      options.replaceSameEvent === true &&
      current?.eventId === normalized.eventId &&
      current.timestamp === normalized.timestamp;
    if (
      current &&
      !replacesSameEvent &&
      compareMetadataEntityRevisions(normalized, current) <= 0
    )
      return false;
    const result = this.db
      .prepare(
        `
      INSERT INTO rchat_metadata_entity_revisions
        (
          group_id,
          entity_type,
          entity_id,
          event_id,
          event_type,
          event_timestamp,
          deleted,
          state_hash,
          source_kind
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, entity_type, entity_id) DO UPDATE SET
        event_id = excluded.event_id,
        event_type = excluded.event_type,
        event_timestamp = excluded.event_timestamp,
        deleted = excluded.deleted,
        state_hash = excluded.state_hash,
        source_kind = excluded.source_kind
    `
      )
      .run(
        groupId,
        normalized.entityType,
        normalized.entityId,
        normalized.eventId,
        normalized.eventType,
        Math.max(0, Math.floor(normalized.timestamp)),
        normalized.deleted ? 1 : 0,
        normalized.stateHash,
        source
      );
    return result.changes > 0;
  }

  getLatestMetadataSnapshot(
    groupId: number,
    scope?: 'public' | 'full'
  ): ReticulumChatMetadataSnapshotRecord | null {
    const row = (
      scope
        ? this.db
            .prepare(
              `
          SELECT * FROM rchat_metadata_snapshots
          WHERE group_id = ? AND scope = ?
          ORDER BY version DESC, created_at DESC, snapshot_hash DESC
          LIMIT 1
        `
            )
            .get(groupId, scope)
        : this.stmtGetLatestMetadataSnapshot.get(groupId)
    ) as MetadataSnapshotRow | undefined;
    return row ? metadataSnapshotRowToRecord(row) : null;
  }

  getMetadataSnapshotByHash(
    groupId: number,
    snapshotHash: string
  ): ReticulumChatMetadataSnapshotRecord | null {
    const normalizedHash = String(snapshotHash || '')
      .trim()
      .toLowerCase();
    if (!normalizedHash) return null;
    const row = this.stmtGetMetadataSnapshotByHash.get(
      groupId,
      normalizedHash
    ) as MetadataSnapshotRow | undefined;
    return row ? metadataSnapshotRowToRecord(row) : null;
  }

  deleteCategory(
    groupId: number,
    categoryId: string,
    options: { clearChannelAssignments?: boolean } = {}
  ): boolean {
    const normalizedCategoryId = normalizeReticulumChatCategoryId(categoryId);
    if (!normalizedCategoryId) return false;
    this.memoryCategories.delete(`${groupId}:${normalizedCategoryId}`);
    if (options.clearChannelAssignments !== false) {
      for (const [key, channel] of this.memoryChannels.entries()) {
        if (
          channel.groupId === groupId &&
          channel.categoryId === normalizedCategoryId
        ) {
          this.memoryChannels.set(key, { ...channel, categoryId: undefined });
        }
      }
      this.stmtClearChannelCategory.run(groupId, normalizedCategoryId);
    }
    const result = this.stmtDeleteCategory.run(groupId, normalizedCategoryId);
    return result.changes > 0;
  }

  invalidateChatSummaryCache(
    groupId?: number,
    channelId?: string,
    ownerAddress?: string
  ): void {
    const normalizedGroupId = Number(groupId);
    const hasGroup =
      Number.isInteger(normalizedGroupId) && normalizedGroupId > 0;
    const normalizedChannelId =
      channelId == null ? '' : normalizeReticulumChatChannelId(channelId);
    const normalizedOwner = String(ownerAddress || '').trim();
    if (!hasGroup && !normalizedChannelId && !normalizedOwner) {
      this.channelSummaryCache.clear();
      return;
    }
    for (const [key, cached] of this.channelSummaryCache) {
      if (hasGroup && cached.groupId !== normalizedGroupId) continue;
      if (normalizedChannelId && cached.channelId !== normalizedChannelId) {
        continue;
      }
      if (normalizedOwner && cached.ownerAddress !== normalizedOwner) continue;
      this.channelSummaryCache.delete(key);
    }
  }

  private channelSummaryCacheKey(
    groupId: number,
    channelId: string,
    ownerAddress: string,
    onlineSince: number
  ): string {
    return JSON.stringify([
      groupId,
      channelId,
      ownerAddress,
      Math.max(0, Math.floor(onlineSince)),
    ]);
  }

  private nextMessageExpiry(
    groupId: number,
    channelId: string,
    now: number
  ): number {
    const row = this.stmtGetNextMessageExpiry.get(groupId, channelId, now) as
      | { expires_at?: number | null }
      | undefined;
    const expiresAt = Number(row?.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > now
      ? expiresAt
      : Number.POSITIVE_INFINITY;
  }

  private rememberChannelSummary(
    key: string,
    cached: CachedReticulumChannelSummary
  ): void {
    if (this.channelSummaryCache.has(key)) {
      this.channelSummaryCache.delete(key);
    }
    while (
      this.channelSummaryCache.size >=
      RETICULUM_CHAT_CHANNEL_SUMMARY_CACHE_MAX_ENTRIES
    ) {
      const oldestKey = this.channelSummaryCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.channelSummaryCache.delete(oldestKey);
    }
    this.channelSummaryCache.set(key, cached);
  }

  getChatSummaries(
    myAddress = '',
    onlineSince = 0
  ): ReticulumGroupChatSummary[] {
    const groupIds = new Set(this.getKnownGroupIds());

    const summaries: ReticulumGroupChatSummary[] = [];
    for (const groupId of groupIds) {
      const silenceRecords = myAddress
        ? this.listSilences(myAddress, 'group', String(groupId))
        : [];
      const now = Date.now();
      const activeSilencedAuthors = new Set(
        silenceRecords
          .filter(
            (record) => record.expiresAt == null || record.expiresAt > now
          )
          .map((record) => record.targetAddress)
      );
      const nextSilenceExpiry = silenceRecords.reduce(
        (nextExpiry, record) =>
          record.expiresAt != null && record.expiresAt > now
            ? Math.min(nextExpiry, record.expiresAt)
            : nextExpiry,
        Number.POSITIVE_INFINITY
      );
      const ignoredThroughByAuthor = new Map<string, number>();
      for (const record of silenceRecords) {
        ignoredThroughByAuthor.set(
          record.targetAddress,
          Math.max(
            ignoredThroughByAuthor.get(record.targetAddress) ?? 0,
            record.ignoredThrough
          )
        );
      }
      const channelIds = this.getSummaryChannelIds(groupId);
      const channelSummaries = channelIds
        .map((channelId) =>
          this.getChannelSummary(
            groupId,
            channelId,
            myAddress,
            onlineSince,
            activeSilencedAuthors,
            ignoredThroughByAuthor,
            nextSilenceExpiry
          )
        )
        .filter((summary): summary is ReticulumChatSummary => !!summary);
      const chatNotificationSummaries = channelSummaries.filter(
        (summary) => summary.channelId !== RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID
      );
      if (chatNotificationSummaries.length === 0) continue;
      const lastChannel = chatNotificationSummaries.reduce((latest, current) =>
        current.updatedAt > latest.updatedAt ? current : latest
      );
      const unreadCount = chatNotificationSummaries.reduce(
        (total, summary) => total + summary.unreadCount,
        0
      );
      const replyCount = chatNotificationSummaries.reduce(
        (total, summary) => total + summary.replyCount,
        0
      );
      const mentionCount = chatNotificationSummaries.reduce(
        (total, summary) => total + summary.mentionCount,
        0
      );

      summaries.push({
        groupId,
        lastEvent: lastChannel.lastEvent,
        unreadCount,
        replyCount,
        mentionCount,
        hasUnreadMention: mentionCount > 0,
        updatedAt: lastChannel.updatedAt,
        channels: channelSummaries.sort((a, b) => b.updatedAt - a.updatedAt),
      });
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getKnownGroupIds(): number[] {
    const groupIds = new Set<number>();
    const rows = this.stmtGetKnownGroups.all() as Array<{ group_id: number }>;
    for (const row of rows) {
      const groupId = Number(row.group_id);
      if (Number.isInteger(groupId) && groupId > 0) groupIds.add(groupId);
    }
    for (const groupId of this.memoryEvents.groupIds()) {
      if (Number.isInteger(groupId) && groupId > 0) groupIds.add(groupId);
    }
    return [...groupIds].sort((a, b) => a - b);
  }

  /**
   * Whether getKnownGroupIds() would list groupId: one indexed row lookup
   * instead of listing every group.
   */
  hasGroupEvents(groupId: number): boolean {
    if (!Number.isInteger(groupId) || groupId <= 0) return false;
    if (this.stmtHasGroupEvents.get(groupId)) return true;
    for (const event of this.memoryEvents.values()) {
      if (event.groupId === groupId) return true;
    }
    return false;
  }

  getPublicGroupActivityRecords(
    limit = 200
  ): ReticulumPublicGroupActivityRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT group_id, local_state_json, messages_24h, messages_7d,
                 active_authors_7d, observed_at, confidence
          FROM rchat_public_group_activity
          WHERE local_state_json IS NOT NULL OR observed_at > 0
          ORDER BY active_authors_7d DESC, messages_24h DESC,
                   messages_7d DESC, observed_at DESC, group_id ASC
          LIMIT ?
        `
      )
      .all(Math.max(1, Math.min(1000, Math.floor(limit)))) as Array<{
      group_id?: number;
      local_state_json?: string | null;
      messages_24h?: number;
      messages_7d?: number;
      active_authors_7d?: number;
      observed_at?: number;
      confidence?: number;
    }>;
    return rows
      .map((row) => ({
        groupId: Number(row.group_id),
        localStateJson:
          typeof row.local_state_json === 'string'
            ? row.local_state_json
            : null,
        messages24h: Math.max(0, Number(row.messages_24h) || 0),
        messages7d: Math.max(0, Number(row.messages_7d) || 0),
        activeAuthors7d: Math.max(0, Number(row.active_authors_7d) || 0),
        observedAt: Math.max(0, Number(row.observed_at) || 0),
        confidence: Math.max(0, Number(row.confidence) || 0),
      }))
      .filter((row) => Number.isInteger(row.groupId) && row.groupId > 0);
  }

  upsertPublicGroupActivityLocalState(
    groupId: number,
    localStateJson: string,
    summary: ReticulumPublicGroupActivitySummary,
    updatedAt: number
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO rchat_public_group_activity
            (group_id, local_state_json, messages_24h, messages_7d,
             active_authors_7d, observed_at, confidence, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(group_id) DO UPDATE SET
            local_state_json = excluded.local_state_json,
            messages_24h = excluded.messages_24h,
            messages_7d = excluded.messages_7d,
            active_authors_7d = excluded.active_authors_7d,
            observed_at = excluded.observed_at,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
        `
      )
      .run(
        groupId,
        localStateJson,
        summary.messages24h,
        summary.messages7d,
        summary.activeAuthors7d,
        summary.observedAt,
        summary.confidence,
        updatedAt
      );
  }

  upsertPublicGroupActivityCache(
    summaries: ReticulumPublicGroupActivitySummary[],
    maxRows = 200,
    updatedAt = Date.now()
  ): void {
    if (summaries.length === 0) return;
    const upsert = this.db.prepare(`
      INSERT INTO rchat_public_group_activity
        (group_id, local_state_json, messages_24h, messages_7d,
         active_authors_7d, observed_at, confidence, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET
        messages_24h = excluded.messages_24h,
        messages_7d = excluded.messages_7d,
        active_authors_7d = excluded.active_authors_7d,
        observed_at = excluded.observed_at,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `);
    const tx = this.db.transaction(() => {
      for (const summary of summaries) {
        upsert.run(
          summary.groupId,
          summary.messages24h,
          summary.messages7d,
          summary.activeAuthors7d,
          summary.observedAt,
          summary.confidence,
          updatedAt
        );
      }
      this.db
        .prepare(
          `
            DELETE FROM rchat_public_group_activity
            WHERE local_state_json IS NULL
              AND group_id NOT IN (
                SELECT group_id
                FROM rchat_public_group_activity
                WHERE local_state_json IS NULL
                ORDER BY active_authors_7d DESC, messages_24h DESC,
                         messages_7d DESC, observed_at DESC, group_id ASC
                LIMIT ?
              )
          `
        )
        .run(Math.max(1, Math.min(1000, Math.floor(maxRows))));
    });
    tx();
  }

  deletePublicGroupActivity(groupId: number): void {
    this.db
      .prepare('DELETE FROM rchat_public_group_activity WHERE group_id = ?')
      .run(groupId);
  }

  prunePublicGroupActivityCache(staleBefore: number, maxRows = 200): void {
    this.db
      .prepare(
        `DELETE FROM rchat_public_group_activity
         WHERE local_state_json IS NULL AND observed_at < ?`
      )
      .run(staleBefore);
    this.db
      .prepare(
        `
          DELETE FROM rchat_public_group_activity
          WHERE local_state_json IS NULL
            AND group_id NOT IN (
              SELECT group_id
              FROM rchat_public_group_activity
              WHERE local_state_json IS NULL
              ORDER BY active_authors_7d DESC, messages_24h DESC,
                       messages_7d DESC, observed_at DESC, group_id ASC
              LIMIT ?
            )
        `
      )
      .run(Math.max(1, Math.min(1000, Math.floor(maxRows))));
  }

  private getSummaryChannelIds(groupId: number): string[] {
    const channels = new Set<string>([RETICULUM_CHAT_DEFAULT_CHANNEL_ID]);
    const archivedChannels = new Set(
      this.getChannels(groupId, true)
        .filter((channel) => channel.archived)
        .map((channel) => channel.channelId)
    );
    for (const row of this.stmtGetKnownChannels.all(groupId) as Array<{
      channel_id?: string;
    }>) {
      const channelId = normalizeReticulumChatChannelId(row.channel_id);
      if (!archivedChannels.has(channelId)) channels.add(channelId);
    }
    for (const channel of this.getChannels(groupId, false)) {
      channels.add(channel.channelId);
    }
    for (const event of this.memoryEvents.eventsInGroup(groupId)) {
      if (event.groupId !== groupId) continue;
      const channelId = normalizeReticulumChatChannelId(event.channelId);
      if (!archivedChannels.has(channelId)) channels.add(channelId);
    }
    return [...channels];
  }

  private countValidatedStoredUnreadMentions(
    groupId: number,
    channelId: string,
    myAddress: string,
    watermark: number,
    now: number,
    activeSilencedAuthors: ReadonlySet<string>,
    ignoredThroughByAuthor: ReadonlyMap<string, number>
  ): number {
    const myMentionHash = hashReticulumChatMentionAddress(myAddress);
    const rows = this.stmtGetUnreadMentionRecords.all(
      groupId,
      channelId,
      myAddress,
      myAddress,
      watermark,
      `%${myMentionHash}%`,
      now
    ) as Array<{
      author_address?: string;
      encrypted_payload?: string;
      mention_address_hashes?: string;
      mention_targets?: string;
      privileged_mention_status?: number;
      projection_author_address?: string;
      timestamp?: number;
    }>;
    let count = 0;
    for (const row of rows) {
      const authorAddress = String(row.projection_author_address || '');
      const timestamp = Number(row.timestamp || 0);
      if (
        !authorAddress ||
        row.author_address !== authorAddress ||
        activeSilencedAuthors.has(authorAddress) ||
        timestamp <= (ignoredThroughByAuthor.get(authorAddress) ?? 0)
      ) {
        continue;
      }
      const signedHashes = parseMentionAddressHashes(
        row.mention_address_hashes
      ).slice(0, RETICULUM_CHAT_MAX_EFFECTIVE_MENTION_HASHES);
      if (!signedHashes.includes(myMentionHash)) continue;
      const hasPrivilegedMention =
        parseMentionTargets(row.mention_targets).some(
          (target) => target.type === 'everyone' || target.type === 'here'
        ) ||
        reticulumChatPayloadHasPrivilegedMention(
          String(row.encrypted_payload || '')
        );
      if (hasPrivilegedMention && Number(row.privileged_mention_status) !== 1) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  private countUnreadReplies(
    groupId: number,
    channelId: string,
    myAddress: string,
    watermark: number,
    now: number,
    activeSilencedAuthors: ReadonlySet<string>,
    ignoredThroughByAuthor: ReadonlyMap<string, number>,
    recentMessageEvents: readonly ReticulumChatEvent[]
  ): number {
    if (!myAddress) return 0;
    const rows = this.stmtGetUnreadReplyRecords.all(
      groupId,
      channelId,
      watermark,
      myAddress,
      myAddress,
      now,
      now
    ) as Array<{
      root_event_id?: string;
      author_address?: string;
      created_at?: number;
    }>;
    const replyEventIds = new Set<string>();
    for (const row of rows) {
      const authorAddress = String(row.author_address || '');
      const createdAt = Number(row.created_at || 0);
      if (
        !row.root_event_id ||
        !authorAddress ||
        activeSilencedAuthors.has(authorAddress) ||
        createdAt <= (ignoredThroughByAuthor.get(authorAddress) ?? 0)
      ) {
        continue;
      }
      replyEventIds.add(row.root_event_id);
    }

    // Remote relay events can still be in the bounded live cache before they
    // are retained in the durable projection. Include that window without
    // turning summary reads into a scan of the event log.
    for (const event of recentMessageEvents) {
      if (
        replyEventIds.has(event.eventId) ||
        !event.replyToEventId ||
        event.timestamp <= watermark ||
        event.authorAddress === myAddress ||
        activeSilencedAuthors.has(event.authorAddress) ||
        event.timestamp <=
          (ignoredThroughByAuthor.get(event.authorAddress) ?? 0)
      ) {
        continue;
      }
      const parent = this.getEvent(event.replyToEventId);
      if (
        !parent ||
        parent.groupId !== groupId ||
        normalizeReticulumChatChannelId(parent.channelId) !== channelId ||
        parent.authorAddress !== myAddress ||
        (parent.eventType !== 'message' &&
          parent.eventType !== 'attachment_manifest') ||
        this.isEventPayloadScrubbed(parent.eventId)
      ) {
        continue;
      }
      replyEventIds.add(event.eventId);
    }
    return replyEventIds.size;
  }

  private getChannelSummary(
    groupId: number,
    channelId: string,
    myAddress = '',
    onlineSince = 0,
    activeSilencedAuthors: ReadonlySet<string> = new Set(),
    ignoredThroughByAuthor: ReadonlyMap<string, number> = new Map(),
    silenceValidUntil = Number.POSITIVE_INFINITY
  ): ReticulumChatSummary | null {
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const normalizedOwner = String(myAddress || '').trim();
    const normalizedOnlineSince = Math.max(0, Math.floor(onlineSince));
    const key = this.channelSummaryCacheKey(
      groupId,
      normalizedChannelId,
      normalizedOwner,
      normalizedOnlineSince
    );
    const now = Date.now();
    const cached = this.channelSummaryCache.get(key);
    if (cached && cached.validUntil > now) {
      // Refresh insertion order so the bounded cache evicts least-recently-used
      // entries when accounts or memberships change over a long-running session.
      this.channelSummaryCache.delete(key);
      this.channelSummaryCache.set(key, cached);
      return cached.summary;
    }
    if (cached) this.channelSummaryCache.delete(key);

    const summary = this.computeChannelSummary(
      groupId,
      normalizedChannelId,
      normalizedOwner,
      normalizedOnlineSince,
      activeSilencedAuthors,
      ignoredThroughByAuthor
    );
    const validUntil = Math.min(
      silenceValidUntil,
      this.nextMessageExpiry(groupId, normalizedChannelId, now)
    );
    this.rememberChannelSummary(key, {
      groupId,
      channelId: normalizedChannelId,
      ownerAddress: normalizedOwner,
      onlineSince: normalizedOnlineSince,
      validUntil,
      summary,
    });
    return summary;
  }

  private computeChannelSummary(
    groupId: number,
    channelId: string,
    myAddress = '',
    onlineSince = 0,
    activeSilencedAuthors: ReadonlySet<string> = new Set(),
    ignoredThroughByAuthor: ReadonlyMap<string, number> = new Map()
  ): ReticulumChatSummary | null {
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const now = Date.now();
    const events = this.getRecentMessageEvents(
      groupId,
      500,
      normalizedChannelId,
      [...activeSilencedAuthors]
    );
    const recentEvents = this.getRecentEvents(
      groupId,
      500,
      normalizedChannelId
    ).filter((event) => !activeSilencedAuthors.has(event.authorAddress));
    const memoryLast = events[events.length - 1] ?? null;
    const lastEvent = memoryLast;
    if (!lastEvent) return null;
    const suppressUnreadState =
      normalizedChannelId === RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID;

    const watermark = this.getReadWatermark(
      groupId,
      normalizedChannelId,
      myAddress
    );
    const unreadCount =
      myAddress && !suppressUnreadState
        ? events.filter(
            (event) =>
              event.timestamp > watermark &&
              event.authorAddress !== myAddress &&
              event.timestamp >
                (ignoredThroughByAuthor.get(event.authorAddress) ?? 0)
          ).length
        : 0;
    const replyCount =
      myAddress && !suppressUnreadState
        ? this.countUnreadReplies(
            groupId,
            normalizedChannelId,
            myAddress,
            watermark,
            now,
            activeSilencedAuthors,
            ignoredThroughByAuthor,
            events
          )
        : 0;
    const mentionCount =
      myAddress && !suppressUnreadState
        ? this.countValidatedStoredUnreadMentions(
            groupId,
            normalizedChannelId,
            myAddress,
            watermark,
            now,
            activeSilencedAuthors,
            ignoredThroughByAuthor
          )
        : 0;
    let memoryMentionCount = 0;
    const myMentionHash = myAddress
      ? hashReticulumChatMentionAddress(myAddress)
      : '';
    let eventMentionHashCount = 0;
    let eventMentionTargetCount = 0;
    const effectiveMentionEvents = new Map<string, ReticulumChatEvent>();
    for (const event of recentEvents) {
      if (
        event.eventType === 'message' ||
        event.eventType === 'attachment_manifest'
      ) {
        effectiveMentionEvents.set(event.eventId, event);
        continue;
      }
      if (event.eventType === 'edit' && event.targetEventId) {
        effectiveMentionEvents.set(event.targetEventId, event);
        continue;
      }
      if (event.eventType === 'delete' && event.targetEventId) {
        effectiveMentionEvents.delete(event.targetEventId);
      }
    }
    const countEventMentionHash = (event: ReticulumChatEvent) => {
      if (
        !myMentionHash ||
        event.authorAddress === myAddress ||
        event.timestamp <= watermark ||
        event.timestamp <=
          (ignoredThroughByAuthor.get(event.authorAddress) ?? 0) ||
        (event.eventType !== 'message' &&
          event.eventType !== 'attachment_manifest' &&
          event.eventType !== 'edit') ||
        !event.mentionAddressHashes?.includes(myMentionHash)
      ) {
        return;
      }
      eventMentionHashCount += 1;
    };
    const countEventMentionTarget = (event: ReticulumChatEvent) => {
      if (
        event.timestamp <= watermark ||
        event.timestamp <=
          (ignoredThroughByAuthor.get(event.authorAddress) ?? 0) ||
        (event.eventType !== 'message' &&
          event.eventType !== 'attachment_manifest' &&
          event.eventType !== 'edit') ||
        !mentionTargetAppliesTo(
          event,
          myAddress,
          normalizedChannelId,
          onlineSince,
          myMentionHash,
          this.getPrivilegedMentionStatus(event.eventId) === 1
        )
      ) {
        return;
      }
      eventMentionHashCount += 1;
    };
    if (!suppressUnreadState) {
      for (const event of effectiveMentionEvents.values()) {
        const hasPrivilegedTarget =
          sanitizeMentionTargets(event.mentionTargets).some(
            (target) => target.type === 'everyone' || target.type === 'here'
          ) || reticulumChatPayloadHasPrivilegedMention(event.encryptedPayload);
        const privilegedMentionAuthorized =
          this.getPrivilegedMentionStatus(event.eventId) === 1;
        if (
          event.mentionAddressHashes
            ?.slice(0, RETICULUM_CHAT_MAX_EFFECTIVE_MENTION_HASHES)
            .includes(myMentionHash) &&
          (!hasPrivilegedTarget || privilegedMentionAuthorized)
        ) {
          countEventMentionHash(event);
        } else {
          countEventMentionTarget(event);
        }
      }
    }
    if (myAddress && !suppressUnreadState) {
      const mentionTargetRows = this.stmtGetUnreadMentionTargetEvents.all(
        groupId,
        normalizedChannelId,
        watermark,
        myAddress
      ) as EventRow[];
      const effectiveTargetEvents = new Map<string, ReticulumChatEvent>();
      const collectTargetCandidate = (event: ReticulumChatEvent) => {
        if (
          event.eventType === 'message' ||
          event.eventType === 'attachment_manifest'
        ) {
          effectiveTargetEvents.set(event.eventId, event);
          return;
        }
        if (event.eventType === 'edit' && event.targetEventId) {
          effectiveTargetEvents.set(event.targetEventId, event);
          return;
        }
        if (event.eventType === 'delete' && event.targetEventId) {
          effectiveTargetEvents.delete(event.targetEventId);
        }
      };
      for (const row of mentionTargetRows) {
        const event = rowToEvent(row);
        if (
          activeSilencedAuthors.has(event.authorAddress) ||
          event.timestamp <=
            (ignoredThroughByAuthor.get(event.authorAddress) ?? 0)
        ) {
          continue;
        }
        collectTargetCandidate(event);
      }
      for (const event of this.memoryEvents.eventsInGroup(groupId)) {
        if (
          event.groupId !== groupId ||
          normalizeReticulumChatChannelId(event.channelId) !==
            normalizedChannelId ||
          event.timestamp <= watermark ||
          event.authorAddress === myAddress ||
          activeSilencedAuthors.has(event.authorAddress) ||
          event.timestamp <=
            (ignoredThroughByAuthor.get(event.authorAddress) ?? 0) ||
          (sanitizeMentionTargets(event.mentionTargets).length === 0 &&
            event.eventType !== 'edit' &&
            event.eventType !== 'delete')
        ) {
          continue;
        }
        collectTargetCandidate(event);
      }
      for (const event of effectiveTargetEvents.values()) {
        if (
          mentionTargetAppliesTo(
            event,
            myAddress,
            normalizedChannelId,
            onlineSince,
            myMentionHash,
            this.getPrivilegedMentionStatus(event.eventId) === 1
          )
        ) {
          eventMentionTargetCount += 1;
        }
      }
    }
    if (myAddress && !suppressUnreadState) {
      for (const mentions of this.memoryMentions.values()) {
        for (const mention of mentions) {
          if (
            mention.groupId === groupId &&
            mention.channelId === normalizedChannelId &&
            mention.mentionedAddress === myAddress &&
            mention.authorAddress !== myAddress &&
            mention.timestamp > watermark &&
            !activeSilencedAuthors.has(mention.authorAddress) &&
            mention.timestamp >
              (ignoredThroughByAuthor.get(mention.authorAddress) ?? 0) &&
            mention.readAt === 0
          ) {
            memoryMentionCount += 1;
          }
        }
      }
    }
    const totalMentionCount = Math.max(
      mentionCount,
      memoryMentionCount,
      eventMentionHashCount,
      eventMentionTargetCount
    );
    // A message edit can add a mention after the original message timestamp.
    // Keep this boundary separate from updatedAt/lastEvent so read state can
    // acknowledge that mutation without changing channel ordering or causing
    // metadata/control activity to look like a new chat message.
    const readThroughTimestamp = events.reduce(
      (latest, event) =>
        Math.max(
          latest,
          event.timestamp,
          projectionUpdatedAtByEvent.get(event) ?? event.timestamp
        ),
      lastEvent.timestamp
    );
    return {
      groupId,
      channelId: normalizedChannelId,
      lastEvent,
      unreadCount,
      replyCount,
      mentionCount: totalMentionCount,
      hasUnreadMention: totalMentionCount > 0,
      updatedAt: lastEvent.timestamp,
      readThroughTimestamp,
    };
  }

  markRead(
    groupId: number,
    channelIdOrTimestamp: string | number,
    upToTimestampOrAddress?: string | number,
    myAddress = ''
  ): void {
    const channelId =
      typeof channelIdOrTimestamp === 'string'
        ? channelIdOrTimestamp
        : RETICULUM_CHAT_DEFAULT_CHANNEL_ID;
    const timestamp = Number(
      typeof channelIdOrTimestamp === 'number'
        ? channelIdOrTimestamp
        : upToTimestampOrAddress
    );
    const effectiveAddress =
      typeof channelIdOrTimestamp === 'number'
        ? typeof upToTimestampOrAddress === 'string'
          ? upToTimestampOrAddress
          : myAddress
        : myAddress;
    this.markChannelsRead(
      [{ groupId, channelId, timestamp }],
      effectiveAddress
    );
  }

  markChannelsRead(targets: ReticulumChatReadTarget[], myAddress = ''): number {
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    const normalizedTargets = new Map<string, ReticulumChatReadTarget>();
    for (const target of targets) {
      const groupId = Number(target?.groupId);
      const timestamp = Number(target?.timestamp);
      if (
        !Number.isInteger(groupId) ||
        groupId <= 0 ||
        !Number.isFinite(timestamp) ||
        timestamp <= 0
      ) {
        continue;
      }
      const channelId = normalizeReticulumChatChannelId(target?.channelId);
      const key = `${groupId}:${channelId}`;
      const previous = normalizedTargets.get(key);
      if (!previous || timestamp > previous.timestamp) {
        normalizedTargets.set(key, { groupId, channelId, timestamp });
      }
    }
    if (normalizedTargets.size === 0) return 0;

    const readAt = Date.now();
    const watermarkUpdates = [...normalizedTargets.values()].filter(
      ({ groupId, channelId, timestamp }) =>
        timestamp > this.getReadWatermark(groupId, channelId, address)
    );
    const transaction = this.db.transaction(() => {
      for (const { groupId, channelId, timestamp } of watermarkUpdates) {
        this.stmtUpsertWatermark.run(groupId, channelId, address, timestamp);
      }
      if (address) {
        for (const {
          groupId,
          channelId,
          timestamp,
        } of normalizedTargets.values()) {
          this.stmtMarkMentionsRead.run(
            readAt,
            groupId,
            channelId,
            address,
            timestamp
          );
        }
      }
    });
    transaction();

    for (const { groupId, channelId, timestamp } of watermarkUpdates) {
      this.memoryReadWatermarks.set(
        this.readWatermarkKey(groupId, channelId, address),
        timestamp
      );
    }
    if (address) {
      const thresholds = new Map(
        [...normalizedTargets.values()].map(
          ({ groupId, channelId, timestamp }) => [
            `${groupId}:${channelId}`,
            timestamp,
          ]
        )
      );
      for (const mentions of this.memoryMentions.values()) {
        for (const mention of mentions) {
          const threshold = thresholds.get(
            `${mention.groupId}:${mention.channelId}`
          );
          if (
            mention.mentionedAddress === address &&
            threshold !== undefined &&
            mention.timestamp <= threshold &&
            mention.readAt === 0
          ) {
            mention.readAt = readAt;
          }
        }
      }
    }
    for (const { groupId, channelId } of normalizedTargets.values()) {
      this.invalidateChatSummaryCache(groupId, channelId, address);
    }
    return normalizedTargets.size;
  }

  getReadWatermark(groupId: number, channelId: string, address = ''): number {
    const normalizedChannelId = normalizeReticulumChatChannelId(channelId);
    const normalizedAddress = typeof address === 'string' ? address.trim() : '';
    const memoryWatermark =
      this.memoryReadWatermarks.get(
        this.readWatermarkKey(groupId, normalizedChannelId, normalizedAddress)
      ) ?? 0;
    const row = this.stmtGetWatermark.get(
      groupId,
      normalizedChannelId,
      normalizedAddress
    ) as { timestamp?: number } | undefined;
    const sqliteWatermark =
      typeof row?.timestamp === 'number' && Number.isFinite(row.timestamp)
        ? row.timestamp
        : 0;
    const exactWatermark = Math.max(memoryWatermark, sqliteWatermark);
    if (exactWatermark > 0) {
      return exactWatermark;
    }
    if (!normalizedAddress) return 0;
    return 0;
  }

  private readWatermarkKey(
    groupId: number,
    channelId: string,
    address: string
  ): string {
    return `${groupId}:${normalizeReticulumChatChannelId(channelId)}:${address}`;
  }

  getMissingEvents(
    groupId: number,
    knownAuthorSeqs: Record<string, number>,
    limit: number
  ): ReticulumChatEvent[] {
    const maxLimit = Math.max(1, limit);
    const recent = this.getRecentEvents(groupId, maxLimit);
    const out: ReticulumChatEvent[] = [];
    const seen = new Set<string>();

    for (const event of recent) {
      const knownSeq = Number(knownAuthorSeqs[event.authorAddress] ?? 0);
      if (event.authorSeq <= (Number.isFinite(knownSeq) ? knownSeq : 0))
        continue;
      if (seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      out.push(event);
      if (out.length >= maxLimit) break;
    }

    for (const event of this.memoryEvents.values()) {
      if (event.groupId !== groupId) continue;
      const knownSeq = Number(knownAuthorSeqs[event.authorAddress] ?? 0);
      if (event.authorSeq <= (Number.isFinite(knownSeq) ? knownSeq : 0))
        continue;
      if (seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      out.push(event);
      if (out.length >= maxLimit) break;
    }

    return out.sort(
      (a, b) => a.timestamp - b.timestamp || a.authorSeq - b.authorSeq
    );
  }

  markServed(eventIds: string[]): void {
    const now = Date.now();
    for (const id of eventIds) {
      const meta = this.memoryMeta.get(id);
      if (meta) meta.lastServedAt = now;
    }
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) this.stmtMarkServed.run(now, id);
    });
    tx(eventIds);
  }

  getRelayCacheBytes(): number {
    const row = this.stmtTotalCacheBytes.get() as
      | { total?: number }
      | undefined;
    const sqliteTotal = typeof row?.total === 'number' ? row.total : 0;
    let memoryTotal = 0;
    for (const meta of this.memoryMeta.values()) {
      if (!meta.ownEvent) memoryTotal += meta.wireBytes;
    }
    return Math.max(sqliteTotal, memoryTotal);
  }

  private enforceRelayCacheLimit(
    maxBytes = RETICULUM_CHAT_CACHE_MAX_BYTES
  ): void {
    while (this.getRelayCacheBytes() > maxBytes) {
      const memoryCandidate = [...this.memoryMeta.entries()]
        .filter(([, meta]) => !meta.ownEvent)
        .sort(
          (a, b) =>
            a[1].lastServedAt - b[1].lastServedAt ||
            a[1].storedAt - b[1].storedAt
        )[0];
      if (memoryCandidate) {
        this.deleteCachedEvent(memoryCandidate[0]);
        continue;
      }
      const row = this.stmtEvictCandidate.get() as
        | { event_id?: string }
        | undefined;
      if (!row?.event_id) break;
      this.deleteCachedEvent(row.event_id);
    }
  }

  private enforceOfflineRelayCacheLimit(
    now = Date.now(),
    maxBytes = RETICULUM_CHAT_RELAY_CACHE_MAX_BYTES
  ): void {
    this.stmtDeleteRelayExpired.run(now);
    for (const [eventId, entry] of this.memoryRelayCache) {
      if (entry.expiresAt <= now) this.memoryRelayCache.delete(eventId);
    }
    while (this.getOfflineRelayCacheBytes(now) > maxBytes) {
      const memoryCandidate = [...this.memoryRelayCache.values()].sort(
        (a, b) => a.expiresAt - b.expiresAt || a.createdAt - b.createdAt
      )[0];
      if (memoryCandidate) {
        this.memoryRelayCache.delete(memoryCandidate.eventId);
        this.stmtDeleteRelayBlob.run(memoryCandidate.blobId);
        continue;
      }
      const row = this.stmtRelayEvictCandidate.get() as
        | { blob_id?: string }
        | undefined;
      if (!row?.blob_id) break;
      this.stmtDeleteRelayBlob.run(row.blob_id);
    }
  }

  private searchEventsMirror(
    terms: string[],
    allowedGroups: Set<number> | null,
    allowedChannels: Set<string> | null,
    allowedAuthors: Set<string> | null,
    excludedAuthors: Set<string>,
    excludedAuthorsByGroup: Map<number, Set<string>>,
    allowedEventTypes: Set<string> | null,
    includeAdminPrivate: boolean,
    beforeTimestamp: number | null,
    afterTimestamp: number | null,
    hasAttachment: boolean,
    hasLink: boolean,
    sort: 'relevance' | 'newest' | 'oldest',
    now: number,
    limit: number,
    offset: number,
    cursor: ReticulumChatSearchCursor | null,
    cursorSort: 'newest' | 'oldest' | null
  ): ReticulumChatSearchResult[] {
    const firstTerm = terms[0];
    const rows = firstTerm
      ? (this.stmtSearchMirror.all(
          `%${firstTerm}%`,
          cursor ? 500 : Math.max((offset + limit) * 20, 500)
        ) as Array<{
          event_id: string;
          search_text: string;
        }>)
      : [];
    const results: ReticulumChatSearchResult[] = [];
    for (const row of rows) {
      const lower = row.search_text.toLowerCase();
      if (!terms.every((term) => lower.includes(term))) continue;
      if (hasLink && !lower.includes('http') && !lower.includes('www.')) {
        continue;
      }
      const event = this.getEvent(row.event_id);
      if (!event) continue;
      const rootEventId = this.rootEventIdForIndexEvent(event);
      const projection = this.computeMessageProjectionForRoot(rootEventId);
      if (!projection || projection.deleted_at !== null) continue;
      if (
        projection.expires_at !== null &&
        projection.expires_at !== undefined &&
        projection.expires_at <= now
      ) {
        continue;
      }
      if (allowedGroups && !allowedGroups.has(projection.group_id)) continue;
      if (
        allowedChannels &&
        !allowedChannels.has(
          normalizeReticulumChatChannelId(projection.channel_id)
        )
      ) {
        continue;
      }
      if (allowedAuthors && !allowedAuthors.has(projection.author_address)) {
        continue;
      }
      if (excludedAuthors.has(projection.author_address)) continue;
      if (
        excludedAuthorsByGroup
          .get(projection.group_id)
          ?.has(projection.author_address)
      ) {
        continue;
      }
      if (
        allowedEventTypes &&
        !allowedEventTypes.has(projection.root_event_type)
      ) {
        continue;
      }
      if (afterTimestamp !== null && projection.created_at < afterTimestamp) {
        continue;
      }
      if (
        beforeTimestamp !== null &&
        projection.created_at >= beforeTimestamp
      ) {
        continue;
      }
      if (hasAttachment && projection.has_attachment !== 1) {
        continue;
      }
      if (!includeAdminPrivate) {
        const channel = this.getChannel(
          projection.group_id,
          normalizeReticulumChatChannelId(projection.channel_id)
        );
        if (channel?.readMode === RETICULUM_CHAT_CHANNEL_READ_MODE_ADMINS) {
          continue;
        }
      }
      if (
        cursorSort &&
        !isProjectionAfterSearchCursor(projection, cursor, cursorSort)
      ) {
        continue;
      }
      results.push({
        event: messageProjectionRowToEvent(projection),
        snippet: buildPlainSnippet(row.search_text, terms),
        cursor: searchCursorFromProjection(projection),
      });
    }
    if (sort === 'oldest') {
      results.sort(
        (a, b) =>
          a.event.timestamp - b.event.timestamp ||
          a.event.eventId.localeCompare(b.event.eventId)
      );
    } else if (sort === 'newest') {
      results.sort(
        (a, b) =>
          b.event.timestamp - a.event.timestamp ||
          b.event.eventId.localeCompare(a.event.eventId)
      );
    }
    return results.slice(offset, offset + limit);
  }

  private searchEventsMemory(
    terms: string[],
    allowedGroups: Set<number> | null,
    allowedChannels: Set<string> | null,
    allowedAuthors: Set<string> | null,
    excludedAuthors: Set<string>,
    excludedAuthorsByGroup: Map<number, Set<string>>,
    allowedEventTypes: Set<string> | null,
    includeAdminPrivate: boolean,
    beforeTimestamp: number | null,
    afterTimestamp: number | null,
    hasAttachment: boolean,
    hasLink: boolean,
    sort: 'relevance' | 'newest' | 'oldest',
    now: number,
    limit: number,
    offset: number,
    cursor: ReticulumChatSearchCursor | null,
    cursorSort: 'newest' | 'oldest' | null
  ): ReticulumChatSearchResult[] {
    const results: ReticulumChatSearchResult[] = [];
    const rootEventIds = new Set<string>();
    for (const event of this.memoryEvents.values()) {
      if (
        event.eventType === 'message' ||
        event.eventType === 'attachment_manifest'
      ) {
        rootEventIds.add(event.eventId);
      } else if (event.eventType === 'edit' && event.targetEventId) {
        rootEventIds.add(event.targetEventId);
      } else if (event.eventType === 'delete' && event.targetEventId) {
        rootEventIds.add(event.targetEventId);
      }
    }
    const events = [...rootEventIds]
      .map((rootEventId) => this.computeMessageProjectionForRoot(rootEventId))
      .filter((projection): projection is MessageProjectionRow => {
        return (
          !!projection &&
          projection.deleted_at === null &&
          (projection.expires_at === null ||
            projection.expires_at === undefined ||
            projection.expires_at > now)
        );
      })
      .sort((a, b) =>
        sort === 'oldest'
          ? a.created_at - b.created_at ||
            a.root_event_id.localeCompare(b.root_event_id)
          : b.created_at - a.created_at ||
            b.root_event_id.localeCompare(a.root_event_id)
      );
    for (const projection of events) {
      const event = messageProjectionRowToEvent(projection);
      if (allowedGroups && !allowedGroups.has(event.groupId)) continue;
      if (
        allowedChannels &&
        !allowedChannels.has(normalizeReticulumChatChannelId(event.channelId))
      ) {
        continue;
      }
      if (allowedAuthors && !allowedAuthors.has(projection.author_address)) {
        continue;
      }
      if (excludedAuthors.has(projection.author_address)) continue;
      if (
        excludedAuthorsByGroup
          .get(projection.group_id)
          ?.has(projection.author_address)
      ) {
        continue;
      }
      if (
        allowedEventTypes &&
        !allowedEventTypes.has(projection.root_event_type)
      ) {
        continue;
      }
      if (afterTimestamp !== null && projection.created_at < afterTimestamp) {
        continue;
      }
      if (
        beforeTimestamp !== null &&
        projection.created_at >= beforeTimestamp
      ) {
        continue;
      }
      if (hasAttachment && projection.has_attachment !== 1) {
        continue;
      }
      if (!includeAdminPrivate) {
        const channel = this.getChannel(
          projection.group_id,
          normalizeReticulumChatChannelId(projection.channel_id)
        );
        if (channel?.readMode === RETICULUM_CHAT_CHANNEL_READ_MODE_ADMINS) {
          continue;
        }
      }
      if (
        cursorSort &&
        !isProjectionAfterSearchCursor(projection, cursor, cursorSort)
      ) {
        continue;
      }
      const text =
        this.memorySearchText.get(event.eventId) ??
        searchTextFromPayload(projection.encrypted_payload);
      const lower = text.toLowerCase();
      if (!terms.every((term) => lower.includes(term))) continue;
      if (hasLink && !lower.includes('http') && !lower.includes('www.')) {
        continue;
      }
      results.push({
        event,
        snippet: buildPlainSnippet(text, terms),
        cursor: searchCursorFromProjection(projection),
      });
    }
    return results.slice(offset, offset + limit);
  }

  private backfillSearchIndex(limit = 5000): void {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM reticulum_chat_search_index')
      .get() as { cnt?: number } | undefined;
    if ((row?.cnt ?? 0) > 0) return;
    const rows = this.db
      .prepare(
        `
          SELECT * FROM reticulum_chat_events
          WHERE event_type IN ('message', 'attachment_manifest')
          ORDER BY timestamp DESC, event_id DESC
          LIMIT ?
        `
      )
      .all(limit) as EventRow[];
    if (rows.length === 0) return;
    const tx = this.db.transaction((events: EventRow[]) => {
      for (const eventRow of events) {
        const event = rowToEvent(eventRow);
        this.upsertSearchText(
          event,
          searchTextFromPayload(event.encryptedPayload),
          true
        );
      }
    });
    tx(rows);
  }

  private migrateProjectedSearchIndex(): void {
    // v4 rebuilds rows created by the early visible-text indexer, which could
    // include reply event IDs, special IDs, and other non-message metadata.
    const migrationName = 'visible-projected-search-index-v4';
    const applied = this.db
      .prepare('SELECT 1 FROM rchat_schema_migrations WHERE name = ? LIMIT 1')
      .get(migrationName);
    if (applied) return;

    const rows = this.db
      .prepare(
        `
          SELECT p.*, search.search_text AS indexed_search_text
          FROM rchat_message_projection p
          LEFT JOIN reticulum_chat_search_index search
            ON search.event_id = p.root_event_id
          ORDER BY p.created_at DESC, p.root_event_id DESC
        `
      )
      .all() as Array<
      MessageProjectionRow & { indexed_search_text?: string | null }
    >;
    const tx = this.db.transaction(() => {
      for (const projection of rows) {
        const projectedText = projectedSearchTextFromPayload(
          projection.encrypted_payload
        );
        // Older encrypted payloads were indexed after renderer decryption.
        // Preserve that index when the database cannot inspect the payload.
        if (projection.deleted_at === null && projectedText === null) continue;
        const desiredText =
          projection.deleted_at === null
            ? normalizeSearchText(projectedText ?? '')
            : '';
        const indexedText = normalizeSearchText(
          projection.indexed_search_text ?? ''
        );
        if (desiredText && desiredText === indexedText) continue;

        this.upsertProjectedSearchText(projection, desiredText);
        // Persisted indexes are authoritative after startup; avoid retaining a
        // duplicate in-memory copy solely because this was an upgrade repair.
        this.memorySearchText.delete(projection.root_event_id);
      }
      this.db
        .prepare(
          'INSERT INTO rchat_schema_migrations (name, applied_at) VALUES (?, ?)'
        )
        .run(migrationName, Date.now());
    });
    tx();
  }

  private backfillMessageProjection(limit = 10000): void {
    const rows = this.db
      .prepare(
        `
          SELECT e.event_id
          FROM reticulum_chat_events e
          LEFT JOIN rchat_message_projection p
            ON p.root_event_id = e.event_id
          WHERE event_type IN ('message', 'attachment_manifest')
            AND p.root_event_id IS NULL
          ORDER BY timestamp DESC, event_id DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<{ event_id?: string }>;
    if (rows.length === 0) return;
    const tx = this.db.transaction((eventIds: string[]) => {
      for (const eventId of eventIds) {
        this.rebuildMessageProjection(eventId);
      }
    });
    tx(
      rows
        .map((row) => (typeof row.event_id === 'string' ? row.event_id : ''))
        .filter(Boolean)
    );
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reticulum_chat_events (
        event_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        author_address TEXT NOT NULL,
        author_public_key TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        author_seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        feed_timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        target_event_id TEXT,
        reply_to_event_id TEXT,
        encrypted_payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        mention_address_hashes TEXT NOT NULL DEFAULT '[]',
        mention_targets TEXT NOT NULL DEFAULT '[]',
        signature TEXT NOT NULL,
        own_event INTEGER NOT NULL DEFAULT 0,
        last_served_at INTEGER NOT NULL,
        stored_at INTEGER NOT NULL,
        accepted_at INTEGER NOT NULL,
        wire_bytes INTEGER NOT NULL,
        scrubbed_at INTEGER,
        expires_at INTEGER,
        message_expiry_duration_ms INTEGER,
        privileged_mention_status INTEGER NOT NULL DEFAULT 0
      );
      DROP INDEX IF EXISTS reticulum_chat_author_seq_idx;
      CREATE TABLE IF NOT EXISTS rchat_author_streams (
        author_address TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rchat_author_sequence_leases (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        author_seq INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, author_address, author_stream_id, author_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_author_sequence_lease_stream
        ON rchat_author_sequence_leases
          (group_id, author_address, author_stream_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_author_sequence_lease_owner
        ON rchat_author_sequence_leases (owner_id);
      CREATE INDEX IF NOT EXISTS reticulum_chat_group_time_idx
        ON reticulum_chat_events (group_id, channel_id, timestamp, author_seq);
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_group_recent
        ON reticulum_chat_events (group_id, timestamp DESC, event_id DESC);
      DROP INDEX IF EXISTS idx_reticulum_chat_events_group_type_recent;
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_metadata_recent
        ON reticulum_chat_events (group_id, timestamp DESC, event_id DESC)
        WHERE event_type IN (
          'channel_create',
          'channel_update',
          'channel_archive',
          'channel_restore',
          'channel_reorder',
          'category_create',
          'category_update',
          'category_delete'
        );
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_channel_metadata
        ON reticulum_chat_events (group_id, channel_id, timestamp, event_id)
        WHERE event_type IN (
          'channel_create',
          'channel_update',
          'channel_archive',
          'channel_restore',
          'channel_reorder'
        );
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_feed
        ON reticulum_chat_events (group_id, channel_id, feed_timestamp, event_id);
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_target
        ON reticulum_chat_events (target_event_id, timestamp, event_id);
      CREATE INDEX IF NOT EXISTS reticulum_chat_cache_idx
        ON reticulum_chat_events (own_event, last_served_at, timestamp);
      CREATE TABLE IF NOT EXISTS rchat_event_headers (
        event_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        author_address TEXT NOT NULL,
        author_public_key TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        author_seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        feed_timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        target_event_id TEXT,
        reply_to_event_id TEXT,
        payload_hash TEXT NOT NULL,
        mention_address_hashes TEXT NOT NULL DEFAULT '[]',
        mention_targets TEXT NOT NULL DEFAULT '[]',
        signature TEXT NOT NULL,
        own_event INTEGER NOT NULL DEFAULT 0,
        last_served_at INTEGER NOT NULL,
        stored_at INTEGER NOT NULL,
        accepted_at INTEGER NOT NULL,
        wire_bytes INTEGER NOT NULL,
        retention_state TEXT NOT NULL DEFAULT 'full',
        scrubbed_at INTEGER,
        expires_at INTEGER,
        message_expiry_duration_ms INTEGER
      );
      DROP INDEX IF EXISTS idx_rchat_event_headers_author_seq;
      CREATE INDEX IF NOT EXISTS idx_rchat_event_headers_group_recent
        ON rchat_event_headers (group_id, timestamp DESC, event_id DESC);
      CREATE INDEX IF NOT EXISTS idx_rchat_event_headers_feed
        ON rchat_event_headers (group_id, channel_id, feed_timestamp, event_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_event_headers_payload
        ON rchat_event_headers (payload_hash);
      CREATE INDEX IF NOT EXISTS idx_rchat_event_headers_target
        ON rchat_event_headers (target_event_id, timestamp, event_id);
      CREATE TABLE IF NOT EXISTS rchat_metadata_snapshots (
        group_id INTEGER NOT NULL,
        snapshot_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'public',
        parent_snapshot_hash TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        latest_event_id TEXT NOT NULL DEFAULT '',
        latest_feed_timestamp INTEGER NOT NULL DEFAULT 0,
        snapshot_hash TEXT NOT NULL,
        admin_address TEXT NOT NULL,
        admin_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        channels_json TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        revisions_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (group_id, snapshot_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rchat_metadata_snapshots_hash
        ON rchat_metadata_snapshots (group_id, snapshot_hash);
      CREATE INDEX IF NOT EXISTS idx_rchat_metadata_snapshots_latest
        ON rchat_metadata_snapshots (group_id, scope, version DESC, created_at DESC);
      CREATE TABLE IF NOT EXISTS rchat_metadata_entity_revisions (
        group_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_timestamp INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        state_hash TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'event',
        PRIMARY KEY (group_id, entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_sync_state (
        scope TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        peer_hash TEXT NOT NULL DEFAULT '',
        state_key TEXT NOT NULL,
        state_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, group_id, peer_hash, state_key)
      );
      CREATE TABLE IF NOT EXISTS rchat_message_projection (
        root_event_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        author_address TEXT NOT NULL,
        author_public_key TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        author_seq INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        root_event_type TEXT NOT NULL,
        current_event_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        reply_to_event_id TEXT,
        encrypted_payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        mention_address_hashes TEXT NOT NULL DEFAULT '[]',
        mention_targets TEXT NOT NULL DEFAULT '[]',
        signature TEXT NOT NULL,
        deleted_at INTEGER,
        deleted_event_id TEXT,
        expires_at INTEGER,
        has_attachment INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_message_projection_visible
        ON rchat_message_projection (group_id, channel_id, deleted_at, created_at, root_event_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_message_projection_group_visible
        ON rchat_message_projection (group_id, deleted_at, created_at, root_event_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_message_projection_window
        ON rchat_message_projection (group_id, channel_id, created_at, root_event_id)
        WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS rchat_peer_group_state (
        peer_hash TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        latest_event_id TEXT,
        latest_feed_timestamp INTEGER,
        digest_hash TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (peer_hash, group_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_peer_channel_state (
        peer_hash TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        latest_event_id TEXT,
        latest_feed_timestamp INTEGER,
        oldest_event_id TEXT,
        oldest_feed_timestamp INTEGER,
        visible_window_hash TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (peer_hash, group_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_verified_windows (
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        start_event_id TEXT NOT NULL,
        start_feed_timestamp INTEGER NOT NULL,
        end_event_id TEXT NOT NULL,
        end_feed_timestamp INTEGER NOT NULL,
        window_hash TEXT NOT NULL,
        verified_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, channel_id, start_event_id, end_event_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_missing_ranges (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        preferred_peer TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, author_address, from_seq, to_seq)
      );
      CREATE TABLE IF NOT EXISTS rchat_missing_stream_ranges (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        preferred_peer TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, author_address, author_stream_id, from_seq, to_seq)
      );
      CREATE TABLE IF NOT EXISTS rchat_missing_range_peer_observations (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        peer_hash TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, author_address, author_stream_id, from_seq, to_seq, peer_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_range_peer_observations_range
        ON rchat_missing_range_peer_observations
          (group_id, author_address, author_stream_id, from_seq, to_seq, observed_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_range_peer_observations_time
        ON rchat_missing_range_peer_observations (observed_at);
      CREATE TABLE IF NOT EXISTS rchat_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        channel_id TEXT,
        peer_hash TEXT,
        operation TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE (dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_sync_queue_ready
        ON rchat_sync_queue (priority, next_attempt_at);
      CREATE TABLE IF NOT EXISTS rchat_rejected_event_markers (
        group_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        event_fingerprint TEXT NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL DEFAULT '',
        author_seq INTEGER NOT NULL DEFAULT 0,
        digest_fingerprint TEXT NOT NULL DEFAULT '',
        rejected_at INTEGER NOT NULL,
        next_revalidate_at INTEGER NOT NULL,
        revalidation_attempts INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (group_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_rejected_event_revalidate
        ON rchat_rejected_event_markers (next_revalidate_at, rejected_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_rejected_event_digest
        ON rchat_rejected_event_markers
          (group_id, digest_fingerprint, next_revalidate_at);
      CREATE TABLE IF NOT EXISTS rchat_rejected_digest_markers (
        group_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        event_fingerprint TEXT NOT NULL,
        digest_fingerprint TEXT NOT NULL,
        rejected_at INTEGER NOT NULL,
        next_revalidate_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, event_id, digest_fingerprint)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_rejected_digest_active
        ON rchat_rejected_digest_markers
          (group_id, digest_fingerprint, next_revalidate_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_peer_channel_state
        ON rchat_peer_channel_state (peer_hash, group_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_peer_group_state
        ON rchat_peer_group_state (peer_hash, group_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_ranges_ready
        ON rchat_missing_ranges (group_id, author_address, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_verified_windows_lookup
        ON rchat_verified_windows (group_id, channel_id, start_feed_timestamp, end_feed_timestamp);
      CREATE TABLE IF NOT EXISTS rchat_relay_cache (
        blob_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        group_id INTEGER NOT NULL,
        group_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        encoding TEXT NOT NULL DEFAULT 'plain-json-v1',
        encryption TEXT NOT NULL DEFAULT 'none',
        key_epoch INTEGER,
        encrypted_key_id TEXT,
        payload_json TEXT NOT NULL,
        source_peer_hash TEXT NOT NULL DEFAULT '',
        served_count INTEGER NOT NULL DEFAULT 0,
        last_served_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_relay_cache_event
        ON rchat_relay_cache (group_id, event_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_relay_cache_eviction
        ON rchat_relay_cache (expires_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_relay_cache_group_created
        ON rchat_relay_cache (group_id, created_at, event_id);
      CREATE TABLE IF NOT EXISTS rchat_group_keys (
        group_id INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        key_bytes_base64 TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        admin_public_key TEXT NOT NULL,
        admin_signature TEXT NOT NULL,
        PRIMARY KEY (group_id, epoch, key_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_group_keys_active
        ON rchat_group_keys (group_id, status, epoch, created_at);
      CREATE TABLE IF NOT EXISTS rchat_group_key_digests (
        group_id INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        admin_public_key TEXT NOT NULL,
        admin_signature TEXT NOT NULL,
        source_peer_hash TEXT NOT NULL DEFAULT '',
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, epoch, key_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_group_key_digests_latest
        ON rchat_group_key_digests (group_id, epoch, created_at);
      CREATE TABLE IF NOT EXISTS rchat_group_key_requests (
        group_id INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        PRIMARY KEY (group_id, epoch, key_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_group_key_requests_pending
        ON rchat_group_key_requests (status, requested_at);
      CREATE TABLE IF NOT EXISTS reticulum_chat_read_watermarks (
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        address TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (group_id, channel_id, address)
      );
      CREATE TABLE IF NOT EXISTS rchat_dm_read_watermarks (
        conversation_id TEXT NOT NULL,
        address TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, address)
      );
      CREATE TABLE IF NOT EXISTS rchat_device_read_state (
        owner_address TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'dm')),
        scope_id TEXT NOT NULL,
        group_id INTEGER,
        channel_id TEXT,
        conversation_id TEXT,
        peer_address TEXT,
        up_to_timestamp INTEGER NOT NULL,
        signed_at INTEGER NOT NULL,
        author_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        PRIMARY KEY (owner_address, scope_type, scope_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_device_read_state_owner_time
        ON rchat_device_read_state (owner_address, signed_at DESC);
      CREATE TABLE IF NOT EXISTS rchat_pending_device_read_state (
        owner_address TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'dm')),
        scope_id TEXT NOT NULL,
        group_id INTEGER,
        channel_id TEXT,
        conversation_id TEXT,
        peer_address TEXT,
        up_to_timestamp INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_address, scope_type, scope_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_device_state (
        owner_address TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        signed_at INTEGER NOT NULL,
        expires_at INTEGER,
        author_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        PRIMARY KEY (owner_address, key)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_device_state_owner_time
        ON rchat_device_state (owner_address, signed_at DESC);
      CREATE TABLE IF NOT EXISTS rchat_pending_device_state (
        owner_address TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_address, key)
      );
      CREATE TABLE IF NOT EXISTS rchat_device_state_ack (
        owner_address TEXT NOT NULL,
        peer_hash TEXT NOT NULL,
        key TEXT NOT NULL,
        signed_at INTEGER NOT NULL,
        PRIMARY KEY (owner_address, peer_hash, key)
      );
      CREATE TABLE IF NOT EXISTS reticulum_chat_mentions (
        event_id TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        mentioned_address TEXT NOT NULL,
        author_address TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        read_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, mentioned_address)
      );
      CREATE INDEX IF NOT EXISTS reticulum_chat_mentions_unread_idx
        ON reticulum_chat_mentions (group_id, channel_id, mentioned_address, read_at, timestamp);
      CREATE TABLE IF NOT EXISTS reticulum_chat_search_index (
        event_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        author_address TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reticulum_chat_search_group_time_idx
        ON reticulum_chat_search_index (group_id, channel_id, timestamp);
      CREATE VIRTUAL TABLE IF NOT EXISTS reticulum_chat_search_fts USING fts5(
        event_id UNINDEXED,
        group_id UNINDEXED,
        channel_id UNINDEXED,
        author_address UNINDEXED,
        timestamp UNINDEXED,
        event_type UNINDEXED,
        search_text,
        tokenize = 'unicode61'
      );
      CREATE TABLE IF NOT EXISTS reticulum_chat_channels (
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        category_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        position INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        write_mode TEXT NOT NULL DEFAULT 'members',
        read_mode TEXT NOT NULL DEFAULT 'members',
        write_mode_updated_at INTEGER NOT NULL DEFAULT 0,
        expiry_duration_ms INTEGER,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_channel_expiry_reconciliation (
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        expiry_duration_ms INTEGER,
        after_timestamp INTEGER NOT NULL DEFAULT -1,
        after_event_id TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS reticulum_chat_categories (
        group_id INTEGER NOT NULL,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, category_id)
      );
      CREATE TABLE IF NOT EXISTS rchat_dm_events (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        sender_public_key TEXT NOT NULL,
        sender_stream_id TEXT NOT NULL DEFAULT '',
        sender_seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        target_event_id TEXT,
        reply_to_event_id TEXT,
        payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        signature TEXT NOT NULL,
        legacy_signature TEXT,
        own_event INTEGER NOT NULL DEFAULT 0,
        read_at INTEGER NOT NULL DEFAULT 0,
        stored_at INTEGER NOT NULL,
        wire_bytes INTEGER NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'received',
        delivery_updated_at INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        message_expiry_duration_ms INTEGER,
        UNIQUE (conversation_id, sender_address, sender_stream_id, sender_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_conversation_time
        ON rchat_dm_events (conversation_id, timestamp, event_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_sender_seq
        ON rchat_dm_events
          (conversation_id, sender_address, sender_stream_id, sender_seq);
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_unread
        ON rchat_dm_events (conversation_id, recipient_address, read_at, timestamp);
      CREATE TABLE IF NOT EXISTS rchat_direct_call_history (
        owner_address TEXT NOT NULL,
        call_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        peer_address TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        outcome TEXT NOT NULL CHECK (
          outcome IN ('answered', 'declined', 'missed', 'cancelled', 'no_answer')
        ),
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        author_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        read_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_address, call_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_direct_call_history_conversation
        ON rchat_direct_call_history
          (owner_address, conversation_id, ended_at DESC, call_id DESC);
      CREATE INDEX IF NOT EXISTS idx_rchat_direct_call_history_peer
        ON rchat_direct_call_history
          (owner_address, peer_address, ended_at DESC, call_id DESC);
      CREATE INDEX IF NOT EXISTS idx_rchat_direct_call_history_unread
        ON rchat_direct_call_history
          (owner_address, read_at, ended_at)
        WHERE direction = 'incoming' AND outcome = 'missed';
      CREATE TABLE IF NOT EXISTS rchat_public_group_activity (
        group_id INTEGER PRIMARY KEY,
        local_state_json TEXT,
        messages_24h INTEGER NOT NULL DEFAULT 0,
        messages_7d INTEGER NOT NULL DEFAULT 0,
        active_authors_7d INTEGER NOT NULL DEFAULT 0,
        observed_at INTEGER NOT NULL DEFAULT 0,
        confidence INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_public_group_activity_rank
        ON rchat_public_group_activity
          (active_authors_7d DESC, messages_24h DESC, messages_7d DESC,
           observed_at DESC);
    `);
  }

  private initRelayCacheSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_relay_cache (
        blob_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        group_id INTEGER NOT NULL,
        group_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        encoding TEXT NOT NULL DEFAULT 'plain-json-v1',
        encryption TEXT NOT NULL DEFAULT 'none',
        key_epoch INTEGER,
        encrypted_key_id TEXT,
        payload_json TEXT NOT NULL,
        source_peer_hash TEXT NOT NULL DEFAULT '',
        served_count INTEGER NOT NULL DEFAULT 0,
        last_served_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_relay_cache_event
        ON rchat_relay_cache (group_id, event_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_relay_cache_eviction
        ON rchat_relay_cache (expires_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_relay_cache_group_created
        ON rchat_relay_cache (group_id, created_at, event_id);
    `);
  }

  private initGroupKeySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_group_keys (
        group_id INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        key_bytes_base64 TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        admin_public_key TEXT NOT NULL,
        admin_signature TEXT NOT NULL,
        PRIMARY KEY (group_id, epoch, key_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_group_keys_active
        ON rchat_group_keys (group_id, status, epoch, created_at);
      CREATE TABLE IF NOT EXISTS rchat_group_key_digests (
        group_id INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        admin_public_key TEXT NOT NULL,
        admin_signature TEXT NOT NULL,
        source_peer_hash TEXT NOT NULL DEFAULT '',
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, epoch, key_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_group_key_digests_latest
        ON rchat_group_key_digests (group_id, epoch, created_at);
      CREATE TABLE IF NOT EXISTS rchat_group_key_requests (
        group_id INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        PRIMARY KEY (group_id, epoch, key_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_group_key_requests_pending
        ON rchat_group_key_requests (status, requested_at);
    `);
  }

  private migrateReadWatermarksSchema(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(reticulum_chat_read_watermarks)')
      .all() as Array<{ name?: string }>;
    const hasAddress = columns.some((column) => column.name === 'address');
    if (hasAddress) return;
    const tx = this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE reticulum_chat_read_watermarks
          RENAME TO reticulum_chat_read_watermarks_legacy;
        CREATE TABLE reticulum_chat_read_watermarks (
          group_id INTEGER NOT NULL,
          address TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL,
          PRIMARY KEY (group_id, address)
        );
        INSERT INTO reticulum_chat_read_watermarks (group_id, address, timestamp)
          SELECT group_id, '', timestamp
          FROM reticulum_chat_read_watermarks_legacy;
        DROP TABLE reticulum_chat_read_watermarks_legacy;
      `);
    });
    tx();
  }

  private migrateChannelWriteModeSchema(): void {
    this.ensureColumn(
      'reticulum_chat_channels',
      'write_mode',
      `
      ALTER TABLE reticulum_chat_channels
        ADD COLUMN write_mode TEXT NOT NULL DEFAULT 'members'
      `
    );
  }

  private migrateChannelReadModeSchema(): void {
    this.ensureColumn(
      'reticulum_chat_channels',
      'read_mode',
      `
      ALTER TABLE reticulum_chat_channels
        ADD COLUMN read_mode TEXT NOT NULL DEFAULT 'members'
      `
    );
  }

  private migrateChannelWriteModeUpdatedAtSchema(): void {
    this.ensureColumn(
      'reticulum_chat_channels',
      'write_mode_updated_at',
      `
      ALTER TABLE reticulum_chat_channels
        ADD COLUMN write_mode_updated_at INTEGER NOT NULL DEFAULT 0
      `
    );
  }

  private migrateMetadataSnapshotLineageSchema(): void {
    this.ensureColumn(
      'rchat_metadata_snapshots',
      'scope',
      `ALTER TABLE rchat_metadata_snapshots ADD COLUMN scope TEXT NOT NULL DEFAULT 'public'`
    );
    this.ensureColumn(
      'rchat_metadata_snapshots',
      'parent_snapshot_hash',
      `ALTER TABLE rchat_metadata_snapshots ADD COLUMN parent_snapshot_hash TEXT NOT NULL DEFAULT ''`
    );
    this.ensureColumn(
      'rchat_metadata_snapshots',
      'revisions_json',
      `ALTER TABLE rchat_metadata_snapshots ADD COLUMN revisions_json TEXT NOT NULL DEFAULT '[]'`
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_metadata_entity_revisions (
        group_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_timestamp INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        state_hash TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'event',
        PRIMARY KEY (group_id, entity_type, entity_id)
      );
    `);
    this.ensureColumn(
      'rchat_metadata_entity_revisions',
      'state_hash',
      `ALTER TABLE rchat_metadata_entity_revisions ADD COLUMN state_hash TEXT NOT NULL DEFAULT ''`
    );
    this.ensureColumn(
      'rchat_metadata_entity_revisions',
      'source_kind',
      `ALTER TABLE rchat_metadata_entity_revisions ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'event'`
    );
    this.db.exec(`
      DROP INDEX IF EXISTS idx_rchat_metadata_snapshots_latest;
      CREATE INDEX idx_rchat_metadata_snapshots_latest
        ON rchat_metadata_snapshots (group_id, scope, version DESC, created_at DESC);
    `);
  }

  private ensureAuthorStreamSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_author_streams (
        author_address TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rchat_author_sequence_leases (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        author_seq INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, author_address, author_stream_id, author_seq)
      );
      DROP INDEX IF EXISTS idx_rchat_author_sequence_lease_owner;
      DROP INDEX IF EXISTS idx_rchat_author_sequence_lease_stream;
      CREATE INDEX idx_rchat_author_sequence_lease_stream
        ON rchat_author_sequence_leases
          (group_id, author_address, author_stream_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_author_sequence_lease_owner
        ON rchat_author_sequence_leases (owner_id);
      CREATE TABLE IF NOT EXISTS rchat_missing_stream_ranges (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        preferred_peer TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, author_address, author_stream_id, from_seq, to_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_stream_ranges_ready
        ON rchat_missing_stream_ranges (next_attempt_at, group_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_stream_ranges_group_retry
        ON rchat_missing_stream_ranges (group_id, next_attempt_at);
      DROP INDEX IF EXISTS reticulum_chat_author_seq_idx;
      DROP INDEX IF EXISTS idx_rchat_event_headers_author_seq;
      DROP INDEX IF EXISTS idx_reticulum_chat_events_author_seq;
      CREATE UNIQUE INDEX IF NOT EXISTS reticulum_chat_author_stream_seq_idx
        ON reticulum_chat_events (group_id, author_address, author_stream_id, author_seq);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rchat_event_headers_author_stream_seq
        ON rchat_event_headers (group_id, author_address, author_stream_id, author_seq);
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_author_stream_seq
        ON reticulum_chat_events (group_id, author_address, author_stream_id, author_seq);
    `);
    this.ensureColumn(
      'rchat_author_sequence_leases',
      'owner_pid',
      `ALTER TABLE rchat_author_sequence_leases ADD COLUMN owner_pid INTEGER NOT NULL DEFAULT 0`
    );
    // Explicit provider denials in a row for one gap row (GO backs off on it,
    // see noteMissingRangeDenial). Desktop never writes it; the default keeps
    // every existing statement and an older build reading this file working.
    this.ensureColumn(
      'rchat_missing_stream_ranges',
      'denial_streak',
      `ALTER TABLE rchat_missing_stream_ranges ADD COLUMN denial_streak INTEGER NOT NULL DEFAULT 0`
    );
  }

  private initSilenceSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_silences (
        owner_address TEXT NOT NULL,
        target_address TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'dm')),
        scope_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        ignored_through INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_address, target_address, scope_type, scope_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_silences_owner_scope
        ON rchat_silences (owner_address, scope_type, scope_id);
    `);
  }

  /**
   * Own post delivery proofs (GO, trackOwnPostDelivery): a side table, so the
   * event tables are not touched. Created once per database; desktop leaves
   * it empty.
   */
  private initOwnPostDeliverySchema(): void {
    if (this.tableColumns('rchat_own_post_delivery').has('proof_kind')) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_own_post_delivery (
        event_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('group', 'self_dm')),
        group_id INTEGER,
        channel_id TEXT,
        conversation_id TEXT,
        author_address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        own_device_at INTEGER,
        member_at INTEGER,
        member_peer_hash TEXT,
        proof_kind TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_own_post_delivery_created
        ON rchat_own_post_delivery (created_at);
    `);
  }

  private runSchemaMigrations(): void {
    const migrations: Array<{ name: string; run: () => void }> = [
      {
        name: 'channel-write-mode',
        run: () => this.migrateChannelWriteModeSchema(),
      },
      { name: 'author-streams', run: () => this.ensureAuthorStreamSchema() },
      {
        name: 'channel-read-mode',
        run: () => this.migrateChannelReadModeSchema(),
      },
      {
        name: 'channel-write-mode-updated-at',
        run: () => this.migrateChannelWriteModeUpdatedAtSchema(),
      },
      { name: 'message-expiry', run: () => this.migrateExpirySchema() },
      {
        name: 'dynamic-channel-expiry-policy',
        run: () => this.migrateDynamicChannelExpiryPolicySchema(),
      },
      {
        name: 'general-channel-expiry-policy',
        run: () => this.migrateGeneralChannelExpiryPolicySchema(),
      },
      {
        name: 'message-projection-attachments',
        run: () => this.migrateMessageProjectionAttachmentSchema(),
      },
      {
        name: 'event-mention-targets',
        run: () => this.migrateEventMentionTargetsSchema(),
      },
      {
        name: 'privileged-mention-authorization',
        run: () => this.migratePrivilegedMentionAuthorizationSchema(),
      },
      {
        name: 'event-scrubbed-at',
        run: () => this.migrateEventScrubbedAtSchema(),
      },
      {
        name: 'dm-delivery-status',
        run: () => this.migrateDirectDeliveryStatusSchema(),
      },
      {
        name: 'dm-legacy-signature',
        run: () => this.migrateDirectLegacySignatureSchema(),
      },
      {
        name: 'dm-author-streams',
        run: () => this.migrateDirectAuthorStreamSchema(),
      },
      {
        name: 'dm-message-expiry',
        run: () => this.migrateDirectExpirySchema(),
      },
      {
        name: 'dm-message-expiry-queue-index',
        run: () => this.migrateDirectExpiryQueueIndex(),
      },
      {
        name: 'dm-message-expiry-marker-sequence-index',
        run: () => this.migrateDirectExpiryMarkerSequenceIndex(),
      },
      {
        name: 'dm-own-device-copied-at',
        run: () => this.migrateDirectOwnDeviceCopiedSchema(),
      },
      {
        name: 'dm-delivery-retry-state',
        run: () => this.migrateDirectDeliveryRetrySchema(),
      },
      {
        name: 'device-read-state-peer-address',
        run: () =>
          this.ensureColumn(
            'rchat_device_read_state',
            'peer_address',
            `ALTER TABLE rchat_device_read_state ADD COLUMN peer_address TEXT`
          ),
      },
      { name: 'relay-cache', run: () => this.initRelayCacheSchema() },
      { name: 'group-keys', run: () => this.initGroupKeySchema() },
      {
        name: 'metadata-snapshot-lineage',
        run: () => this.migrateMetadataSnapshotLineageSchema(),
      },
      {
        name: 'group-digest-revisions',
        run: () => this.initGroupDigestRevisionSchema(),
      },
      { name: 'local-user-silences', run: () => this.initSilenceSchema() },
      {
        name: 'discussion-reply-index',
        run: () => this.migrateDiscussionReplyIndexSchema(),
      },
      {
        name: 'author-gap-peer-observations',
        run: () => this.initAuthorGapPeerObservationSchema(),
      },
      {
        name: 'author-gap-known-unavailable',
        run: () => this.initAuthorGapKnownUnavailableSchema(),
      },
      {
        name: 'rejected-event-author-sequence',
        run: () => this.migrateRejectedEventAuthorSequenceSchema(),
      },
      { name: 'group-calendar-v1', run: () => this.initCalendarSchema() },
      {
        name: 'own-post-delivery',
        run: () => this.initOwnPostDeliverySchema(),
      },
    ];
    for (const migration of migrations) {
      try {
        migration.run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Reticulum chat DB migration failed: ${migration.name}: ${message}`
        );
      }
    }
  }

  private initGroupDigestRevisionSchema(): void {
    const bumpNewGroup = `
      INSERT INTO rchat_group_digest_revisions (group_id, revision)
      VALUES (NEW.group_id, 1)
      ON CONFLICT(group_id) DO UPDATE SET revision = revision + 1;
    `;
    const bumpOldGroup = `
      INSERT INTO rchat_group_digest_revisions (group_id, revision)
      VALUES (OLD.group_id, 1)
      ON CONFLICT(group_id) DO UPDATE SET revision = revision + 1;
    `;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_group_digest_revisions (
        group_id INTEGER PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0
      );

      CREATE TRIGGER IF NOT EXISTS rchat_digest_event_insert
      AFTER INSERT ON reticulum_chat_events BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_event_delete
      AFTER DELETE ON reticulum_chat_events BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_event_update
      AFTER UPDATE OF group_id, channel_id, timestamp, feed_timestamp,
        event_type, expires_at ON reticulum_chat_events
      BEGIN ${bumpNewGroup} END;

      CREATE TRIGGER IF NOT EXISTS rchat_digest_header_insert
      AFTER INSERT ON rchat_event_headers BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_header_delete
      AFTER DELETE ON rchat_event_headers BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_header_update
      AFTER UPDATE OF group_id, author_address, author_stream_id, author_seq
      ON rchat_event_headers BEGIN ${bumpNewGroup} END;

      CREATE TRIGGER IF NOT EXISTS rchat_digest_expired_marker_insert
      AFTER INSERT ON rchat_expired_event_markers BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_expired_marker_delete
      AFTER DELETE ON rchat_expired_event_markers BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_expired_marker_update
      AFTER UPDATE OF group_id, author_address, author_stream_id, author_seq
      ON rchat_expired_event_markers BEGIN ${bumpNewGroup} END;

      CREATE TRIGGER IF NOT EXISTS rchat_digest_channel_insert
      AFTER INSERT ON reticulum_chat_channels BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_channel_delete
      AFTER DELETE ON reticulum_chat_channels BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_channel_update
      AFTER UPDATE ON reticulum_chat_channels BEGIN ${bumpNewGroup} END;

      CREATE TRIGGER IF NOT EXISTS rchat_digest_category_insert
      AFTER INSERT ON reticulum_chat_categories BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_category_delete
      AFTER DELETE ON reticulum_chat_categories BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_category_update
      AFTER UPDATE ON reticulum_chat_categories BEGIN ${bumpNewGroup} END;

      CREATE TRIGGER IF NOT EXISTS rchat_digest_snapshot_insert
      AFTER INSERT ON rchat_metadata_snapshots BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_snapshot_delete
      AFTER DELETE ON rchat_metadata_snapshots BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_snapshot_update
      AFTER UPDATE ON rchat_metadata_snapshots BEGIN ${bumpNewGroup} END;

      CREATE TRIGGER IF NOT EXISTS rchat_digest_metadata_revision_insert
      AFTER INSERT ON rchat_metadata_entity_revisions BEGIN ${bumpNewGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_metadata_revision_delete
      AFTER DELETE ON rchat_metadata_entity_revisions BEGIN ${bumpOldGroup} END;
      CREATE TRIGGER IF NOT EXISTS rchat_digest_metadata_revision_update
      AFTER UPDATE ON rchat_metadata_entity_revisions BEGIN ${bumpNewGroup} END;
    `);
  }

  private migrateRejectedEventAuthorSequenceSchema(): void {
    this.ensureColumn(
      'rchat_rejected_event_markers',
      'author_stream_id',
      `ALTER TABLE rchat_rejected_event_markers
       ADD COLUMN author_stream_id TEXT NOT NULL DEFAULT ''`
    );
    this.ensureColumn(
      'rchat_rejected_event_markers',
      'author_seq',
      `ALTER TABLE rchat_rejected_event_markers
       ADD COLUMN author_seq INTEGER NOT NULL DEFAULT 0`
    );
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rchat_rejected_event_author_seq
        ON rchat_rejected_event_markers
          (group_id, author_address, author_stream_id, author_seq,
           next_revalidate_at)
    `);
  }

  upsertCalendarMutation(
    mutation: ReticulumCalendarMutation,
    resourceHash: string
  ): { inserted: boolean; projected: boolean } {
    const transaction = this.db.transaction(() =>
      this.upsertCalendarMutationInTransaction(
        mutation,
        resourceHash,
        Date.now()
      )
    );
    return transaction();
  }

  upsertCalendarMutations(
    items: Array<{
      mutation: ReticulumCalendarMutation;
      resourceHash: string;
    }>
  ): Array<{ inserted: boolean; projected: boolean }> {
    if (items.length === 0) return [];
    const storedAt = Date.now();
    const transaction = this.db.transaction(() =>
      items.map(({ mutation, resourceHash }) =>
        this.upsertCalendarMutationInTransaction(
          mutation,
          resourceHash,
          storedAt
        )
      )
    );
    return transaction();
  }

  private upsertCalendarMutationInTransaction(
    mutation: ReticulumCalendarMutation,
    resourceHash: string,
    storedAt: number
  ): { inserted: boolean; projected: boolean } {
    const mutationJson = JSON.stringify(mutation);
    const inserted =
      this.db
        .prepare(
          `INSERT INTO rchat_calendar_mutations
              (mutation_id, group_id, event_id, operation, timestamp,
               author_address, author_public_key, signature, resource_hash,
               mutation_json, stored_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(mutation_id) DO NOTHING`
        )
        .run(
          mutation.mutationId,
          mutation.groupId,
          mutation.eventId,
          mutation.operation,
          mutation.timestamp,
          mutation.authorAddress,
          mutation.authorPublicKey,
          mutation.signature,
          resourceHash,
          mutationJson,
          storedAt
        ).changes > 0;
    if (!inserted) return { inserted: false, projected: false };

    const current = this.db
      .prepare(
        `SELECT mutation_id, updated_at
             FROM rchat_calendar_events
            WHERE group_id = ? AND event_id = ?`
      )
      .get(mutation.groupId, mutation.eventId) as
      | { mutation_id: string; updated_at: number }
      | undefined;
    if (
      current &&
      (current.updated_at > mutation.timestamp ||
        (current.updated_at === mutation.timestamp &&
          current.mutation_id.localeCompare(mutation.mutationId) >= 0))
    ) {
      return { inserted: true, projected: false };
    }

    const bounds = mutation.state
      ? reticulumCalendarStateBounds(mutation.state)
      : { startAt: null, endAt: null, recurrenceUntilAt: null };
    this.db
      .prepare(
        `INSERT INTO rchat_calendar_events
          (group_id, event_id, mutation_id, updated_at, deleted, state_json,
           start_at, end_at, recurring, recurrence_until_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id, event_id) DO UPDATE SET
           mutation_id = excluded.mutation_id,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted,
           state_json = excluded.state_json,
           start_at = excluded.start_at,
           end_at = excluded.end_at,
           recurring = excluded.recurring,
           recurrence_until_at = excluded.recurrence_until_at`
      )
      .run(
        mutation.groupId,
        mutation.eventId,
        mutation.mutationId,
        mutation.timestamp,
        mutation.operation === 'delete' ? 1 : 0,
        mutation.state ? JSON.stringify(mutation.state) : null,
        bounds.startAt,
        bounds.endAt,
        mutation.state?.recurrence ? 1 : 0,
        bounds.recurrenceUntilAt
      );
    if (mutation.operation === 'delete') {
      this.db
        .prepare(
          `DELETE FROM rchat_calendar_reminders
            WHERE group_id = ? AND event_id = ?`
        )
        .run(mutation.groupId, mutation.eventId);
    }
    return { inserted: true, projected: true };
  }

  hasCalendarMutation(mutationId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM rchat_calendar_mutations WHERE mutation_id = ? LIMIT 1'
        )
        .get(mutationId)
    );
  }

  hasCalendarEvent(groupId: number, eventId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM rchat_calendar_events
            WHERE group_id = ? AND event_id = ? AND deleted = 0
            LIMIT 1`
        )
        .get(groupId, eventId)
    );
  }

  getCalendarMutation(mutationId: string): ReticulumCalendarMutation | null {
    const row = this.db
      .prepare(
        'SELECT mutation_json FROM rchat_calendar_mutations WHERE mutation_id = ?'
      )
      .get(mutationId) as { mutation_json?: string } | undefined;
    if (!row?.mutation_json) return null;
    try {
      return JSON.parse(row.mutation_json) as ReticulumCalendarMutation;
    } catch {
      return null;
    }
  }

  getCalendarMutationResourceHash(mutationId: string): string {
    const row = this.db
      .prepare(
        'SELECT resource_hash FROM rchat_calendar_mutations WHERE mutation_id = ?'
      )
      .get(mutationId) as { resource_hash?: string } | undefined;
    return String(row?.resource_hash || '');
  }

  getCalendarProjectionMutations(groupId: number): ReticulumCalendarMutation[] {
    const rows = this.db
      .prepare(
        `SELECT m.mutation_json
           FROM rchat_calendar_events e
           JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
          WHERE e.group_id = ?
          ORDER BY e.event_id`
      )
      .all(groupId) as Array<{ mutation_json: string }>;
    const output: ReticulumCalendarMutation[] = [];
    for (const row of rows) {
      try {
        output.push(JSON.parse(row.mutation_json) as ReticulumCalendarMutation);
      } catch {
        // A damaged row is ignored; verified snapshots can repair it later.
      }
    }
    return output;
  }

  getCalendarProjectionMutation(
    groupId: number,
    eventId: string
  ): ReticulumCalendarMutation | null {
    const row = this.db
      .prepare(
        `SELECT m.mutation_json
           FROM rchat_calendar_events e
           JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
          WHERE e.group_id = ? AND e.event_id = ?
          LIMIT 1`
      )
      .get(groupId, eventId) as { mutation_json?: string } | undefined;
    if (!row?.mutation_json) return null;
    try {
      return JSON.parse(row.mutation_json) as ReticulumCalendarMutation;
    } catch {
      return null;
    }
  }

  getCalendarEventOccurrence(
    groupId: number,
    eventId: string,
    now: number,
    visiblePastMs: number,
    preferredOccurrenceStart?: number
  ): ReticulumCalendarOccurrence | null {
    const mutation = this.getCalendarProjectionMutation(groupId, eventId);
    if (!mutation || mutation.operation !== 'upsert' || !mutation.state) {
      return null;
    }
    let occurrence: ReticulumCalendarOccurrence | null = null;
    if (
      Number.isFinite(preferredOccurrenceStart) &&
      Number(preferredOccurrenceStart) > 0
    ) {
      occurrence =
        expandReticulumCalendarMutation(
          mutation,
          Number(preferredOccurrenceStart),
          Number(preferredOccurrenceStart) + 1,
          1
        )[0] ?? null;
    }
    if (!occurrence && !mutation.state.recurrence) {
      occurrence = findNextReticulumCalendarOccurrence(mutation, 0);
    }
    if (!occurrence && mutation.state.recurrence) {
      occurrence =
        expandReticulumCalendarMutation(mutation, now, now + 1, 1)[0] ??
        findNextReticulumCalendarOccurrence(mutation, now);
    }
    if (!occurrence && mutation.state.recurrence) {
      const recent = expandReticulumCalendarMutation(
        mutation,
        Math.max(0, now - visiblePastMs),
        now + 1,
        1_000
      );
      occurrence = recent.at(-1) ?? null;
    }
    if (!occurrence) return null;
    const creation = this.db
      .prepare(
        `SELECT author_address, timestamp
           FROM rchat_calendar_mutations
          WHERE group_id = ? AND event_id = ? AND operation = 'upsert'
          ORDER BY timestamp ASC, mutation_id ASC
          LIMIT 1`
      )
      .get(groupId, eventId) as
      | { author_address: string; timestamp: number }
      | undefined;
    return creation
      ? {
          ...occurrence,
          creatorAddress: creation.author_address,
          createdAt: Number(creation.timestamp),
        }
      : occurrence;
  }

  getCalendarProjectionMutationIds(groupId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT e.mutation_id, m.mutation_json
           FROM rchat_calendar_events e
           JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
          WHERE e.group_id = ?
          ORDER BY e.event_id`
      )
      .all(groupId) as Array<{
      mutation_id: string;
      mutation_json: string;
    }>;
    const output: string[] = [];
    for (const row of rows) {
      try {
        JSON.parse(row.mutation_json);
        output.push(row.mutation_id);
      } catch {
        // Match the snapshot projection, which cannot serve damaged JSON.
      }
    }
    return output;
  }

  getCalendarEventMutations(
    groupId: number,
    eventIds: string[]
  ): Map<string, ReticulumCalendarMutation> {
    const ids = [
      ...new Set(eventIds.map((id) => id.trim().toLowerCase())),
    ].filter(Boolean);
    const output = new Map<string, ReticulumCalendarMutation>();
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT e.event_id, m.mutation_json
             FROM rchat_calendar_events e
             JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
            WHERE e.group_id = ?
              AND e.deleted = 0
              AND e.event_id IN (${placeholders})`
        )
        .all(groupId, ...chunk) as Array<{
        event_id: string;
        mutation_json: string;
      }>;
      for (const row of rows) {
        try {
          output.set(
            row.event_id,
            JSON.parse(row.mutation_json) as ReticulumCalendarMutation
          );
        } catch {
          // Ignore malformed local rows without suppressing other reminders.
        }
      }
    }
    return output;
  }

  getCalendarOccurrences(
    groupId: number,
    rangeStart: number,
    rangeEnd: number,
    limit = 2_000
  ): ReticulumCalendarOccurrence[] {
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit)));
    const nonRecurringRows = this.db
      .prepare(
        `SELECT m.mutation_json
           FROM rchat_calendar_events e
           JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
          WHERE e.group_id = ?
            AND e.deleted = 0
            AND e.recurring = 0
            AND e.end_at > ?
            AND e.start_at < ?
          ORDER BY COALESCE(e.start_at, 0), e.event_id
          LIMIT ?`
      )
      .all(groupId, rangeStart, rangeEnd, safeLimit) as Array<{
      mutation_json: string;
    }>;
    const recurringRows = this.db
      .prepare(
        `SELECT m.mutation_json
           FROM rchat_calendar_events e
           JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
          WHERE e.group_id = ?
            AND e.deleted = 0
            AND e.recurring = 1
            AND e.start_at < ?
            AND (e.recurrence_until_at IS NULL OR e.recurrence_until_at >= ?)
          ORDER BY COALESCE(e.start_at, 0), e.event_id
          LIMIT ?`
      )
      .all(groupId, rangeEnd, rangeStart, safeLimit) as Array<{
      mutation_json: string;
    }>;
    const expandRows = (
      rows: Array<{ mutation_json: string }>
    ): ReticulumCalendarOccurrence[] => {
      const occurrences: ReticulumCalendarOccurrence[] = [];
      for (const row of rows) {
        if (occurrences.length >= safeLimit) break;
        try {
          const mutation = JSON.parse(
            row.mutation_json
          ) as ReticulumCalendarMutation;
          occurrences.push(
            ...expandReticulumCalendarMutation(
              mutation,
              rangeStart,
              rangeEnd,
              safeLimit - occurrences.length
            )
          );
        } catch {
          // Ignore malformed local rows rather than failing the entire calendar.
        }
      }
      return occurrences;
    };
    const occurrences = [
      ...expandRows(nonRecurringRows),
      ...expandRows(recurringRows),
    ];
    const ordered = occurrences
      .sort(
        (a, b) =>
          a.occurrenceStart - b.occurrenceStart ||
          a.occurrenceId.localeCompare(b.occurrenceId)
      )
      .slice(0, safeLimit);
    const eventIds = [...new Set(ordered.map((item) => item.eventId))];
    const creationByEventId = new Map<
      string,
      { authorAddress: string; timestamp: number }
    >();
    for (let offset = 0; offset < eventIds.length; offset += 500) {
      const chunk = eventIds.slice(offset, offset + 500);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT event_id, author_address, timestamp
             FROM rchat_calendar_mutations
            WHERE group_id = ?
              AND operation = 'upsert'
              AND event_id IN (${placeholders})
            ORDER BY timestamp ASC, mutation_id ASC`
        )
        .all(groupId, ...chunk) as Array<{
        event_id: string;
        author_address: string;
        timestamp: number;
      }>;
      for (const row of rows) {
        if (!creationByEventId.has(row.event_id)) {
          creationByEventId.set(row.event_id, {
            authorAddress: row.author_address,
            timestamp: row.timestamp,
          });
        }
      }
    }
    return ordered.map((occurrence) => {
      const creation = creationByEventId.get(occurrence.eventId);
      return creation
        ? {
            ...occurrence,
            creatorAddress: creation.authorAddress,
            createdAt: creation.timestamp,
          }
        : occurrence;
    });
  }

  getCalendarEventOccurrences(
    groupId: number,
    eventIds: string[],
    rangeStart: number,
    rangeEnd: number,
    limit = 5_000
  ): ReticulumCalendarOccurrence[] {
    const ids = [
      ...new Set(eventIds.map((id) => id.trim().toLowerCase())),
    ].filter(Boolean);
    if (ids.length === 0) return [];
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit)));
    const rows: Array<{ mutation_json: string }> = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const placeholders = chunk.map(() => '?').join(',');
      rows.push(
        ...(this.db
          .prepare(
            `SELECT m.mutation_json
               FROM rchat_calendar_events e
               JOIN rchat_calendar_mutations m ON m.mutation_id = e.mutation_id
              WHERE e.group_id = ?
                AND e.deleted = 0
                AND e.event_id IN (${placeholders})
              ORDER BY e.event_id`
          )
          .all(groupId, ...chunk) as Array<{ mutation_json: string }>)
      );
    }
    const occurrences: ReticulumCalendarOccurrence[] = [];
    for (const row of rows) {
      if (occurrences.length >= safeLimit) break;
      try {
        const mutation = JSON.parse(
          row.mutation_json
        ) as ReticulumCalendarMutation;
        occurrences.push(
          ...expandReticulumCalendarMutation(
            mutation,
            rangeStart,
            rangeEnd,
            safeLimit - occurrences.length
          )
        );
      } catch {
        // Ignore a malformed local row without suppressing other reminders.
      }
    }
    return occurrences.sort(
      (left, right) =>
        left.occurrenceStart - right.occurrenceStart ||
        left.occurrenceId.localeCompare(right.occurrenceId)
    );
  }

  getCalendarReminder(
    ownerAddress: string,
    groupId: number,
    eventId: string
  ): ReticulumCalendarReminder | null {
    const row = this.db
      .prepare(
        `SELECT owner_address, group_id, event_id, offset_ms,
                last_fired_occurrence_id, updated_at
           FROM rchat_calendar_reminders
          WHERE owner_address = ? AND group_id = ? AND event_id = ?`
      )
      .get(ownerAddress, groupId, eventId) as
      | {
          owner_address: string;
          group_id: number;
          event_id: string;
          offset_ms: number | null;
          last_fired_occurrence_id: string;
          updated_at: number;
        }
      | undefined;
    return row
      ? {
          ownerAddress: row.owner_address,
          groupId: row.group_id,
          eventId: row.event_id,
          offsetMs: row.offset_ms == null ? null : Number(row.offset_ms),
          lastFiredOccurrenceId: row.last_fired_occurrence_id,
          updatedAt: Number(row.updated_at),
        }
      : null;
  }

  setCalendarReminder(reminder: ReticulumCalendarReminder): void {
    this.db
      .prepare(
        `INSERT INTO rchat_calendar_reminders
          (owner_address, group_id, event_id, offset_ms,
           last_fired_occurrence_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_address, group_id, event_id) DO UPDATE SET
           offset_ms = excluded.offset_ms,
           last_fired_occurrence_id = excluded.last_fired_occurrence_id,
           updated_at = excluded.updated_at`
      )
      .run(
        reminder.ownerAddress,
        reminder.groupId,
        reminder.eventId,
        reminder.offsetMs,
        reminder.lastFiredOccurrenceId,
        reminder.updatedAt
      );
  }

  listCalendarReminders(ownerAddress: string): ReticulumCalendarReminder[] {
    const rows = this.db
      .prepare(
        `SELECT owner_address, group_id, event_id, offset_ms,
                last_fired_occurrence_id, updated_at
           FROM rchat_calendar_reminders
          WHERE owner_address = ? AND offset_ms IS NOT NULL`
      )
      .all(ownerAddress) as Array<{
      owner_address: string;
      group_id: number;
      event_id: string;
      offset_ms: number;
      last_fired_occurrence_id: string;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      ownerAddress: row.owner_address,
      groupId: row.group_id,
      eventId: row.event_id,
      offsetMs: Number(row.offset_ms),
      lastFiredOccurrenceId: row.last_fired_occurrence_id,
      updatedAt: Number(row.updated_at),
    }));
  }

  private initCalendarSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_calendar_mutations (
        mutation_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
        timestamp INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        resource_hash TEXT NOT NULL,
        mutation_json TEXT NOT NULL,
        stored_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_calendar_mutations_group_time
        ON rchat_calendar_mutations (group_id, timestamp, mutation_id);
      CREATE INDEX IF NOT EXISTS idx_rchat_calendar_mutations_event
        ON rchat_calendar_mutations (group_id, event_id, timestamp, mutation_id);

      CREATE TABLE IF NOT EXISTS rchat_calendar_events (
        group_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        mutation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        state_json TEXT,
        start_at INTEGER,
        end_at INTEGER,
        recurring INTEGER NOT NULL DEFAULT 0,
        recurrence_until_at INTEGER,
        PRIMARY KEY (group_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_calendar_events_range
        ON rchat_calendar_events (group_id, start_at, end_at)
        WHERE deleted = 0;
      CREATE TABLE IF NOT EXISTS rchat_calendar_reminders (
        owner_address TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        offset_ms INTEGER,
        last_fired_occurrence_id TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_address, group_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_calendar_reminders_owner
        ON rchat_calendar_reminders (owner_address, group_id);
    `);
    this.ensureColumn(
      'rchat_calendar_events',
      'recurrence_until_at',
      `ALTER TABLE rchat_calendar_events ADD COLUMN recurrence_until_at INTEGER`
    );
    const recurrenceBoundsMigration = 'calendar-recurrence-bounds-v1';
    const recurrenceBoundsApplied = this.db
      .prepare('SELECT 1 FROM rchat_schema_migrations WHERE name = ? LIMIT 1')
      .get(recurrenceBoundsMigration);
    if (!recurrenceBoundsApplied) {
      const rows = this.db
        .prepare(
          `SELECT group_id, event_id, state_json
             FROM rchat_calendar_events
            WHERE deleted = 0 AND recurring = 1`
        )
        .all() as Array<{
        group_id: number;
        event_id: string;
        state_json: string | null;
      }>;
      const migrate = this.db.transaction(() => {
        const update = this.db.prepare(
          `UPDATE rchat_calendar_events
              SET recurrence_until_at = ?
            WHERE group_id = ? AND event_id = ?`
        );
        for (const row of rows) {
          try {
            const state = JSON.parse(
              String(row.state_json || '')
            ) as ReticulumCalendarMutation['state'];
            if (!state) continue;
            update.run(
              reticulumCalendarStateBounds(state).recurrenceUntilAt,
              row.group_id,
              row.event_id
            );
          } catch {
            // A malformed projection remains unbounded and can be repaired by
            // the next valid signed calendar snapshot.
          }
        }
        this.db.exec(`
          DROP INDEX IF EXISTS idx_rchat_calendar_events_recurring;
          CREATE INDEX idx_rchat_calendar_events_recurring
            ON rchat_calendar_events
              (group_id, recurring, recurrence_until_at, start_at)
            WHERE deleted = 0 AND recurring = 1;
        `);
        this.db
          .prepare(
            `INSERT OR IGNORE INTO rchat_schema_migrations (name, applied_at)
             VALUES (?, ?)`
          )
          .run(recurrenceBoundsMigration, Date.now());
      });
      migrate();
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rchat_calendar_events_recurring
        ON rchat_calendar_events
          (group_id, recurring, recurrence_until_at, start_at)
        WHERE deleted = 0 AND recurring = 1;
    `);
  }

  private initAuthorGapPeerObservationSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_missing_range_peer_observations (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        peer_hash TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, author_address, author_stream_id, from_seq, to_seq, peer_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_range_peer_observations_range
        ON rchat_missing_range_peer_observations
          (group_id, author_address, author_stream_id, from_seq, to_seq, observed_at);
      CREATE INDEX IF NOT EXISTS idx_rchat_missing_range_peer_observations_time
        ON rchat_missing_range_peer_observations (observed_at);
    `);
  }

  private initAuthorGapKnownUnavailableSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_known_unavailable_ranges (
        group_id INTEGER NOT NULL,
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        confirmed_at INTEGER NOT NULL,
        recheck_at INTEGER NOT NULL,
        peer_hashes_json TEXT NOT NULL,
        PRIMARY KEY (group_id, author_address, author_stream_id, from_seq, to_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_known_unavailable_recheck
        ON rchat_known_unavailable_ranges (recheck_at, group_id);
    `);
  }

  private migrateAuthorGapPeerRetryBackoff(): void {
    const migrationName = 'author-gap-peer-retry-backoff-v1';
    const appliedAt = Date.now();
    const retryAt = appliedAt + 60_000;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO rchat_schema_migrations (name, applied_at) VALUES (?, ?)'
        )
        .run(migrationName, appliedAt);
      const applied = this.db
        .prepare(
          'SELECT applied_at FROM rchat_schema_migrations WHERE name = ? LIMIT 1'
        )
        .get(migrationName) as { applied_at?: number } | undefined;
      if (Number(applied?.applied_at) !== appliedAt) return;
      this.shortenLegacyAuthorGapRetryBackoff(retryAt);
    });
    tx();
  }

  private shortenLegacyAuthorGapRetryBackoff(retryAt: number): void {
    const delayedRanges = this.dedupeMissingRangeRows([
      ...(this.stmtGetAllMissingRanges.all() as ReticulumChatMissingRangeRow[]),
      ...[...this.memoryMissingRanges.values()].map((range) =>
        this.missingRangeStateToRow(range)
      ),
    ]).filter((row) => Number(row.next_attempt_at) > retryAt);
    for (const range of delayedRanges) {
      this.stmtRescheduleMissingRangeAny.run({
        group_id: range.group_id,
        author_address: range.author_address,
        author_stream_id: range.author_stream_id,
        from_seq: range.from_seq,
        to_seq: range.to_seq,
        preferred_peer: range.preferred_peer ?? null,
        next_attempt_at: retryAt,
      });
      this.missingRangeWrites += 1;
      const key = this.missingRangeKey(
        range.group_id,
        range.author_address,
        range.author_stream_id,
        range.from_seq,
        range.to_seq
      );
      const memoryRange = this.memoryMissingRanges.get(key);
      if (memoryRange) {
        this.memoryMissingRanges.set(key, {
          ...memoryRange,
          nextAttemptAt: retryAt,
        });
      }
    }
  }

  private migrateDiscussionReplyIndexSchema(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rchat_message_projection_reply
        ON rchat_message_projection
          (group_id, channel_id, reply_to_event_id, created_at, root_event_id);
    `);
  }

  private migrateGeneralChannelExpiryPolicySchema(): void {
    const migrationName = 'general-channel-expiry-policy-v1';
    const applied = this.db
      .prepare(
        'SELECT applied_at FROM rchat_schema_migrations WHERE name = ? LIMIT 1'
      )
      .get(migrationName) as { applied_at?: number } | undefined;
    if (applied) {
      this.generalChannelExpiryPolicyAppliedAt = Math.max(
        0,
        Math.floor(Number(applied.applied_at) || 0)
      );
      return;
    }
    const appliedAt = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
            UPDATE reticulum_chat_channels
            SET expiry_duration_ms = ?
            WHERE channel_id = ?
          `
        )
        .run(
          RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS,
          RETICULUM_CHAT_DEFAULT_CHANNEL_ID
        );
      this.db
        .prepare(
          `
            INSERT INTO rchat_channel_expiry_reconciliation
              (group_id, channel_id, revision, expiry_duration_ms,
               after_timestamp, after_event_id, updated_at)
            SELECT groups.group_id, ?, 1, ?, -1, '', ?
            FROM (
              SELECT group_id
              FROM reticulum_chat_events
              WHERE channel_id = ?
              UNION
              SELECT group_id
              FROM reticulum_chat_channels
              WHERE channel_id = ?
            ) AS groups
            WHERE groups.group_id > 0
            ON CONFLICT(group_id, channel_id) DO UPDATE SET
              revision = rchat_channel_expiry_reconciliation.revision + 1,
              expiry_duration_ms = excluded.expiry_duration_ms,
              after_timestamp = -1,
              after_event_id = '',
              updated_at = excluded.updated_at
          `
        )
        .run(
          RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
          RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS,
          appliedAt,
          RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
          RETICULUM_CHAT_DEFAULT_CHANNEL_ID
        );
      this.db
        .prepare(
          'INSERT INTO rchat_schema_migrations (name, applied_at) VALUES (?, ?)'
        )
        .run(migrationName, appliedAt);
    });
    tx();
    this.generalChannelExpiryPolicyAppliedAt = appliedAt;
  }

  private tableColumns(tableName: string): Set<string> {
    const rows = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{
      name?: string;
    }>;
    return new Set(
      rows
        .map((row) => (typeof row.name === 'string' ? row.name : ''))
        .filter(Boolean)
    );
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    alterSql: string
  ): void {
    if (this.tableColumns(tableName).has(columnName)) return;
    this.db.exec(alterSql);
  }

  private verifyRequiredSchema(): void {
    const requiredTables: Array<{ table: string; columns: string[] }> = [
      {
        table: 'reticulum_chat_events',
        columns: [
          'channel_id',
          'author_stream_id',
          'mention_targets',
          'privileged_mention_status',
          'scrubbed_at',
          'expires_at',
          'message_expiry_duration_ms',
        ],
      },
      {
        table: 'rchat_message_projection',
        columns: ['author_stream_id', 'expires_at', 'has_attachment'],
      },
      {
        table: 'rchat_event_headers',
        columns: [
          'event_id',
          'author_stream_id',
          'payload_hash',
          'retention_state',
          'expires_at',
          'message_expiry_duration_ms',
        ],
      },
      {
        table: 'rchat_metadata_snapshots',
        columns: [
          'group_id',
          'snapshot_hash',
          'channels_json',
          'categories_json',
        ],
      },
      {
        table: 'rchat_metadata_entity_revisions',
        columns: [
          'group_id',
          'entity_type',
          'entity_id',
          'state_hash',
          'source_kind',
        ],
      },
      {
        table: 'rchat_group_digest_revisions',
        columns: ['group_id', 'revision'],
      },
      {
        table: 'reticulum_chat_channels',
        columns: [
          'write_mode',
          'read_mode',
          'write_mode_updated_at',
          'expiry_duration_ms',
        ],
      },
      {
        table: 'rchat_channel_expiry_reconciliation',
        columns: [
          'group_id',
          'channel_id',
          'revision',
          'expiry_duration_ms',
          'after_timestamp',
          'after_event_id',
          'updated_at',
        ],
      },
      {
        table: 'rchat_expired_event_markers',
        columns: [
          'event_id',
          'group_id',
          'channel_id',
          'author_address',
          'author_seq',
          'timestamp',
          'expired_at',
        ],
      },
      {
        table: 'rchat_rejected_event_markers',
        columns: [
          'group_id',
          'event_id',
          'event_fingerprint',
          'author_address',
          'author_stream_id',
          'author_seq',
          'digest_fingerprint',
          'rejected_at',
          'next_revalidate_at',
          'revalidation_attempts',
        ],
      },
      {
        table: 'rchat_known_unavailable_ranges',
        columns: [
          'group_id',
          'author_address',
          'author_stream_id',
          'from_seq',
          'to_seq',
          'confirmed_at',
          'recheck_at',
          'peer_hashes_json',
        ],
      },
      {
        table: 'rchat_rejected_digest_markers',
        columns: [
          'group_id',
          'event_id',
          'event_fingerprint',
          'digest_fingerprint',
          'rejected_at',
          'next_revalidate_at',
        ],
      },
      {
        table: 'rchat_dm_events',
        columns: [
          'delivery_status',
          'delivery_updated_at',
          'expires_at',
          'message_expiry_duration_ms',
          'own_device_copied_at',
          'delivery_attempts',
          'next_delivery_attempt_at',
        ],
      },
      {
        table: 'rchat_dm_expired_event_markers',
        columns: [
          'event_id',
          'conversation_id',
          'sender_address',
          'recipient_address',
          'sender_stream_id',
          'sender_seq',
          'timestamp',
          'expired_at',
        ],
      },
      {
        table: 'rchat_dm_expiry_preferences',
        columns: ['owner_address', 'peer_address', 'duration_ms', 'updated_at'],
      },
      {
        table: 'rchat_dm_read_watermarks',
        columns: ['conversation_id', 'address', 'timestamp'],
      },
      {
        table: 'rchat_device_read_state',
        columns: [
          'owner_address',
          'scope_type',
          'scope_id',
          'peer_address',
          'up_to_timestamp',
          'signed_at',
          'author_public_key',
          'signature',
        ],
      },
      {
        table: 'rchat_pending_device_read_state',
        columns: [
          'owner_address',
          'scope_type',
          'scope_id',
          'peer_address',
          'up_to_timestamp',
          'updated_at',
        ],
      },
      {
        table: 'rchat_device_state',
        columns: [
          'owner_address',
          'key',
          'value',
          'signed_at',
          'expires_at',
          'author_public_key',
          'signature',
        ],
      },
      {
        table: 'rchat_pending_device_state',
        columns: ['owner_address', 'key', 'value', 'expires_at', 'updated_at'],
      },
      {
        table: 'rchat_device_state_ack',
        columns: ['owner_address', 'peer_hash', 'key', 'signed_at'],
      },
      {
        table: 'rchat_silences',
        columns: [
          'owner_address',
          'target_address',
          'scope_type',
          'scope_id',
          'expires_at',
          'ignored_through',
          'updated_at',
        ],
      },
      {
        table: 'rchat_public_group_activity',
        columns: [
          'group_id',
          'local_state_json',
          'messages_24h',
          'messages_7d',
          'active_authors_7d',
          'observed_at',
          'confidence',
        ],
      },
      {
        table: 'rchat_calendar_mutations',
        columns: [
          'mutation_id',
          'group_id',
          'event_id',
          'operation',
          'timestamp',
          'author_address',
          'author_public_key',
          'signature',
          'resource_hash',
          'mutation_json',
          'stored_at',
        ],
      },
      {
        table: 'rchat_calendar_events',
        columns: [
          'group_id',
          'event_id',
          'mutation_id',
          'updated_at',
          'deleted',
          'state_json',
          'start_at',
          'end_at',
          'recurring',
        ],
      },
      {
        table: 'rchat_calendar_reminders',
        columns: [
          'owner_address',
          'group_id',
          'event_id',
          'offset_ms',
          'last_fired_occurrence_id',
        ],
      },
      {
        table: 'rchat_own_post_delivery',
        columns: [
          'event_id',
          'scope',
          'group_id',
          'channel_id',
          'conversation_id',
          'author_address',
          'created_at',
          'own_device_at',
          'member_at',
          'member_peer_hash',
          'proof_kind',
        ],
      },
    ];
    const missing: string[] = [];
    for (const item of requiredTables) {
      const columns = this.tableColumns(item.table);
      if (columns.size === 0) {
        missing.push(`${item.table}.*`);
        continue;
      }
      for (const column of item.columns) {
        if (!columns.has(column)) missing.push(`${item.table}.${column}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Reticulum chat DB schema migration incomplete; missing ${missing.join(', ')}`
      );
    }
  }

  private migrateExpirySchema(): void {
    this.ensureColumn(
      'reticulum_chat_channels',
      'expiry_duration_ms',
      `
        ALTER TABLE reticulum_chat_channels
          ADD COLUMN expiry_duration_ms INTEGER
      `
    );
    this.ensureColumn(
      'reticulum_chat_events',
      'expires_at',
      `
        ALTER TABLE reticulum_chat_events
          ADD COLUMN expires_at INTEGER
      `
    );
    this.ensureColumn(
      'rchat_message_projection',
      'expires_at',
      `
        ALTER TABLE rchat_message_projection
          ADD COLUMN expires_at INTEGER
      `
    );
    this.ensureColumn(
      'reticulum_chat_events',
      'message_expiry_duration_ms',
      `
        ALTER TABLE reticulum_chat_events
          ADD COLUMN message_expiry_duration_ms INTEGER
      `
    );
    this.ensureColumn(
      'rchat_event_headers',
      'expires_at',
      `
        ALTER TABLE rchat_event_headers
          ADD COLUMN expires_at INTEGER
      `
    );
    this.ensureColumn(
      'rchat_event_headers',
      'message_expiry_duration_ms',
      `
        ALTER TABLE rchat_event_headers
          ADD COLUMN message_expiry_duration_ms INTEGER
      `
    );

    const markerColumns = this.tableColumns('rchat_expired_event_markers');
    if (
      markerColumns.size > 0 &&
      !['author_address', 'author_seq', 'timestamp', 'expired_at'].every(
        (name) => markerColumns.has(name)
      )
    ) {
      this.db.exec('DROP TABLE rchat_expired_event_markers');
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_expired_event_markers (
        event_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'general',
        author_address TEXT NOT NULL,
        author_stream_id TEXT NOT NULL,
        author_seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        expired_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_expires
        ON reticulum_chat_events (expires_at);
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_channel_next_expiry
        ON reticulum_chat_events (group_id, channel_id, expires_at)
        WHERE event_type IN ('message', 'attachment_manifest')
          AND expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_rchat_message_projection_expires
        ON rchat_message_projection (expires_at);
      DROP INDEX IF EXISTS idx_reticulum_chat_events_pending_expiry;
      CREATE INDEX IF NOT EXISTS idx_rchat_event_headers_target
        ON rchat_event_headers (target_event_id, timestamp, event_id);
    `);
    this.db.exec(`
      DROP INDEX IF EXISTS idx_rchat_expired_event_markers_author_seq;
      CREATE INDEX idx_rchat_expired_event_markers_author_seq
        ON rchat_expired_event_markers (group_id, author_address, author_stream_id, author_seq);
    `);
  }

  private migrateDynamicChannelExpiryPolicySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rchat_channel_expiry_reconciliation (
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        expiry_duration_ms INTEGER,
        after_timestamp INTEGER NOT NULL DEFAULT -1,
        after_event_id TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, channel_id)
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_channel_expiry
        ON reticulum_chat_events (group_id, channel_id, timestamp, event_id)
        WHERE event_type IN ('message', 'attachment_manifest');
    `);
    this.ensureColumn(
      'rchat_channel_expiry_reconciliation',
      'revision',
      `ALTER TABLE rchat_channel_expiry_reconciliation
       ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`
    );
    this.ensureColumn(
      'rchat_channel_expiry_reconciliation',
      'expiry_duration_ms',
      `ALTER TABLE rchat_channel_expiry_reconciliation
       ADD COLUMN expiry_duration_ms INTEGER`
    );
    this.db
      .prepare(
        `
          UPDATE rchat_channel_expiry_reconciliation AS pending
          SET expiry_duration_ms = CASE
            WHEN EXISTS (
              SELECT 1 FROM reticulum_chat_channels channels
              WHERE channels.group_id = pending.group_id
                AND channels.channel_id = pending.channel_id
            ) THEN (
              SELECT channels.expiry_duration_ms
              FROM reticulum_chat_channels channels
              WHERE channels.group_id = pending.group_id
                AND channels.channel_id = pending.channel_id
            )
            WHEN pending.channel_id = ? THEN ?
            ELSE NULL
          END
        `
      )
      .run(
        RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
        RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS
      );
    const migrationName = 'dynamic-channel-expiry-policy-v1';
    const applied = this.db
      .prepare('SELECT 1 FROM rchat_schema_migrations WHERE name = ? LIMIT 1')
      .get(migrationName);
    if (applied) return;
    const appliedAt = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT OR IGNORE INTO rchat_channel_expiry_reconciliation
              (group_id, channel_id, revision, expiry_duration_ms,
               after_timestamp, after_event_id, updated_at)
            SELECT DISTINCT events.group_id, events.channel_id, 1,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM reticulum_chat_channels channels
                  WHERE channels.group_id = events.group_id
                    AND channels.channel_id = events.channel_id
                ) THEN (
                  SELECT channels.expiry_duration_ms
                  FROM reticulum_chat_channels channels
                  WHERE channels.group_id = events.group_id
                    AND channels.channel_id = events.channel_id
                )
                WHEN events.channel_id = ? THEN ?
                ELSE NULL
              END,
              -1, '', ?
            FROM reticulum_chat_events events
            WHERE events.event_type IN ('message', 'attachment_manifest')
              AND (
                events.channel_id IN ('general', 'qortal-land')
                OR EXISTS (
                  SELECT 1
                  FROM reticulum_chat_channels channels
                  WHERE channels.group_id = events.group_id
                    AND channels.channel_id = events.channel_id
                )
              )
          `
        )
        .run(
          RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
          RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
          appliedAt
        );
      this.db
        .prepare(
          'INSERT INTO rchat_schema_migrations (name, applied_at) VALUES (?, ?)'
        )
        .run(migrationName, appliedAt);
    });
    tx();
  }

  private migrateMessageProjectionAttachmentSchema(): void {
    this.ensureColumn(
      'rchat_message_projection',
      'has_attachment',
      `
        ALTER TABLE rchat_message_projection
          ADD COLUMN has_attachment INTEGER NOT NULL DEFAULT 0
      `
    );
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rchat_message_projection_attachments
        ON rchat_message_projection (group_id, has_attachment, deleted_at, created_at, root_event_id);
    `);
    // The backfill scans and rewrites the whole projection table (≈200 ms on a
    // phone-sized history, far more on an interpreted WebView). Stamp it so it
    // runs once per database instead of on every open; new rows get their flag
    // at insert time.
    const migrationName = 'message-projection-attachments-backfill-v1';
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rchat_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const applied = this.db
      .prepare('SELECT 1 FROM rchat_schema_migrations WHERE name = ? LIMIT 1')
      .get(migrationName);
    if (applied) return;
    const appliedAt = Date.now();
    const tx = this.db.transaction(() => {
      this.db.exec(`
        UPDATE rchat_message_projection
        SET has_attachment = CASE
          WHEN root_event_type = 'attachment_manifest'
            OR encrypted_payload LIKE '%"attachments"%'
          THEN 1
          ELSE 0
        END
      `);
      this.db
        .prepare(
          'INSERT INTO rchat_schema_migrations (name, applied_at) VALUES (?, ?)'
        )
        .run(migrationName, appliedAt);
    });
    tx();
  }

  private migrateEventMentionTargetsSchema(): void {
    this.ensureColumn(
      'reticulum_chat_events',
      'mention_targets',
      `
      ALTER TABLE reticulum_chat_events
        ADD COLUMN mention_targets TEXT NOT NULL DEFAULT '[]'
      `
    );
  }

  private migratePrivilegedMentionAuthorizationSchema(): void {
    this.ensureColumn(
      'reticulum_chat_events',
      'privileged_mention_status',
      `
      ALTER TABLE reticulum_chat_events
        ADD COLUMN privileged_mention_status INTEGER NOT NULL DEFAULT 0
      `
    );
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rchat_pending_privileged_mentions
        ON reticulum_chat_events (accepted_at, event_id)
        WHERE privileged_mention_status = 2;
    `);
  }

  private migrateEventScrubbedAtSchema(): void {
    this.ensureColumn(
      'reticulum_chat_events',
      'scrubbed_at',
      `
      ALTER TABLE reticulum_chat_events
        ADD COLUMN scrubbed_at INTEGER
      `
    );
  }

  private migrateDirectDeliveryStatusSchema(): void {
    this.ensureColumn(
      'rchat_dm_events',
      'delivery_status',
      `
        ALTER TABLE rchat_dm_events
          ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'received'
      `
    );
    this.ensureColumn(
      'rchat_dm_events',
      'delivery_updated_at',
      `
        ALTER TABLE rchat_dm_events
          ADD COLUMN delivery_updated_at INTEGER NOT NULL DEFAULT 0
      `
    );
    // Backs the pending-delivery sweep; created after the column is
    // guaranteed to exist so legacy databases migrate cleanly.
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_pending_delivery
         ON rchat_dm_events (delivery_status, sender_address, timestamp)`
    );
  }

  private migrateDirectAuthorStreamSchema(): void {
    const table = this.db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'rchat_dm_events'`
      )
      .get() as { sql?: string } | undefined;
    const normalizedSql = String(table?.sql || '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (
      normalizedSql.includes('sender_stream_id') &&
      normalizedSql.includes(
        'unique (conversation_id, sender_address, sender_stream_id, sender_seq)'
      )
    ) {
      return;
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
        ALTER TABLE rchat_dm_events RENAME TO rchat_dm_events_pre_stream;
        CREATE TABLE rchat_dm_events (
          event_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          sender_address TEXT NOT NULL,
          recipient_address TEXT NOT NULL,
          sender_public_key TEXT NOT NULL,
          sender_stream_id TEXT NOT NULL DEFAULT '',
          sender_seq INTEGER NOT NULL,
          timestamp INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          target_event_id TEXT,
          reply_to_event_id TEXT,
          payload TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          signature TEXT NOT NULL,
          legacy_signature TEXT,
          own_event INTEGER NOT NULL DEFAULT 0,
          read_at INTEGER NOT NULL DEFAULT 0,
          stored_at INTEGER NOT NULL,
          wire_bytes INTEGER NOT NULL,
          delivery_status TEXT NOT NULL DEFAULT 'received',
          delivery_updated_at INTEGER NOT NULL DEFAULT 0,
          UNIQUE
            (conversation_id, sender_address, sender_stream_id, sender_seq)
        );
        INSERT INTO rchat_dm_events
          (event_id, conversation_id, sender_address, recipient_address,
           sender_public_key, sender_stream_id, sender_seq, timestamp,
           event_type, target_event_id, reply_to_event_id, payload,
           payload_hash, signature, legacy_signature, own_event, read_at, stored_at, wire_bytes,
           delivery_status, delivery_updated_at)
        SELECT event_id, conversation_id, sender_address, recipient_address,
               sender_public_key, '', sender_seq, timestamp, event_type,
               target_event_id, reply_to_event_id, payload, payload_hash,
               signature, legacy_signature, own_event, read_at, stored_at, wire_bytes,
               delivery_status, delivery_updated_at
        FROM rchat_dm_events_pre_stream;
        DROP TABLE rchat_dm_events_pre_stream;
        CREATE INDEX idx_rchat_dm_events_conversation_time
          ON rchat_dm_events (conversation_id, timestamp, event_id);
        CREATE INDEX idx_rchat_dm_events_sender_seq
          ON rchat_dm_events
            (conversation_id, sender_address, sender_stream_id, sender_seq);
        CREATE INDEX idx_rchat_dm_events_unread
          ON rchat_dm_events
            (conversation_id, recipient_address, read_at, timestamp);
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateDirectLegacySignatureSchema(): void {
    this.ensureColumn(
      'rchat_dm_events',
      'legacy_signature',
      `ALTER TABLE rchat_dm_events ADD COLUMN legacy_signature TEXT`
    );
  }

  private migrateDirectExpirySchema(): void {
    this.ensureColumn(
      'rchat_dm_events',
      'expires_at',
      `ALTER TABLE rchat_dm_events ADD COLUMN expires_at INTEGER`
    );
    this.ensureColumn(
      'rchat_dm_events',
      'message_expiry_duration_ms',
      `ALTER TABLE rchat_dm_events ADD COLUMN message_expiry_duration_ms INTEGER`
    );
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_expires
        ON rchat_dm_events (expires_at) WHERE expires_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS rchat_dm_expired_event_markers (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        sender_stream_id TEXT NOT NULL DEFAULT '',
        sender_seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        expired_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_expired_sender_cursor
        ON rchat_dm_expired_event_markers
          (conversation_id, sender_address, timestamp, event_id);
      CREATE TABLE IF NOT EXISTS rchat_dm_expiry_preferences (
        owner_address TEXT NOT NULL,
        peer_address TEXT NOT NULL,
        duration_ms INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_address, peer_address)
      );
    `);
  }

  /**
   * GO-only local state: when a verified own device (a home Hub) first pulled
   * an own pending event. Additive and nullable; nothing on the wire reads it.
   */
  private migrateDirectOwnDeviceCopiedSchema(): void {
    this.ensureColumn(
      'rchat_dm_events',
      'own_device_copied_at',
      `ALTER TABLE rchat_dm_events ADD COLUMN own_device_copied_at INTEGER`
    );
  }

  /**
   * GO-only local state: the pending-delivery sweep's attempt count and next
   * due time per own event, so a restart neither re-bursts tracked fanouts
   * nor forgets the slow tail. Additive and nullable; never on the wire.
   */
  private migrateDirectDeliveryRetrySchema(): void {
    this.ensureColumn(
      'rchat_dm_events',
      'delivery_attempts',
      `ALTER TABLE rchat_dm_events ADD COLUMN delivery_attempts INTEGER`
    );
    this.ensureColumn(
      'rchat_dm_events',
      'next_delivery_attempt_at',
      `ALTER TABLE rchat_dm_events ADD COLUMN next_delivery_attempt_at INTEGER`
    );
  }

  private migrateDirectExpiryQueueIndex(): void {
    this.db.exec(`
      DROP INDEX IF EXISTS idx_rchat_dm_events_expires;
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_expiry_queue
        ON rchat_dm_events (expires_at, event_id)
        WHERE expires_at IS NOT NULL;
    `);
  }

  private migrateDirectExpiryMarkerSequenceIndex(): void {
    this.db.exec(`
      DROP INDEX IF EXISTS idx_rchat_dm_expiry_preferences_owner;
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_expired_sender_seq
        ON rchat_dm_expired_event_markers
          (conversation_id, sender_address, sender_seq);
      CREATE INDEX IF NOT EXISTS idx_rchat_dm_events_expiry_target
        ON rchat_dm_events (target_event_id)
        WHERE target_event_id IS NOT NULL;
    `);
  }
}
