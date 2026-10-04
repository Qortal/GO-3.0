import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stashed = vi.hoisted(() => [] as Blob[]);
const published = vi.hoisted(() => [] as Record<string, unknown>[][]);

vi.mock('../../../utils/publishFileStash', () => ({
  stashPublishFile: vi.fn((file: Blob) => {
    stashed.push(file);
    return `stash-${stashed.length}`;
  }),
  discardPublishFile: vi.fn(),
}));
vi.mock('./quitterIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitterIdentity')>()),
  buildQuitterPostIdentifier: vi.fn(
    async () => 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-abcdefghijklmno-v1'
  ),
}));
vi.mock('./quitterPublish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitterPublish')>()),
  publishMultipleResources: vi.fn(
    async (resources: Record<string, unknown>[]) => {
      published.push(resources);
      return {};
    }
  ),
}));

import { publishTorqPost } from './torqPublish';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      resolve(__dirname, '../../../utils/__fixtures__/media-metadata', name)
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

const decode = (base64: string) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    )
  );

// A photo attached to a Torq post as a file goes to public, permanent QDN.
// It must not carry its GPS position or camera model there.
describe('publishTorqPost file attachments', () => {
  beforeEach(() => {
    stashed.length = 0;
    published.length = 0;
  });

  it('publishes a photo attached as a file without its EXIF/GPS', async () => {
    const photo = new File([fixture('phone-exif-gps.jpg')], 'IMG_1.jpg', {
      type: 'image/jpeg',
    });
    expect(await readText(photo)).toContain('GPSSECRET');

    await publishTorqPost({
      text: 'holiday',
      userName: 'Alice',
      files: [{ file: photo }],
    });

    expect(stashed).toHaveLength(1);
    const body = await readText(stashed[0]);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');

    const [fileResource, , postResource] = published[0];
    expect(fileResource.filename).toBe('IMG_1.jpg');
    const post = decode(String(postResource.base64));
    expect(post.attachments[0]).toMatchObject({
      filename: 'IMG_1.jpg',
      mimeType: 'image/jpeg',
      size: stashed[0].size,
    });
  });

  it('leaves other files byte for byte', async () => {
    const pdf = new File(['%PDF-1.4 hello'], 'notes.pdf', {
      type: 'application/pdf',
    });
    await publishTorqPost({
      text: '',
      userName: 'Alice',
      files: [{ file: pdf }],
    });
    expect(stashed[0]).toBe(pdf);
  });
});
