import { stripAttachmentMetadata } from '../../utils/stripFileMetadata';

/** One cleaned copy per picked File, so re-staging returns the same path. */
const cleanedFiles = new WeakMap<File, File>();

/**
 * Photos and videos sent as files keep their pixels and frames but not their
 * GPS position, camera model and capture time. Other files go out unchanged.
 */
async function withoutLocationMetadata(file: File): Promise<File> {
  if (!file || typeof file !== 'object') return file;
  const cached = cleanedFiles.get(file);
  if (cached) return cached;
  const cleaned = await stripAttachmentMetadata(file);
  cleanedFiles.set(file, cleaned);
  return cleaned;
}

/**
 * Resource attachments are streamed from disk rather than buffered, so the
 * sender needs a real filesystem path. Desktop gets one from the native file
 * dialog; a WebView-picked File has none, so on mobile the bytes are copied
 * into the native staging directory first.
 */
export async function stageReticulumFilePath(file: File): Promise<string> {
  const stage = (
    window.reticulumResources as
      | { stageFileForPath?: (file: File) => Promise<string> }
      | undefined
  )?.stageFileForPath;
  if (typeof stage !== 'function') return '';
  return (await stage(await withoutLocationMetadata(file))) || '';
}
