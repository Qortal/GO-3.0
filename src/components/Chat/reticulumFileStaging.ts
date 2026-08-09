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
  return (await stage(file)) || '';
}
