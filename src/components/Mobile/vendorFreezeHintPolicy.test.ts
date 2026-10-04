import { describe, expect, it } from 'vitest';
import type { VendorFreezeRecord } from '../../plugins/QortalBackground';
import {
  ACK_COOLDOWN_MS,
  CARD_TTL_MS,
  FREEZE_WINDOW_MS,
  MAX_BELL_NOTICES,
  acknowledgeUi,
  clampUiToClock,
  closeCardUi,
  decide,
  initialUiState,
  mergeFreezeEpisodes,
  parseUiState,
  recordCardShown,
  setDontShowAgainUi,
  significantFreezeEpisodes,
  type VendorFreezeFacts,
  type VendorFreezeHintUiState,
} from './vendorFreezeHintPolicy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

/** A freeze noticed at `at` after `gapMin` minutes frozen. */
const rec = (
  at: number,
  gapMin: number,
  extra: Partial<VendorFreezeRecord> = {}
): VendorFreezeRecord => ({
  at,
  gapMs: gapMin * MIN,
  ignoring: false,
  charging: true,
  ...extra,
});

/** Two separate, significant overnight freezes before `now`. */
const twoNights = (now = NOW, extra: Partial<VendorFreezeRecord> = {}) => [
  rec(now - 2 * DAY, 40, extra),
  rec(now - 1 * DAY, 40, extra),
];

const facts = (
  records: VendorFreezeRecord[],
  mode: VendorFreezeFacts['mode'] = 'charging'
): VendorFreezeFacts => ({ mode, records });

/** Migrated a month ago: no quiet time, nothing shown yet. */
const ui = (
  extra: Partial<VendorFreezeHintUiState> = {}
): VendorFreezeHintUiState => ({
  ...initialUiState(NOW - 30 * DAY),
  ...extra,
});

describe('mergeFreezeEpisodes', () => {
  it('merges a detection whose freeze began within 2 min of the previous one', () => {
    const first = rec(NOW - HOUR, 30);
    // Screen on for 2 min exactly, then frozen again for 20 min.
    const second = rec(first.at + 2 * MIN + 20 * MIN, 20);
    const episodes = mergeFreezeEpisodes([first, second]);
    expect(episodes).toEqual([
      {
        firstAt: first.at,
        lastAt: second.at,
        startAt: first.at - 30 * MIN,
        gapMs: 50 * MIN,
        maxGapMs: 30 * MIN,
        detections: 2,
        ignoring: false,
        charging: true,
      },
    ]);
  });

  it('keeps detections more than 2 min apart as separate episodes', () => {
    const first = rec(NOW - HOUR, 30);
    const second = rec(first.at + 2 * MIN + 1 + 20 * MIN, 20);
    expect(mergeFreezeEpisodes([first, second])).toHaveLength(2);
  });

  it('chains merges and compares with the previous detection, not the first', () => {
    const a = rec(NOW - 3 * HOUR, 10);
    const b = rec(a.at + MIN + 10 * MIN, 10);
    const c = rec(b.at + MIN + 10 * MIN, 10);
    const episodes = mergeFreezeEpisodes([c, a, b]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      firstAt: a.at,
      lastAt: c.at,
      gapMs: 30 * MIN,
      detections: 3,
    });
  });

  it('counts an episode as exempt or charging only when every detection was', () => {
    const a = rec(NOW - HOUR, 10, { ignoring: true, charging: true });
    const b = rec(a.at + 11 * MIN, 10, { ignoring: false, charging: false });
    expect(mergeFreezeEpisodes([a, b])[0]).toMatchObject({
      ignoring: false,
      charging: false,
    });
    const c = rec(NOW - HOUR, 10, { ignoring: true });
    const d = rec(c.at + 11 * MIN, 10, { ignoring: true });
    expect(mergeFreezeEpisodes([c, d])[0].ignoring).toBe(true);
  });

  it('drops malformed records', () => {
    expect(
      mergeFreezeEpisodes([
        { at: Number.NaN, gapMs: MIN, ignoring: false, charging: false },
        { at: NOW, gapMs: -1, ignoring: false, charging: false },
        null as unknown as VendorFreezeRecord,
      ])
    ).toEqual([]);
  });
});

