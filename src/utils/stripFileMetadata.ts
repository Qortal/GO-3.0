/**
 * Photos and videos sent or published as files keep their pixels and frames
 * but not their GPS position, camera model and capture time. Everything else
 * goes out unchanged.
 *
 * The declared type decides first. When it says nothing (empty, or a generic
 * binary type, as some document providers and extension-less files report),
 * the first bytes decide: JPEG/PNG/WebP magic, or an ISO-BMFF `ftyp` box with
 * a video brand. HEIF/AVIF images and MP4 audio share that box layout, but a
 * top-level `meta` box there is the image itself or the song's tags, so those
 * brands are never treated as video.
 */

import { stripImageFileMetadata } from './imageCompression';
import { detectImageContainer } from './stripImageMetadata';
import { scrubVideoFileMetadata } from './stripVideoMetadata';

export type MediaKind = 'image' | 'video';

/** Types that say nothing about the content, so the bytes decide. */
const GENERIC_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/unknown',
]);

/** ISO-BMFF brands that are not video: HEIF/AVIF images, camera raw, audio. */
const NOT_VIDEO_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'mif2',
  'msf1',
  'miaf',
  'avif',
  'avis',
  'avio',
  'crx ',
  'M4A ',
  'M4B ',
  'M4P ',
  'F4A ',
  'F4B ',
]);

const SNIFF_BYTES = 64;

async function readHead(file: Blob): Promise<Uint8Array> {
  const part = file.slice(0, SNIFF_BYTES);
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

const ascii = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** What the first bytes of a file are, as far as metadata removal cares. */
export function sniffMediaKind(head: Uint8Array): MediaKind | null {
  if (detectImageContainer(head)) return 'image';
  if (head.length < 12 || ascii(head, 4) !== 'ftyp') return null;
  const size =
    ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const end = Math.min(head.length, Math.max(12, size));
  const brands = [ascii(head, 8)];
  // Compatible brands follow the 4-byte minor version.
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(head, at));
  return brands.some((brand) => NOT_VIDEO_BRANDS.has(brand)) ? null : 'video';
}

/** Audio files keep their tags; some recorders write a video-like `ftyp`. */
const AUDIO_EXTENSION = /\.(m4a|m4b|aac|mp3|wav|ogg|oga|opus|flac)$/i;

async function mediaKindOf(file: File): Promise<MediaKind | null> {
  const type = (file?.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (!GENERIC_TYPES.has(type)) return null;
  if (AUDIO_EXTENSION.test(file?.name || '')) return null;
  try {
    return sniffMediaKind(await readHead(file));
  } catch {
    return null;
  }
}

/**
 * The file without photo/video location and device metadata. Images are
 * stripped losslessly (JPEG, PNG, WebP), MP4/MOV videos scrubbed in place;
 * anything else, or anything that cannot be parsed, comes back as it is.
 */
export async function stripAttachmentMetadata(file: File): Promise<File> {
  if (!file) return file;
  const kind = await mediaKindOf(file);
  if (kind === 'image') return stripImageFileMetadata(file);
  if (kind === 'video') return (await scrubVideoFileMetadata(file)) as File;
  return file;
}
