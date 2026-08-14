import type { AppUpdatePhase } from '../../appUpdate/appUpdateAtoms';

export const formatUpdateSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const formatUpdateDate = (timestamp: number): string => {
  if (!timestamp) return '';
  const published = new Date(timestamp);
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'published today';
  if (days === 1) return 'published yesterday';
  if (days < 7) return `published ${days} days ago`;
  return `published ${published.toLocaleDateString()}`;
};

/** One line that says where the update is, wherever it is shown. */
export const updateHeadline = (phase: AppUpdatePhase): string => {
  switch (phase) {
    case 'preparing':
      return 'Fetching update';
    case 'downloading':
      return 'Downloading update';
    case 'installing':
      return 'Ready to install';
    case 'needs-permission':
      return 'Permission needed';
    case 'error':
      return 'Update failed';
    default:
      return 'Update available';
  }
};
