/**
 * Recent renderer errors for Copy diagnostics: every error a React error
 * boundary caught (a chat row's "Invalid Data", the shell), the ones React
 * redrew past by itself, and the uncaught ones.
 *
 * Memory only, at most APP_ERROR_RING_MAX entries, repeats folded into one
 * entry with a count. The report is pasted publicly, so an entry holds no
 * content: messages pass the report's URL/API-key redaction, quoted text is
 * dropped (engines quote the value they choke on: JSON.parse quotes its
 * input), the length is capped, and stack frames keep only bundle
 * file:line:col (mappable with the build's source maps). The report adds its
 * pseudonyms on top.
 */
import { redactDiagnosticText } from '../reticulumChat/mobile/groupValidation';
import {
  readFatalErrors,
  type FatalErrorRecord,
} from '../common/fatalErrorLog';

type AppErrorKind = 'caught' | 'uncaught' | 'recovered';

export type AppErrorEntry = {
  firstAt: number;
  lastAt: number;
  count: number;
  /** Times a boundary drew its children again after catching this error. */
  healed: number;
  kind: AppErrorKind;
  boundary: string;
  name: string;
  message: string;
  frames: string[];
  components: string[];
  shape: string;
};

type AppErrorInput = {
  kind: AppErrorKind;
  error: unknown;
  componentStack?: string | null;
  boundary?: string;
  shape?: string;
};

export type AppErrorDiagnostics = {
  recent: AppErrorEntry[];
  fatal: FatalErrorRecord[];
};

export const APP_ERROR_RING_MAX = 20;
export const APP_ERROR_MESSAGE_MAX = 160;

const SHAPE_MAX = 400;
const FRAME_MAX = 3;
const COMPONENT_MAX = 4;
const REPORT_RECENT_MAX = 10;
const REPORT_FATAL_MAX = 5;

