import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  showTransferNotification: vi.fn(
    async (_options: Record<string, unknown>) => ({
      success: true,
    })
  ),
  dismissTransferNotification: vi.fn(
    async (_options: Record<string, unknown>) => ({
      success: true,
    })
  ),
}));

vi.mock('../plugins/QortalBackground', () => ({ QortalBackground: plugin }));
// The app's i18n setup, so labels resolve the way they do on the phone.
import '../i18n/i18n';
vi.mock('./platform', () => ({ isCapacitor: () => true }));

import {
  beginQappFetchNotification,
  beginQdnSaveNotification,
  cancelQdnSaveNotification,
  claimQappFetchForSave,
  completeQappFetch,
  continueQdnSaveNotification,
  countUnseenQdnDownloads,
  declineQdnSave,
  dismissQdnTransfer,
  finishQdnSaveNotification,
  getPanelSavedQdnFiles,
  getQdnTransfers,
  getSavedQdnFiles,
  hideSavedQdnFilesFromPanel,
  markSavedQdnFilesSeen,
  minimizeQdnTransfer,
  removeSavedQdnFile,
  renameQdnTransfer,
  reportQappFetchProgress,
  reportQdnTransferProgress,
  resetQdnTransfersForTests,
  retryQdnSave,
} from './qdnDownloadNotifications';

const setGoVisible = (visible: boolean) =>
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  });
const unseen = () =>
  countUnseenQdnDownloads(getQdnTransfers(), getSavedQdnFiles());

const lastNotification = () =>
  plugin.showTransferNotification.mock.calls.at(-1)?.[0] as Record<
    string,
    unknown
  >;
const only = () => {
  const transfers = getQdnTransfers();
  expect(transfers).toHaveLength(1);
  return transfers[0];
};

