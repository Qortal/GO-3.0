/**
 * Decides how the in-app file viewer shows a received file. Pure helpers, so
 * the rules can be tested without a WebView.
 */

export type FilePreviewKind =
  | 'markdown'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'other';

/** Past this, text is cut off in the viewer (the full file still saves/shares). */
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** Past this, markdown is shown as plain text rather than parsed. */
export const MARKDOWN_RENDER_MAX_BYTES = 1024 * 1024;
/** How much of an unknown file is inspected to decide whether it is text. */
const TEXT_SNIFF_BYTES = 64 * 1024;

const IMAGE_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

const VIDEO_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
};

const AUDIO_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn']);

// Shown as source. Web pages never run inside the app.
const MARKUP_SOURCE_EXT = new Set(['html', 'htm', 'xhtml', 'mhtml']);

const TEXT_EXT = new Set(
  (
    'txt text log csv tsv json jsonl ndjson geojson xml yaml yml toml ini ' +
    'cfg conf properties env sh bash zsh fish bat cmd ps1 py js mjs cjs ts ' +
    'tsx jsx java kt kts gradle c h cc cpp hpp cs go rs rb php pl lua r ' +
    'swift dart scala sql css scss less vue svelte rst adoc tex srt vtt asc ' +
    'pem pub diff patch gitignore dockerfile makefile nfo'
  ).split(' ')
);

// Known binary containers: never sniffed as text.
const BINARY_EXT = new Set(
  (
    'zip rar 7z gz tgz bz2 xz zst tar apk aab apks exe msi dmg deb rpm ' +
    'appimage iso img bin dll so doc docx xls xlsx ppt pptx odt ods odp ' +
    'epub mobi heic heif tif tiff psd gguf sqlite db jar wasm ttf otf woff ' +
    'woff2 rtf'
  ).split(' ')
);

export function fileExtension(fileName?: string | null): string {
  const base =
    String(fileName || '')
      .split(/[/\\]/)
      .pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) {
    // Extension-less names that are still well-known text files.
    const lower = base.toLowerCase();
    return lower === 'dockerfile' || lower === 'makefile' ? lower : '';
  }
  return base.slice(dot + 1).toLowerCase();
}

/** A usable MIME type: the declared one unless it is generic, else by extension. */
export function resolveFileMimeType(
  fileName?: string | null,
  declared?: string | null
): string {
  const mime = String(declared || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = fileExtension(fileName);
  if (IMAGE_EXT[ext]) return IMAGE_EXT[ext];
  if (VIDEO_EXT[ext]) return VIDEO_EXT[ext];
  if (AUDIO_EXT[ext]) return AUDIO_EXT[ext];
  if (ext === 'pdf') return 'application/pdf';
  if (MARKDOWN_EXT.has(ext)) return 'text/markdown';
  if (MARKUP_SOURCE_EXT.has(ext)) return 'text/html';
  if (ext === 'json') return 'application/json';
  if (TEXT_EXT.has(ext)) return 'text/plain';
  return mime || 'application/octet-stream';
}

/**
 * MIME type to hand another app for "Open with". Android has no viewer for
 * `text/markdown` & co. on most phones, so text-like files go out as
 * `text/plain`, which every editor accepts.
 */
export function mimeTypeForExternalOpen(
  fileName?: string | null,
  declared?: string | null
): string {
  const mime = resolveFileMimeType(fileName, declared);
  if (
    mime === 'text/markdown' ||
    mime === 'text/x-markdown' ||
    (mime.startsWith('text/') && mime !== 'text/html')
  ) {
    return 'text/plain';
  }
  return mime;
}

/** True when the bytes read as UTF-8 text (no NULs, no invalid sequences). */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, TEXT_SNIFF_BYTES);
  if (sample.length === 0) return true;
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i];
    if (b === 0) return false;
    // Control characters other than tab, LF, FF, CR, ESC.
    if (b < 32 && b !== 9 && b !== 10 && b !== 12 && b !== 13 && b !== 27) {
      control += 1;
    }
  }
  if (control / sample.length > 0.02) return false;
  try {
    // `stream` keeps a multi-byte character cut at the sample edge from
    // counting as invalid.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  }
}

export function classifyFilePreview(options: {
  fileName?: string | null;
  mimeType?: string | null;
  /** Leading bytes; decide for files whose name doesn't say what they are. */
  head?: Uint8Array | null;
}): FilePreviewKind {
  const ext = fileExtension(options.fileName);
  const mime = resolveFileMimeType(options.fileName, options.mimeType);

  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (
    MARKDOWN_EXT.has(ext) ||
    mime === 'text/markdown' ||
    mime === 'text/x-markdown'
  ) {
    return 'markdown';
  }
  if (BINARY_EXT.has(ext)) return 'other';
  if (IMAGE_EXT[ext] || mime.startsWith('image/')) return 'image';
  if (VIDEO_EXT[ext] || mime.startsWith('video/')) return 'video';
  if (AUDIO_EXT[ext] || mime.startsWith('audio/')) return 'audio';
  if (MARKUP_SOURCE_EXT.has(ext) || TEXT_EXT.has(ext)) return 'text';
  // When the name doesn't settle it, the bytes do: declared types are often
  // wrong (the WebView reports `text/plain` for any untyped blob).
  if (options.head) return looksLikeText(options.head) ? 'text' : 'other';
  return mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
    ? 'text'
    : 'other';
}

/** Web markup is shown as source, never rendered. */
export function isMarkupSourceFile(fileName?: string | null): boolean {
  return MARKUP_SOURCE_EXT.has(fileExtension(fileName));
}

/** Decodes up to `maxBytes` of UTF-8, reporting whether the text was cut. */
export function decodeTextPreview(
  bytes: Uint8Array,
  maxBytes = TEXT_PREVIEW_MAX_BYTES
): { text: string; truncated: boolean } {
  const truncated = bytes.length > maxBytes;
  const slice = truncated ? bytes.subarray(0, maxBytes) : bytes;
  let text = new TextDecoder('utf-8').decode(slice, { stream: truncated });
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, truncated };
}
