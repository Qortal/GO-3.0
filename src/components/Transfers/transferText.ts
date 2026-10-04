import type { TFunction } from 'i18next';
import { isAndroidPackageFile } from '../../utils/androidPackageFiles';
import {
  formatTransferBytes,
  type QdnTransfer,
  type QdnTransferStage,
} from '../../utils/qdnDownloadNotifications';

/** Listed in GO's notifications panel: running, failed, or awaiting a Save. */
export const PANEL_TRANSFER_STAGES: ReadonlySet<QdnTransferStage> = new Set([
  'fetching',
  'gathering',
  'awaiting_save',
  'saving',
  'failed',
  'declined',
]);

/** Stages with work still going on: they show a progress bar. */
export const ACTIVE_TRANSFER_STAGES: ReadonlySet<QdnTransferStage> = new Set([
  'fetching',
  'gathering',
  'awaiting_save',
  'saving',
]);

/** One line under the file name: the stage, percent and sizes. */
export function transferStatusText(
  transfer: QdnTransfer,
  t: TFunction
): string {
  const sizes =
    transfer.totalBytes > 0
      ? `${formatTransferBytes(transfer.bytes)} / ${formatTransferBytes(transfer.totalBytes)}`
      : '';
  const withProgress = (label: string) =>
    [label, transfer.percent >= 0 ? `${transfer.percent}%` : '', sizes]
      .filter(Boolean)
      .join(' · ');
  switch (transfer.stage) {
    case 'fetching':
      return withProgress(t('core:file_transfer.stage_downloading'));
    case 'gathering':
      return [
        t('core:file_transfer.stage_gathering'),
        transfer.percent >= 0 ? `${transfer.percent}%` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'awaiting_save':
      return t('core:file_transfer.stage_awaiting_save');
    case 'saving':
      return withProgress(t('core:file_transfer.stage_saving'));
    case 'declined':
      return t('core:file_transfer.stage_declined');
    case 'saved':
      return t(
        isAndroidPackageFile(transfer.filename, transfer.mimeType)
          ? 'core:file_transfer.package_saved'
          : 'core:file_transfer.saved_to',
        { location: transfer.location || '' }
      );
    case 'failed':
    default:
      return transfer.error || t('core:file_transfer.failed_title');
  }
}
