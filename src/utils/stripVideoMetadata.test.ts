import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  scrubMovieBox,
  scrubMp4Metadata,
  scrubVideoFileMetadata,
} from './stripVideoMetadata';

/*
 * Fixtures (ffmpeg-made, 0.3 s, real box layouts):
 * - android-xyz-mdta.mp4: moov last; moov/udta/©xyz location the way Android's
 *   MPEG4Writer writes it, moov/meta mdta keys (com.android.manufacturer /
 *   model) and a file-level XMP uuid box with GPS.
 * - android-location.mp4: 3GPP moov/udta/loci location, make/model tags and a
 *   creation time.
 * - iphone-mdta-faststart.mov: QuickTime, moov BEFORE mdat (so any shift would
 *   break the sample offsets), com.apple.quicktime.location.ISO6709 keys.
 * The scrubbed files were checked offline: ffmpeg decodes identical frames
 * (framemd5) and ffprobe reports no location/make/model/creation_time.
 */
const fixtureBytes = (name: string) =>
  new Uint8Array(
    readFileSync(resolve(__dirname, '__fixtures__/media-metadata', name))
  );
const fixtureBlob = (name: string, type = 'video/mp4') =>
  new Blob([fixtureBytes(name)], { type });

const SECRETS = ['51.5021', 'PrivateModel', 'SecretPhoneCo', 'xmpmeta', 'loci'];

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const blobBytes = async (blob: Blob) =>
  new Uint8Array(
    await new Promise<ArrayBuffer>((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result as ArrayBuffer);
      reader.onerror = () => fail(reader.error);
      reader.readAsArrayBuffer(blob);
    })
  );

type Box = { type: string; start: number; size: number; header: number };

const topLevelBoxes = (bytes: Uint8Array): Box[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  let p = 0;
  while (p + 8 <= bytes.length) {
    let size = view.getUint32(p);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(p + 8));
      header = 16;
    }
    out.push({
      type: latin1(bytes.subarray(p + 4, p + 8)),
      start: p,
      size,
      header,
    });
    p += size;
  }
  return out;
};

const box = (type: string, ...children: Uint8Array[]) => {
  const size = 8 + children.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(Buffer.from(type, 'latin1'), 4);
  let p = 8;
  for (const child of children) {
    out.set(child, p);
    p += child.length;
  }
  return out;
};

