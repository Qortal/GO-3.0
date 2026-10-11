/**
 * GO's QDN publish window: the publishes Q-Apps ask GO for, and how far each
 * has got.
 *
 * A Q-App that publishes a big file usually covers itself with its own
 * progress window (qapp-core's "Publishing Status", Q-Share's list) until the
 * upload is done, which can take many minutes. Once a publish is big or slow,
 * GO takes it over: the frame helper (utils/qappPublishUi.ts) hides the app's
 * own window and GO shows its window in its place. GO's window shrinks into a
 * bubble, so the app can be used while the files go up. The app's window is
 * handed back when the publish ends, if the app still shows it (a failure to
 * retry, say).
 *
 * Only Q-App publishes are listed (an appInfo with a tab); GO's own screens
 * show their own progress.
 */
import { executeEvent } from '../../utils/events';
import {
  QDN_PUBLISH_CHUNK_BYTES,
  type PublishProgress,
} from './publishProgress';

/** From this size on GO takes a publish over at once (one part or more). */
export const PUBLISH_WINDOW_MIN_BYTES = QDN_PUBLISH_CHUNK_BYTES;
/** A smaller publish is taken over once it has been going this long. */
export const PUBLISH_WINDOW_SLOW_MS = 8_000;
/** How long GO waits to hear whether the app's own window was hidden. */
export const APP_WINDOW_ANSWER_MS = 400;
/** A publish that went through stays in the bubble this long, then leaves. */
export const PUBLISHED_LINGER_MS = 2_400;
/**
 * ...and this long in the open window, which covers the app: the app's own
 * window would have closed at once.
 */
export const PUBLISHED_LINGER_EXPANDED_MS = 1_200;
/** Speed is measured over the last this-many milliseconds. */
const SPEED_WINDOW_MS = 30_000;
/** ...and only once the samples span at least this long. */
const SPEED_MIN_SPAN_MS = 2_500;
/** Finished publishes kept at most (the window lists them until dismissed). */
const MAX_JOBS = 12;

/** GO → the Q-App frame (via AppViewer): hide or hand back its own window. */
export const QDN_PUBLISH_APP_WINDOW_EVENT = 'qdnPublishAppWindow';
export type AppWindowCommand = 'hide' | 'release';
export type AppWindowCommandDetail = {
  tabId: string;
  jobId: string;
  command: AppWindowCommand;
};

export type PublishRowState =
  | 'waiting'
  | 'preparing'
  | 'uploading'
  | 'processing'
  | 'published'
  | 'failed'
  | 'cancelled';

/** One resource of a publish. */
export type PublishRow = {
  service: string;
  /** File name, title or identifier: what the person would recognise. */
  label: string;
  /** 0 when GO cannot tell. */
  bytes: number;
  sentChunks: number;
  totalChunks: number;
  state: PublishRowState;
  /** A part or a node call failed and is about to be tried again. */
  retrying: boolean;
  error: string | null;
};

export type PublishJobOutcome =
  | 'running'
  | 'published'
  /** Some resources went through, some did not. */
  | 'partial'
  | 'failed'
  | 'cancelled';

/** What the frame helper did with the app's own window. */
export type AppWindowState = 'unknown' | 'hidden' | 'none';

export type PublishJob = {
  id: string;
  tabId: string;
  appName: string;
  appService: string | null;
  rows: PublishRow[];
  startedAt: number;
  finishedAt: number | null;
  outcome: PublishJobOutcome;
  /** GO's window (or bubble) took it over; small quick publishes never are. */
  shown: boolean;
  appWindow: AppWindowState;
  /** Bytes a second over the last half minute, or null until known. */
  speed: number | null;
};

/** closed: nothing on screen; minimized: the bubble. */
export type PublishWindowView = 'closed' | 'expanded' | 'minimized';

export type PublishWindowSnapshot = {
  jobs: PublishJob[];
  view: PublishWindowView;
};

export type PublishRowInput = {
  service: string;
  label: string;
  bytes: number;
};

let jobs: PublishJob[] = [];
let view: PublishWindowView = 'closed';
let snapshot: PublishWindowSnapshot = { jobs, view };
let seq = 0;
/** When the person last opened, minimized or dismissed the window. */
let lastUserToggle = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
const decided = new Set<string>();
const speedSamples = new Map<string, { at: number; bytes: number }[]>();

function emit(): void {
  snapshot = { jobs, view };
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* one listener never stops the others */
    }
  }
}

