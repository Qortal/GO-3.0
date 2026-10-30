/**
 * Remove recording location and device metadata from MP4/MOV files
 * (ISO BMFF / QuickTime) without touching the audio or video.
 *
 * Phones write the place a video was shot into `moov/udta/©xyz` (Android,
 * iOS), `moov/udta/loci` (3GPP) and `moov/meta` or `moov/udta/meta` (mdta keys
 * such as `com.apple.quicktime.location.ISO6709`), next to the make, model and
 * software. XMP (with GPS) can also sit in a `uuid` box, and mvhd/tkhd/mdhd
 * hold the recording time.
 *
 * Deleting boxes would shift the sample offsets stored in stco/co64, so every
 * metadata box (udta, meta, and uuid at file level; udta, meta and XMP uuid in
 * the movie and its tracks) is instead rewritten in place as a `free` box of
 * the same size with its payload zeroed, and the creation/modification times
 * are zeroed. Players skip `free` boxes and every byte offset stays valid.
 * A Samsung "SEF" trailer after the last box (capture time, country code) is
 * zero-filled in place too. Other bytes after the movie box that are not a
 * box are left as they are rather than failing the whole scrub.
 * Timed metadata tracks (GoPro GPMF, DJI subtitles) are not touched.
 */

import { nameBlob } from './namedFile';

type ScrubVideoResult =
  | {
      ok: true;
      /** Same Blob as the input when nothing needed scrubbing. */
      blob: Blob;
      changed: boolean;
      /** Box paths turned into `free`, e.g. "moov/udta". */
      scrubbed: string[];
    }
  | { ok: false; reason: 'unsupported' | 'malformed' | 'too-large' };

/** Movie boxes are a few hundred KB even for long clips; refuse absurd ones. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
/** Metadata boxes outside moov are zero-filled in memory; cap their size. */
const MAX_METADATA_BOX_BYTES = 16 * 1024 * 1024;
/** Fragmented files can hold many top-level boxes; stop walking after this. */
const MAX_TOP_LEVEL_BOXES = 200_000;

const TOP_LEVEL_FIRST_BOXES = new Set([
  'ftyp',
  'moov',
  'mdat',
  'free',
  'skip',
  'wide',
  'pnot',
  'uuid',
  'styp',
]);

/** Containers below moov that can hold udta/meta (stbl never does). */
const DESCEND_INTO = new Set(['trak', 'mdia', 'minf']);

/** Adobe XMP: BE7ACFCB-97A9-42E8-9C71-999491E3AFAC */
const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91,
  0xe3, 0xaf, 0xac,
];

class MalformedVideoError extends Error {}

const malformed = (message: string): never => {
  throw new MalformedVideoError(message);
};

const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

const readU32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] << 24) |
    (bytes[at + 1] << 16) |
    (bytes[at + 2] << 8) |
    bytes[at + 3]) >>>
  0;

const readU64 = (bytes: Uint8Array, at: number): number => {
  const high = readU32(bytes, at);
  const low = readU32(bytes, at + 4);
  const value = high * 2 ** 32 + low;
  if (!Number.isSafeInteger(value)) malformed('Box size too large');
  return value;
};

type BoxHeader = { size: number; type: string; headerSize: number };

