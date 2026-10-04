import { beforeEach, describe, expect, it, vi } from 'vitest';

const reticulum = vi.hoisted(() => ({
  qchatFileOpen: vi.fn(
    async (_options: Record<string, unknown>) =>
      ({ ok: true }) as { ok: boolean }
  ),
}));

vi.mock('../plugins/Reticulum', () => ({ Reticulum: reticulum }));
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => true },
  };
});

import {
  externalOpenMimeType,
  isPackageOpenRefusal,
  isPageLikeFile,
  isRefusedForOpen,
  openFileInViewerApp,
  PACKAGE_ARCHIVE_REFUSED,
} from './nativeFileOpen';
import { openSavedMobileFile } from './mobileFileSave';
import { openStagedMobileFileWith } from './mobileFileShare';

const PACKAGE_MIME = 'application/vnd.android.package-archive';

// N-31 / review issue 4: GO hands no app package to Android from any open
// path; only GO's own updater installs. Packages are refused before native.
describe('opening files in another app', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reticulum.qchatFileOpen.mockClear();
    reticulum.qchatFileOpen.mockImplementation(async () => ({ ok: true }));
  });

  it.each([
    ['GO.apk', undefined, 'content://media/external/downloads/12'],
    ['GO 3.0 v0.0.15.xapk', undefined, 'content://media/external/file/3'],
    ['GO.аpk', undefined, 'content://media/external/file/4'],
    ['update.bin', PACKAGE_MIME, 'content://media/external/file/5'],
    [undefined, undefined, '/data/user/0/app/files/qchat/GO.apk'],
  ])(
    'refuses %s (%s) without asking native',
    async (fileName, mimeType, uri) => {
      const error = await openFileInViewerApp({
        uri,
        fileName,
        mimeType,
      }).catch((err) => err);
      expect(isPackageOpenRefusal(error)).toBe(true);
      expect(error.code).toBe(PACKAGE_ARCHIVE_REFUSED);
      expect(reticulum.qchatFileOpen).not.toHaveBeenCalled();
    }
  );

  it('hands other files over with their type', async () => {
    await expect(
      openFileInViewerApp({
        uri: 'content://media/external/file/9',
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
      })
    ).resolves.toEqual({ ok: true });
    expect(reticulum.qchatFileOpen).toHaveBeenCalledWith({
      uri: 'content://media/external/file/9',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('recognises the native refusal by its code', async () => {
    reticulum.qchatFileOpen.mockRejectedValueOnce(
      Object.assign(new Error('GO does not open app packages'), {
        code: PACKAGE_ARCHIVE_REFUSED,
      })
    );
    const error = await openFileInViewerApp({
      uri: 'content://media/external/file/10',
      fileName: 'archive.zip',
    }).catch((err) => err);
    expect(isPackageOpenRefusal(error)).toBe(true);
    expect(isPackageOpenRefusal(new Error('other'))).toBe(false);
  });

  it('isRefusedForOpen leaves ordinary files alone', () => {
    expect(isRefusedForOpen({ fileName: 'photo.jpg' })).toBe(false);
    expect(isRefusedForOpen({ fileName: 'notes.apkx' })).toBe(false);
    expect(isRefusedForOpen({ uri: 'content://media/external/file/1' })).toBe(
      false
    );
  });

  it('openSavedMobileFile reports false for a package and never opens it', async () => {
    await expect(
      openSavedMobileFile('content://media/external/file/7', 'GO.apk')
    ).resolves.toBe(false);
    expect(reticulum.qchatFileOpen).not.toHaveBeenCalled();

    await expect(
      openSavedMobileFile('content://media/external/file/8', 'a.pdf')
    ).resolves.toBe(true);
    expect(reticulum.qchatFileOpen).toHaveBeenCalledTimes(1);
  });

  it('openStagedMobileFileWith rejects a package with the refusal code', async () => {
    const error = await openStagedMobileFileWith(
      'content://app.fileprovider/share/GO.apk',
      'GO.apk',
      PACKAGE_MIME
    ).catch((err) => err);
    expect(isPackageOpenRefusal(error)).toBe(true);
    expect(reticulum.qchatFileOpen).not.toHaveBeenCalled();
  });
});

// N-27: a sender's page or script never opens as a live page in a browser.
describe('the type a file is handed to another app with', () => {
  beforeEach(() => {
    reticulum.qchatFileOpen.mockClear();
  });

  it.each([
    ['site.html'],
    ['site.HTM'],
    ['page.xhtml'],
    ['saved.mhtml'],
    ['logo.svg'],
    ['feed.xml'],
    ['style.xsl'],
    ['run.js'],
    ['site.html.'],
    ['site.ht\u200Bml'],
    // XML types Android's MimeTypeMap maps to "+xml" (review: an .rss could
    // reach a browser through the extension guess).
    ['feed.rss'],
    ['feed.atom'],
    ['places.kml'],
    ['list.xspf'],
    ['graph.rdf'],
    ['show.smil'],
    ['formula.mathml'],
  ])('opens %s as plain text', async (fileName) => {
    expect(isPageLikeFile(fileName)).toBe(true);
    await openFileInViewerApp({ uri: '/data/x/files/a', fileName });
    expect(reticulum.qchatFileOpen).toHaveBeenCalledWith({
      uri: '/data/x/files/a',
      fileName,
      mimeType: 'text/plain',
    });
  });

  it('judges a declared page type the same way', () => {
    expect(externalOpenMimeType('download', 'text/html; charset=utf-8')).toBe(
      'text/plain'
    );
    expect(externalOpenMimeType('feed', 'application/rss+xml')).toBe(
      'text/plain'
    );
    expect(externalOpenMimeType('x.bin', 'image/svg+xml')).toBe('text/plain');
  });

  it('leaves every other type alone', () => {
    expect(externalOpenMimeType('photo.jpg')).toBeUndefined();
    expect(externalOpenMimeType('a.pdf', 'application/pdf')).toBe(
      'application/pdf'
    );
    expect(externalOpenMimeType('notes.md', 'text/plain')).toBe('text/plain');
    expect(isPageLikeFile('archive.zip')).toBe(false);
    expect(isPageLikeFile('script.json')).toBe(false);
  });

  it('still gives a package the archive type', () => {
    expect(externalOpenMimeType('GO.apk')).toBe('application/zip');
  });
});
