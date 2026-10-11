import { describe, expect, it } from 'vitest';

import { engineLogLineKey, isEngineFaultLine } from './engineLogFaults';

describe('engineLogFaults', () => {
  it('flags the stall watchdog lines as faults', () => {
    for (const line of [
      'warn [MobileChat] bridge_stall_diagnostic executor_stalled=true executor_idle_s=21.3 cmd_q=40/256 threads=63 stuck=none',
      'warn [MobileChat] bridge_thread_population threads=63 cpu_total=120 cpu_top=a:3 groups_top=b:2',
      'warn [MobileChat] bridge_executor_recovered error=',
      '2026-10-11T10:00:00.000Z warn [MobileChat] bridge_stall_diagnostic executor_stalled=false executor_idle_s=0 cmd_q=0/0 threads=0 stuck=none',
    ]) {
      expect(isEngineFaultLine(line)).toBe(true);
    }
  });

  it('does not take "install" for a stall', () => {
    expect(isEngineFaultLine('warn [MobileChat] engine install ok')).toBe(
      false
    );
    // A log-level watchdog line is not a fault (only warn/error are).
    expect(
      isEngineFaultLine('log [MobileChat] bridge_thread_population threads=63')
    ).toBe(false);
  });

  it('keeps the verdicts of the report predicate it was copied from', () => {
    const faults = [
      'warn [ReticulumChat] Group membership validation unavailable for group=694 address=QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG',
      'warn [ReticulumChat] Refusing history page group=694: reason=requester_membership_unavailable',
      'warn [ReticulumChat] Author gap repair paused group=36 reason=bridge-overloaded:dm page link preparation in flight',
      'log [ReticulumChat] event_page_imported group=1144 events=20 inserted=0 membership_deferred=3 more=false',
      '[ReticulumChat] Giving up event pull after 8 attempts',
    ];
    for (const line of faults) expect(isEngineFaultLine(line)).toBe(true);
    const quiet = [
      'log [ReticulumChat] background_author_gap_repair sent=1 skipped=15 scanned=16',
      'log [ReticulumChat] some_counter deferred=0',
      '2026-09-30T11:03:44.130Z warn [ReticulumChat] digest_send_slow duration_ms=714 queued_ms=160 queue_size=5 group=1152',
      '2026-09-30T11:03:43.177Z warn [ReticulumChat] digest_state_worker_fallback group=1152 reason=x attempt=1',
    ];
    for (const line of quiet) expect(isEngineFaultLine(line)).toBe(false);
  });

  it('blanks identifiers but keeps counters in the line key', () => {
    expect(
      engineLogLineKey(
        '2026-09-30T11:13:54.489Z warn [ReticulumChat] Refusing history page group=694 peer=492207ed7012af1e inserted=20'
      )
    ).toBe(
      'warn [ReticulumChat] Refusing history page group=* peer=* inserted=20'
    );
  });
});
