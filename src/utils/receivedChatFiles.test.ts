import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isNative: true,
  files: new Map<string, Uint8Array>(),
  qchatFileStat: vi.fn(),
  qchatFileOpen: vi.fn(),
  qchatReceivedFileRead: vi.fn(),
  qchatReceivedFileSave: vi.fn(),
  qchatReceivedFilesClear: vi.fn(),
  ensureStoragePermission: vi.fn(),
  clearStagedShareFiles: vi.fn(async () => {}),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => native.isNative },
  };
});

vi.mock('../plugins/Reticulum', () => ({
  Reticulum: {
    qchatFileStat: native.qchatFileStat,
    qchatFileOpen: native.qchatFileOpen,
    qchatReceivedFileRead: native.qchatReceivedFileRead,
    qchatReceivedFileSave: native.qchatReceivedFileSave,
    qchatReceivedFilesClear: native.qchatReceivedFilesClear,
  },
}));

vi.mock('../plugins/FileWriter', () => ({
  ensureNativeStoragePermission: native.ensureStoragePermission,
}));

vi.mock('./mobileFileShare', () => ({
  clearStagedShareFiles: native.clearStagedShareFiles,
}));

import { OPEN_FILE_VIEWER_EVENT } from './fileViewerEvents';
import { executeEvent } from './events';
import {
  clearReceivedChatFiles,
  installReceivedChatFileCleanup,
  isPrivateReceivedChatFile,
  openReceivedChatFile,
  readReceivedChatFile,
  receivedFileDisplayName,
  saveReceivedChatFile,
} from './receivedChatFiles';

const PRIVATE =
  '/data/user/0/com.github.Qortal.qortalMobile/files/qchat-received/1f2e';
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function putFile(path: string, bytes: Uint8Array) {
  native.files.set(path, bytes);
}

