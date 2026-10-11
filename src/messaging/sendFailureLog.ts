/**
 * Small in-memory record of the most recent chat send failures.
 *
 * The message queue only logs a failed send to the console, which a phone
 * user cannot see. Keeping the last few reasons here lets the Reticulum
 * diagnostics report (top-bar badge > Copy diagnostics) include them, so a
 * screenshot or pasted report says *why* a message "failed to send".
 */
/** One send attempt: how long it took and why it failed (null = it went through). */
export type SendAttemptRecord = {
  ms: number;
  error: string | null;
  /** The engine already had this exact event stored (an earlier attempt landed). */
  duplicate?: boolean;
};

export type SendFailureRecord = {
  at: number;
  target: string;
  attempts: number;
  error: string;
  /** 'recovered': an earlier attempt failed and a later one went through. Absent = all attempts failed. */
  outcome?: 'failed' | 'recovered';
  /** Every attempt in order: its duration and why it failed (null = it went through). */
  attemptLog?: SendAttemptRecord[];
};

const MAX_RECORDS = 20;
/** Recovered sends kept among MAX_RECORDS; failures are never evicted for them. */
const MAX_RECOVERED_RECORDS = 5;
const MAX_ATTEMPTS_KEPT = 5;
const MAX_TIMINGS = 20;
const records: SendFailureRecord[] = [];
const timings: number[] = [];

/** Turn whatever a send rejected with into one readable line. */
export function describeSendError(error: unknown): string {
  let text: string;
  if (error instanceof Error) text = error.message || error.name;
  else if (typeof error === 'string') text = error;
  else if (error && typeof error === 'object') {
    const maybe = error as { error?: unknown; message?: unknown };
    if (typeof maybe.error === 'string') text = maybe.error;
    else if (typeof maybe.message === 'string') text = maybe.message;
    else {
      try {
        text = JSON.stringify(error);
      } catch {
        text = String(error);
      }
    }
  } else text = String(error ?? 'unknown error');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function normalizeAttempts(
  log?: SendAttemptRecord[]
): SendAttemptRecord[] | undefined {
  if (!Array.isArray(log) || log.length === 0) return undefined;
  return log.slice(-MAX_ATTEMPTS_KEPT).map((attempt) => ({
    ms: Math.max(0, Math.round(Number(attempt?.ms) || 0)),
    error: attempt?.error === null ? null : describeSendError(attempt?.error),
    ...(attempt?.duplicate ? { duplicate: true } : {}),
  }));
}

function push(record: SendFailureRecord): SendFailureRecord {
  records.push(record);
  if (record.outcome === 'recovered') {
    // Retries that went through must not push the real failures out of the
    // list (the report prints the last 10): keep only the newest few.
    let recovered = records.filter((r) => r.outcome === 'recovered').length;
    for (let i = 0; recovered > MAX_RECOVERED_RECORDS && i < records.length; ) {
      if (records[i].outcome === 'recovered') {
        records.splice(i, 1);
        recovered -= 1;
      } else {
        i += 1;
      }
    }
  }
  if (records.length > MAX_RECORDS) {
    records.splice(0, records.length - MAX_RECORDS);
  }
  return record;
}

export function recordSendFailure(
  target: unknown,
  attempts: number,
  error: unknown,
  attemptLog?: SendAttemptRecord[]
): SendFailureRecord {
  const log = normalizeAttempts(attemptLog);
  return push({
    at: Date.now(),
    target: String(target ?? ''),
    attempts,
    error: describeSendError(error),
    ...(log ? { attemptLog: log } : {}),
  });
}

/**
 * A send that failed at least once and then went through on a retry. Kept in
 * the same list as failures so the report shows what the user waited through.
 */
export function recordSendRecovered(
  target: unknown,
  attempts: number,
  attemptLog: SendAttemptRecord[]
): SendFailureRecord {
  const log = normalizeAttempts(attemptLog) ?? [];
  const lastFailure = [...log]
    .reverse()
    .find((attempt) => attempt.error !== null);
  return push({
    at: Date.now(),
    target: String(target ?? ''),
    attempts,
    error: lastFailure?.error ?? '',
    outcome: 'recovered',
    attemptLog: log,
  });
}

/** Time from a send's first attempt to its success, for the last MAX_TIMINGS sends. */
export function recordSendTiming(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  timings.push(Math.round(ms));
  if (timings.length > MAX_TIMINGS) {
    timings.splice(0, timings.length - MAX_TIMINGS);
  }
}

export function getRecentSendTimings(): number[] {
  return [...timings];
}

export function getRecentSendFailures(): SendFailureRecord[] {
  return [...records];
}

export function clearSendFailuresForTests(): void {
  records.length = 0;
  timings.length = 0;
}
