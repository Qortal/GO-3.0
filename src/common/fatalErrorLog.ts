/**
 * Android's logcat and Chromium's console buffer both rotate within minutes on
 * a busy device, so a crash that happens deep into a session leaves no trace by
 * the time anyone looks at it. Keep the last few fatal errors in localStorage
 * so they survive until the app is opened again.
 */

const STORAGE_KEY = 'qgo:fatal-errors';
const MAX_ENTRIES = 8;

export type FatalErrorKind = 'render' | 'error' | 'unhandledrejection';

export type FatalErrorRecord = {
  at: string;
  kind: FatalErrorKind;
  message: string;
  stack?: string;
  componentStack?: string;
};

export function readFatalErrors(): FatalErrorRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordFatalError(
  kind: FatalErrorKind,
  error: unknown,
  componentStack?: string
): void {
  try {
    const err = error instanceof Error ? error : null;
    const record: FatalErrorRecord = {
      at: new Date().toISOString(),
      kind,
      message: err?.message ?? String(error).slice(0, 300),
      stack: err?.stack?.slice(0, 4000),
      componentStack: componentStack?.slice(0, 4000),
    };
    const next = [record, ...readFatalErrors()].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — the console log below is the fallback */
  }
}

let installed = false;

/** Catches the failures that never reach a React error boundary. */
export function installFatalErrorRecorder(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => {
    recordFatalError('error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    recordFatalError('unhandledrejection', event.reason);
  });
}