/** Parse a box header at `at`; `available` is how many bytes remain. */
const parseBoxHeader = (
  bytes: Uint8Array,
  at: number,
  available: number
): BoxHeader => {
  if (available < 8) malformed('Box header truncated');
  let size = readU32(bytes, at);
  const type = fourcc(bytes, at + 4);
  let headerSize = 8;
  if (size === 1) {
    if (available < 16) malformed('Large box header truncated');
    size = readU64(bytes, at + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = available; // runs to the end of its parent
  }
  if (size < headerSize || size > available) malformed(`Bad ${type} size`);
  return { size, type, headerSize };
};

const isXmpUuid = (bytes: Uint8Array, at: number, end: number): boolean =>
  end - at >= 16 && XMP_UUID.every((value, i) => bytes[at + i] === value);

/** Boxes that carry the recording's creation and modification time. */
const TIMESTAMP_BOXES = new Set(['mvhd', 'tkhd', 'mdhd']);

/**
 * Zero the creation/modification times of an mvhd/tkhd/mdhd payload (full
 * box: version, flags, then two 32-bit or two 64-bit times). Returns whether
 * anything was set.
 */
const zeroBoxTimes = (bytes: Uint8Array, start: number, end: number) => {
  const timeBytes = bytes[start] === 1 ? 16 : 8;
  const from = start + 4;
  const to = from + timeBytes;
  if (to > end) return false;
  let set = false;
  for (let i = from; i < to; i += 1) {
    if (bytes[i] !== 0) set = true;
  }
  bytes.fill(0, from, to);
  return set;
};

/** Rewrite the box at `at` as a zero-filled `free` box of the same size. */
const neutraliseBox = (bytes: Uint8Array, at: number, header: BoxHeader) => {
  bytes[at + 4] = 0x66; // f
  bytes[at + 5] = 0x72; // r
  bytes[at + 6] = 0x65; // e
  bytes[at + 7] = 0x65; // e
  bytes.fill(0, at + header.headerSize, at + header.size);
};

/**
 * Neutralise metadata boxes inside a movie box held in memory (mutates
 * `moov`). Returns the paths that were scrubbed.
 */
export function scrubMovieBox(moov: Uint8Array, path = 'moov'): string[] {
  const scrubbed: string[] = [];
  const top = parseBoxHeader(moov, 0, moov.length);
  if (top.type !== 'moov') malformed('Not a moov box');

  const walk = (start: number, end: number, parentPath: string) => {
    let at = start;
    while (at < end) {
      if (end - at < 8) break; // trailing padding inside a container
      const header = parseBoxHeader(moov, at, end - at);
      const boxPath = `${parentPath}/${header.type}`;
      const isMetadata =
        header.type === 'udta' ||
        header.type === 'meta' ||
        (header.type === 'uuid' &&
          isXmpUuid(moov, at + header.headerSize, at + header.size));
      if (isMetadata) {
        neutraliseBox(moov, at, header);
        scrubbed.push(boxPath);
      } else if (TIMESTAMP_BOXES.has(header.type)) {
        if (zeroBoxTimes(moov, at + header.headerSize, at + header.size)) {
          scrubbed.push(`${boxPath}:time`);
        }
      } else if (DESCEND_INTO.has(header.type)) {
        walk(at + header.headerSize, at + header.size, boxPath);
      }
      at += header.size;
    }
  };

  walk(top.headerSize, top.size, path);
  return scrubbed;
}

async function readRange(
  blob: Blob,
  start: number,
  end: number
): Promise<Uint8Array> {
  const part = blob.slice(start, end);
  const maybe = part as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybe.arrayBuffer === 'function') {
    return new Uint8Array(await maybe.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(part);
  });
}

type Patch = { start: number; end: number; bytes: Uint8Array };

const readU32LE = (bytes: Uint8Array, at: number): number =>
  (bytes[at] |
    (bytes[at + 1] << 8) |
    (bytes[at + 2] << 16) |
    (bytes[at + 3] << 24)) >>>
  0;

/** Top-level box types are four printable ASCII characters. */
const isPrintableFourcc = (type: string): boolean =>
  /^[\x20-\x7e]{4}$/.test(type);

/**
 * Samsung phones append a "SEF" trailer after the last box, holding the
 * capture time, the mobile country code and editing data. It ends with a
 * little-endian directory length and "SEFT"; the directory ("SEFH", version,
 * entry count, then 12-byte entries whose offsets count back from SEFH) says
 * where its data starts. Returns that start, or -1 when there is no trailer
 * that checks out.
 */
async function samsungTrailerStart(file: Blob, total: number): Promise<number> {
  if (total < 32) return -1;
  const tail = await readRange(file, total - 8, total);
  if (tail.length !== 8 || fourcc(tail, 4) !== 'SEFT') return -1;
  const directoryLength = readU32LE(tail, 0);
  const directoryStart = total - 8 - directoryLength;
  if (
    directoryLength < 12 ||
    directoryLength > MAX_METADATA_BOX_BYTES ||
    directoryStart < 8
  ) {
    return -1;
  }
  const directory = await readRange(file, directoryStart, total - 8);
  if (fourcc(directory, 0) !== 'SEFH') return -1;
  const count = readU32LE(directory, 8);
  if (12 + count * 12 > directory.length) return -1;
  let start = directoryStart;
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + i * 12;
    const dataStart = directoryStart - readU32LE(directory, entry + 4);
    const dataSize = readU32LE(directory, entry + 8);
    if (dataStart < 8 || dataStart + dataSize > directoryStart) return -1;
    start = Math.min(start, dataStart);
  }
  return total - start <= MAX_METADATA_BOX_BYTES ? start : -1;
}

class TooLargeError extends Error {}

/**
 * Walk the top-level boxes in [0, limit) and collect the patches that
 * neutralise metadata. With `tolerateTrailer`, bytes after the movie box
 * that are not a box (vendor trailers) end the walk and are left as they
 * are; without it they make the file malformed.
 */
