/**
 * Android notifications for files being saved out of QDN.
 *
 * Any save can take minutes — the node has to collect the file from peers
 * before a single byte reaches the app — and the person who started it has
 * usually left the screen by then. The notification is where that wait is
 * visible, and it carries both stages: the node gathering the file, then the
 * file being written to storage.
 */
import { QortalBackground } from '../plugins/QortalBackground';
import { isCapacitor } from './platform';

/** One notification per file being saved, keyed by the id given at the start. */
type TrackedSave = {
  filename: string;
  lastNotifyAt: number;
  lastPercent: number;
};

const PROGRESS_NOTIFY_MIN_INTERVAL_MS = 1000;
const PROGRESS_NOTIFY_MIN_DELTA_PCT = 2;

const saves = new Map<string, TrackedSave>();

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.max(0, Math.round(bytes))} B`;
};

const notify = (
  id: string,
  title: string,
  text: string,
  progress: number,
  ongoing: boolean
): void => {
  void QortalBackground.showTransferNotification({
    transferId: id,
    title,
    text,
    progress,
    ongoing,
  }).catch(() => {
    /* the download matters, the notification does not */
  });
};

/**
 * Announce that a file is being fetched. Returns false when there is nowhere
 * to show it, so callers can skip the rest of the reporting.
 */
export function beginQdnSaveNotification(
  id: string,
  filename: string
): boolean {
  if (!isCapacitor()) return false;
  saves.set(id, { filename, lastNotifyAt: 0, lastPercent: -1 });
  notify(id, `Fetching ${filename}`, 'Looking for the file on QDN…', -1, true);
  return true;
}

/**
 * The node is collecting the file from peers. Percent is -1 while the node has
 * not worked out how much there is to collect.
 */
export function reportQdnGatherProgress(
  id: string,
  percent: number,
  detail?: { localChunkCount?: number; totalChunkCount?: number }
): void {
  const save = saves.get(id);
  if (!save) return;
  const rounded = percent >= 0 ? Math.round(percent) : -1;
  if (!shouldNotify(save, rounded)) return;

  const chunks =
    detail?.totalChunkCount && detail.totalChunkCount > 0
      ? ` · ${detail.localChunkCount ?? 0}/${detail.totalChunkCount} chunks`
      : '';
  notify(
    id,
    `Fetching ${save.filename}`,
    rounded >= 0
      ? `Gathering from QDN · ${rounded}%${chunks}`
      : 'Gathering from QDN…',
    rounded,
    true
  );
}

/** The file is on the node and is now being written to the device. */
export function reportQdnTransferProgress(
  id: string,
  bytesWritten: number,
  totalBytes: number
): void {
  const save = saves.get(id);
  if (!save) return;
  const percent =
    totalBytes > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((bytesWritten / totalBytes) * 100))
        )
      : -1;
  if (!shouldNotify(save, percent)) return;

  const size =
    totalBytes > 0
      ? `${formatBytes(bytesWritten)} / ${formatBytes(totalBytes)}`
      : formatBytes(bytesWritten);
  notify(
    id,
    `Saving ${save.filename}`,
    percent >= 0 ? `${percent}% · ${size}` : size,
    percent,
    true
  );
}

export function finishQdnSaveNotification(id: string, location: string): void {
  const save = saves.get(id);
  if (!save) return;
  saves.delete(id);
  notify(id, 'File saved', `${save.filename} · ${location}`, -2, false);
}

export function failQdnSaveNotification(id: string, reason?: string): void {
  const save = saves.get(id);
  if (!save) return;
  saves.delete(id);
  notify(
    id,
    'Download failed',
    reason ? `${save.filename} · ${reason}` : save.filename,
    -2,
    false
  );
}

export function cancelQdnSaveNotification(id: string): void {
  if (!saves.delete(id)) return;
  void QortalBackground.dismissTransferNotification({ transferId: id }).catch(
    () => {
      /* best effort */
    }
  );
}

/**
 * Android redraws the whole shade for every update, so a notification driven
 * straight off the write loop would be a waste of the battery it is meant to
 * be saving.
 */
function shouldNotify(save: TrackedSave, percent: number): boolean {
  const now = Date.now();
  const movedEnough =
    percent < 0 ||
    percent >= save.lastPercent + PROGRESS_NOTIFY_MIN_DELTA_PCT ||
    percent >= 100;
  if (now - save.lastNotifyAt < PROGRESS_NOTIFY_MIN_INTERVAL_MS) return false;
  if (!movedEnough) return false;
  save.lastNotifyAt = now;
  save.lastPercent = percent;
  return true;
}
