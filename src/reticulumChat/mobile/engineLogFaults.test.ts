import { describe, expect, it } from 'vitest';

import {
  bootFaultRepeatKey,
  engineLogLineKey,
  isEngineFaultLine,
} from './engineLogFaults';

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

  it('flags the worker storage lines as faults', () => {
    for (const line of [
      '2026-10-19T13:06:59.216Z warn [mobile-fs] handle_top_up_stuck batch_ms=31000 spares=0; starting another',
      'warn [mobile-fs] slot_open_failed failed=32 of=32 error=TooManyOpenHandles',
      'warn [mobile-fs] dropped 52 stale blobs to stay under 2048 open handles',
      'warn inbound resource staging failed code=EMFILE error=EMFILE: no spare OPFS handles',
    ]) {
      expect(isEngineFaultLine(line)).toBe(true);
    }
    // Routine boot housekeeping is logged, not a fault.
    expect(
      isEngineFaultLine('log [mobile-fs] boot_dropped_disposable files=3080')
    ).toBe(false);
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

  it('flags skipped or refused channel metadata as faults', () => {
    for (const line of [
      'warn [ReticulumChat] channel_metadata_projection_skipped event=abc group=694 type=channel_create author=QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG reason=author_not_group_admin decision=core author_role=other',
      'warn [ReticulumChat] metadata_snapshot_ignored group=694 peer=492207ed7012af1e hash=0011 scope=full signer=Q reason=metadata_snapshot_non_admin',
      'warn [ReticulumChat] metadata_snapshot_rejected group=694 reason=full_snapshot_admin_required',
    ]) {
      expect(isEngineFaultLine(line)).toBe(true);
    }
    // Only warn/error lines count, as before.
    expect(
      isEngineFaultLine(
        'info [ReticulumChat] metadata_snapshot_request_ignored group=694 reason=full_snapshot_admin_required'
      )
    ).toBe(false);
  });

  it('keys per-event fault lines by kind and group for the boot buffer', () => {
    expect(
      bootFaultRepeatKey(
        'warn [ReticulumChat] channel_metadata_projection_skipped event=abc group=694 type=channel_create'
      )
    ).toBe('channel_metadata_projection_skipped|694');
    expect(
      bootFaultRepeatKey(
        'warn [ReticulumChat] channel_metadata_projection_deferred event=x group=12 reason=admin_validation_unavailable'
      )
    ).toBe('channel_metadata_projection_deferred|12');
    expect(
      bootFaultRepeatKey(
        'warn [sqlite-wasm] slow_statement ms=400 sql=SELECT 1'
      )
    ).toBe('slow_statement|');
    expect(
      bootFaultRepeatKey('warn [ReticulumChat] Refusing history page group=1')
    ).toBeNull();
    // OPFS handle pool retries repeat until OPFS recovers.
    for (const kind of [
      'slot_open_failed',
      'handle_top_up_stuck',
      'handle_top_up_failed',
      'index_persist_failed',
    ]) {
      expect(bootFaultRepeatKey(`warn [mobile-fs] ${kind} error=x`)).toBe(
        `${kind}|`
      );
    }
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