describe('the 5-minute floor', () => {
  it('counts a freeze of 5 min or more, not one just under', () => {
    expect(significantFreezeEpisodes([rec(NOW, 5)])).toHaveLength(1);
    expect(
      significantFreezeEpisodes([{ ...rec(NOW, 5), gapMs: 5 * MIN - 1 }])
    ).toHaveLength(0);
  });

  it('applies the floor to each freeze, not to a merged sum', () => {
    // Two 3-min freezes, 1 min of screen-on between them: one episode,
    // 6 min frozen in total, but no single freeze reached 5 min.
    const a = rec(NOW - HOUR, 3);
    const b = rec(a.at + MIN + 3 * MIN, 3);
    expect(mergeFreezeEpisodes([a, b])).toHaveLength(1);
    expect(significantFreezeEpisodes([a, b])).toHaveLength(0);
  });

  it('counts a merged episode once one of its freezes reaches 5 min', () => {
    const a = rec(NOW - HOUR, 3);
    const b = rec(a.at + MIN + 6 * MIN, 6);
    const episodes = significantFreezeEpisodes([a, b]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      gapMs: 9 * MIN,
      maxGapMs: 6 * MIN,
      detections: 2,
    });
  });

  it('a desk charger glanced at every few minutes raises nothing', () => {
    // 4-min freezes with 1 min of screen-on between them, all afternoon,
    // on two days: two long chained episodes made of short freezes only.
    const day = (end: number) =>
      Array.from({ length: 40 }, (_, i) => rec(end - i * 5 * MIN, 4));
    const records = [...day(NOW - DAY), ...day(NOW - 2 * DAY)];
    expect(mergeFreezeEpisodes(records)).toHaveLength(2);
    const decision = decide(facts(records), ui(), NOW);
    expect(decision.bell).toBeNull();
    expect(decision.settings.variant).toBe('none');
  });

  it('shows nothing for short freezes, however many', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      rec(NOW - (i + 1) * 3 * HOUR, 4)
    );
    const decision = decide(facts(records), ui(), NOW);
    expect(decision.bell).toBeNull();
    expect(decision.settings).toEqual({
      episodes7d: 0,
      lastAt: null,
      variant: 'none',
    });
  });
});

describe('decide: a new bell notice', () => {
  it('appears after 2 significant episodes in the last 7 days', () => {
    const decision = decide(facts(twoNights()), ui(), NOW);
    expect(decision.bell).toEqual({
      episodes: 2,
      lastAt: NOW - DAY,
      since: NOW - FREEZE_WINDOW_MS,
      variant: 'fixable',
      shownAt: NOW,
      badge: true,
      isNew: true,
    });
    expect(decision.settings).toEqual({
      episodes7d: 2,
      lastAt: NOW - DAY,
      variant: 'fixable',
    });
  });

  it('needs 2 episodes: one is only shown in the settings', () => {
    const decision = decide(facts([rec(NOW - DAY, 40)]), ui(), NOW);
    expect(decision.bell).toBeNull();
    expect(decision.settings).toEqual({
      episodes7d: 1,
      lastAt: NOW - DAY,
      variant: 'fixable',
    });
  });

  it('treats merged detections as one episode', () => {
    const a = rec(NOW - DAY, 40);
    const b = rec(a.at + MIN + 40 * MIN, 40);
    expect(decide(facts([a, b]), ui(), NOW).bell).toBeNull();
  });

  it('counts only the last 7 days, inclusive', () => {
    const edge = [rec(NOW - FREEZE_WINDOW_MS, 40), rec(NOW - DAY, 40)];
    expect(decide(facts(edge), ui(), NOW).bell?.episodes).toBe(2);

    const outside = [rec(NOW - FREEZE_WINDOW_MS - 1, 40), rec(NOW - DAY, 40)];
    const decision = decide(facts(outside), ui(), NOW);
    expect(decision.bell).toBeNull();
    expect(decision.settings.episodes7d).toBe(1);
  });

  it('counts only episodes after the last acknowledgement', () => {
    const records = twoNights();
    const ackBetween = ui({ ackAt: NOW - 1.5 * DAY });
    expect(decide(facts(records), ackBetween, NOW).bell).toBeNull();
    // The settings still show both.
    expect(decide(facts(records), ackBetween, NOW).settings.episodes7d).toBe(2);
  });

  it('shows nothing at all with background sync off', () => {
    const decision = decide(facts(twoNights(), 'off'), ui(), NOW);
    expect(decision).toEqual({
      bell: null,
      settings: { episodes7d: 0, lastAt: null, variant: 'none' },
    });
    expect(decide(null, ui(), NOW).bell).toBeNull();
  });

  it('shows nothing new once "Don\'t show again" is ticked; the settings still do', () => {
    const decision = decide(
      facts(twoNights()),
      ui({ dontShowAgain: true }),
      NOW
    );
    expect(decision.bell).toBeNull();
    expect(decision.settings.variant).toBe('fixable');
  });

  it(`stops after ${MAX_BELL_NOTICES} notices on this install`, () => {
    expect(
      decide(facts(twoNights()), ui({ shownCount: 2 }), NOW).bell?.isNew
    ).toBe(true);
    expect(
      decide(facts(twoNights()), ui({ shownCount: MAX_BELL_NOTICES }), NOW).bell
    ).toBeNull();
  });
});