export function subscribePublishWindow(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPublishWindowSnapshot(): PublishWindowSnapshot {
  return snapshot;
}

const findJob = (jobId: string) => jobs.find((job) => job.id === jobId);

function patchJob(
  jobId: string,
  patch: (job: PublishJob) => Partial<PublishJob> | null
): PublishJob | null {
  let next: PublishJob | null = null;
  jobs = jobs.map((job) => {
    if (job.id !== jobId) return job;
    const change = patch(job);
    if (!change) return job;
    next = { ...job, ...change };
    return next;
  });
  return next;
}

function addTimer(jobId: string, timer: ReturnType<typeof setTimeout>): void {
  const list = timers.get(jobId) ?? [];
  list.push(timer);
  timers.set(jobId, list);
}

function clearTimers(jobId: string): void {
  for (const timer of timers.get(jobId) ?? []) clearTimeout(timer);
  timers.delete(jobId);
}

function forgetJob(jobId: string): void {
  clearTimers(jobId);
  decided.delete(jobId);
  speedSamples.delete(jobId);
}

/** Bytes of a row already on the node. */
export function rowSentBytes(row: PublishRow): number {
  if (
    row.state === 'processing' ||
    row.state === 'published' ||
    (row.totalChunks > 0 && row.sentChunks >= row.totalChunks)
  ) {
    return row.bytes;
  }
  if (row.state !== 'uploading' || row.totalChunks <= 0) return 0;
  return Math.min(row.bytes, row.sentChunks * QDN_PUBLISH_CHUNK_BYTES);
}

/** How much of a publish is on the node: bytes when known, else rows. */
export function publishJobProgress(job: PublishJob): {
  sentBytes: number;
  totalBytes: number;
  /** 0-1. */
  fraction: number;
} {
  const totalBytes = job.rows.reduce((sum, row) => sum + row.bytes, 0);
  const sentBytes = job.rows.reduce((sum, row) => sum + rowSentBytes(row), 0);
  if (totalBytes > 0) {
    return { sentBytes, totalBytes, fraction: sentBytes / totalBytes };
  }
  const settled = job.rows.filter(
    (row) => row.state === 'processing' || isRowFinal(row)
  ).length;
  return {
    sentBytes,
    totalBytes,
    fraction: job.rows.length ? settled / job.rows.length : 0,
  };
}

export const isRowFinal = (row: PublishRow): boolean =>
  row.state === 'published' ||
  row.state === 'failed' ||
  row.state === 'cancelled';

/**
 * Seconds left at the current speed, or null when there is no fair guess
 * (no speed yet, or every part is up and the node is processing).
 */
export function publishJobSecondsLeft(job: PublishJob): number | null {
  if (job.outcome !== 'running' || !job.speed || job.speed <= 0) return null;
  const { sentBytes, totalBytes } = publishJobProgress(job);
  const left = totalBytes - sentBytes;
  if (left <= 0) return null;
  return left / job.speed;
}

function sampleSpeed(jobId: string, now: number): number | null {
  const job = findJob(jobId);
  if (!job) return null;
  const { sentBytes } = publishJobProgress(job);
  const samples = speedSamples.get(jobId) ?? [];
  const last = samples[samples.length - 1];
  if (!last || last.bytes !== sentBytes)
    samples.push({ at: now, bytes: sentBytes });
  while (samples.length > 2 && now - samples[0].at > SPEED_WINDOW_MS) {
    samples.shift();
  }
  speedSamples.set(jobId, samples);
  const first = samples[0];
  const newest = samples[samples.length - 1];
  const span = newest.at - first.at;
  if (samples.length < 2 || span < SPEED_MIN_SPAN_MS) return job.speed;
  const speed = (newest.bytes - first.bytes) / (span / 1000);
  return speed > 0 ? speed : job.speed;
}

function computeOutcome(
  rows: PublishRow[],
  aborted: boolean
): PublishJobOutcome {
  if (aborted) return 'cancelled';
  const published = rows.filter((row) => row.state === 'published').length;
  if (published === rows.length) return 'published';
  return published > 0 ? 'partial' : 'failed';
}

function trimJobs(): void {
  if (jobs.length <= MAX_JOBS) return;
  const removable = jobs.filter((job) => job.outcome !== 'running');
  const drop = new Set(
    removable.slice(0, jobs.length - MAX_JOBS).map((job) => job.id)
  );
  for (const id of drop) forgetJob(id);
  jobs = jobs.filter((job) => !drop.has(job.id));
}

function shownJobs(): PublishJob[] {
  return jobs.filter((job) => job.shown);
}

/** Nothing left to show: the window (or bubble) goes. */
function closeIfEmpty(): void {
  if (shownJobs().length === 0) view = 'closed';
}

/**
 * GO's window or bubble takes the publish over: the app is asked to hide its
 * own window, and GO opens its window in that place if it did, or shows the
 * bubble if the app showed nothing GO could hide.
 */
function takeOver(jobId: string): void {
  const job = findJob(jobId);
  if (!job || job.shown || job.outcome !== 'running') return;
  patchJob(jobId, () => ({ shown: true }));
  emit();
  executeEvent(QDN_PUBLISH_APP_WINDOW_EVENT, {
    tabId: job.tabId,
    jobId,
    command: 'hide',
  } satisfies AppWindowCommandDetail);
  addTimer(
    jobId,
    setTimeout(() => decideView(jobId), APP_WINDOW_ANSWER_MS)
  );
}

function decideView(jobId: string): void {
  const job = findJob(jobId);
  if (!job || !job.shown || decided.has(jobId)) return;
  decided.add(jobId);
  // The person has just approved this publish, so its window opens where the
  // app's own one was; with nothing hidden the app is usable as it is, and
  // the bubble is enough.
  if (job.appWindow === 'hidden') view = 'expanded';
  else if (view === 'closed') view = 'minimized';
  emit();
}

/**
 * Starts listing a Q-App publish (after the person approved it). Small ones
 * stay off screen unless they turn out slow.
 */
export function beginPublishJob(
  input: {
    tabId: string;
    appName: string;
    appService?: string | null;
    rows: PublishRowInput[];
  },
  now = Date.now()
): string {
  seq += 1;
  const id = `publish-${now.toString(36)}-${seq}`;
  const job: PublishJob = {
    id,
    tabId: input.tabId,
    appName: input.appName,
    appService: input.appService ?? null,
    rows: input.rows.map((row) => ({
      service: row.service,
      label: row.label,
      bytes: Math.max(0, Number(row.bytes) || 0),
      sentChunks: 0,
      totalChunks: 0,
      state: 'waiting',
      retrying: false,
      error: null,
    })),
    startedAt: now,
    finishedAt: null,
    outcome: 'running',
    shown: false,
    appWindow: 'unknown',
    speed: null,
  };
  jobs = [...jobs, job];
  trimJobs();
  emit();
  const totalBytes = job.rows.reduce((sum, row) => sum + row.bytes, 0);
  if (totalBytes >= PUBLISH_WINDOW_MIN_BYTES) {
    takeOver(id);
  } else {
    addTimer(
      id,
      setTimeout(() => takeOver(id), PUBLISH_WINDOW_SLOW_MS)
    );
  }
  return id;
}

function patchRow(
  jobId: string,
  index: number,
  patch: (row: PublishRow) => Partial<PublishRow> | null
): boolean {
  let changed = false;
  patchJob(jobId, (job) => {
    const row = job.rows[index];
    if (!row || isRowFinal(row)) return null;
    const change = patch(row);
    if (!change) return null;
    changed = true;
    const rows = job.rows.slice();
    rows[index] = { ...row, ...change };
    return { rows };
  });
  return changed;
}

/** GO has started on resource `index` (reading or encrypting it first). */
export function notePublishRowStarted(jobId: string, index: number): void {
  if (
    patchRow(jobId, index, (row) =>
      row.state === 'waiting' ? { state: 'preparing' } : null
    )
  ) {
    emit();
  }
}

/** The file's size, once GO has it (a stashed file is resolved late). */
export function notePublishRowBytes(
  jobId: string,
  index: number,
  bytes: number
): void {
  const value = Math.max(0, Number(bytes) || 0);
  if (
    patchRow(jobId, index, (row) =>
      row.bytes === value ? null : { bytes: value }
    )
  ) {
    emit();
    const job = findJob(jobId);
    const totalBytes = job?.rows.reduce((sum, row) => sum + row.bytes, 0) ?? 0;
    if (job && !job.shown && totalBytes >= PUBLISH_WINDOW_MIN_BYTES) {
      takeOver(jobId);
    }
  }
}

export function notePublishProgress(
  jobId: string,
  index: number,
  progress: PublishProgress,
  now = Date.now()
): void {
  const changed = patchRow(jobId, index, (row) => {
    switch (progress.stage) {
      case 'uploading':
        return {
          state: 'uploading',
          sentChunks: Math.max(0, progress.sentChunks),
          totalChunks: Math.max(0, progress.totalChunks),
          retrying: false,
        };
      case 'processing':
        return {
          state: 'processing',
          sentChunks: Math.max(row.totalChunks, 1),
          totalChunks: Math.max(row.totalChunks, 1),
          retrying: false,
        };
      case 'retrying':
        return row.retrying ? null : { retrying: true };
      case 'published':
        return { state: 'published', retrying: false };
      default:
        return null;
    }
  });
  if (!changed) return;
  const speed = sampleSpeed(jobId, now);
  patchJob(jobId, (job) => (job.speed === speed ? null : { speed }));
  emit();
}

export function notePublishRowPublished(jobId: string, index: number): void {
  if (patchRow(jobId, index, () => ({ state: 'published', retrying: false }))) {
    emit();
  }
}

export function notePublishRowFailed(
  jobId: string,
  index: number,
  reason: string
): void {
  if (
    patchRow(jobId, index, () => ({
      state: 'failed',
      retrying: false,
      error: reason ? String(reason).slice(0, 300) : null,
    }))
  ) {
    emit();
  }
}

/**
 * The publish is over. A row nobody settled counts as failed (or cancelled
 * when the publish was stopped). A shown publish hands the app its own window
 * back; one that went through leaves the screen after a moment, one that did
 * not stays until dismissed.
 */
export function finishPublishJob(
  jobId: string,
  options: { aborted?: boolean } = {},
  now = Date.now()
): void {
  const job = findJob(jobId);
  if (!job || job.outcome !== 'running') return;
  clearTimers(jobId);
  const aborted = options.aborted === true;
  const rows = job.rows.map((row) =>
    isRowFinal(row)
      ? row
      : {
          ...row,
          state: (aborted ? 'cancelled' : 'failed') as PublishRowState,
          retrying: false,
        }
  );
  const outcome = computeOutcome(rows, aborted);
  if (!job.shown) {
    forgetJob(jobId);
    jobs = jobs.filter((item) => item.id !== jobId);
    emit();
    return;
  }
  patchJob(jobId, () => ({ rows, outcome, finishedAt: now, speed: null }));
  executeEvent(QDN_PUBLISH_APP_WINDOW_EVENT, {
    tabId: job.tabId,
    jobId,
    command: 'release',
  } satisfies AppWindowCommandDetail);
  if (!decided.has(jobId)) {
    decided.add(jobId);
    if (job.appWindow === 'hidden') view = 'expanded';
    else if (view === 'closed') view = 'minimized';
  }
  if (outcome === 'published') {
    addTimer(
      jobId,
      setTimeout(
        () => {
          forgetJob(jobId);
          jobs = jobs.filter((item) => item.id !== jobId);
          closeIfEmpty();
          emit();
        },
        view === 'expanded' ? PUBLISHED_LINGER_EXPANDED_MS : PUBLISHED_LINGER_MS
      )
    );
  }
  emit();
}

/**
 * The frame helper's answer to "hide": was there a window to hide? A window
 * the app drew late is hidden late; GO's window then still opens in its
 * place, unless the person has already opened or closed it themselves.
 */
export function noteAppWindow(
  jobId: string,
  state: 'hidden' | 'none',
  tabId?: string
): void {
  const job = findJob(jobId);
  // A frame answers for its own tab's publishes only.
  if (!job || job.appWindow === state) return;
  if (tabId !== undefined && job.tabId !== tabId) return;
  patchJob(jobId, () => ({ appWindow: state }));
  if (job.outcome !== 'running') {
    emit();
    return;
  }
  if (!decided.has(jobId)) {
    decideView(jobId);
    return;
  }
  if (
    state === 'hidden' &&
    view !== 'expanded' &&
    lastUserToggle < job.startedAt
  ) {
    view = 'expanded';
  }
  emit();
}

export function expandPublishWindow(): void {
  lastUserToggle = Date.now();
  if (view === 'expanded' || shownJobs().length === 0) return;
  view = 'expanded';
  emit();
}

export function minimizePublishWindow(): void {
  lastUserToggle = Date.now();
  if (view === 'minimized' || shownJobs().length === 0) return;
  view = 'minimized';
  emit();
}

/**
 * The person is done looking: finished publishes go, and a running one
 * carries on in the bubble.
 */
export function dismissPublishWindow(): void {
  lastUserToggle = Date.now();
  const finished = jobs.filter((job) => job.shown && job.outcome !== 'running');
  for (const job of finished) forgetJob(job.id);
  const gone = new Set(finished.map((job) => job.id));
  jobs = jobs.filter((job) => !gone.has(job.id));
  view = shownJobs().length ? 'minimized' : 'closed';
  emit();
}

/** Tests only. */
export function resetPublishWindowForTests(): void {
  for (const id of [...timers.keys()]) clearTimers(id);
  decided.clear();
  speedSamples.clear();
  lastUserToggle = 0;
  jobs = [];
  view = 'closed';
  snapshot = { jobs, view };
  listeners.clear();
}
