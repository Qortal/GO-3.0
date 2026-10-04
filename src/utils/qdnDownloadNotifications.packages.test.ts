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
  beginQdnSaveNotification,
  finishQdnSaveNotification,
  getQdnTransfers,
  getSavedQdnFiles,
  resetQdnTransfersForTests,
} from './qdnDownloadNotifications';

const STORAGE_KEY = 'qortal-go:saved-files:v1';
const PACKAGE_MIME = 'application/vnd.android.package-archive';

const lastNotification = () => {
  const { calls } = plugin.showTransferNotification.mock;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
};

const saveFile = (
  id: string,
  filename: string,
  mimeType?: string,
  location = 'Documents/Qortal Go/Apps'
) => {
  beginQdnSaveNotification(id, filename, { stage: 'saving' });
  finishQdnSaveNotification(id, location, {
    uri: `content://media/external_primary/file/${id}`,
    mimeType,
  });
};

// GO-N-20 / N-31: a Q-App names the file, so an .apk it saves is never offered
// to open or install under GO's name. It is listed as saved, with where it went.
describe('app packages a Q-App saves', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    localStorage.clear();
    resetQdnTransfersForTests();
    plugin.showTransferNotification.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['GO 3.0 v0.0.15.apk', undefined],
    ['GO 3.0 v0.0.15.apk', PACKAGE_MIME],
    ['bundle.xapk', undefined],
    ['release.aab', 'application/octet-stream'],
    ['GO.apk_', 'application/octet-stream'],
    ['GO.\u0430pk', undefined],
    // The type alone is enough: the name may say anything.
    ['update.bin', PACKAGE_MIME],
  ])('lists %s (%s) as saved, with nothing to tap', (filename, mimeType) => {
    saveFile('1', filename, mimeType);

    const posted = lastNotification();
    expect(posted).toMatchObject({
      title: `${filename} saved`,
      text: 'Saved to Documents/Qortal Go/Apps. GO does not open app packages.',
    });
    expect(posted.openUri).toBeUndefined();
    expect(posted.openMimeType).toBeUndefined();
    expect(posted.actionLabel).toBeUndefined();
    expect(JSON.stringify(posted)).not.toMatch(/install/i);
    expect(JSON.stringify(posted)).not.toContain('package-archive');

    const [transfer] = getQdnTransfers();
    expect(transfer).toMatchObject({
      stage: 'saved',
      location: 'Documents/Qortal Go/Apps',
      mimeType: 'application/zip',
    });
    expect(transfer.uri).toBeUndefined();

    const [entry] = getSavedQdnFiles();
    expect(entry).toMatchObject({
      filename,
      location: 'Documents/Qortal Go/Apps',
      mimeType: 'application/zip',
    });
    expect(entry.uri).toBeUndefined();
    const stored = localStorage.getItem(STORAGE_KEY) || '';
    expect(stored).not.toContain('package-archive');
    expect(stored).not.toContain('content://');
  });

  it('saving the same package again still replaces its entry', () => {
    saveFile('1', 'GO.apk', PACKAGE_MIME);
    saveFile('2', 'GO.apk', PACKAGE_MIME);
    expect(getSavedQdnFiles()).toHaveLength(1);
  });

  it('leaves other files as they were', () => {
    saveFile('2', 'report.pdf', 'application/pdf', 'Documents/Qortal Go/Docs');
    expect(lastNotification()).toMatchObject({
      text: 'Tap to open · Documents/Qortal Go/Docs',
      actionLabel: 'Open',
      openUri: 'content://media/external_primary/file/2',
      openMimeType: 'application/pdf',
    });
    expect(getQdnTransfers()[0].uri).toBe(
      'content://media/external_primary/file/2'
    );
    expect(getSavedQdnFiles()[0]).toMatchObject({
      uri: 'content://media/external_primary/file/2',
      mimeType: 'application/pdf',
    });
  });
});

describe('saved files kept by an earlier build', () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('no longer offers a stored package to open or install', async () => {
    const savedAt = Date.now();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: 'saved:old-apk',
          filename: 'GO 3.0 v0.0.15.apk',
          location: 'Documents/Qortal Go/Apps',
          uri: 'content://media/external_primary/file/7',
          mimeType: PACKAGE_MIME,
          savedAt,
          seen: true,
        },
        {
          id: 'saved:photo',
          filename: 'photo.jpg',
          location: 'Pictures/Qortal Go',
          uri: 'content://media/external_primary/file/8',
          mimeType: 'image/jpeg',
          savedAt,
          seen: true,
        },
      ])
    );
    vi.resetModules();
    const fresh = await import('./qdnDownloadNotifications');

    const [apk, photo] = fresh.getSavedQdnFiles();
    expect(apk).toMatchObject({
      id: 'saved:old-apk',
      filename: 'GO 3.0 v0.0.15.apk',
      location: 'Documents/Qortal Go/Apps',
      mimeType: 'application/zip',
    });
    expect(apk.uri).toBeUndefined();
    expect(photo).toMatchObject({
      id: 'saved:photo',
      uri: 'content://media/external_primary/file/8',
      mimeType: 'image/jpeg',
    });
  });
});
