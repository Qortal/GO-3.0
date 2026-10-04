import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sniffMediaKind, stripAttachmentMetadata } from './stripFileMetadata';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(resolve(__dirname, '__fixtures__/media-metadata', name))
  );

const readText = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () =>
      done(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(blob);
  });

/** An ftyp box with the given major and compatible brands. */
const ftyp = (major: string, ...compatible: string[]) => {
  const size = 16 + compatible.length * 4;
  const out = Buffer.alloc(size + 16);
  out.writeUInt32BE(size, 0);
  out.write('ftyp', 4, 'latin1');
  out.write(major, 8, 'latin1');
  compatible.forEach((brand, i) => out.write(brand, 16 + i * 4, 'latin1'));
  // A top-level meta box follows, as in HEIF images and tagged audio.
  out.writeUInt32BE(16, size);
  out.write('meta', size + 4, 'latin1');
  return new Uint8Array(out);
};

describe('sniffMediaKind', () => {
  it('recognises photos and MP4/MOV video by their first bytes', () => {
    expect(sniffMediaKind(fixture('phone-exif-gps.jpg'))).toBe('image');
    expect(sniffMediaKind(fixture('exif-text.png'))).toBe('image');
    expect(sniffMediaKind(fixture('exif-xmp.webp'))).toBe('image');
    expect(sniffMediaKind(fixture('android-xyz-mdta.mp4'))).toBe('video');
    expect(sniffMediaKind(fixture('iphone-mdta-faststart.mov'))).toBe('video');
  });

  it('never treats HEIF/AVIF images or MP4 audio as video', () => {
    expect(sniffMediaKind(ftyp('heic', 'mif1', 'heic'))).toBeNull();
    expect(sniffMediaKind(ftyp('mif1', 'heic', 'miaf'))).toBeNull();
    expect(sniffMediaKind(ftyp('avif', 'avif', 'mif1'))).toBeNull();
    expect(sniffMediaKind(ftyp('M4A ', 'M4A ', 'isom'))).toBeNull();
    expect(sniffMediaKind(ftyp('isom', 'iso2', 'mp41'))).toBe('video');
    expect(sniffMediaKind(new Uint8Array(32))).toBeNull();
  });
});

describe('stripAttachmentMetadata', () => {
  it('strips a photo attached as a file', async () => {
    const photo = new File([fixture('phone-exif-gps.jpg')], 'IMG_1.jpg', {
      type: 'image/jpeg',
    });
    const out = await stripAttachmentMetadata(photo);
    expect(out).not.toBe(photo);
    expect(out.name).toBe('IMG_1.jpg');
    const body = await readText(out);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');
  });

  it('leaves untyped HEIF and audio, and typed documents, untouched', async () => {
    const heif = new File([ftyp('heic', 'mif1', 'heic')], 'IMG_3', {
      type: '',
    });
    expect(await stripAttachmentMetadata(heif)).toBe(heif);
    const song = new File([ftyp('M4A ', 'M4A ')], 'song.m4a', {
      type: 'application/octet-stream',
    });
    expect(await stripAttachmentMetadata(song)).toBe(song);
    // Phone recorders write an mp42/isom brand into .m4a voice notes.
    const memo = new File([ftyp('mp42', 'isom', 'mp42')], 'Voice 001.m4a', {
      type: '',
    });
    expect(await stripAttachmentMetadata(memo)).toBe(memo);
    // A declared non-media type is trusted, whatever the bytes look like.
    const doc = new File([fixture('phone-exif-gps.jpg')], 'scan.pdf', {
      type: 'application/pdf',
    });
    expect(await stripAttachmentMetadata(doc)).toBe(doc);
  });
});
