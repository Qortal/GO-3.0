import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLoggerForTests,
  createLogThrottle,
  getBootFaultLogs,
  getBootFaultOverflow,
  getLogKeyCounts,
  getRecentLogs,
  log,
  logThrottleKey,
  warn,
} from './logger';

describe('mobile worker log capture', () => {
  beforeEach(() => {
    __resetLoggerForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetLoggerForTests();
  });

  it('keeps fault lines in the boot buffer, not timing noise', () => {
    warn('[ReticulumChat] digest_send_slow duration_ms=714');
    expect(getBootFaultLogs()).toEqual([]);
    warn('[ReticulumChat] Refusing history page group=1: reason=x');
    expect(getBootFaultLogs()).toHaveLength(1);
    expect(getBootFaultLogs()[0]).toMatch(
      /^\d{4}-\d\d-\d\dT\S+ warn \[ReticulumChat\] Refusing history page group=1: reason=x$/
    );
    // Both still reach the recent ring.
    expect(getRecentLogs()).toHaveLength(2);
  });

  it('keeps a log-level line with a non-zero membership deferral', () => {
    log('[ReticulumChat] event_page_imported membership_deferred=0');
    log('[ReticulumChat] event_page_imported membership_deferred=3');
    expect(getBootFaultLogs()).toHaveLength(1);
    expect(getBootFaultLogs()[0]).toContain('membership_deferred=3');
  });

  it('counts the fault lines a full boot buffer could not keep', () => {
    for (let i = 0; i < 151; i++) {
      warn(`[ReticulumChat] Refusing history page group=${i}: reason=x`);
    }
    expect(getBootFaultLogs()).toHaveLength(150);
    expect(getBootFaultOverflow()).toBe(1);
  });

  it('counts lines per key since boot, without values', () => {
    for (let i = 0; i < 3; i++) {
      log(`[ReticulumChat] background_author_gap_repair sent=${i}`);
    }
    warn('[ReticulumChat] digest_repair_slow duration_ms=9000');
    const counts = getLogKeyCounts();
    expect(counts).toHaveLength(2);
    expect(counts[0]).toMatchObject({
      key: 'log:background_author_gap_repair',
      n: 3,
    });
    expect(counts[0].lastAt).toBeGreaterThanOrEqual(counts[0].firstAt);
    expect(counts[1]).toMatchObject({ key: 'warn:digest_repair_slow', n: 1 });
  });

  it('caps the key map and sums the rest into "other"', () => {
    for (let i = 0; i < 300; i++) log(`[ReticulumChat] event_${i}_seen x=1`);
    const counts = getLogKeyCounts(1_000);
    expect(counts).toHaveLength(257);
    expect(counts[counts.length - 1]).toEqual({
      key: 'other',
      n: 44,
      firstAt: 0,
      lastAt: 0,
    });
    expect(getLogKeyCounts(40)).toHaveLength(41);
  });
});

describe('mobile worker log throttle', () => {
  it('keys engine lines by event name, not by the shared prefix', () => {
    expect(
      logThrottleKey('log', [
        '[MobileChat]',
        '[ReticulumChat] dm_pending_redeliver event=abc attempt=1',
      ])
    ).toBe('log:dm_pending_redeliver');
    expect(
      logThrottleKey('log', ['[MobileChat]', '[ReticulumChat] dm_page_reject'])
    ).toBe('log:dm_page_reject');
    expect(
      logThrottleKey('warn', ['[MobileChat] bridge socket connect failed', {}])
    ).toBe('warn:bridge socket connect');
    expect(
      logThrottleKey('warn', ['[MobileChat] Failed to send 3 items'])
    ).toBe('warn:Failed to send');
    expect(logThrottleKey('error', ['[MobileChat]', new Error('x')])).toBe(
      'error:[MobileChat]'
    );
  });

  it('gives distinct events separate budgets under a global ceiling', () => {
    const decide = createLogThrottle();
    const line = (name: string) => [
      '[MobileChat]',
      `[ReticulumChat] ${name} attempt=1`,
    ];
    let emitted = 0;
    for (let i = 0; i < 8; i++) {
      if (decide('log', line('noisy_event'), 1_000 + i).emit) emitted++;
    }
    expect(emitted).toBe(5);
    // A different event is not swallowed by the noisy one's budget.
    expect(decide('log', line('dm_pending_redeliver'), 1_010).emit).toBe(true);
    // Global ceiling: 15 lines per window across all keys.
    for (let i = 0; i < 20; i++) {
      if (decide('log', line(`event_${i}`), 1_020 + i).emit) emitted++;
    }
    expect(emitted).toBe(5 + 9);
  });

  it('reports suppressed lines lazily on the next call after the window', () => {
    const decide = createLogThrottle();
    for (let i = 0; i < 8; i++) {
      decide('warn', ['[MobileChat]', '[ReticulumChat] noisy_event'], i);
    }
    const next = decide(
      'log',
      ['[MobileChat]', '[ReticulumChat] other'],
      10_000
    );
    expect(next.emit).toBe(true);
    expect(next.summary).toBe(
      '[MobileChat] (3 lines suppressed in 10s: warn:noisy_event=3)'
    );
    // Nothing further to report in the following window.
    expect(
      decide('log', ['[MobileChat]', '[ReticulumChat] other'], 20_000).summary
    ).toBeNull();
  });

  it('never throttles DM page serve outcomes, nor counts them', () => {
    const decide = createLogThrottle();
    const dmLine = (name: string, i: number) => [
      '[MobileChat]',
      `[ReticulumChat] ${name} conversation=abc transfer=t${i} auth_ms=3`,
    ];
    let dmEmitted = 0;
    for (let i = 0; i < 40; i++) {
      for (const name of [
        'dm_page_link_authorized',
        'dm_page_link_delivered',
        'dm_page_link_delivery_failed',
        'dm_page_link_skipped',
      ]) {
        if (decide('log', dmLine(name, i), 1_000 + i).emit) dmEmitted++;
      }
    }
    expect(dmEmitted).toBe(160);
    // Other lines still get their full budgets in the same window.
    let other = 0;
    for (let i = 0; i < 20; i++) {
      if (
        decide(
          'log',
          ['[MobileChat]', `[ReticulumChat] event_${i % 4} x=1`],
          1_100 + i
        ).emit
      )
        other++;
    }
    expect(other).toBe(15);
    // A similar but different event name is throttled as usual.
    let page = 0;
    for (let i = 0; i < 8; i++) {
      if (
        decide(
          'warn',
          ['[MobileChat]', '[ReticulumChat] dm_page_reject'],
          1_200 + i
        ).emit
      )
        page++;
    }
    expect(page).toBe(0);
    // Nothing exempt shows up in the suppression summary.
    const next = decide('log', ['[MobileChat]', '[ReticulumChat] x'], 20_000);
    expect(next.summary).not.toContain('dm_page_link_');
  });

  it('prunes the key map but still counts pruned suppressions', () => {
    const decide = createLogThrottle({ maxKeys: 4, global: 1 });
    for (let i = 0; i < 10; i++) {
      decide('log', [`[MobileChat] key_${i}`], i);
    }
    const { summary } = decide('log', ['[MobileChat] later'], 10_000);
    expect(summary).toMatch(/^\[MobileChat\] \(9 lines suppressed in 10s: /);
  });
});
