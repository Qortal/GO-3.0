/**
 * Paths of chat-resource staging files, built in the engine worker.
 *
 * Kotlin confines every staged read, write and delete to its staging folder
 * (ReticulumPlugin.resolveStagedFile, ChatResourceStagingPolicy). The worker
 * used to ask Kotlin for each new path (`nativefs path`): one more round trip
 * per serve and per accept, queued behind everything else on a busy worker
 * (one report had nativefs:path at p95 ~20 s). Kotlin now hands the folder
 * over once, with the bridge socket info, and the worker builds
 * `<folder>/<uuid>-<clean name>` itself, exactly as Kotlin did.
 *
 * cleanStagedFileName is a copy of SavedFilePolicy.cleanName (plus Kotlin's
 * "blob" for a blank name), so both sides make the same name. The JVM and
 * vitest suites check it against one shared fixture:
 * android/app/src/test/resources/chat-resource-staged-names.tsv.
 */

/** SavedFilePolicy.FALLBACK_NAME */
const FALLBACK_NAME = 'download';
/** SavedFilePolicy.MAX_NAME_LENGTH, in UTF-16 units like Java's String. */
const MAX_NAME_LENGTH = 200;
/** SavedFilePolicy.MAX_KEPT_EXTENSION */
const MAX_KEPT_EXTENSION = 16;
/**
 * SavedFilePolicy.isInvisible: Java's CONTROL, FORMAT, LINE_SEPARATOR,
 * PARAGRAPH_SEPARATOR and SURROGATE types. With the `u` flag a lone
 * surrogate half is one code point of category Cs, as in Java.
 */
const INVISIBLE_RE = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;
/** SavedFilePolicy.isForbidden */
const FORBIDDEN = new Set(['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>']);
/**
 * Kotlin's Char.isWhitespace and Java's isWhitespace || isSpaceChar: the
 * space separators, line and paragraph separators, and the ASCII controls
 * Java counts as white space. Not JavaScript's \s, which differs (U+FEFF,
 * U+001C-U+001F).
 */
const JAVA_SPACE_RE = /^[\p{Zs}\p{Zl}\p{Zp}\t\n\u000B\f\r\u001C-\u001F]$/u;

function isTrimmable(ch: string): boolean {
  return ch === '.' || JAVA_SPACE_RE.test(ch);
}

/** SavedFilePolicy.trimTrailing: one UTF-16 unit at a time, as in Java. */
function trimTrailing(s: string): string {
  let end = s.length;
  while (end > 0 && isTrimmable(s.charAt(end - 1))) end -= 1;
  return s.slice(0, end);
}

/** SavedFilePolicy.trimEnds */
function trimEnds(s: string): string {
  const t = trimTrailing(s);
  let start = 0;
  while (start < t.length && isTrimmable(t.charAt(start))) start += 1;
  return t.slice(start);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** SavedFilePolicy.limitLength */
function limitLength(n: string): string {
  if (n.length <= MAX_NAME_LENGTH) return n;
  const dot = n.lastIndexOf('.');
  const ext =
    dot > 0 && n.length - dot <= MAX_KEPT_EXTENSION ? n.slice(dot) : '';
  let cut = MAX_NAME_LENGTH - ext.length;
  if (cut > 0 && isHighSurrogate(n.charCodeAt(cut - 1))) cut -= 1;
  return n.slice(0, cut) + ext;
}

/** Kotlin's String.isBlank() */
function isBlank(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (!JAVA_SPACE_RE.test(s.charAt(i))) return false;
  }
  return true;
}

/**
 * The file-name part of a staged path for `name` (an engine OPFS basename):
 * ReticulumPlugin.stagedResourcePath's `sanitizeFileName(name.ifBlank {
 * "blob" })`, which for a non-blank name is SavedFilePolicy.cleanName.
 */
export function cleanStagedFileName(name: string): string {
  const raw = isBlank(String(name ?? '')) ? 'blob' : String(name);
  let out = '';
  // for...of walks code points; a lone surrogate half comes out on its own.
  for (const ch of raw) {
    if (INVISIBLE_RE.test(ch)) continue;
    out += FORBIDDEN.has(ch) ? '_' : ch;
  }
  const n = trimEnds(limitLength(trimEnds(out)));
  return n === '' ? FALLBACK_NAME : n;
}

/** A random v4 UUID, lower case like Java's UUID.toString(). */
export function newStagingId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * `<dir>/<uuid>-<clean name>`, the same shape ReticulumPlugin.stagedResourcePath
 * returned (File(dir, child).absolutePath). Kotlin still checks every path it
 * is given against its folder before it touches the file.
 */
export function buildStagedResourcePath(
  dir: string,
  name: string,
  id: string = newStagingId()
): string {
  const folder = dir.replace(/\/+$/, '');
  return `${folder}/${id}-${cleanStagedFileName(name)}`;
}
