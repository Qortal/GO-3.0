/**
 * Android notifications for Reticulum (Q-Chat) file transfers.
 *
 * Mirrors the in-chat transfer state into system notifications:
 * - outgoing shares waiting for the recipient ("active files") with the
 *   time remaining before the offer expires,
 * - live upload/download progress bars with speed and ETA,
 * - terminal states (sent / received / failed).
 */
import i18n from 'i18next';
import {
  getQchatPendingSendInfo,
  onMobileQchatFileTransferEvent,
} from '../bridge/capacitorBridge';
import { QortalBackground } from '../plugins/QortalBackground';
import { isCapacitor } from './platform';
import { formatTransferBytes as formatBytes } from './qdnDownloadNotifications';

type TransferDirection = 'send' | 'receive';

type TrackedTransfer = {
  transferId: string;
  fileName: string;
  size: number;
  direction: TransferDirection;
  /** waiting = outgoing share waiting for downloader (countdown shown). */
  phase: 'waiting' | 'transferring';
  expiresAt: number | null;
  lastProgressNotifyAt: number;
  lastPercent: number;
};

const PROGRESS_NOTIFY_MIN_INTERVAL_MS = 1000;
const PROGRESS_NOTIFY_MIN_DELTA_PCT = 4;
const COUNTDOWN_TICK_MS = 30_000;

const trackedTransfers = new Map<string, TrackedTransfer>();
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

const asStr = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const asNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
};

const notify = (options: {
  transferId: string;
  title: string;
  text: string;
  progress?: number;
  ongoing?: boolean;
}): void => {
  void QortalBackground.showTransferNotification({
    transferId: options.transferId,
    title: options.title,
    text: options.text,
    progress: options.progress ?? -2,
    ongoing: options.ongoing ?? false,
  }).catch(() => {
    /* notification is best-effort */
  });
};

const dismiss = (transferId: string): void => {
  void QortalBackground.dismissTransferNotification({ transferId }).catch(
    () => {
      /* notification is best-effort */
    }
  );
};