describe('decide: after an acknowledgement', () => {
  const ACK = NOW - 20 * DAY;
  const acked = (extra: Partial<VendorFreezeHintUiState> = {}) =>
    acknowledgeUi(
      ui({ cardShownAt: ACK - HOUR, shownCount: 1, ...extra }),
      ACK
    );

  it('stays quiet for 14 days, even with new episodes', () => {
    const at = ACK + ACK_COOLDOWN_MS - 1;
    const records = twoNights(at);
    expect(decide(facts(records), acked(), at).bell).toBeNull();
    expect(decide(facts(records), acked(), at).settings.episodes7d).toBe(2);
  });

  it('comes back after 14 days with 2 new episodes', () => {
    const at = ACK + ACK_COOLDOWN_MS;
    const bell = decide(facts(twoNights(at)), acked(), at).bell;
    expect(bell).toMatchObject({ isNew: true, badge: true, episodes: 2 });
  });

  it('needs 2 new episodes: 1 is not enough', () => {
    const at = ACK + ACK_COOLDOWN_MS;
    const records = [rec(ACK - DAY, 40), rec(at - DAY, 40)];
    expect(decide(facts(records), acked(), at).bell).toBeNull();
    expect(decide(facts(records), acked(), at).settings.episodes7d).toBe(1);
  });

  it('needs the 2 new episodes inside the last 7 days', () => {
    const at = ACK + ACK_COOLDOWN_MS;
    const records = [rec(at - 9 * DAY, 40), rec(at - DAY, 40)];
    expect(decide(facts(records), acked(), at).bell).toBeNull();
  });
});

describe('decide: already exempt', () => {
  it('shows no bell notice when 2 counted episodes were exempt, and says so in the settings', () => {
    const decision = decide(
      facts(twoNights(NOW, { ignoring: true })),
      ui(),
      NOW
    );
    expect(decision.bell).toBeNull();
    expect(decision.settings).toEqual({
      episodes7d: 2,
      lastAt: NOW - DAY,
      variant: 'exempt_still_frozen',
    });
  });

  it('never claims restrictions are off while GO is not exempt now', () => {
    const decision = decide(
      { ...facts(twoNights(NOW, { ignoring: true })), ignoringNow: false },
      ui(),
      NOW
    );
    // The bell rule looks at the episodes only.
    expect(decision.bell).toBeNull();
    expect(decision.settings.variant).toBe('fixable');
    expect(
      decide(
        { ...facts(twoNights(NOW, { ignoring: true })), ignoringNow: true },
        ui(),
        NOW
      ).settings.variant
    ).toBe('exempt_still_frozen');
  });

  it('still shows the notice when only 1 counted episode was exempt', () => {
    const records = [
      rec(NOW - 3 * DAY, 40),
      rec(NOW - 2 * DAY, 40, { ignoring: true }),
      rec(NOW - DAY, 40),
    ];
    const decision = decide(facts(records), ui(), NOW);
    expect(decision.bell).toMatchObject({ isNew: true, variant: 'fixable' });
    expect(decision.settings.variant).toBe('fixable');
  });

  it('only weighs counted episodes: exempt ones before the acknowledgement do not block', () => {
    const records = [
      rec(NOW - 6 * DAY, 40, { ignoring: true }),
      rec(NOW - 5 * DAY, 40, { ignoring: true }),
      rec(NOW - 2 * DAY, 40),
      rec(NOW - DAY, 40),
    ];
    const decision = decide(facts(records), ui({ ackAt: NOW - 4 * DAY }), NOW);
    expect(decision.bell?.isNew).toBe(true);
    // The settings look at the whole week.
    expect(decision.settings.variant).toBe('exempt_still_frozen');
  });
});

