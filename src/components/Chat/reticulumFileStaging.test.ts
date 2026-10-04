import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stageReticulumFilePath } from './reticulumFileStaging';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      resolve(__dirname, '../../utils/__fixtures__/media-metadata', name)
    )
  );

const readText = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () =>
      done(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const installStager = () => {
  const stageFileForPath = vi.fn(
    async (file: File) => `mobile-file://1/${file.name}`
  );
  Object.defineProperty(window, 'reticulumResources', {
    configurable: true,
    value: { stageFileForPath },
  });
  return stageFileForPath;
};

afterEach(() => {
  Reflect.deleteProperty(window, 'reticulumResources');
});

describe('stageReticulumFilePath', () => {
  it('stages photos sent as files without their GPS/camera metadata', async () => {
    const stage = installStager();
    const photo = new File([fixture('phone-exif-gps.jpg')], 'IMG_1.jpg', {
      type: 'image/jpeg',
    });

    await expect(stageReticulumFilePath(photo)).resolves.toBe(
      'mobile-file://1/IMG_1.jpg'
    );
    const staged = stage.mock.calls[0][0];
    expect(staged).not.toBe(photo);
    expect(staged.name).toBe('IMG_1.jpg');
    const body = await readText(staged);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');

    // Staging the same pick again hands over the same cleaned File.
    await stageReticulumFilePath(photo);
    expect(stage.mock.calls[1][0]).toBe(staged);
  });

  it('stages videos without their recording location', async () => {
    const stage = installStager();
    const clip = new File([fixture('android-xyz-mdta.mp4')], 'clip.mp4', {
      type: 'video/mp4',
    });
    await stageReticulumFilePath(clip);
    const staged = stage.mock.calls[0][0];
    expect(staged.size).toBe(clip.size);
    expect(await readText(staged)).not.toContain('51.5021');
  });

  it('sniffs photos and videos whose type says nothing', async () => {
    const stage = installStager();
    const photo = new File([fixture('phone-exif-gps.jpg')], 'IMG_2', {
      type: '',
    });
    const clip = new File([fixture('android-xyz-mdta.mp4')], 'clip.bin', {
      type: 'application/octet-stream',
    });
    await stageReticulumFilePath(photo);
    await stageReticulumFilePath(clip);
    const [stagedPhoto, stagedClip] = stage.mock.calls.map((call) => call[0]);
    expect(stagedPhoto).not.toBe(photo);
    expect(stagedPhoto.name).toBe('IMG_2');
    expect(await readText(stagedPhoto)).not.toContain('GPSSECRET');
    expect(stagedClip).not.toBe(clip);
    expect(stagedClip.size).toBe(clip.size);
    expect(await readText(stagedClip)).not.toContain('51.5021');
  });

  it('stages other files untouched', async () => {
    const stage = installStager();
    const doc = new File([new Uint8Array(10)], 'notes.pdf', {
      type: 'application/pdf',
    });
    await stageReticulumFilePath(doc);
    expect(stage.mock.calls[0][0]).toBe(doc);
  });

  it('returns no path where staging is unavailable', async () => {
    await expect(stageReticulumFilePath(new File([], 'a.txt'))).resolves.toBe(
      ''
    );
  });
});