async function scrubTopLevel(
  file: Blob,
  limit: number,
  tolerateTrailer: boolean
): Promise<{ patches: Patch[]; scrubbed: string[] }> {
  const patches: Patch[] = [];
  const scrubbed: string[] = [];
  let sawMoov = false;
  let at = 0;
  let boxes = 0;
  while (at < limit && boxes < MAX_TOP_LEVEL_BOXES) {
    boxes += 1;
    if (limit - at < 8) break; // stray tail bytes
    const head = await readRange(file, at, Math.min(limit, at + 16));
    let header: BoxHeader;
    try {
      header = parseBoxHeader(head, 0, limit - at);
      if (sawMoov && !isPrintableFourcc(header.type)) {
        malformed('Not a box after the movie');
      }
    } catch (err) {
      if (tolerateTrailer && sawMoov && err instanceof MalformedVideoError) {
        break;
      }
      throw err;
    }
    const end = at + header.size;

    if (header.type === 'moov') {
      if (header.size > MAX_MOOV_BYTES) throw new TooLargeError();
      const moov = await readRange(file, at, end);
      if (moov.length !== header.size) malformed('Short moov read');
      const found = scrubMovieBox(moov);
      if (found.length) {
        patches.push({ start: at, end, bytes: moov });
        scrubbed.push(...found);
      }
      sawMoov = true;
    } else if (
      header.type === 'udta' ||
      header.type === 'meta' ||
      header.type === 'uuid'
    ) {
      if (header.size > MAX_METADATA_BOX_BYTES) throw new TooLargeError();
      const replacement = new Uint8Array(header.size);
      replacement.set(head.subarray(0, header.headerSize));
      neutraliseBox(replacement, 0, header);
      patches.push({ start: at, end, bytes: replacement });
      scrubbed.push(header.type);
    }
    at = end;
  }
  return { patches, scrubbed };
}

/**
 * Scrub location/device metadata from an MP4/MOV Blob. Only the box headers
 * and the movie box are read; the result is assembled from slices of the
 * original, so large videos are not copied. Non-ISO-BMFF input (WebM, MKV…)
 * comes back as `unsupported`. A Samsung SEF trailer is zero-filled; other
 * non-box bytes after the movie box are left alone.
 */
export async function scrubMp4Metadata(file: Blob): Promise<ScrubVideoResult> {
  const total = file.size;
  if (!total || total < 16) return { ok: false, reason: 'unsupported' };
  try {
    const first = await readRange(file, 0, 16);
    if (first.length < 8 || !TOP_LEVEL_FIRST_BOXES.has(fourcc(first, 4))) {
      return { ok: false, reason: 'unsupported' };
    }

    let walk: { patches: Patch[]; scrubbed: string[] } | null = null;
    const trailerStart = await samsungTrailerStart(file, total);
    if (trailerStart > 0) {
      try {
        // The boxes must end exactly where the trailer begins.
        walk = await scrubTopLevel(file, trailerStart, false);
        walk.patches.push({
          start: trailerStart,
          end: total,
          bytes: new Uint8Array(total - trailerStart),
        });
        walk.scrubbed.push('trailer:SEF');
      } catch (err) {
        if (!(err instanceof MalformedVideoError)) throw err;
        walk = null; // it did not line up; treat it like any other tail
      }
    }
    if (!walk) walk = await scrubTopLevel(file, total, true);
    const { patches, scrubbed } = walk;

    if (!patches.length) {
      return { ok: true, blob: file, changed: false, scrubbed };
    }
    const parts: BlobPart[] = [];
    let cursor = 0;
    for (const patch of patches) {
      if (patch.start > cursor) parts.push(file.slice(cursor, patch.start));
      parts.push(patch.bytes as BlobPart);
      cursor = patch.end;
    }
    if (cursor < total) parts.push(file.slice(cursor, total));
    const blob = new Blob(parts, { type: file.type || 'video/mp4' });
    if (blob.size !== total) malformed('Scrubbed size changed');
    return { ok: true, blob, changed: true, scrubbed };
  } catch (err) {
    if (err instanceof TooLargeError) return { ok: false, reason: 'too-large' };
    if (err instanceof MalformedVideoError) {
      return { ok: false, reason: 'malformed' };
    }
    throw err;
  }
}

/**
 * Publish-ready copy of a video without its location/device metadata. When
 * the file cannot be parsed it is returned unchanged (and a warning logged):
 * blocking the post would be worse than the status quo, and the native
 * transcoder no longer writes a location at all.
 */
export async function scrubVideoFileMetadata<T extends Blob>(
  file: T
): Promise<T | File> {
  let result: ScrubVideoResult;
  try {
    result = await scrubMp4Metadata(file);
  } catch (err) {
    console.warn('[stripVideoMetadata] could not read video', err);
    return file;
  }
  if (result.ok === false) {
    if (result.reason !== 'unsupported') {
      console.warn(
        '[stripVideoMetadata] metadata left in place:',
        result.reason
      );
    }
    return file;
  }
  if (!result.changed) return file;
  const name = (file as Blob & { name?: unknown }).name;
  return nameBlob(
    result.blob,
    typeof name === 'string' && name ? name : 'video.mp4'
  );
}
