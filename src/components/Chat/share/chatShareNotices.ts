import i18n from 'i18next';
import { executeEvent } from '../../../utils/events';
import type { ChatShareNotice } from './chatShareInbox';

const sentence = { postProcess: 'capitalizeFirstChar' };

export function chatShareNoticeText(notice: ChatShareNotice): string {
  switch (notice.kind) {
    case 'extra_files':
      return i18n.t('reticulum:share.notice_extra_files', sentence);
    case 'too_large':
      return i18n.t('reticulum:share.notice_too_large', {
        ...sentence,
        max: notice.maxMb,
      });
    case 'unsafe_image':
      return i18n.t('reticulum:share.notice_unsafe_image', sentence);
    default:
      return i18n.t('reticulum:share.notice_unreadable', sentence);
  }
}

/** One snackbar line for everything that did not come through. */
export function showChatShareNotices(
  notices: readonly ChatShareNotice[],
  type: 'info' | 'error' = 'info'
) {
  const lines = [...new Set(notices.map(chatShareNoticeText))].filter(Boolean);
  if (!lines.length) return;
  executeEvent('openGlobalSnackBar', { message: lines.join(' '), type });
}
