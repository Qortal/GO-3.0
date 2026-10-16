import type { TFunction } from 'i18next';
import {
  isRowFinal,
  publishJobProgress,
  type PublishJob,
  type PublishJobOutcome,
  type PublishRow,
} from '../../qdn/publish/publishJobs';
import { formatTransferBytes } from '../../utils/qdnDownloadNotifications';

/** Several publishes at once read as one: the worst outcome, or running. */
export function combinedOutcome(jobs: PublishJob[]): PublishJobOutcome {
  if (jobs.some((job) => job.outcome === 'running')) return 'running';
  if (jobs.some((job) => job.outcome === 'failed')) return 'failed';
  if (jobs.some((job) => job.outcome === 'partial')) return 'partial';
  if (jobs.some((job) => job.outcome === 'cancelled')) return 'cancelled';
  return 'published';
}

/** Bytes (or rows) of the publishes still running, or of all when none is. */
export function combinedProgress(jobs: PublishJob[]): {
  sentBytes: number;
  totalBytes: number;
  fraction: number;
} {
  const running = jobs.filter((job) => job.outcome === 'running');
  const counted = running.length ? running : jobs;
  if (!counted.length) return { sentBytes: 0, totalBytes: 0, fraction: 0 };
  let sentBytes = 0;
  let totalBytes = 0;
  let fractionSum = 0;
  for (const job of counted) {
    const progress = publishJobProgress(job);
    sentBytes += progress.sentBytes;
    totalBytes += progress.totalBytes;
    fractionSum += job.outcome === 'running' ? progress.fraction : 1;
  }
  const fraction =
    totalBytes > 0 && counted.every((job) => publishJobProgress(job).totalBytes)
      ? sentBytes / totalBytes
      : fractionSum / counted.length;
  return {
    sentBytes,
    totalBytes,
    fraction: Math.max(0, Math.min(1, fraction)),
  };
}

/** Every part is up and nothing failed yet: the node is building the file. */
export function isProcessing(jobs: PublishJob[]): boolean {
  const running = jobs.filter((job) => job.outcome === 'running');
  if (!running.length) return false;
  return (
    running.every((job) =>
      job.rows.every((row) => isRowFinal(row) || row.state === 'processing')
    ) &&
    running.some((job) => job.rows.some((row) => row.state === 'processing'))
  );
}

export function isRetrying(jobs: PublishJob[]): boolean {
  return jobs.some(
    (job) => job.outcome === 'running' && job.rows.some((row) => row.retrying)
  );
}

/** A publish stopped because the node needs its API key. */
export function needsNodeKey(jobs: PublishJob[]): boolean {
  return jobs.some(
    (job) =>
      job.outcome !== 'running' && job.rows.some((row) => row.needsNodeKey)
  );
}

export function windowTitle(outcome: PublishJobOutcome, t: TFunction): string {
  switch (outcome) {
    case 'published':
      return t('core:qdn_publish.title_published');
    case 'partial':
      return t('core:qdn_publish.title_partial');
    case 'failed':
      return t('core:qdn_publish.title_failed');
    case 'cancelled':
      return t('core:qdn_publish.title_cancelled');
    case 'running':
    default:
      return t('core:qdn_publish.title_publishing');
  }
}

export function percentText(fraction: number, t: TFunction): string {
  return t('core:qdn_publish.percent', {
    percent: Math.floor(Math.max(0, Math.min(1, fraction)) * 100),
  });
}

/** "about 3 min left", or null without a fair guess. */
export function timeLeftText(
  seconds: number | null,
  t: TFunction
): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 60) return t('core:qdn_publish.time_left_under_minute');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return t('core:qdn_publish.time_left_minutes', { count: minutes });
  }
  return t('core:qdn_publish.time_left_hours', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

export function speedText(speed: number | null, t: TFunction): string | null {
  if (!speed || speed <= 0 || !Number.isFinite(speed)) return null;
  return t('core:qdn_publish.speed', { speed: formatTransferBytes(speed) });
}

/** "385 MB of 812 MB", or null when the sizes are not known. */
export function sizeProgressText(
  sentBytes: number,
  totalBytes: number,
  t: TFunction
): string | null {
  if (totalBytes <= 0) return null;
  return t('core:qdn_publish.sent_of_total', {
    sent: formatTransferBytes(Math.min(sentBytes, totalBytes)),
    total: formatTransferBytes(totalBytes),
  });
}

/** Percent of one row's upload, or null before its first part. */
export function rowPercent(row: PublishRow): number | null {
  if (row.state === 'processing' || row.state === 'published') return 100;
  if (row.state !== 'uploading' || row.totalChunks <= 0) return null;
  return Math.floor(
    (Math.min(row.sentChunks, row.totalChunks) / row.totalChunks) * 100
  );
}

export function rowStatusText(row: PublishRow, t: TFunction): string {
  if (row.retrying && !isRowFinal(row)) {
    return t('core:qdn_publish.row_retrying');
  }
  switch (row.state) {
    case 'preparing':
      return t('core:qdn_publish.row_preparing');
    case 'uploading': {
      const percent = rowPercent(row);
      return percent === null
        ? t('core:qdn_publish.row_preparing')
        : t('core:qdn_publish.row_uploading', { percent });
    }
    case 'processing':
      return t('core:qdn_publish.row_processing');
    case 'published':
      return t('core:qdn_publish.row_published');
    case 'failed':
      return t('core:qdn_publish.row_failed');
    case 'cancelled':
      return t('core:qdn_publish.row_cancelled');
    case 'waiting':
    default:
      return t('core:qdn_publish.row_waiting');
  }
}

/** "Q-Share · 3 files", or "2 publishes" when there are several. */
export function windowSubtitle(jobs: PublishJob[], t: TFunction): string {
  if (jobs.length > 1) {
    return t('core:qdn_publish.publishes', { count: jobs.length });
  }
  const job = jobs[0];
  if (!job) return '';
  return t('core:qdn_publish.app_files', {
    app: job.appName,
    count: job.rows.length,
  });
}

/** "1 of 2 files published", for a publish that did not all go through. */
export function filesPublishedText(jobs: PublishJob[], t: TFunction): string {
  const rows = jobs.flatMap((job) => job.rows);
  return t('core:qdn_publish.files_published', {
    done: rows.filter((row) => row.state === 'published').length,
    count: rows.length,
  });
}
