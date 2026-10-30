/**
 * When GO tells the user that the phone's own battery manager froze it (the
 * "GO was stopped in the background" notice). Pure: native records the
 * freezes (BackgroundKeepAlive / VendorFreezeLog, up to 50), this decides
 * what the bell panel and the Background sync settings show;
 * vendorFreezeHintStore.ts feeds it and persists the UI state.
 *
 * The rules, so a real but intermittent vendor freeze (vivo's fast_freezer
 * on a charger) does not nag on every return:
 * - a freeze counts only if GO was frozen for 5 min or more in one go;
 * - a detection whose freeze began within 2 min of the previous detection
 *   continues that episode (screen briefly on, then off and frozen again);
 *   an episode counts when at least one of its freezes does, so chained
 *   short freezes (a phone glanced at every few minutes) never count;
 * - the bell notice needs 2+ such episodes in the last 7 days, all after the
 *   last acknowledgement, background sync not 'off', no "Don't show again"
 *   tick, and fewer than 3 notices shown on this install;
 * - after an acknowledgement it can come back only 14 days later, and only
 *   with 2+ new episodes;
 * - no notice when 2+ of those episodes happened while GO was already exempt
 *   from battery optimisation (nothing left for the user to switch; the
 *   settings say so instead);
 * - a shown card stays (the steps must still be readable after a trip to the
 *   phone's settings) until X or 7 days after it appeared;
 * - stored times ahead of the clock (set while the clock was wrong) count as
 *   now, so a clock fixed later cannot silence the notice for months.
 */
import type { VendorFreezeRecord } from '../../plugins/QortalBackground';
import type { BackgroundSyncMode } from './backgroundSync';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A single freeze shorter than this is not worth a notice. */
const SIGNIFICANT_FREEZE_MS = 5 * MINUTE_MS;
/** Max screen-on time between two detections of one episode. */
const EPISODE_MERGE_MS = 2 * MINUTE_MS;
/** The window episodes are counted in. */
export const FREEZE_WINDOW_MS = 7 * DAY_MS;
/** Episodes needed for a bell notice, and new ones after an acknowledgement. */
const BELL_MIN_EPISODES = 2;
/** Quiet time after an acknowledgement. */
export const ACK_COOLDOWN_MS = 14 * DAY_MS;
/** Bell notices per install, ever. */
export const MAX_BELL_NOTICES = 3;
/** A card leaves the bell panel this long after it appeared. */
export const CARD_TTL_MS = 7 * DAY_MS;
/** Episodes while exempt that show the exemption does not help. */
const EXEMPT_MIN_EPISODES = 2;

type VendorFreezeEpisode = {
  /** `at` of the first detection (screen back on after the first freeze). */
  firstAt: number;
  /** `at` of the last detection. */
  lastAt: number;
  /** When the first freeze began (`at - gapMs`). */
  startAt: number;
  /** Frozen time, summed over the episode's detections. */
  gapMs: number;
  /** The longest single freeze; the episode counts when it is 5 min+. */
  maxGapMs: number;
  detections: number;
  /** GO was exempt from battery optimisation during every detection. */
  ignoring: boolean;
  /** The phone was charging during every detection. */
  charging: boolean;
};

export type VendorFreezeFacts = {
  mode: BackgroundSyncMode;
  /** Native's vendorFreezeRecent; any order. */
  records: readonly VendorFreezeRecord[];
  /**
   * GO is exempt now. When false, 'exempt_still_frozen' ("restrictions are
   * already off") would be untrue, so the variant stays 'fixable'.
   */
  ignoringNow?: boolean;
};

/** Persisted per install (vendorFreezeHintStore.ts). */
export type VendorFreezeHintUiState = {
  /** Last acknowledgement; only episodes after it count for a new notice. */
  ackAt: number | null;
  /** Start of the 14-day quiet time; null when none runs (fresh install). */
  cooldownFrom: number | null;
  /** Bell notices shown on this install. */
  shownCount: number;
  /** The "Don't show again" tick: no new bell notice. */
  dontShowAgain: boolean;
  /** When the current (or last) bell card appeared. */
  cardShownAt: number | null;
  /** The current card was closed with X. */
  cardClosed: boolean;
};

type VendorFreezeVariant = 'fixable' | 'exempt_still_frozen' | 'none';

export type VendorFreezeBell = {
  /** Significant episodes since `since`. */
  episodes: number;
  /** The newest of them. */
  lastAt: number;
  /** 7 days before the card appeared: the window `episodes` covers. */
  since: number;
  /** 'exempt_still_frozen' once 2+ of the card's episodes were exempt. */
  variant: Exclude<VendorFreezeVariant, 'none'>;
  /** When the card appeared (now, for a new card). */
  shownAt: number;
  /** Counts in the bell badge: not acknowledged since it appeared. */
  badge: boolean;
  /** A new card: the store records it (cardShownAt, shownCount). */
  isNew: boolean;
};