describe('decide: the card on the bell panel', () => {
  const SHOWN = NOW - DAY / 2;
  const shown = (extra: Partial<VendorFreezeHintUiState> = {}) => ({
    ...recordCardShown(ui(), SHOWN),
    ...extra,
  });

  it('records the card: shown at, count, not closed', () => {
    expect(recordCardShown(ui({ cardClosed: true }), SHOWN)).toMatchObject({
      cardShownAt: SHOWN,
      cardClosed: false,
      shownCount: 1,
    });
  });

  it('keeps showing the recorded card, with its badge until acknowledged', () => {
    const records = twoNights(SHOWN);
    const bell = decide(facts(records), shown(), NOW).bell;
    expect(bell).toEqual({
      episodes: 2,
      lastAt: SHOWN - DAY,
      since: SHOWN - FREEZE_WINDOW_MS,
      variant: 'fixable',
      shownAt: SHOWN,
      badge: true,
      isNew: false,
    });
  });

  it('acknowledging clears the badge but keeps the card', () => {
    const state = acknowledgeUi(shown(), NOW - HOUR);
    const bell = decide(facts(twoNights(SHOWN)), state, NOW).bell;
    expect(bell).toMatchObject({ badge: false, isNew: false, shownAt: SHOWN });
  });

  it('X removes it, and the quiet time keeps a new one away', () => {
    const state = closeCardUi(shown(), NOW - HOUR);
    const records = [...twoNights(SHOWN), ...twoNights(NOW)];
    expect(decide(facts(records), state, NOW).bell).toBeNull();
  });

  it('ticking "Don\'t show again" keeps the card readable', () => {
    const state = setDontShowAgainUi(shown(), true, NOW - HOUR);
    const bell = decide(facts(twoNights(SHOWN)), state, NOW).bell;
    expect(bell).toMatchObject({ badge: false, isNew: false });
  });

  it('expires 7 days after it appeared', () => {
    const records = twoNights(SHOWN);
    const state = acknowledgeUi(shown(), SHOWN + HOUR);
    expect(
      decide(facts(records), state, SHOWN + CARD_TTL_MS - 1).bell
    ).not.toBeNull();
    expect(decide(facts(records), state, SHOWN + CARD_TTL_MS).bell).toBeNull();
  });

  it('an unacknowledged card that expired can be followed by a new one', () => {
    const at = SHOWN + CARD_TTL_MS + DAY;
    const bell = decide(facts(twoNights(at)), shown(), at).bell;
    expect(bell).toMatchObject({ isNew: true, shownAt: at });
  });

  it('counts later episodes too, and turns honest once 2 of them were exempt', () => {
    const records = [
      ...twoNights(SHOWN),
      rec(NOW - 3 * HOUR, 40, { ignoring: true }),
      rec(NOW - HOUR, 40, { ignoring: true }),
    ];
    const bell = decide(facts(records), shown(), NOW).bell;
    expect(bell).toMatchObject({
      episodes: 4,
      lastAt: NOW - HOUR,
      variant: 'exempt_still_frozen',
      isNew: false,
    });
  });

  it('goes away when the freezes it explained are gone', () => {
    expect(decide(facts([]), shown(), NOW).bell).toBeNull();
  });

  it('hides with background sync off', () => {
    expect(
      decide(facts(twoNights(SHOWN), 'off'), shown(), NOW).bell
    ).toBeNull();
  });
});

describe('migration from the always-on hint', () => {
  const UPDATED = NOW - 3 * DAY;

  it('starts counting at the update, without a quiet time', () => {
    const state = initialUiState(UPDATED);
    expect(state).toEqual({
      ackAt: UPDATED,
      cooldownFrom: null,
      shownCount: 0,
      dontShowAgain: false,
      cardShownAt: null,
      cardClosed: false,
    });
    // Freezes from before the update do not count.
    const before = [rec(UPDATED - 2 * DAY, 40), rec(UPDATED - DAY, 40)];
    expect(decide(facts(before), state, NOW).bell).toBeNull();
    // Two after it do, right away.
    const after = [
      ...before,
      rec(UPDATED + DAY, 40),
      rec(UPDATED + 2 * DAY, 40),
    ];
    expect(decide(facts(after), state, NOW).bell).toMatchObject({
      isNew: true,
      episodes: 4,
    });
  });
});

