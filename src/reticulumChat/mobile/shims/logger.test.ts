import { describe, expect, it } from 'vitest';
import { createLogThrottle, logThrottleKey } from './logger';

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

  it('prunes the key map but still counts pruned suppressions', () => {
    const decide = createLogThrottle({ maxKeys: 4, global: 1 });
    for (let i = 0; i < 10; i++) {
      decide('log', [`[MobileChat] key_${i}`], i);
    }
    const { summary } = decide('log', ['[MobileChat] later'], 10_000);
    expect(summary).toMatch(/^\[MobileChat\] \(9 lines suppressed in 10s: /);
  });
});
