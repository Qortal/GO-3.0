import { describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => {
  const listeners: ((image: unknown) => void)[] = [];
  return {
    listeners,
    describe: vi.fn(async () => ({ hasImage: true, stamp: 7 })),
    readImage: vi.fn(async () => ({
      base64: btoa('PNGDATA'),
      mimeType: 'image/png',
      fileName: 'shot.png',
    })),
    writeImage: vi.fn(async () => undefined),
    setImageInsertTarget: vi.fn(async () => undefined),
    addListener: vi.fn(
      async (_event: string, listener: (i: unknown) => void) => {
        listeners.push(listener);
        return { remove: async () => undefined };
      }
    ),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => plugin,
}));
vi.mock('./platform', () => ({ isGoApp: () => true }));

import {
  claimKeyboardImageTarget,
  describeClipboardImage,
  readClipboardImageFile,
} from './nativeClipboardImage';

const readText = (file: Blob) =>
  new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.readAsText(file);
  });

describe('nativeClipboardImage', () => {
  it('says whether a picture is there and reads it as a file', async () => {
    expect(await describeClipboardImage()).toEqual({
      hasImage: true,
      stamp: 7,
    });
    const file = await readClipboardImageFile();
    expect(file?.name).toBe('shot.png');
    expect(file?.type).toBe('image/png');
    expect(await readText(file!)).toBe('PNGDATA');
  });

  it('hands keyboard pictures to the focused composer only', async () => {
    const first = vi.fn();
    const release = claimKeyboardImageTarget(first);
    expect(plugin.setImageInsertTarget).toHaveBeenLastCalledWith({
      active: true,
    });
    await vi.waitFor(() => expect(plugin.listeners.length).toBe(1));
    plugin.listeners[0]({
      base64: btoa('GIF'),
      mimeType: 'image/gif',
      fileName: 'sticker.gif',
    });
    expect(first).toHaveBeenCalledWith(expect.any(File));
    release();
    expect(plugin.setImageInsertTarget).toHaveBeenLastCalledWith({
      active: false,
    });
    plugin.listeners[0]({ base64: btoa('GIF'), mimeType: 'image/gif' });
    expect(first).toHaveBeenCalledTimes(1);
  });
});
