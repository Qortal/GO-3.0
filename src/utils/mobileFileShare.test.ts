import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  isNative: true,
  rmdir: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => fs.isNative },
  };
});

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    rmdir: fs.rmdir,
    writeFile: fs.writeFile,
    appendFile: fs.appendFile,
  },
}));

import {
  clearStagedShareFiles,
  stageMobileFileForSharing,
} from './mobileFileShare';

const SHARE_DIR = { path: 'shared-files', directory: 'CACHE', recursive: true };

describe('clearStagedShareFiles (N-22)', () => {
  beforeEach(() => {
    fs.isNative = true;
    fs.rmdir.mockReset().mockResolvedValue(undefined);
    fs.writeFile
      .mockReset()
      .mockImplementation(async ({ path }) => ({
        uri: `file:///cache/${path}`,
      }));
    fs.appendFile.mockReset().mockResolvedValue(undefined);
  });

  it('deletes the staged copies and stages the file again afterwards', async () => {
    // Empty: jsdom's Blob has no arrayBuffer() for the sliced write path.
    const blob = new Blob([]);
    const first = await stageMobileFileForSharing('k', 'a.txt', blob);
    // Reused while staged: "Share" then "Open with" write it once.
    await expect(stageMobileFileForSharing('k', 'a.txt', blob)).resolves.toBe(
      first
    );
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    fs.rmdir.mockClear();
    await clearStagedShareFiles();
    expect(fs.rmdir).toHaveBeenCalledWith(SHARE_DIR);

    await stageMobileFileForSharing('k', 'a.txt', blob);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('never throws when there is nothing to delete', async () => {
    fs.rmdir.mockRejectedValue(new Error('Folder does not exist.'));
    await expect(clearStagedShareFiles()).resolves.toBeUndefined();
  });

  it('touches no files outside the Android app', async () => {
    fs.isNative = false;
    await clearStagedShareFiles();
    expect(fs.rmdir).not.toHaveBeenCalled();
  });
});