describe('received chat files (N-22, N-27)', () => {
  let viewerRequests: Array<Record<string, unknown>>;
  const onViewer = (event: Event) =>
    viewerRequests.push((event as CustomEvent).detail);

  beforeEach(() => {
    native.isNative = true;
    native.files.clear();
    viewerRequests = [];
    document.addEventListener(OPEN_FILE_VIEWER_EVENT, onViewer);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    native.qchatFileStat.mockReset().mockImplementation(async ({ path }) => {
      const bytes = native.files.get(path);
      return { exists: !!bytes, size: bytes?.length ?? 0 };
    });
    native.qchatFileOpen.mockReset().mockResolvedValue({ ok: true });
    native.qchatReceivedFileRead
      .mockReset()
      .mockImplementation(async ({ path, offset, length }) => {
        const bytes = native.files.get(path);
        if (!bytes) {
          throw Object.assign(new Error('Received file not found'), {
            code: 'NOT_FOUND',
          });
        }
        const slice = bytes.subarray(offset, offset + length);
        return {
          dataBase64: toBase64(slice),
          bytesRead: slice.length,
          size: bytes.length,
          eof: offset + slice.length >= bytes.length,
        };
      });
    native.qchatReceivedFileSave
      .mockReset()
      .mockImplementation(async ({ path, fileName }) => {
        if (!native.files.has(path)) {
          throw Object.assign(new Error('Received file not found'), {
            code: 'NOT_FOUND',
          });
        }
        return {
          ok: true,
          uri: 'content://media/external/file/77',
          name: fileName,
          folder: 'Qortal Go/Images',
        };
      });
    native.qchatReceivedFilesClear
      .mockReset()
      .mockResolvedValue({ ok: true, deleted: 3 });
    native.ensureStoragePermission.mockReset().mockResolvedValue(true);
    native.clearStagedShareFiles.mockReset().mockResolvedValue(undefined);
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = () => 'blob:test';
      (URL as any).revokeObjectURL = () => {};
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:received-file');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    document.removeEventListener(OPEN_FILE_VIEWER_EVENT, onViewer);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows the cleaned name, never the bidi-reversed one', () => {
    expect(receivedFileDisplayName({ fileName: 'holiday\u202Egpj.apk' })).toBe(
      'holidaygpj.apk'
    );
    expect(receivedFileDisplayName({ path: `${PRIVATE}/scan.pdf` })).toBe(
      'scan.pdf'
    );
  });

  it('calls only a file this build received private', () => {
    expect(isPrivateReceivedChatFile({ path: `${PRIVATE}/scan.pdf` })).toBe(
      true
    );
    // Up to v0.0.14: app-specific external storage, plus a Downloads copy.
    const legacy =
      '/storage/emulated/0/Android/data/com.github.Qortal.qortalMobile/files/Download/QortalFiles/scan.pdf';
    expect(isPrivateReceivedChatFile({ path: legacy })).toBe(false);
    expect(
      isPrivateReceivedChatFile({
        path: legacy,
        legacyUri: 'content://media/external/downloads/4',
      })
    ).toBe(false);
    expect(
      isPrivateReceivedChatFile({
        path: `${PRIVATE}/scan.pdf`,
        legacyUri: 'content://media/external/downloads/4',
      })
    ).toBe(false);
    expect(isPrivateReceivedChatFile({ path: '' })).toBe(false);
    expect(
      isPrivateReceivedChatFile({ path: '/x/qchat-received-old/u/a.pdf' })
    ).toBe(false);
  });

  it('reads a file in slices', async () => {
    const bytes = new Uint8Array(1_300_000).map((_, i) => i % 251);
    putFile(`${PRIVATE}/big.bin`, bytes);
    const blob = await readReceivedChatFile(`${PRIVATE}/big.bin`, bytes.length);
    expect(native.qchatReceivedFileRead).toHaveBeenCalledTimes(3);
    expect(blob.size).toBe(bytes.length);
    const back = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(blob);
      })
    );
    expect(back[0]).toBe(0);
    expect(back[1_299_999]).toBe(1_299_999 % 251);
  });

  it('opens a received file in GO viewer, not in another app', async () => {
    vi.useFakeTimers();
    putFile(`${PRIVATE}/photo.jpg`, new Uint8Array([0xff, 0xd8, 0xff]));
    const result = await openReceivedChatFile({
      path: `${PRIVATE}/photo.jpg`,
      legacyUri: 'content://media/external/downloads/12',
      fileName: 'photo.jpg',
    });
    expect(result).toEqual({ ok: true, via: 'viewer' });
    expect(viewerRequests).toEqual([
      { url: 'blob:received-file', fileName: 'photo.jpg', fileSize: 3 },
    ]);
    expect(native.qchatFileOpen).not.toHaveBeenCalled();
    // The url only lives long enough for the viewer to read it.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:received-file');
  });

  it('hands a file too large for the viewer to another app as text when it is a page', async () => {
    putFile(`${PRIVATE}/site.html`, new Uint8Array(10));
    const result = await openReceivedChatFile(
      { path: `${PRIVATE}/site.html`, fileName: 'site.html' },
      { viewerMaxBytes: 5 }
    );
    expect(result).toEqual({ ok: true, via: 'app' });
    expect(viewerRequests).toEqual([]);
    expect(native.qchatFileOpen).toHaveBeenCalledWith({
      uri: `${PRIVATE}/site.html`,
      fileName: 'site.html',
      mimeType: 'text/plain',
    });
  });

  it('never opens an app package, however it is disguised', async () => {
    putFile(`${PRIVATE}/holidaygpj.apk`, new Uint8Array([0x50, 0x4b]));
    const result = await openReceivedChatFile({
      path: `${PRIVATE}/holidaygpj.apk`,
      fileName: 'holiday\u202Egpj.apk',
    });
    expect(result).toEqual({ ok: false, reason: 'package' });
    expect(native.qchatReceivedFileRead).not.toHaveBeenCalled();
    expect(native.qchatFileOpen).not.toHaveBeenCalled();
    expect(viewerRequests).toEqual([]);
  });

  it('still opens a file an older build copied to Downloads', async () => {
    const result = await openReceivedChatFile({
      path: '/storage/emulated/0/Android/data/x/files/Download/QortalFiles/a.pdf',
      legacyUri: 'content://media/external/downloads/12',
      fileName: 'a.pdf',
    });
    expect(result).toEqual({ ok: true, via: 'app' });
    expect(native.qchatFileOpen).toHaveBeenCalledWith({
      uri: 'content://media/external/downloads/12',
      fileName: 'a.pdf',
    });
  });

  it('opens an older build private copy in the viewer', async () => {
    const legacyPath =
      '/storage/emulated/0/Android/data/x/files/Download/QortalFiles/n.txt';
    putFile(legacyPath, new TextEncoder().encode('hi'));
    const result = await openReceivedChatFile({
      path: legacyPath,
      legacyUri: 'content://media/external/downloads/13',
      fileName: 'n.txt',
    });
    expect(result).toEqual({ ok: true, via: 'viewer' });
  });

  it('reports a file that is gone', async () => {
    const result = await openReceivedChatFile({
      path: `${PRIVATE}/gone.jpg`,
      fileName: 'gone.jpg',
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
    expect(native.qchatFileOpen).not.toHaveBeenCalled();
  });

  it('falls back to another app when the viewer read fails', async () => {
    putFile(`${PRIVATE}/a.mp4`, new Uint8Array(4));
    native.qchatReceivedFileRead.mockRejectedValueOnce(new Error('io'));
    const result = await openReceivedChatFile({
      path: `${PRIVATE}/a.mp4`,
      fileName: 'a.mp4',
    });
    expect(result).toEqual({ ok: true, via: 'app' });
    expect(viewerRequests).toEqual([]);
  });

  it('saves to the device only when asked, under the cleaned name', async () => {
    putFile(`${PRIVATE}/holidaygpj.jpg`, new Uint8Array(4));
    const result = await saveReceivedChatFile({
      path: `${PRIVATE}/holidaygpj.jpg`,
      fileName: 'holiday\u2066gpj.jpg',
    });
    expect(result).toEqual({
      ok: true,
      name: 'holidaygpj.jpg',
      location: 'Documents/Qortal Go/Images/holidaygpj.jpg',
      uri: 'content://media/external/file/77',
    });
    expect(native.ensureStoragePermission).toHaveBeenCalled();
    expect(native.qchatReceivedFileSave).toHaveBeenCalledWith({
      path: `${PRIVATE}/holidaygpj.jpg`,
      fileName: 'holidaygpj.jpg',
    });
  });

  it('reports the name the save really got', async () => {
    putFile(`${PRIVATE}/photo.jpg`, new Uint8Array(2));
    native.qchatReceivedFileSave.mockResolvedValueOnce({
      ok: true,
      uri: 'content://media/external/file/78',
      name: 'photo (1).jpg',
      folder: 'Qortal Go/Images',
    });
    const result = await saveReceivedChatFile({
      path: `${PRIVATE}/photo.jpg`,
      fileName: 'photo.jpg',
    });
    expect(result.location).toBe('Documents/Qortal Go/Images/photo (1).jpg');
  });

  it('says why a save did not happen', async () => {
    native.ensureStoragePermission.mockResolvedValueOnce(false);
    putFile(`${PRIVATE}/a.jpg`, new Uint8Array(1));
    await expect(
      saveReceivedChatFile({ path: `${PRIVATE}/a.jpg`, fileName: 'a.jpg' })
    ).resolves.toEqual({ ok: false, reason: 'permission' });
    expect(native.qchatReceivedFileSave).not.toHaveBeenCalled();

    await expect(
      saveReceivedChatFile({ path: `${PRIVATE}/b.jpg`, fileName: 'b.jpg' })
    ).resolves.toEqual({ ok: false, reason: 'missing' });

    await expect(
      saveReceivedChatFile({
        path: `${PRIVATE}/b.jpg`,
        legacyUri: 'content://media/external/downloads/12',
        fileName: 'b.jpg',
      })
    ).resolves.toEqual({ ok: false, reason: 'already_public' });
  });

  it('clears received files on logout, once installed', async () => {
    const uninstall = installReceivedChatFileCleanup();
    // A second install is a no-op: one clear per logout.
    installReceivedChatFileCleanup();
    executeEvent('logout-event', {});
    await Promise.resolve();
    expect(native.qchatReceivedFilesClear).toHaveBeenCalledTimes(1);
    // Copies staged for Share / "Open with" are deleted too.
    expect(native.clearStagedShareFiles).toHaveBeenCalledTimes(1);
    uninstall();
    executeEvent('logout-event', {});
    await Promise.resolve();
    expect(native.qchatReceivedFilesClear).toHaveBeenCalledTimes(1);
    expect(native.clearStagedShareFiles).toHaveBeenCalledTimes(1);
    await expect(clearReceivedChatFiles()).resolves.toBe(3);
  });

  it('does nothing outside the Android app', async () => {
    native.isNative = false;
    expect(installReceivedChatFileCleanup()).toBeTypeOf('function');
    executeEvent('logout-event', {});
    await expect(clearReceivedChatFiles()).resolves.toBe(0);
    expect(native.qchatReceivedFilesClear).not.toHaveBeenCalled();
    await expect(
      saveReceivedChatFile({ path: `${PRIVATE}/a.jpg` })
    ).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});