export type VendorFreezeSettings = {
  /** Significant episodes in the last 7 days, acknowledged or not. */
  episodes7d: number;
  lastAt: number | null;
  variant: VendorFreezeVariant;
};

type VendorFreezeDecision = {
  bell: VendorFreezeBell | null;
  settings: VendorFreezeSettings;
};

const NO_SETTINGS: VendorFreezeSettings = {
  episodes7d: 0,
  lastAt: null,
  variant: 'none',
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Detections grouped into episodes, oldest first. A detection whose freeze
 * began (`at - gapMs`) no later than 2 min after the previous detection's
 * `at` continues that episode.
 */
export const mergeFreezeEpisodes = (
  records: readonly VendorFreezeRecord[]
): VendorFreezeEpisode[] => {
  const sorted = records
    .filter(
      (record) =>
        record && finite(record.at) && finite(record.gapMs) && record.gapMs >= 0
    )
    .slice()
    .sort((a, b) => a.at - b.at);
  const episodes: VendorFreezeEpisode[] = [];
  for (const record of sorted) {
    const startAt = record.at - record.gapMs;
    const previous = episodes[episodes.length - 1];
    if (previous && startAt - previous.lastAt <= EPISODE_MERGE_MS) {
      previous.lastAt = record.at;
      previous.gapMs += record.gapMs;
      previous.maxGapMs = Math.max(previous.maxGapMs, record.gapMs);
      previous.detections += 1;
      previous.ignoring = previous.ignoring && record.ignoring === true;
      previous.charging = previous.charging && record.charging === true;
      continue;
    }
    episodes.push({
      firstAt: record.at,
      lastAt: record.at,
      startAt,
      gapMs: record.gapMs,
      maxGapMs: record.gapMs,
      detections: 1,
      ignoring: record.ignoring === true,
      charging: record.charging === true,
    });
  }
  return episodes;
};

/**
 * Episodes with at least one freeze of 5 min or more. Short freezes still
 * join an episode (so they cannot split one in two), but never make one
 * count on their own, however many are chained.
 */
export const significantFreezeEpisodes = (
  records: readonly VendorFreezeRecord[]
): VendorFreezeEpisode[] =>
  mergeFreezeEpisodes(records).filter(
    (episode) => episode.maxGapMs >= SIGNIFICANT_FREEZE_MS
  );

const newestAt = (episodes: readonly VendorFreezeEpisode[]): number =>
  episodes.reduce((max, episode) => Math.max(max, episode.lastAt), -Infinity);

const exemptCount = (episodes: readonly VendorFreezeEpisode[]): number =>
  episodes.filter((episode) => episode.ignoring).length;

const variantOf = (
  episodes: readonly VendorFreezeEpisode[],
  ignoringNow: boolean | undefined
): Exclude<VendorFreezeVariant, 'none'> =>
  exemptCount(episodes) >= EXEMPT_MIN_EPISODES && ignoringNow !== false
    ? 'exempt_still_frozen'
    : 'fixable';

/** The card on the bell panel right now, if one is still up. */
const currentCard = (
  significant: readonly VendorFreezeEpisode[],
  ui: VendorFreezeHintUiState,
  now: number,
  ignoringNow: boolean | undefined
): VendorFreezeBell | null => {
  const shownAt = ui.cardShownAt;
  if (!finite(shownAt) || ui.cardClosed) return null;
  if (now - shownAt >= CARD_TTL_MS) return null;
  const since = shownAt - FREEZE_WINDOW_MS;
  const episodes = significant.filter((episode) => episode.lastAt >= since);
  // Native's records were cleared (app data wiped): nothing left to explain.
  if (episodes.length === 0) return null;
  return {
    episodes: episodes.length,
    lastAt: newestAt(episodes),
    since,
    variant: variantOf(episodes, ignoringNow),
    shownAt,
    badge: !(finite(ui.ackAt) && ui.ackAt >= shownAt),
    isNew: false,
  };
};

/** A new card, when every rule allows one. */
const newCard = (
  recent: readonly VendorFreezeEpisode[],
  ui: VendorFreezeHintUiState,
  now: number
): VendorFreezeBell | null => {
  if (ui.dontShowAgain) return null;
  if (ui.shownCount >= MAX_BELL_NOTICES) return null;
  if (finite(ui.cooldownFrom) && now - ui.cooldownFrom < ACK_COOLDOWN_MS) {
    return null;
  }
  const counted = recent.filter(
    (episode) => !finite(ui.ackAt) || episode.firstAt > ui.ackAt
  );
  if (counted.length < BELL_MIN_EPISODES) return null;
  // Already exempt and still frozen: nothing the notice could fix.
  if (exemptCount(counted) >= EXEMPT_MIN_EPISODES) return null;
  return {
    episodes: recent.length,
    lastAt: newestAt(recent),
    since: now - FREEZE_WINDOW_MS,
    variant: 'fixable',
    shownAt: now,
    badge: true,
    isNew: true,
  };
};

/**
 * What the bell panel and the Background sync settings show. `bell.isNew`
 * asks the caller to record the card (`recordCardShown`) and decide again.
 */
export const decide = (
  facts: VendorFreezeFacts | null,
  ui: VendorFreezeHintUiState,
  now: number
): VendorFreezeDecision => {
  if (!facts || facts.mode === 'off') {
    return { bell: null, settings: NO_SETTINGS };
  }
  ui = clampUiToClock(ui, now);
  const significant = significantFreezeEpisodes(facts.records ?? []);
  const recent = significant.filter(
    (episode) => episode.lastAt >= now - FREEZE_WINDOW_MS
  );
  const settings: VendorFreezeSettings =
    recent.length === 0
      ? NO_SETTINGS
      : {
          episodes7d: recent.length,
          lastAt: newestAt(recent),
          variant: variantOf(recent, facts.ignoringNow),
        };
  const bell =
    currentCard(significant, ui, now, facts.ignoringNow) ??
    newCard(recent, ui, now) ??
    null;
  return { bell, settings };
};

// ── UI state transitions ─────────────────────────────────────────────────────

/**
 * Stored times ahead of `now` were written while the clock was wrong (a
 * first-boot clock, a manual change corrected later). Taken as is, they would
 * hide every freeze, or keep the quiet time running, until the real date
 * passes them. They count as `now` instead: the acknowledgement or card did
 * happen, just not when the clock said. Returns `ui` itself when nothing was
 * ahead, so the store persists only a real change.
 */
export const clampUiToClock = (
  ui: VendorFreezeHintUiState,
  now: number
): VendorFreezeHintUiState => {
  const ahead = (value: number | null) => finite(value) && value > now;
  if (!ahead(ui.ackAt) && !ahead(ui.cooldownFrom) && !ahead(ui.cardShownAt)) {
    return ui;
  }
  return {
    ...ui,
    ackAt: ahead(ui.ackAt) ? now : ui.ackAt,
    cooldownFrom: ahead(ui.cooldownFrom) ? now : ui.cooldownFrom,
    cardShownAt: ahead(ui.cardShownAt) ? now : ui.cardShownAt,
  };
};

/**
 * First run of this code (also after the update from the old always-on
 * hint): only freezes from now on count, and no quiet time runs. The old
 * native pending flag and count are ignored.
 */
export const initialUiState = (now: number): VendorFreezeHintUiState => ({
  ackAt: now,
  cooldownFrom: null,
  shownCount: 0,
  dontShowAgain: false,
  cardShownAt: null,
  cardClosed: false,
});

/** Clears the badge and starts the 14-day quiet time. Keeps the card up. */
export const acknowledgeUi = (
  ui: VendorFreezeHintUiState,
  now: number
): VendorFreezeHintUiState => ({ ...ui, ackAt: now, cooldownFrom: now });

/** X on the card: acknowledges and takes the card off the bell panel. */
export const closeCardUi = (
  ui: VendorFreezeHintUiState,
  now: number
): VendorFreezeHintUiState => ({ ...acknowledgeUi(ui, now), cardClosed: true });

/** Ticking acknowledges; unticking only turns the notices back on. */
export const setDontShowAgainUi = (
  ui: VendorFreezeHintUiState,
  value: boolean,
  now: number
): VendorFreezeHintUiState =>
  value
    ? { ...acknowledgeUi(ui, now), dontShowAgain: true }
    : { ...ui, dontShowAgain: false };

/** A new card appeared (decide returned `bell.isNew`). */
export const recordCardShown = (
  ui: VendorFreezeHintUiState,
  now: number
): VendorFreezeHintUiState => ({
  ...ui,
  cardShownAt: now,
  cardClosed: false,
  shownCount: ui.shownCount + 1,
});

const finiteOrNull = (value: unknown): number | null =>
  finite(value) && value > 0 ? value : null;

/** A stored state, checked field by field; null when it is not one. */
export const parseUiState = (raw: unknown): VendorFreezeHintUiState | null => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stored = value as Partial<
    Record<keyof VendorFreezeHintUiState, unknown>
  >;
  const shownCount = Number(stored.shownCount);
  return {
    ackAt: finiteOrNull(stored.ackAt),
    cooldownFrom: finiteOrNull(stored.cooldownFrom),
    shownCount:
      Number.isFinite(shownCount) && shownCount > 0
        ? Math.floor(shownCount)
        : 0,
    dontShowAgain: stored.dontShowAgain === true,
    cardShownAt: finiteOrNull(stored.cardShownAt),
    cardClosed: stored.cardClosed === true,
  };
};
