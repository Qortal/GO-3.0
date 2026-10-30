import {
  isAndroidPackageFile,
  PACKAGE_OPEN_MIME,
  safeOpenMimeType,
} from './androidPackageFiles';
import { cleanFileName } from './receivedFileName';

/**
 * The code the native open path (ReticulumPlugin.qchatFileOpen) rejects with
 * when the file is an app package, and the code this module uses when it
 * refuses one before asking native.
 */
export const PACKAGE_ARCHIVE_REFUSED = 'PACKAGE_ARCHIVE_REFUSED';

/** Thrown for an app package: GO only installs through its own updater. */
export class PackageOpenRefusedError extends Error {
  readonly code = PACKAGE_ARCHIVE_REFUSED;

  constructor() {
    super('GO does not open app packages');
    this.name = 'PackageOpenRefusedError';
  }
}

/** True for a refusal from this module or from the native open path. */
export function isPackageOpenRefusal(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === PACKAGE_ARCHIVE_REFUSED
  );
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

/**
 * True when GO would refuse to hand this file to another app. Checks the
 * name, the uri (an app-storage path ends in the file name) and the type.
 */
export function isRefusedForOpen(options: {
  uri?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
}): boolean {
  return (
    isAndroidPackageFile(options.fileName, options.mimeType) ||
    isAndroidPackageFile(options.uri)
  );
}

/** The type every page-like file is handed to another app as. */
const PAGE_OPEN_MIME = 'text/plain';

// Types a browser renders as a page that can run script: the list in
// SavedFilePolicy.java and AppOriginGuardPolicy.java, plus the XML feed and
// map types Android's MimeTypeMap gives a "+xml" type (native treats every
// "+xml" type as a page).
const PAGE_EXTENSION =
  /\.(html?|xhtml?|xht|shtml|mht|mhtml|svgz?|xml|xslt?|rss|atom|rdf|kml|xspf|smil|mathml)$/;
const SCRIPT_EXTENSION = /\.(js|mjs)$/;
const PAGE_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/vnd.wap.xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/xslt+xml',
  'text/xsl',
  'text/x-server-parsed-html',
  'multipart/related',
  'message/rfc822',
  'application/x-mimearchive',
]);
const SCRIPT_MIME_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
]);

const baseMimeType = (mimeType?: string | null): string =>
  String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

/**
 * True when the name, as it reads (invisible characters and trailing dots
 * removed), ends in an extension a browser shows as a page.
 */
export function hasPageExtension(fileName?: string | null): boolean {
  const name = cleanFileName(fileName).toLowerCase();
  return !!name && PAGE_EXTENSION.test(name);
}

/** True for a type a browser shows as a page: HTML, SVG, any "+xml". */
export function isPageMimeType(mimeType?: string | null): boolean {
  const mime = baseMimeType(mimeType);
  return PAGE_MIME_TYPES.has(mime) || mime.endsWith('+xml');
}

/**
 * True for a file a browser would show as a page or run as script: HTML,
 * SVG, XML and the like, judged by the name as it reads (invisible
 * characters and trailing dots removed) and by the declared type.
 */
export function isPageLikeFile(
  fileName?: string | null,
  mimeType?: string | null
): boolean {
  const name = cleanFileName(fileName).toLowerCase();
  if (name && (PAGE_EXTENSION.test(name) || SCRIPT_EXTENSION.test(name))) {
    return true;
  }
  return (
    isPageMimeType(mimeType) || SCRIPT_MIME_TYPES.has(baseMimeType(mimeType))
  );
}

/**
 * The type to hand another app: a package goes out as a zip archive, a page
 * or script as plain text (so a sender's .html or .svg opens as source in an
 * editor, never as a live page in a browser), anything else with its own
 * type or none, which native then works out (N-27).
 */
export function externalOpenMimeType(
  fileName?: string | null,
  mimeType?: string | null
): string | undefined {
  if (isAndroidPackageFile(fileName, mimeType)) return PACKAGE_OPEN_MIME;
  if (isPageLikeFile(fileName, mimeType)) return PAGE_OPEN_MIME;
  return safeOpenMimeType(fileName, mimeType);
}

/**
 * Every "Open" / "Open with" of a saved or received file goes through here.
 * An app package never reaches native (which refuses it too, by name, type
 * and content); anything else is handed over with a type that cannot be the
 * package installer's, and a page goes over as plain text.
 */
export async function openFileInViewerApp(options: {
  uri: string;
  fileName?: string;
  mimeType?: string;
}): Promise<{ ok: boolean }> {
  if (isRefusedForOpen(options)) throw new PackageOpenRefusedError();
  const mimeType = externalOpenMimeType(options.fileName, options.mimeType);
  const { Reticulum } = await import('../plugins/Reticulum');
  return Reticulum.qchatFileOpen({
    uri: options.uri,
    ...(options.fileName ? { fileName: options.fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
  });
}