describe('scrubMp4Metadata', () => {
  it('turns Android location, device keys and XMP into free boxes in place', async () => {
    const source = fixtureBytes('android-xyz-mdta.mp4');
    expect(latin1(source)).toContain('51.5021');
    const result = await scrubMp4Metadata(fixtureBlob('android-xyz-mdta.mp4'));
    if (result.ok === false) throw new Error(result.reason);

    expect(result.changed).toBe(true);
    expect(result.scrubbed).toEqual([
      'moov/udta', // ffmpeg's own encoder tag
      'moov/udta', // ©xyz location
      'moov/meta', // com.android.* keys
      'uuid', // XMP
    ]);
    const out = await blobBytes(result.blob);
    expect(out.length).toBe(source.length);
    const body = latin1(out);
    for (const secret of SECRETS) expect(body).not.toContain(secret);

    // ftyp and mdat (the actual audio/video) are untouched, and every box
    // keeps its offset and size.
    const before = topLevelBoxes(source);
    const after = topLevelBoxes(out);
    expect(after.map((b) => [b.start, b.size])).toEqual(
      before.map((b) => [b.start, b.size])
    );
    expect(after.map((b) => b.type)).toEqual([
      'ftyp',
      'free',
      'mdat',
      'moov',
      'free',
    ]);
    for (const b of before.filter(
      (x) => x.type === 'ftyp' || x.type === 'mdat'
    )) {
      expect(
        out
          .subarray(b.start, b.start + b.size)
          .every((value, i) => value === source[b.start + i])
      ).toBe(true);
    }
    // The former XMP uuid box is now zero-filled.
    const xmp = after[4];
    expect(
      out
        .subarray(xmp.start + xmp.header, xmp.start + xmp.size)
        .every((v) => v === 0)
    ).toBe(true);
  });

  it('removes 3GPP loci and zeroes the recording time', async () => {
    const result = await scrubMp4Metadata(fixtureBlob('android-location.mp4'));
    if (result.ok === false) throw new Error(result.reason);
    expect(result.scrubbed).toContain('moov/udta');
    expect(result.scrubbed).toContain('moov/mvhd:time');
    expect(result.scrubbed).toContain('moov/trak/tkhd:time');
    expect(result.scrubbed).toContain('moov/trak/mdia/mdhd:time');
    const out = await blobBytes(result.blob);
    for (const secret of SECRETS) expect(latin1(out)).not.toContain(secret);
    // mvhd version 0: creation + modification times are bytes 12..20 of the box.
    const moov = topLevelBoxes(out).find((b) => b.type === 'moov');
    const mvhd = moov.start + 8;
    expect(latin1(out.subarray(mvhd + 4, mvhd + 8))).toBe('mvhd');
    expect(out.subarray(mvhd + 12, mvhd + 20).every((v) => v === 0)).toBe(true);
  });

  it('keeps sample offsets valid when moov comes before mdat (faststart)', async () => {
    const source = fixtureBytes('iphone-mdta-faststart.mov');
    const result = await scrubMp4Metadata(
      fixtureBlob('iphone-mdta-faststart.mov', 'video/quicktime')
    );
    if (result.ok === false) throw new Error(result.reason);
    expect(result.scrubbed).toEqual(['moov/udta']);
    expect(result.blob.type).toBe('video/quicktime');
    const out = await blobBytes(result.blob);
    for (const secret of SECRETS) expect(latin1(out)).not.toContain(secret);
    const mdat = topLevelBoxes(out).find((b) => b.type === 'mdat');
    expect(topLevelBoxes(source).find((b) => b.type === 'mdat')).toEqual(mdat);
    expect(
      out
        .subarray(mdat.start, mdat.start + mdat.size)
        .every((value, i) => value === source[mdat.start + i])
    ).toBe(true);
  });

  it('returns the same Blob when there is nothing to remove', async () => {
    const clean = new Blob(
      [
        box('ftyp', Buffer.from('isom\0\0\0\0isom', 'latin1')),
        box('mdat', new Uint8Array(32)),
        box('moov', box('trak', box('mdia'))),
      ],
      { type: 'video/mp4' }
    );
    const result = await scrubMp4Metadata(clean);
    expect(result).toEqual({
      ok: true,
      blob: clean,
      changed: false,
      scrubbed: [],
    });
  });

  it('handles 64-bit box sizes', () => {
    const udta = new Uint8Array(16 + 12);
    const view = new DataView(udta.buffer);
    view.setUint32(0, 1);
    udta.set(Buffer.from('udta', 'latin1'), 4);
    view.setBigUint64(8, BigInt(udta.length));
    udta.set(Buffer.from('+51.5021-0.1/', 'latin1').subarray(0, 12), 16);
    const moov = box('moov', udta);
    expect(scrubMovieBox(moov)).toEqual(['moov/udta']);
    expect(latin1(moov.subarray(12, 16))).toBe('free');
    expect(new DataView(moov.buffer).getBigUint64(16)).toBe(BigInt(28));
    expect(moov.subarray(24).every((v) => v === 0)).toBe(true);
  });

  it('still scrubs the movie when non-box bytes follow the last box', async () => {
    const source = fixtureBytes('android-xyz-mdta.mp4');
    const tail = Buffer.from(
      'SEFH\x6a\0\0\0\x01\0\0\0junk-from-a-vendor-trailer-SEFT',
      'latin1'
    );
    const withTail = new Uint8Array(source.length + tail.length);
    withTail.set(source);
    withTail.set(tail, source.length);

    const result = await scrubMp4Metadata(new Blob([withTail]));
    if (result.ok === false) throw new Error(result.reason);
    expect(result.scrubbed).toContain('moov/udta');
    const out = await blobBytes(result.blob);
    expect(out.length).toBe(withTail.length);
    for (const secret of SECRETS) expect(latin1(out)).not.toContain(secret);
    // An unknown tail is left exactly as it was.
    expect(latin1(out.subarray(source.length))).toBe(latin1(tail));
  });

  it('zero-fills a Samsung SEF trailer (capture time, country code)', async () => {
    const source = fixtureBytes('android-xyz-mdta.mp4');
    const u32le = (value: number) => {
      const out = Buffer.alloc(4);
      out.writeUInt32LE(value);
      return out;
    };
    const entry = (type: number, name: string, value: string) =>
      Buffer.concat([
        Buffer.from([0, 0, type & 0xff, type >> 8]),
        u32le(name.length),
        Buffer.from(name, 'latin1'),
        Buffer.from(value, 'latin1'),
      ]);
    const time = entry(0x0a01, 'Image_UTC_Data', '1727712000123');
    const mcc = entry(0x0a20, 'MCC_Data', '234');
    const data = Buffer.concat([time, mcc]);
    // Offsets count back from the start of the SEFH directory.
    const directory = Buffer.concat([
      Buffer.from('SEFH', 'latin1'),
      u32le(106),
      u32le(2),
      Buffer.from([0, 0, 0x01, 0x0a]),
      u32le(data.length),
      u32le(time.length),
      Buffer.from([0, 0, 0x20, 0x0a]),
      u32le(mcc.length),
      u32le(mcc.length),
    ]);
    const trailer = Buffer.concat([
      data,
      directory,
      u32le(directory.length),
      Buffer.from('SEFT', 'latin1'),
    ]);
    const withTrailer = new Uint8Array(source.length + trailer.length);
    withTrailer.set(source);
    withTrailer.set(trailer, source.length);

    const result = await scrubMp4Metadata(
      new Blob([withTrailer], { type: 'video/mp4' })
    );
    if (result.ok === false) throw new Error(result.reason);
    expect(result.scrubbed).toContain('trailer:SEF');
    const out = await blobBytes(result.blob);
    expect(out.length).toBe(withTrailer.length);
    const body = latin1(out);
    for (const secret of [...SECRETS, 'Image_UTC_Data', '1727712000123']) {
      expect(body).not.toContain(secret);
    }
    expect(out.subarray(source.length).every((v) => v === 0)).toBe(true);
    // Everything before the trailer matches the plain scrub.
    const plain = await scrubMp4Metadata(fixtureBlob('android-xyz-mdta.mp4'));
    if (plain.ok === false) throw new Error(plain.reason);
    const plainBytes = await blobBytes(plain.blob);
    expect(
      out.subarray(0, source.length).every((v, i) => v === plainBytes[i])
    ).toBe(true);
  });

  it('leaves non-MP4 video alone and refuses broken files', async () => {
    const webm = new Blob(
      [Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(28).fill(0)])],
      { type: 'video/webm' }
    );
    expect(await scrubMp4Metadata(webm)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    const truncated = fixtureBytes('android-xyz-mdta.mp4').subarray(0, 2500);
    expect(await scrubMp4Metadata(new Blob([truncated]))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('scrubVideoFileMetadata', () => {
  it('keeps the file name and size', async () => {
    const file = new File([fixtureBytes('android-xyz-mdta.mp4')], 'clip.mp4', {
      type: 'video/mp4',
    });
    const out = await scrubVideoFileMetadata(file);
    expect(out).not.toBe(file);
    expect((out as File).name).toBe('clip.mp4');
    expect(out.size).toBe(file.size);
    expect(latin1(await blobBytes(out))).not.toContain('51.5021');
  });

  it('returns the input when the video cannot be parsed', async () => {
    const file = new File([new Uint8Array(64)], 'odd.mp4', {
      type: 'video/mp4',
    });
    expect(await scrubVideoFileMetadata(file)).toBe(file);
  });
});
