import { describe, expect, it } from 'vitest';
import {
  ANDROID_PACKAGE_MIME,
  PACKAGE_OPEN_MIME,
  isAndroidPackageFile,
  safeOpenMimeType,
} from './androidPackageFiles';

describe('isAndroidPackageFile', () => {
  it.each([
    'GO 3.0 v0.0.15.apk',
    'game.APK',
    'split.apks',
    'bundle.xapk',
    'mirror.apkm',
    'release.aab',
    'GO.apk.',
    'GO.apk ',
    // GO's name cleaning turns "GO.apk?" into this.
    'GO.apk_',
  ])('treats %s as a package', (name) => {
    expect(isAndroidPackageFile(name)).toBe(true);
  });

  it.each([
    ['a zero-width space', 'GO.apk\u200B'],
    ['a zero-width joiner inside', 'GO.a\u200Dpk'],
    ['a right-to-left mark', 'GO\u200F.apk'],
    ['a Cyrillic a', 'GO.\u0430pk'],
    ['a Cyrillic p and k', 'GO.a\u0440\u043A'],
    ['capital Cyrillic letters', 'GO.\u0410\u0420\u041A'],
    ['a Greek kappa', 'GO.ap\u03BA'],
    ['a Cyrillic x', 'bundle.\u0445apk'],
    ['fullwidth letters', 'GO\uFF0E\uFF41\uFF50\uFF4B'],
  ])('sees through %s', (_label, name) => {
    expect(isAndroidPackageFile(name)).toBe(true);
  });

  it.each([
    'photo.jpg',
    'notes.apk.txt',
    'notes.apk_backup',
    'apk',
    'archive.zip',
    // Cyrillic text that is not an extension stays an ordinary file.
    '\u043F\u0440\u0438\u0432\u0435\u0442.txt',
    '',
    undefined,
  ])('treats %s as an ordinary file', (name) => {
    expect(isAndroidPackageFile(name)).toBe(false);
  });

  it('goes by the type when the name does not say', () => {
    expect(isAndroidPackageFile('update.bin', ANDROID_PACKAGE_MIME)).toBe(true);
    expect(
      isAndroidPackageFile('update', 'Application/Vnd.Android.Package-Archive')
    ).toBe(true);
    expect(isAndroidPackageFile('update.bin', 'application/zip')).toBe(false);
  });
});

describe('safeOpenMimeType', () => {
  it('opens a package as a zip, whatever type it came with', () => {
    expect(safeOpenMimeType('GO.apk')).toBe(PACKAGE_OPEN_MIME);
    expect(safeOpenMimeType('GO.apk', ANDROID_PACKAGE_MIME)).toBe(
      PACKAGE_OPEN_MIME
    );
    expect(safeOpenMimeType('GO.apk', 'application/octet-stream')).toBe(
      PACKAGE_OPEN_MIME
    );
    expect(safeOpenMimeType('innocent.pdf', ANDROID_PACKAGE_MIME)).toBe(
      PACKAGE_OPEN_MIME
    );
    // Not a type the native open paths would swap for the extension's guess.
    expect(PACKAGE_OPEN_MIME).not.toBe('application/octet-stream');
    expect(PACKAGE_OPEN_MIME).not.toContain('package-archive');
  });

  it('leaves every other file alone', () => {
    expect(safeOpenMimeType('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(safeOpenMimeType('a.pdf')).toBeUndefined();
    expect(safeOpenMimeType('a.pdf', '')).toBeUndefined();
  });
});