describe('QDN transfer progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setGoVisible(true);
    localStorage.clear();
    resetQdnTransfersForTests();
    plugin.showTransferNotification.mockClear();
    plugin.dismissTransferNotification.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows a Q-App download into its save, on one card', () => {
    const size = 125_946_226;
    beginQappFetchNotification('qapp-fetch:a', 'GO 3.0', size);
    renameQdnTransfer('qapp-fetch:a', 'GO 3.0 v0.0.11.apk');
    vi.advanceTimersByTime(2000);
    reportQappFetchProgress('qapp-fetch:a', size / 2, size);
    vi.advanceTimersByTime(500);
    expect(only()).toMatchObject({
      filename: 'GO 3.0 v0.0.11.apk',
      stage: 'fetching',
      percent: 50,
    });

    completeQappFetch('qapp-fetch:a');
    expect(only().stage).toBe('awaiting_save');

    // The Q-App's SAVE_FILE carries a blob of exactly that size.
    expect(claimQappFetchForSave(size)).toBe('qapp-fetch:a');
    expect(claimQappFetchForSave(size - 1)).toBeNull();

    continueQdnSaveNotification('qapp-fetch:a', 'GO 3.0 v0.0.11.apk');
    vi.advanceTimersByTime(2000);
    reportQdnTransferProgress('qapp-fetch:a', size, size);
    vi.advanceTimersByTime(500);
    expect(only()).toMatchObject({ stage: 'saving', percent: 100 });

    setGoVisible(false);
    finishQdnSaveNotification('qapp-fetch:a', 'Documents/Qortal Go/Apps', {
      uri: 'content://media/external_primary/file/9',
      mimeType: 'application/zip',
    });
    expect(only()).toMatchObject({
      stage: 'saved',
      location: 'Documents/Qortal Go/Apps',
      uri: 'content://media/external_primary/file/9',
      mimeType: 'application/vnd.android.package-archive',
    });
    // GO was in the background, so the phone pops it up and opens the file.
    expect(lastNotification()).toMatchObject({
      transferId: 'qapp-fetch:a',
      openUri: 'content://media/external_primary/file/9',
      openMimeType: 'application/vnd.android.package-archive',
      alert: true,
      ongoing: false,
    });

    // The card goes after a while; the panel keeps it as ready to open.
    vi.advanceTimersByTime(13_000);
    expect(getQdnTransfers()).toHaveLength(0);
    expect(getSavedQdnFiles()).toMatchObject([
      {
        filename: 'GO 3.0 v0.0.11.apk',
        location: 'Documents/Qortal Go/Apps',
        uri: 'content://media/external_primary/file/9',
        seen: false,
      },
    ]);
  });

  it('does not pop up on the phone while GO is on screen', () => {
    beginQdnSaveNotification('save:1', 'photo.jpg', { stage: 'saving' });
    finishQdnSaveNotification('save:1', 'Documents/Qortal Go/Images', {
      uri: 'content://media/external_primary/file/3',
      mimeType: 'image/jpeg',
    });
    expect(lastNotification()).toMatchObject({
      alert: false,
      openUri: 'content://media/external_primary/file/3',
    });
  });

  it('sends a hidden card to the panel, not to the phone', () => {
    beginQappFetchNotification('qapp-fetch:e', 'GO 3.0 v0.0.11.apk', 1000);
    vi.advanceTimersByTime(2000);
    reportQappFetchProgress('qapp-fetch:e', 400, 1000);
    const posted = plugin.showTransferNotification.mock.calls.length;

    minimizeQdnTransfer('qapp-fetch:e');
    expect(only().minimized).toBe(true);
    expect(plugin.showTransferNotification.mock.calls.length).toBe(posted);
    // The bell counts it while it runs.
    expect(unseen()).toBe(1);
  });

  it('keeps saved files for the panel until they are removed', () => {
    beginQdnSaveNotification('save:3', 'GO 3.0 v0.0.11.apk', {
      stage: 'saving',
    });
    finishQdnSaveNotification('save:3', 'Documents/Qortal Go/Apps', {
      uri: 'content://media/external_primary/file/5',
    });
    expect(String(lastNotification().actionLabel)).toMatch(/install/i);
    expect(lastNotification().openMimeType).toBe(
      'application/vnd.android.package-archive'
    );
    expect(unseen()).toBe(1);
    expect(localStorage.getItem('qortal-go:saved-files:v1')).toContain(
      'GO 3.0 v0.0.11.apk'
    );

    // Saving the same file again replaces its entry.
    beginQdnSaveNotification('save:4', 'GO 3.0 v0.0.11.apk', {
      stage: 'saving',
    });
    finishQdnSaveNotification('save:4', 'Documents/Qortal Go/Apps', {
      uri: 'content://media/external_primary/file/5',
    });
    expect(getSavedQdnFiles()).toHaveLength(1);

    markSavedQdnFilesSeen();
    expect(unseen()).toBe(0);
    removeSavedQdnFile(getSavedQdnFiles()[0].id);
    expect(getSavedQdnFiles()).toHaveLength(0);
    expect(localStorage.getItem('qortal-go:saved-files:v1')).toBe('[]');
  });

  it('clears saved files from the panel into the history', () => {
    for (const [id, name] of [
      ['save:5', 'a.pdf'],
      ['save:6', 'b.pdf'],
    ]) {
      beginQdnSaveNotification(id, name, { stage: 'saving' });
      finishQdnSaveNotification(id, 'Documents/Qortal Go/Docs', {
        uri: `content://media/external_primary/file/${id}`,
      });
    }
    expect(unseen()).toBe(2);

    // One swipe: that file leaves the panel only.
    const [newest] = getSavedQdnFiles();
    hideSavedQdnFilesFromPanel(newest.id);
    expect(getSavedQdnFiles()).toHaveLength(2);
    expect(
      getPanelSavedQdnFiles(getSavedQdnFiles()).map((f) => f.filename)
    ).toEqual(['a.pdf']);
    expect(unseen()).toBe(1);

    // Clear all: the rest follow, still kept (and stored) for the history.
    hideSavedQdnFilesFromPanel();
    expect(getPanelSavedQdnFiles(getSavedQdnFiles())).toHaveLength(0);
    expect(getSavedQdnFiles()).toHaveLength(2);
    expect(unseen()).toBe(0);
    expect(
      JSON.parse(localStorage.getItem('qortal-go:saved-files:v1')!).every(
        (file: { hiddenFromPanel?: boolean }) => file.hiddenFromPanel
      )
    ).toBe(true);
  });

  it('drops a Q-App download nobody saves', () => {
    beginQappFetchNotification('qapp-fetch:b', 'clip', 8_000_000);
    completeQappFetch('qapp-fetch:b');
    vi.advanceTimersByTime(21_000);
    expect(getQdnTransfers()).toHaveLength(0);
    expect(plugin.dismissTransferNotification).toHaveBeenCalledWith({
      transferId: 'qapp-fetch:b',
    });
  });

  it('drops a Q-App download that stops reporting', () => {
    beginQappFetchNotification('qapp-fetch:c', 'clip', 8_000_000);
    vi.advanceTimersByTime(91_000);
    expect(getQdnTransfers()).toHaveLength(0);
  });

  it('clears the card when the save fails', () => {
    beginQappFetchNotification('qapp-fetch:d', 'a.zip', 9_000_000);
    completeQappFetch('qapp-fetch:d');
    const id = claimQappFetchForSave(9_000_000);
    expect(id).toBe('qapp-fetch:d');
    cancelQdnSaveNotification(id!);
    expect(getQdnTransfers()).toHaveLength(0);
  });

  it('keeps a declined file with a Save that needs no second answer', async () => {
    beginQappFetchNotification('qapp-fetch:f', 'GO 3.0 v0.0.11.apk', 5000);
    completeQappFetch('qapp-fetch:f');
    const id = claimQappFetchForSave(5000)!;
    const retry = vi.fn(async () => {
      continueQdnSaveNotification(id, 'GO 3.0 v0.0.11.apk');
    });

    declineQdnSave(id, retry);
    expect(only()).toMatchObject({ stage: 'declined', minimized: false });
    expect(lastNotification()).toMatchObject({ ongoing: false });

    // Off the card after a moment, still in the panel and on the bell.
    vi.advanceTimersByTime(13_000);
    expect(only()).toMatchObject({ stage: 'declined', minimized: true });
    expect(unseen()).toBe(1);

    await retryQdnSave(id);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(only()).toMatchObject({ stage: 'saving', minimized: false });
    // It no longer expires as a declined file.
    vi.advanceTimersByTime(31 * 60_000);
    expect(getQdnTransfers()).toHaveLength(1);
  });

  it('drops a declined file on dismiss, or after half an hour', () => {
    beginQappFetchNotification('qapp-fetch:g', 'x.zip', 5000);
    completeQappFetch('qapp-fetch:g');
    declineQdnSave(claimQappFetchForSave(5000)!, async () => undefined);
    dismissQdnTransfer('qapp-fetch:g');
    expect(getQdnTransfers()).toHaveLength(0);

    beginQappFetchNotification('qapp-fetch:h', 'y.zip', 6000);
    completeQappFetch('qapp-fetch:h');
    declineQdnSave(claimQappFetchForSave(6000)!, async () => undefined);
    vi.advanceTimersByTime(30 * 60_000 + 1000);
    expect(getQdnTransfers()).toHaveLength(0);
  });
});