/** 'filter', 'senderName', '👍' stay; sentences go. */
const SINGLE_QUOTED_KEEP_RE = /^[^\s']{1,24}$/;
const IDENT_RE = /^[\w$.<>-]{1,40}$/;
const V8_FRAME_RE =
  /^\s*at\s+(?:(?:async\s+)?(?:new\s+)?(\S+)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME_RE = /^\s*([^@\s]*)@(.+?):(\d+):(\d+)\s*$/;

const entries: AppErrorEntry[] = [];
const entryByError = new WeakMap<object, AppErrorEntry>();
/**
 * React's onCaughtError and the boundary's own onCatch report the same error
 * back to back; the second call adds to the first entry instead of counting
 * again.
 */
let lastRecorded: { error: object; entry: AppErrorEntry } | null = null;

const clip = (text: string, max: number): string => {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
};

export function scrubAppErrorText(
  text: unknown,
  max = APP_ERROR_MESSAGE_MAX
): string {
  let out = redactDiagnosticText(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  out = out
    .replace(/"[^"]*"/g, '"…"')
    .replace(/`[^`]*`/g, '`…`')
    .replace(/'([^']*)'/g, (match, inner: string) =>
      SINGLE_QUOTED_KEEP_RE.test(inner) ? match : "'…'"
    );
  return clip(out, max);
}

const fileOf = (path: string): string =>
  path.split(/[?#]/)[0].split(/[\\/]/).pop() || '?';

const frameOf = (line: string): string | null => {
  const match = V8_FRAME_RE.exec(line) ?? GECKO_FRAME_RE.exec(line);
  if (!match) return null;
  const [, fn, path, row, col] = match;
  return `${fn && IDENT_RE.test(fn) ? `${fn}@` : ''}${fileOf(path)}:${row}:${col}`;
};

/** Bundle `fn@file:line:col` frames from an error stack, never a URL. */
export function stackFrames(stack: unknown, max = FRAME_MAX): string[] {
  if (typeof stack !== 'string') return [];
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    const frame = frameOf(line);
    if (frame) out.push(frame);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Component names from a React component stack, with bundle file:line:col
 * when the line has one (prod names are minified).
 */
export function componentNames(
  componentStack: unknown,
  max = COMPONENT_MAX
): string[] {
  if (typeof componentStack !== 'string') return [];
  const out: string[] = [];
  for (const line of componentStack.split('\n')) {
    const frame = /\(/.test(line) ? frameOf(line) : null;
    const name = /^\s*(?:at\s+)?([A-Za-z_$][\w$.]*)/.exec(line)?.[1];
    if (frame) out.push(frame);
    else if (name && IDENT_RE.test(name)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

const describeError = (
  error: unknown
): { name: string; message: string; stack: unknown } => {
  if (error && typeof error === 'object') {
    const value = error as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
    return {
      name:
        typeof value.name === 'string' && IDENT_RE.test(value.name)
          ? value.name
          : 'Error',
      message: scrubAppErrorText(value.message),
      stack: value.stack,
    };
  }
  return {
    name: `thrown ${typeof error}`,
    message: scrubAppErrorText(error),
    stack: undefined,
  };
};

const keyOf = (
  entry: Pick<
    AppErrorEntry,
    'kind' | 'boundary' | 'name' | 'message' | 'frames'
  >
): string =>
  `${entry.kind}|${entry.boundary}|${entry.name}|${entry.message}|${entry.frames[0] ?? ''}`;

/** Keeps a scrubbed record of a renderer error. Never throws. */
export function recordAppError(input: AppErrorInput, now = Date.now()): void {
  try {
    const { error } = input;
    const isObject = Boolean(error) && typeof error === 'object';
    if (isObject && lastRecorded?.error === error) {
      // Second report of the same catch (root hook, then the boundary).
      const entry = lastRecorded.entry;
      lastRecorded = null;
      if (input.boundary && !entry.boundary) entry.boundary = input.boundary;
      if (input.shape) entry.shape = clip(input.shape, SHAPE_MAX);
      if (!entry.components.length) {
        entry.components = componentNames(input.componentStack);
      }
      return;
    }
    const { name, message, stack } = describeError(error);
    const draft = {
      kind: input.kind,
      boundary: input.boundary ?? '',
      name,
      message,
      frames: stackFrames(stack),
    };
    const key = keyOf(draft);
    const index = entries.findIndex((entry) => keyOf(entry) === key);
    let entry: AppErrorEntry;
    if (index >= 0) {
      entry = entries[index];
      entries.splice(index, 1);
      entry.count += 1;
      entry.lastAt = now;
      if (input.shape) entry.shape = clip(input.shape, SHAPE_MAX);
    } else {
      entry = {
        ...draft,
        firstAt: now,
        lastAt: now,
        count: 1,
        healed: 0,
        components: componentNames(input.componentStack),
        shape: input.shape ? clip(input.shape, SHAPE_MAX) : '',
      };
    }
    // The array stays ordered by lastAt.
    entries.push(entry);
    if (entries.length > APP_ERROR_RING_MAX) {
      entries.splice(0, entries.length - APP_ERROR_RING_MAX);
    }
    if (isObject) {
      entryByError.set(error as object, entry);
      lastRecorded = { error: error as object, entry };
    } else {
      lastRecorded = null;
    }
  } catch {
    /* diagnostics must never break the app */
  }
}

/**
 * A boundary drew its children again after catching `error`
 * (ErrorBoundary.componentDidUpdate).
 */
export function noteAppErrorHealed(error: unknown): void {
  try {
    if (!error || typeof error !== 'object') return;
    const entry = entryByError.get(error);
    if (!entry) return;
    entry.healed += 1;
    entryByError.delete(error);
  } catch {
    /* diagnostics must never break the app */
  }
}

/** Oldest first; copies, so callers cannot change the ring. */
export function getRecentAppErrors(): AppErrorEntry[] {
  return entries.map((entry) => ({
    ...entry,
    frames: [...entry.frames],
    components: [...entry.components],
  }));
}

export function collectAppErrorDiagnostics(): AppErrorDiagnostics {
  return { recent: getRecentAppErrors(), fatal: readFatalErrors() };
}

export function clearAppErrorsForTests(): void {
  entries.length = 0;
  lastRecorded = null;
}

const iso = (at: unknown): string => {
  try {
    return new Date(Number(at)).toISOString();
  } catch {
    return String(at);
  }
};

/** Lines under the report's '--- Recent app errors ---' heading. Never throws. */
export function formatAppErrorLines(
  diag: AppErrorDiagnostics | null | undefined
): string[] {
  try {
    const lines: string[] = [];
    const recent = (Array.isArray(diag?.recent) ? diag.recent : [])
      .filter((entry) => entry && typeof entry === 'object')
      .slice(-REPORT_RECENT_MAX);
    if (!recent.length) {
      lines.push('This session: none');
    } else {
      lines.push('This session, newest last:');
      for (const entry of recent) {
        const repeat =
          entry.count > 1 ? `, ${entry.count}x until ${iso(entry.lastAt)}` : '';
        const healed = entry.healed > 0 ? `, healed ${entry.healed}x` : '';
        const where = entry.boundary ? ` in ${entry.boundary}` : '';
        lines.push(
          `${iso(entry.firstAt)} ${entry.kind}${where}${repeat}${healed}: ${entry.name}: ${entry.message || '(no message)'}`
        );
        if (entry.frames?.length) {
          lines.push(`  at ${entry.frames.join(' < ')}`);
        }
        if (entry.components?.length) {
          lines.push(`  components: ${entry.components.join(' < ')}`);
        }
        if (entry.shape) lines.push(`  row: ${entry.shape}`);
      }
    }
    const fatal = (Array.isArray(diag?.fatal) ? diag.fatal : [])
      .filter((record) => record && typeof record === 'object')
      .slice(0, REPORT_FATAL_MAX);
    if (!fatal.length) {
      lines.push('Saved crash log: none');
    } else {
      lines.push('Saved crash log (kept across restarts), newest first:');
      for (const record of fatal) {
        lines.push(
          `${scrubAppErrorText(record.at ?? '?', 40)} ${scrubAppErrorText(record.kind ?? '?', 24)}: ${scrubAppErrorText(record.message)}`
        );
        const frames = stackFrames(record.stack);
        if (frames.length) lines.push(`  at ${frames.join(' < ')}`);
        const names = componentNames(record.componentStack);
        if (names.length) lines.push(`  components: ${names.join(' < ')}`);
      }
    }
    return lines;
  } catch {
    return ['App errors: not available'];
  }
}
