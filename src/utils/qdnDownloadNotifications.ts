/**
 * Progress for files being saved out of QDN, in the app and in the tray.
 *
 * Any save can take minutes — the node has to collect the file from peers
 * before a single byte reaches the app, or a Q-App pulls the whole file itself
 * before it asks GO to save it — and the person who started it has usually
 * left the screen by then. Every stage is reported here once and shows up in
 * three places: the progress card over the app, GO's notifications panel
 * (where a hidden card goes), and the Android notification.
 *
 * A saved file stays in GO's panel as "ready to open" until it is removed
 * ({@link getSavedQdnFiles}). The Android notification opens it on tap and
 * pops up only when GO is in the background. An app package (.apk) is
 * listed as saved, with where it went, but never offered to open or install:
 * the Q-App names it, so GO's "Install" would vouch for anything (see
 * androidPackageFiles.ts).
 */
import i18n from 'i18next';
import { QortalBackground } from '../plugins/QortalBackground';
import { isAndroidPackageFile, safeOpenMimeType } from './androidPackageFiles';
import { isCapacitor } from './platform';

export type QdnTransferStage =
  | 'fetching'
  | 'gathering'
  | 'awaiting_save'
  | 'saving'
  | 'saved'
  | 'failed'
  /** Downloaded, but the save was declined; it can still be saved. */
  | 'declined';

/** What the in-app card shows for one file. */
export type QdnTransfer = {
  id: string;
  filename: string;
  stage: QdnTransferStage;
  /** 0-100, or -1 while there is no way to tell. */
  percent: number;
  bytes: number;
  totalBytes: number;
  /** Where the file went, e.g. "Documents/Qortal Go/Apps". */
  location?: string;
  uri?: string;
  mimeType?: string;
  error?: string;
  /** Hidden from the app; the tray notification carries on. */
  minimized: boolean;
};

/** A file that landed, listed in GO's notifications panel until removed. */
export type SavedQdnFile = {
  id: string;
  filename: string;
  location: string;
  uri?: string;
  mimeType?: string;
  savedAt: number;
  seen: boolean;
  /** Cleared from the panel; still listed in the notification history. */
  hiddenFromPanel?: boolean;
};

/** One notification per file being saved, keyed by the id given at the start. */
type TrackedSave = {
  filename: string;
  lastNotifyAt: number;
  lastPercent: number;
};

const PROGRESS_NOTIFY_MIN_INTERVAL_MS = 1000;
const PROGRESS_NOTIFY_MIN_DELTA_PCT = 2;
/** The card may redraw more often than the tray, but not per chunk. */
const STORE_EMIT_MIN_INTERVAL_MS = 150;
/** Finished cards stay long enough to tap Open, then clear themselves. */
const FINISHED_CARD_TTL_MS = 12_000;
/** A declined file stays on the card this long, then only in the panel. */
const DECLINED_CARD_TTL_MS = 12_000;
/** A declined file holds the whole download in memory; not forever. */
const DECLINED_KEEP_MS = 30 * 60_000;
/** A Q-App download that no save picks up is not GO's to announce. */
const UNCLAIMED_FETCH_TTL_MS = 20_000;
/** Reports stop when a Q-App drops a download without cancelling it. */
const STALLED_FETCH_TTL_MS = 90_000;
/** A save asks first; the downloaded file waits this long for the answer. */
const AWAITING_SAVE_TTL_MS = 5 * 60_000;

const saves = new Map<string, TrackedSave>();
/** How to save a declined file after all, held until it is saved or dropped. */
const retries = new Map<string, () => Promise<unknown>>();

const SAVED_FILES_STORAGE_KEY = 'qortal-go:saved-files:v1';
const SAVED_FILES_MAX = 20;
const SAVED_FILES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let savedFiles: SavedQdnFile[] = loadSavedFiles();

const transfers = new Map<string, QdnTransfer>();
let snapshot: QdnTransfer[] = [];
const listeners = new Set<() => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmitAt = 0;
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function loadSavedFiles(): SavedQdnFile[] {
  try {
    const raw = JSON.parse(
      globalThis.localStorage?.getItem(SAVED_FILES_STORAGE_KEY) || '[]'
    );
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - SAVED_FILES_MAX_AGE_MS;
    return raw
      .filter(
        (file) =>
          file &&
          typeof file.id === 'string' &&
          typeof file.filename === 'string' &&
          typeof file.location === 'string' &&
          Number(file.savedAt) > cutoff
      )
      .slice(0, SAVED_FILES_MAX)
      .map(withoutPackageOpen);
  } catch {
    return [];
  }
}

