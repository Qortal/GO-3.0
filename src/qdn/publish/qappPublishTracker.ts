/**
 * What get.ts tells GO's publish window about a Q-App's publish (see
 * publishJobs.ts). Every call is safe to make on a null tracker, and none of
 * them may break the publish itself.
 */
import {
  beginPublishJob,
  finishPublishJob,
  notePublishProgress,
  notePublishRowBytes,
  notePublishRowFailed,
  notePublishRowPublished,
  notePublishRowStarted,
  type PublishRowInput,
} from './publishJobs';
import { isNodeApiKeyRequiredError } from './nodeAnswer';
import type { PublishProgress } from './publishProgress';

export type QappPublishTracker = {
  rowStarted: (index: number) => void;
  /** Size of a file GO resolved late (a stashed file). */
  rowBytes: (index: number, bytes: number) => void;
  /** For publishData's onProgress. */
  progressFor: (index: number) => (progress: PublishProgress) => void;
  rowPublished: (index: number) => void;
  /** `cause`: the error behind a `reason` given as text, when there is one. */
  rowFailed: (index: number, reason: unknown, cause?: unknown) => void;
  finish: (options?: { aborted?: boolean }) => void;
};

type PublishResourceLike = {
  service?: unknown;
  identifier?: unknown;
  filename?: unknown;
  title?: unknown;
  file?: unknown;
  blob?: unknown;
  data64?: unknown;
  base64?: unknown;
};

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Size of what a resource sends, as far as GO can tell before sending it. */
export function publishResourceBytes(resource: PublishResourceLike): number {
  const file = resource?.file ?? resource?.blob;
  if (typeof Blob !== 'undefined' && file instanceof Blob) return file.size;
  const base64 = text(resource?.data64) || text(resource?.base64);
  return base64 ? Math.floor((base64.length * 3) / 4) : 0;
}

/** The name a person would recognise: the file name, else title or identifier. */
export function publishResourceLabel(resource: PublishResourceLike): string {
  const file = resource?.file ?? resource?.blob;
  // Not `instanceof File`: cordova-plugin-file replaces the global File, so
  // real files fail that check (see get.ts).
  const fileName =
    typeof Blob !== 'undefined' && file instanceof Blob
      ? text((file as { name?: unknown }).name)
      : '';
  return (
    text(resource?.filename) ||
    fileName ||
    text(resource?.title) ||
    text(resource?.identifier) ||
    text(resource?.service) ||
    'QDN'
  ).slice(0, 200);
}

/**
 * A tracker for a publish a Q-App asked for, or null for GO's own publishes
 * (no tab: GO's screens show their own progress).
 */
export function startQappPublishTracker(
  appInfo: unknown,
  resources: PublishResourceLike[]
): QappPublishTracker | null {
  const info = (appInfo ?? {}) as {
    tabId?: unknown;
    name?: unknown;
    service?: unknown;
    internal?: unknown;
  };
  const tabId = text(info.tabId);
  if (!tabId || info.internal === true || !Array.isArray(resources)) {
    return null;
  }
  let jobId: string;
  try {
    const rows: PublishRowInput[] = resources.map((resource) => ({
      service: text(resource?.service) || 'FILE',
      label: publishResourceLabel(resource),
      bytes: publishResourceBytes(resource),
    }));
    jobId = beginPublishJob({
      tabId,
      appName: text(info.name) || 'Q-App',
      appService: text(info.service) || null,
      rows,
    });
  } catch {
    return null;
  }
  const safe =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      try {
        fn(...args);
      } catch {
        /* the window must never break a publish */
      }
    };
  return {
    rowStarted: safe((index: number) => notePublishRowStarted(jobId, index)),
    rowBytes: safe((index: number, bytes: number) =>
      notePublishRowBytes(jobId, index, bytes)
    ),
    progressFor: (index: number) =>
      safe((progress: PublishProgress) =>
        notePublishProgress(jobId, index, progress)
      ),
    rowPublished: safe((index: number) =>
      notePublishRowPublished(jobId, index)
    ),
    rowFailed: safe((index: number, reason: unknown, cause?: unknown) =>
      notePublishRowFailed(
        jobId,
        index,
        typeof reason === 'string'
          ? reason
          : reason instanceof Error
            ? reason.message
            : '',
        { needsNodeKey: isNodeApiKeyRequiredError(cause ?? reason) }
      )
    ),
    finish: safe((options?: { aborted?: boolean }) =>
      finishPublishJob(jobId, options)
    ),
  };
}
