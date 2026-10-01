import type { TFunction } from 'i18next';
import type { AppUpdatePhase } from '../../appUpdate/appUpdateAtoms';

export const formatUpdateSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/**
 * "published 3 days ago" in the reader's language. The relative part comes
 * from Intl, which already knows each language's plural forms.
 */
export const formatUpdateDate = (
  timestamp: number,
  t: TFunction,
  language?: string
): string => {
  if (!timestamp) return '';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  let when: string;
  if (days < 7) {
    try {
      when = new Intl.RelativeTimeFormat(language || undefined, {
        numeric: 'auto',
      }).format(-days, 'day');
    } catch {
      when = new Date(timestamp).toLocaleDateString();
    }
  } else {
    when = new Date(timestamp).toLocaleDateString(language || undefined);
  }
  return t('core:go_updates.published_when', { when });
};

/** One line that says where an install is, wherever it is shown. */
export const updateHeadline = (phase: AppUpdatePhase, t: TFunction): string => {
  switch (phase) {
    case 'preparing':
      return t('core:go_updates.job.fetching');
    case 'downloading':
      return t('core:go_updates.job.downloading');
    case 'installing':
      return t('core:go_updates.job.ready');
    case 'needs-permission':
      return t('core:go_updates.job.permission');
    case 'error':
      return t('core:go_updates.job.failed');
    default:
      return '';
  }
};