const stopCountdownIfIdle = (): void => {
  const anyWaiting = [...trackedTransfers.values()].some(
    (t) => t.phase === 'waiting'
  );
  if (!anyWaiting && countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
};

const waitingShareText = (transfer: TrackedTransfer): string => {
  const sizeLabel = transfer.size > 0 ? `${formatBytes(transfer.size)} · ` : '';
  if (transfer.expiresAt && transfer.expiresAt > Date.now()) {
    return `${sizeLabel}Waiting for download · ${formatDuration(
      transfer.expiresAt - Date.now()
    )} left`;
  }
  return `${sizeLabel}Waiting for download`;
};

const refreshWaitingCountdowns = (): void => {
  const now = Date.now();
  for (const transfer of [...trackedTransfers.values()]) {
    if (transfer.phase !== 'waiting') continue;
    if (transfer.expiresAt && transfer.expiresAt <= now) {
      trackedTransfers.delete(transfer.transferId);
      dismiss(transfer.transferId);
      continue;
    }
    notify({
      transferId: transfer.transferId,
      title: `Sharing ${transfer.fileName}`,
      text: waitingShareText(transfer),
      ongoing: true,
    });
  }
  stopCountdownIfIdle();
};

const ensureCountdownTimer = (): void => {
  if (countdownTimer !== null) return;
  countdownTimer = setInterval(refreshWaitingCountdowns, COUNTDOWN_TICK_MS);
};

const trackTransfer = (
  transferId: string,
  payload: Record<string, unknown>,
  directionHint?: TransferDirection
): TrackedTransfer => {
  const existing = trackedTransfers.get(transferId);
  const pendingSend = getQchatPendingSendInfo(transferId);
  const direction: TransferDirection =
    directionHint ?? existing?.direction ?? (pendingSend ? 'send' : 'receive');
  const transfer: TrackedTransfer = existing ?? {
    transferId,
    fileName: '',
    size: 0,
    direction,
    phase: 'transferring',
    expiresAt: null,
    lastProgressNotifyAt: 0,
    lastPercent: -1,
  };
  transfer.direction = directionHint ?? transfer.direction;
  const fileName = asStr(payload.fileName) || pendingSend?.fileName || '';
  if (fileName) transfer.fileName = fileName;
  const size = asNum(payload.size) || pendingSend?.size || 0;
  if (size > 0) transfer.size = size;
  if (pendingSend?.expiresAt) transfer.expiresAt = pendingSend.expiresAt;
  trackedTransfers.set(transferId, transfer);
  return transfer;
};

const progressText = (
  transfer: TrackedTransfer,
  percent: number,
  bytesTransferred: number,
  bytesPerSecond: number
): string => {
  const parts: string[] = [`${percent}%`];
  if (transfer.size > 0 && bytesTransferred > 0) {
    parts.push(`${formatBytes(bytesTransferred)} / ${formatBytes(transfer.size)}`);
  }
  if (bytesPerSecond > 0) {
    parts.push(`${formatBytes(bytesPerSecond)}/s`);
    if (transfer.size > 0 && bytesTransferred < transfer.size) {
      const etaMs =
        ((transfer.size - bytesTransferred) / bytesPerSecond) * 1000;
      parts.push(`${formatDuration(etaMs)} left`);
    }
  }
  return parts.join(' · ');
};

const handleProgressEvent = (
  transfer: TrackedTransfer,
  payload: Record<string, unknown>
): void => {
  transfer.phase = 'transferring';
  const percent = Math.max(
    0,
    Math.min(100, Math.round(asNum(payload.progress) * 100))
  );
  const now = Date.now();
  const intervalOk =
    now - transfer.lastProgressNotifyAt >= PROGRESS_NOTIFY_MIN_INTERVAL_MS;
  const deltaOk =
    percent >= transfer.lastPercent + PROGRESS_NOTIFY_MIN_DELTA_PCT ||
    percent >= 100;
  if (!intervalOk && !deltaOk) return;
  transfer.lastProgressNotifyAt = now;
  transfer.lastPercent = percent;

  const verb = transfer.direction === 'send' ? 'Uploading' : 'Downloading';
  notify({
    transferId: transfer.transferId,
    title: `${verb} ${transfer.fileName || 'file'}`,
    text: progressText(
      transfer,
      percent,
      asNum(payload.bytesTransferred),
      asNum(payload.bytesPerSecond)
    ),
    progress: percent,
    ongoing: true,
  });
};

const handleTerminalEvent = (
  transfer: TrackedTransfer,
  status: 'sent' | 'received' | 'failed',
  payload: Record<string, unknown>
): void => {
  trackedTransfers.delete(transfer.transferId);
  stopCountdownIfIdle();

  const fileName = transfer.fileName || 'file';
  if (status === 'sent') {
    notify({
      transferId: transfer.transferId,
      title: 'File sent',
      text: `${fileName} was delivered over Reticulum`,
    });
    return;
  }
  if (status === 'received') {
    // A received file stays in GO's private storage; nothing is copied to
    // Downloads (N-22, N-27). The chat card has Open and Save to device.
    notify({
      transferId: transfer.transferId,
      title: i18n.t('core:file_transfer.received_notification_title'),
      text: i18n.t('core:file_transfer.received_notification_text', {
        fileName,
      }),
    });
    return;
  }
  const reason = asStr(payload.reason);
  notify({
    transferId: transfer.transferId,
    title: 'File transfer failed',
    text: reason ? `${fileName} · ${reason.replace(/_/g, ' ')}` : fileName,
  });
};

const handleTransferEvent = (payload: Record<string, unknown>): void => {
  const transferId = asStr(payload.transferId).trim();
  const status = asStr(payload.status);
  if (!transferId || !status) return;

  switch (status) {
    case 'registered': {
      const transfer = trackTransfer(transferId, payload, 'send');
      transfer.phase = 'waiting';
      notify({
        transferId,
        title: `Sharing ${transfer.fileName || 'file'}`,
        text: waitingShareText(transfer),
        ongoing: true,
      });
      ensureCountdownTimer();
      break;
    }
    case 'accepted':
    case 'connecting':
    case 'retrying':
    case 'link_established':
    case 'auth_sent': {
      const transfer = trackTransfer(transferId, payload);
      // Keep the sender's "waiting" countdown until bytes actually move.
      if (transfer.phase === 'waiting') break;
      const verb = transfer.direction === 'send' ? 'Sending' : 'Downloading';
      notify({
        transferId,
        title: `${verb} ${transfer.fileName || 'file'}`,
        text: 'Connecting…',
        progress: -1,
        ongoing: true,
      });
      break;
    }
    case 'authorized': {
      const transfer = trackTransfer(transferId, payload, 'send');
      transfer.phase = 'transferring';
      notify({
        transferId,
        title: `Sending ${transfer.fileName || 'file'}`,
        text: 'Starting upload…',
        progress: -1,
        ongoing: true,
      });
      break;
    }
    case 'sending': {
      handleProgressEvent(trackTransfer(transferId, payload, 'send'), payload);
      break;
    }
    case 'receiving': {
      handleProgressEvent(
        trackTransfer(transferId, payload, 'receive'),
        payload
      );
      break;
    }
    case 'sent': {
      handleTerminalEvent(
        trackTransfer(transferId, payload, 'send'),
        'sent',
        payload
      );
      break;
    }
    case 'received': {
      handleTerminalEvent(
        trackTransfer(transferId, payload, 'receive'),
        'received',
        payload
      );
      break;
    }
    case 'failed':
    case 'rejected': {
      // Only surface failures for transfers we were actually showing;
      // defensive bridge rejections for unknown ids would just be noise.
      const transfer = trackedTransfers.get(transferId);
      if (transfer) handleTerminalEvent(transfer, 'failed', payload);
      break;
    }
    default:
      break;
  }
};

/** Wire Reticulum file-transfer events to Android notifications. Idempotent. */
export const initMobileTransferNotifications = (): void => {
  if (initialized || !isCapacitor()) return;
  initialized = true;
  onMobileQchatFileTransferEvent(handleTransferEvent);
};