/**
 * Earlier builds stored packages with the installer's type and a uri the
 * panel offered as "Install". Without the uri there is nothing to open.
 */
function withoutPackageOpen(file: SavedQdnFile): SavedQdnFile {
  if (!isAndroidPackageFile(file.filename, file.mimeType)) return file;
  const { uri: _uri, ...rest } = file;
  return { ...rest, mimeType: safeOpenMimeType(file.filename, file.mimeType) };
}

function storeSavedFiles(): void {
  try {
    globalThis.localStorage?.setItem(
      SAVED_FILES_STORAGE_KEY,
      JSON.stringify(savedFiles)
    );
  } catch {
    /* the list lives on in memory */
  }
}

// Written with their final capitals: several start with the file name, which
// a capitalising post-processor would change.
const t = (key: string, options?: Record<string, unknown>): string =>
  i18n.t(`core:file_transfer.${key}`, options) as string;

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.max(0, Math.round(bytes))} B`;
};

export const formatTransferBytes = formatBytes;

const percentOf = (done: number, total: number): number =>
  total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : -1;

const sizeText = (done: number, total: number): string =>
  total > 0
    ? `${formatBytes(done)} / ${formatBytes(total)}`
    : formatBytes(done);

// ---------------------------------------------------------------------------
// The store behind the in-app card

function emit(immediate: boolean): void {
  const flush = () => {
    emitTimer = null;
    lastEmitAt = Date.now();
    snapshot = Array.from(transfers.values());
    listeners.forEach((listener) => listener());
  };
  if (immediate) {
    if (emitTimer) clearTimeout(emitTimer);
    flush();
    return;
  }
  if (emitTimer) return;
  const wait = Math.max(
    0,
    STORE_EMIT_MIN_INTERVAL_MS - (Date.now() - lastEmitAt)
  );
  emitTimer = setTimeout(flush, wait);
}

function update(
  id: string,
  patch: Partial<QdnTransfer>,
  immediate = false
): QdnTransfer | null {
  const current = transfers.get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  transfers.set(id, next);
  emit(immediate || patch.stage !== undefined);
  return next;
}

function expireAfter(id: string, ms: number, onExpire: () => void): void {
  clearExpiry(id);
  expiryTimers.set(
    id,
    setTimeout(() => {
      expiryTimers.delete(id);
      onExpire();
    }, ms)
  );
}

function clearExpiry(id: string): void {
  const timer = expiryTimers.get(id);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(id);
}

function removeTransfer(id: string): void {
  clearExpiry(id);
  if (transfers.delete(id)) emit(true);
}

export function subscribeQdnTransfers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getQdnTransfers(): QdnTransfer[] {
  return snapshot;
}

/** Newest first. */
export function getSavedQdnFiles(): SavedQdnFile[] {
  return savedFiles;
}

/** What the bell counts: downloads sent to the panel, and files not yet seen. */
export function countUnseenQdnDownloads(
  transferList: QdnTransfer[],
  saved: SavedQdnFile[]
): number {
  const hidden = transferList.filter(
    (transfer) =>
      transfer.minimized &&
      transfer.stage !== 'saved' &&
      transfer.stage !== 'failed'
  ).length;
  return hidden + saved.filter((file) => !file.seen).length;
}

export function markSavedQdnFilesSeen(): void {
  if (savedFiles.every((file) => file.seen)) return;
  savedFiles = savedFiles.map((file) =>
    file.seen ? file : { ...file, seen: true }
  );
  storeSavedFiles();
  emit(true);
}

/** Saved files the notifications panel lists (not cleared into the history). */
export function getPanelSavedQdnFiles(files: SavedQdnFile[]): SavedQdnFile[] {
  return files.filter((file) => !file.hiddenFromPanel);
}

/**
 * Take saved files out of the panel but keep them in the history, which
 * lists every saved file. With no id, clears them all.
 */
export function hideSavedQdnFilesFromPanel(id?: string): void {
  let changed = false;
  savedFiles = savedFiles.map((file) => {
    if (file.hiddenFromPanel || (id && file.id !== id)) return file;
    changed = true;
    return { ...file, hiddenFromPanel: true, seen: true };
  });
  if (!changed) return;
  storeSavedFiles();
  emit(true);
}

export function removeSavedQdnFile(id: string): void {
  const next = savedFiles.filter((file) => file.id !== id);
  if (next.length === savedFiles.length) return;
  savedFiles = next;
  storeSavedFiles();
  emit(true);
}

function addSavedFile(file: Omit<SavedQdnFile, 'id' | 'seen' | 'savedAt'>) {
  // Saving the same file again overwrites it, so it replaces its entry.
  const rest = savedFiles.filter(
    (entry) =>
      !(file.uri && entry.uri === file.uri) &&
      !(entry.filename === file.filename && entry.location === file.location)
  );
  savedFiles = [
    {
      ...file,
      id: `saved:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
      seen: false,
    },
    ...rest,
  ].slice(0, SAVED_FILES_MAX);
  storeSavedFiles();
}

