/**
 * Small in-memory record of the most recent chat send failures.
 *
 * The message queue only logs a failed send to the console, which a phone
 * user cannot see. Keeping the last few reasons here lets the Reticulum
 * diagnostics report (top-bar badge > Copy diagnostics) include them, so a
 * screenshot or pasted report says *why* a message "failed to send".
 */
export type SendFailureRecord = {
  at: number;
  target: string;
  attempts: number;
  error: string;
};

const MAX_RECORDS = 20;
const records: SendFailureRecord[] = [];

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

export function recordSendFailure(
  target: unknown,
  attempts: number,
  error: unknown
): SendFailureRecord {
  const record: SendFailureRecord = {
    at: Date.now(),
    target: String(target ?? ''),
    attempts,
    error: describeSendError(error),
  };
  records.push(record);
  if (records.length > MAX_RECORDS) {
    records.splice(0, records.length - MAX_RECORDS);
  }
  return record;
}

export function getRecentSendFailures(): SendFailureRecord[] {
  return [...records];
}

export function clearSendFailuresForTests(): void {
  records.length = 0;
}
