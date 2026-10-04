import { describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/i18n';

const mocks = vi.hoisted(() => ({
  listeners: [] as ((payload: Record<string, unknown>) => void)[],
  show: vi.fn(),
}));

vi.mock('../bridge/capacitorBridge', () => ({
  getQchatPendingSendInfo: () => null,
  onMobileQchatFileTransferEvent: (
    cb: (payload: Record<string, unknown>) => void
  ) => {
    mocks.listeners.push(cb);
    return () => {};
  },
}));
vi.mock('../plugins/QortalBackground', () => ({
  QortalBackground: {
    showTransferNotification: mocks.show,
    dismissTransferNotification: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('./platform', () => ({ isCapacitor: () => true }));

import { initMobileTransferNotifications } from './mobileTransferNotifications';

// N-22: a received file is no longer copied to Downloads, so the tray must
// not say it was.
describe('the notification for a received chat file', () => {
  it('says the file is in GO, not in Downloads', () => {
    // The keys reach the locale files in a separate step.
    i18n.addResource(
      'en',
      'core',
      'file_transfer.received_notification_title',
      'File received'
    );
    i18n.addResource(
      'en',
      'core',
      'file_transfer.received_notification_text',
      '{{fileName}} is ready in GO'
    );
    mocks.show.mockResolvedValue(undefined);
    initMobileTransferNotifications();
    expect(mocks.listeners).toHaveLength(1);

    mocks.listeners[0]({
      status: 'received',
      transferId: 'qft-9',
      fileName: 'report & notes.pdf',
      path: '/data/user/0/app/files/qchat-received/u/report & notes.pdf',
    });

    expect(mocks.show).toHaveBeenCalledTimes(1);
    const shown = mocks.show.mock.calls[0][0];
    expect(shown).toMatchObject({
      transferId: 'qft-9',
      title: 'File received',
      text: 'report & notes.pdf is ready in GO',
      ongoing: false,
    });
    expect(JSON.stringify(shown)).not.toMatch(/Downloads/);
  });
});
