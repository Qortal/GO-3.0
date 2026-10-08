/**
 * A pasted picture (or one a keyboard inserts) goes into the chat composer
 * only once nothing that could trace it is left: no GPS position, camera,
 * capture time or other EXIF/XMP/IPTC data, and no file name from whoever
 * copied it. The same checks the composer's other pictures get, done where
 * the paste comes in, so no route around them is left.
 *
 * JPEG, PNG and WebP are cleaned losslessly and GIF carries no such data.
 * Anything else (HEIC, AVIF) can only be cleaned by drawing it again, and if
 * even that fails the picture is refused rather than sent as it is.
 */
import { compressImageFile, ensureImageMetadataFree } from './imageCompression';
import { createNamedFile } from './namedFile';
import { stripAttachmentMetadata } from './stripFileMetadata';

const EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** A neutral name: the clipboard's may be personal. */
const pastedName = (type: string) =>
  `pasted-image.${EXTENSIONS[type] ?? 'png'}`;

const asCleanFile = (blob: Blob, fallbackType: string): File => {
  const type = blob.type || fallbackType;
  // Not `new File`: on Android cordova-plugin-file replaces it (namedFile.ts).
  return createNamedFile([blob], pastedName(type), { type });
};

let lastFailure = '';

/**
 * Why the last picture could not be cleaned: its type, size, first bytes
 * and what each step said. Nothing of the picture itself.
 */
export const describeLastCleanFailure = (): string => lastFailure;

const firstBytesHex = async (file: Blob): Promise<string> => {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    return Array.from(head, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    );
  } catch {
    return '?';
  }
};

/** The picture without tracing data, or null if it can't be made so. */
export async function cleanPastedImage(file: File): Promise<File | null> {
  const checked = await ensureImageMetadataFree(file);
  if (checked.ok) return asCleanFile(checked.file, file.type);
  let redraw = '';
  try {
    const redrawn = await compressImageFile(file, {
      first: { quality: 0.92, maxWidth: 4096, mimeType: 'image/jpeg' },
    });
    const again = await ensureImageMetadataFree(redrawn);
    if (again.ok) return asCleanFile(again.file, 'image/jpeg');
    redraw = (again as { reason?: string }).reason ?? '';
  } catch (error) {
    redraw = error instanceof Error ? error.message : String(error);
    console.warn('[cleanPastedImage] could not redraw the picture', error);
  }
  lastFailure = `type=${file.type || '?'} size=${file.size} head=${await firstBytesHex(
    file
  )} check=${(checked as { reason?: string }).reason} redraw=${redraw}`;
  return null;
}

/**
 * Pasted files, cleaned: pictures as above (dropped if they can't be),
 * videos scrubbed of location and device data, other files as they are.
 */
export async function cleanPastedFiles(files: File[]): Promise<File[]> {
  const cleaned = await Promise.all(
    files.map(async (file) => {
      if (file.type?.startsWith('image/')) return cleanPastedImage(file);
      try {
        return await stripAttachmentMetadata(file);
      } catch {
        return file;
      }
    })
  );
  return cleaned.filter((file): file is File => file !== null);
}
