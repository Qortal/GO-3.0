import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * On Android, cordova-plugin-file replaces the global File with a
 * constructor that returns a plain object, not a Blob (see namedFile.ts).
 * Copy and paste of pictures broke on the phone that way while every test
 * passed: these run them with that File in place.
 */
function CordovaFile(this: Record<string, unknown>, name: unknown) {
  this.name = name;
  this.size = 0;
}

const photoBlob = () =>
  new Blob(
    [
      readFileSync(
        resolve(__dirname, '__fixtures__/media-metadata/phone-exif-gps.jpg')
      ),
    ],
    { type: 'image/jpeg' }
  );

describe('pictures with cordova-plugin-file’s File in place', () => {
  const RealFile = globalThis.File;

  afterEach(() => {
    globalThis.File = RealFile;
    vi.resetModules();
    vi.doUnmock('@capacitor/core');
    vi.doUnmock('./platform');
  });

  it('still cleans a picture into a real Blob', async () => {
    globalThis.File = CordovaFile as unknown as typeof File;
    vi.resetModules();
    const { cleanPastedImage } = await import('./cleanPastedImage');
    const source = Object.assign(photoBlob(), { name: 'IMG.jpg' }) as File;
    const clean = await cleanPastedImage(source);
    expect(clean).toBeInstanceOf(Blob);
    expect(clean!.size).toBeGreaterThan(1000);
    expect(clean!.name).toBe('pasted-image.jpg');
    expect(clean!.type).toBe('image/jpeg');
  });

  it('turns a clipboard picture into a real Blob', async () => {
    globalThis.File = CordovaFile as unknown as typeof File;
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { getPlatform: () => 'android' },
      registerPlugin: () => ({
        readImage: async () => ({
          base64: btoa('PNGDATA'),
          mimeType: 'image/png',
          fileName: 'shot.png',
        }),
      }),
    }));
    vi.doMock('./platform', () => ({ isGoApp: () => true }));
    const { readClipboardImageFile } = await import('./nativeClipboardImage');
    const file = await readClipboardImageFile();
    expect(file).toBeInstanceOf(Blob);
    expect(file!.size).toBe(7);
    expect(file!.name).toBe('shot.png');
  });
});