describe('UI state transitions', () => {
  it('acknowledging starts the quiet time', () => {
    expect(acknowledgeUi(ui(), NOW)).toMatchObject({
      ackAt: NOW,
      cooldownFrom: NOW,
    });
  });

  it('unticking only turns the notices back on', () => {
    const ticked = setDontShowAgainUi(ui(), true, NOW - DAY);
    expect(ticked).toMatchObject({
      dontShowAgain: true,
      ackAt: NOW - DAY,
      cooldownFrom: NOW - DAY,
    });
    expect(setDontShowAgainUi(ticked, false, NOW)).toEqual({
      ...ticked,
      dontShowAgain: false,
    });
  });

  it('parses a stored state and rejects junk', () => {
    const state = recordCardShown(acknowledgeUi(ui(), NOW - DAY), NOW);
    expect(parseUiState(JSON.stringify(state))).toEqual(state);
    expect(parseUiState(state)).toEqual(state);
    expect(parseUiState('not json')).toBeNull();
    expect(parseUiState('[]')).toBeNull();
    expect(parseUiState(null)).toBeNull();
    expect(
      parseUiState({
        ackAt: 'soon',
        cooldownFrom: -5,
        shownCount: 2.7,
        dontShowAgain: 'yes',
        cardShownAt: Number.NaN,
        cardClosed: 1,
      })
    ).toEqual({
      ackAt: null,
      cooldownFrom: null,
      shownCount: 2,
      dontShowAgain: false,
      cardShownAt: null,
      cardClosed: false,
    });
  });
});

describe('stored times ahead of the clock', () => {
  it('count as now, so a fixed clock cannot silence the notice for months', () => {
    // Acknowledged while the clock ran 30 days ahead, then corrected.
    const wrong = ui({ ackAt: NOW + 30 * DAY, cooldownFrom: NOW + 30 * DAY });
    const clamped = clampUiToClock(wrong, NOW);
    expect(clamped).toMatchObject({ ackAt: NOW, cooldownFrom: NOW });
    // Freezes before the correction were acknowledged ...
    expect(decide(facts(twoNights()), wrong, NOW).bell).toBeNull();
    // ... and the quiet time runs 14 days from the correction, not from the
    // wrong date: two new nights after it raise a card.
    const later = NOW + ACK_COOLDOWN_MS + 2 * DAY;
    const records = [...twoNights(), ...twoNights(later)];
    expect(decide(facts(records), clamped, later).bell).toMatchObject({
      isNew: true,
    });
    // decide alone clamps to each new `now`, so the quiet time would seem to
    // start again on every read: the store must persist the clamp once.
    expect(decide(facts(records), wrong, NOW + 20 * DAY).bell).toBeNull();
  });

  it('a card stamped in the future expires 7 days from now', () => {
    const state = ui({
      cardShownAt: NOW + 60 * DAY,
      ackAt: NOW - 30 * DAY,
      shownCount: 1,
    });
    expect(clampUiToClock(state, NOW).cardShownAt).toBe(NOW);
    expect(decide(facts(twoNights()), state, NOW).bell).toMatchObject({
      shownAt: NOW,
      isNew: false,
    });
    expect(
      decide(facts(twoNights()), clampUiToClock(state, NOW), NOW + CARD_TTL_MS)
        .bell
    ).toBeNull();
  });

  it('leaves a state with nothing ahead untouched (same object)', () => {
    const state = acknowledgeUi(ui(), NOW);
    expect(clampUiToClock(state, NOW)).toBe(state);
  });
});

describe('a vivo on the charger every night', () => {
  it('shows at most one card per quiet time and 3 in total', () => {
    const installed = NOW - 120 * DAY;
    let state = initialUiState(installed);
    const records: VendorFreezeRecord[] = [];
    const cards: number[] = [];
    for (let day = 1; day <= 110; day++) {
      const morning = installed + day * DAY;
      records.push(rec(morning, 6 * 60));
      const decision = decide(facts(records.slice(-20)), state, morning);
      if (decision.bell?.isNew) {
        state = recordCardShown(state, morning);
        cards.push(day);
        // The user reads it later that day.
        state = acknowledgeUi(state, morning + HOUR);
      }
    }
    expect(cards).toEqual([2, 17, 32]);
    expect(state.shownCount).toBe(3);
  });
});
