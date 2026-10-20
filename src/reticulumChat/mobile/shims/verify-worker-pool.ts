/**
 * Inline stand-in for `electron/src/verify-worker-pool` on mobile.
 *
 * Hub 3.0.3's call managers (call.ts, group-call.ts), hosted in GO's WebView
 * by src/bridge/hubCall, verify every CALL_* / GC_* signature through a
 * `VerifyWorkerPool`. There are no Node worker_threads on mobile, so this
 * runs the same `runEd25519VerifySync` the desktop pool falls back to when
 * its workers are busy or missing — identical results, on the calling thread
 * (noble Ed25519 through the crypto shim, ~1–3 ms per signature).
 *
 * Verification resolves on a later macrotask, never synchronously, like the
 * desktop worker round-trip: callers treat `verify()` as async and some keep
 * state ("in flight") that must exist before the result is applied.
 */
import {
  runEd25519VerifySync,
  type Ed25519VerifyPayload,
} from '../../../../electron/src/ed25519-verify-common';
// MessageChannel macrotask: not clamped/throttled like setTimeout(0) while
// the page is hidden during a call (src/bridge/hubCall/macrotask.ts).
import { sharedMacrotaskQueue } from '../../../bridge/hubCall/macrotask';

export function resolveEd25519WorkerPath(): string {
  return '/nonexistent/ed25519-verify.worker.js';
}

export class VerifyWorkerPool {
  private started = false;
  private verified = 0;
  private rejected = 0;

  constructor(
    private readonly label: string,
    _workerCount?: number,
    _maxPending?: number
  ) {}

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
  }

  verify(payload: Ed25519VerifyPayload): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      sharedMacrotaskQueue().set(() => {
        let ok = false;
        try {
          ok = runEd25519VerifySync(payload);
        } catch {
          ok = false;
        }
        if (ok) this.verified += 1;
        else this.rejected += 1;
        resolve(ok);
      });
    });
  }

  /** Diagnostics only (not part of the desktop API). */
  stats(): {
    label: string;
    started: boolean;
    verified: number;
    rejected: number;
  } {
    return {
      label: this.label,
      started: this.started,
      verified: this.verified,
      rejected: this.rejected,
    };
  }
}

export default VerifyWorkerPool;