/** Hide the card; the download carries on in GO's notifications panel. */
export function minimizeQdnTransfer(id: string): void {
  update(id, { minimized: true }, true);
}

/** Bring a hidden card back over the app. */
export function restoreQdnTransfer(id: string): void {
  update(id, { minimized: false }, true);
}

/**
 * Clear a finished card. A declined file is dropped for good; running
 * transfers can only be hidden.
 */
export function dismissQdnTransfer(id: string): void {
  const current = transfers.get(id);
  if (!current) return;
  if (current.stage === 'declined') {
    cancelQdnSaveNotification(id);
  } else if (current.stage === 'saved' || current.stage === 'failed') {
    removeTransfer(id);
  } else {
    minimizeQdnTransfer(id);
  }
}

/**
 * With GO on screen, a finished save is announced in the app (card and
 * panel); only when GO is in the background does the phone pop it up.
 */
function goInForeground(): boolean {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'visible'
  );
}

// ---------------------------------------------------------------------------
// The tray

type NotifyExtra = {
  openUri?: string;
  openMimeType?: string;
  alert?: boolean;
  actionLabel?: string;
};

const notify = (
  id: string,
  title: string,
  text: string,
  progress: number,
  ongoing: boolean,
  extra: NotifyExtra = {}
): void => {
  void QortalBackground.showTransferNotification({
    transferId: id,
    title,
    text,
    progress,
    ongoing,
    ...extra,
  }).catch(() => {
    /* the download matters, the notification does not */
  });
};

function track(id: string, filename: string, stage: QdnTransferStage): void {
  saves.set(id, { filename, lastNotifyAt: 0, lastPercent: -1 });
  const existing = transfers.get(id);
  transfers.set(id, {
    id,
    filename,
    stage,
    percent: -1,
    bytes: 0,
    totalBytes: 0,
    minimized: existing?.minimized ?? false,
  });
  emit(true);
}

/**
 * Announce that a file is being fetched. Returns false when there is nowhere
 * to show it, so callers can skip the rest of the reporting. A blob that is
 * already in hand starts at the saving stage.
 */
export function beginQdnSaveNotification(
  id: string,
  filename: string,
  options: { stage?: 'gathering' | 'saving' } = {}
): boolean {
  if (!isCapacitor()) return false;
  const stage = options.stage ?? 'gathering';
  track(id, filename, stage);
  notify(
    id,
    stage === 'saving'
      ? t('saving_title', { filename })
      : t('fetching_title', { filename }),
    stage === 'saving' ? '' : t('looking_for_file'),
    -1,
    true
  );
  return true;
}

/**
 * Carry a transfer already on screen (a Q-App download) on into its save, so
 * the same card and notification follow the file to the end.
 */
export function continueQdnSaveNotification(
  id: string,
  filename: string
): boolean {
  if (!isCapacitor()) return false;
  if (!transfers.has(id)) {
    return beginQdnSaveNotification(id, filename, { stage: 'saving' });
  }
  clearExpiry(id);
  saves.set(id, { filename, lastNotifyAt: 0, lastPercent: -1 });
  update(id, { filename, stage: 'saving', percent: 0, bytes: 0 }, true);
  notify(id, t('saving_title', { filename }), '', 0, true);
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
  update(id, { stage: 'gathering', percent: rounded });
  if (!shouldNotify(save, rounded)) return;

  const text =
    rounded < 0
      ? t('gathering_unknown')
      : detail?.totalChunkCount && detail.totalChunkCount > 0
        ? t('gathering_chunks', {
            percent: rounded,
            local: detail.localChunkCount ?? 0,
            total: detail.totalChunkCount,
          })
        : t('gathering', { percent: rounded });
  notify(
    id,
    t('fetching_title', { filename: save.filename }),
    text,
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
  const percent = percentOf(bytesWritten, totalBytes);
  update(id, {
    stage: 'saving',
    percent,
    bytes: bytesWritten,
    totalBytes,
  });
  if (!shouldNotify(save, percent)) return;

  const size = sizeText(bytesWritten, totalBytes);
  notify(
    id,
    t('saving_title', { filename: save.filename }),
    percent >= 0 ? t('progress', { percent, size }) : size,
    percent,
    true
  );
}

export function finishQdnSaveNotification(
  id: string,
  location: string,
  file: { uri?: string; mimeType?: string; sizeBytes?: number } = {}
): void {
  const save = saves.get(id);
  if (!save) return;
  saves.delete(id);
  dropQappFetchesOfSavedFile(
    id,
    file.sizeBytes || transfers.get(id)?.totalBytes || 0
  );
  // An app package is saved but not offered to open: the Q-App chose its
  // name, and GO opening it would put GO's name on the install. The native
  // open paths refuse packages too, so an Open here could only fail. The
  // file is still where the location says.
  const packageFile = isAndroidPackageFile(save.filename, file.mimeType);
  const uri = packageFile ? undefined : file.uri;
  const mimeType = safeOpenMimeType(save.filename, file.mimeType);
  addSavedFile({ filename: save.filename, location, uri, mimeType });
  update(
    id,
    {
      stage: 'saved',
      percent: 100,
      location,
      uri,
      mimeType,
    },
    true
  );
  expireAfter(id, FINISHED_CARD_TTL_MS, () => removeTransfer(id));

  notify(
    id,
    t('saved_title', { filename: save.filename }),
    uri
      ? t('tap_to_open', { location })
      : packageFile
        ? t('package_saved', { location })
        : `${save.filename} · ${location}`,
    -2,
    false,
    {
      ...(uri
        ? {
            openUri: uri,
            openMimeType: mimeType,
            actionLabel: t('open'),
          }
        : {}),
      alert: !goInForeground(),
    }
  );
}

/**
 * A Q-App may fetch the same file more than once (to play it, then again to
 * save it), and a save continues only one of those downloads. Once the file
 * is saved, the others' "waiting for the save" has nothing left to wait for.
 * Matched by size, as {@link claimQappFetchForSave} does: the names differ
 * (resource file name against the name the Q-App saves under).
 */
function dropQappFetchesOfSavedFile(savedId: string, sizeBytes: number): void {
  if (!sizeBytes) return;
  for (const transfer of [...transfers.values()]) {
    if (
      transfer.id !== savedId &&
      transfer.stage === 'awaiting_save' &&
      transfer.totalBytes === sizeBytes
    ) {
      cancelQdnSaveNotification(transfer.id);
    }
  }
}

export function failQdnSaveNotification(id: string, reason?: string): void {
  const save = saves.get(id);
  if (!save) return;
  saves.delete(id);
  update(id, { stage: 'failed', error: reason }, true);
  expireAfter(id, FINISHED_CARD_TTL_MS, () => removeTransfer(id));
  notify(
    id,
    t('failed_title'),
    reason ? `${save.filename} · ${reason}` : save.filename,
    -2,
    false
  );
}

export function cancelQdnSaveNotification(id: string): void {
  retries.delete(id);
  const known = saves.delete(id);
  const shown = transfers.has(id);
  removeTransfer(id);
  if (!known && !shown) return;
  void QortalBackground.dismissTransferNotification({ transferId: id }).catch(
    () => {
      /* best effort */
    }
  );
}

/**
 * The person said no to saving a file that is already downloaded. It stays in
 * GO's panel (and briefly on the card) with a Save button, which runs `retry`
 * without asking again: tapping Save is the answer.
 */
export function declineQdnSave(
  id: string,
  retry: () => Promise<unknown>
): void {
  const current = transfers.get(id);
  if (!current) return;
  retries.set(id, retry);
  const filename = current.filename;
  update(id, { stage: 'declined', percent: 100, error: undefined }, true);
  notify(
    id,
    t('not_saved_title', { filename }),
    t('not_saved_tray'),
    -2,
    false
  );
  expireAfter(id, DECLINED_CARD_TTL_MS, () => {
    minimizeQdnTransfer(id);
    expireAfter(id, DECLINED_KEEP_MS - DECLINED_CARD_TTL_MS, () =>
      cancelQdnSaveNotification(id)
    );
  });
}

export function canRetryQdnSave(id: string): boolean {
  return retries.has(id);
}

/** Save a declined file after all. */
export async function retryQdnSave(id: string): Promise<void> {
  const retry = retries.get(id);
  if (!retry) return;
  retries.delete(id);
  clearExpiry(id);
  update(id, { minimized: false }, true);
  await retry();
}

// ---------------------------------------------------------------------------
// Downloads a Q-App makes by itself (see qappFetchReporter.ts)

export function beginQappFetchNotification(
  id: string,
  filename: string,
  totalBytes: number
): boolean {
  if (!isCapacitor()) return false;
  track(id, filename, 'fetching');
  update(id, { totalBytes, percent: 0 }, true);
  notify(
    id,
    t('downloading_title', { filename }),
    sizeText(0, totalBytes),
    0,
    true
  );
  expireAfter(id, STALLED_FETCH_TTL_MS, () => cancelQdnSaveNotification(id));
  return true;
}

/** The resource properties came back with the real file name. */
export function renameQdnTransfer(id: string, filename: string): void {
  const save = saves.get(id);
  if (save) save.filename = filename;
  update(id, { filename }, true);
}

export function reportQappFetchProgress(
  id: string,
  loaded: number,
  totalBytes: number
): void {
  const save = saves.get(id);
  const current = transfers.get(id);
  if (!save || current?.stage !== 'fetching') return;
  const percent = percentOf(loaded, totalBytes);
  update(id, { percent, bytes: loaded, totalBytes });
  expireAfter(id, STALLED_FETCH_TTL_MS, () => cancelQdnSaveNotification(id));
  if (!shouldNotify(save, percent)) return;
  const size = sizeText(loaded, totalBytes);
  notify(
    id,
    t('downloading_title', { filename: save.filename }),
    percent >= 0 ? t('progress', { percent, size }) : size,
    percent,
    true
  );
}

/**
 * The Q-App has the whole file. If it goes on to ask GO to save it, the save
 * takes this transfer over ({@link claimQappFetchForSave}); if not, the card
 * and the notification go quietly.
 */
export function completeQappFetch(id: string): void {
  const current = transfers.get(id);
  if (!current || current.stage !== 'fetching') return;
  update(
    id,
    {
      stage: 'awaiting_save',
      percent: 100,
      bytes: current.totalBytes,
    },
    true
  );
  const save = saves.get(id);
  if (save) {
    notify(
      id,
      t('downloading_title', { filename: save.filename }),
      t('stage_awaiting_save'),
      100,
      true
    );
  }
  expireAfter(id, UNCLAIMED_FETCH_TTL_MS, () => cancelQdnSaveNotification(id));
}

/**
 * A save request just arrived with a blob. When a Q-App download of exactly
 * that size is on screen, the save continues it; returns its id.
 */
export function claimQappFetchForSave(sizeBytes: number): string | null {
  if (!sizeBytes) return null;
  let match: QdnTransfer | null = null;
  for (const transfer of transfers.values()) {
    if (
      (transfer.stage === 'awaiting_save' || transfer.stage === 'fetching') &&
      transfer.totalBytes === sizeBytes
    ) {
      match = transfer;
    }
  }
  if (!match) return null;
  // The person still has to agree to the save; give them time to answer.
  expireAfter(match.id, AWAITING_SAVE_TTL_MS, () =>
    cancelQdnSaveNotification(match!.id)
  );
  update(match.id, { stage: 'awaiting_save', percent: 100 }, true);
  return match.id;
}

export function failQappFetch(id: string, reason?: string): void {
  if (transfers.get(id)?.stage !== 'fetching') return;
  failQdnSaveNotification(id, reason);
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

/** Test hook. */
export function resetQdnTransfersForTests(): void {
  saves.clear();
  retries.clear();
  transfers.clear();
  expiryTimers.forEach((timer) => clearTimeout(timer));
  expiryTimers.clear();
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = null;
  lastEmitAt = 0;
  snapshot = [];
  savedFiles = [];
}
