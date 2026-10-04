/**
 * Names of files that reach GO from someone else: a chat peer's attachment,
 * a Q-App's download, a QDN attachment. The sender picks the name, so it is
 * cleaned before GO shows it or saves under it.
 *
 * The rules mirror SavedFilePolicy.cleanName on Android, so the name shown in
 * chat is the name the file is saved under:
 * - control, bidi and other invisible format characters are removed, so a
 *   right-to-left override cannot make "holiday[RLO]gpj.apk" read as
 *   "holidaykpa.jpg" (N-27);
 * - path separators and characters Android storage refuses become "_";
 * - leading dots, and trailing dots and spaces, go ("photo.jpg." still has
 *   the extension it shows);
 * - long names are shortened, keeping a short extension.
 *
 * No Capacitor or React imports: the chat, the viewer and the save helpers
 * all use it.
 */

/** Cc, Cf (bidi controls, zero-width characters), Cs (lone surrogates), Zl, Zp. */
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
/** Path separators and the characters Android storage refuses. */
const FORBIDDEN_CHARACTERS = /[/\\?%*:|"<>]/g;
const TRIMMABLE = /[.\s]/u;

export const MAX_FILE_NAME_LENGTH = 200;
/** Longest extension (with its dot) kept whole when a name is shortened. */
const MAX_KEPT_EXTENSION = 16;

function trimTrailing(value: string): string {
  let end = value.length;
  while (end > 0 && TRIMMABLE.test(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

function trimEnds(value: string): string {
  const trimmed = trimTrailing(value);
  let start = 0;
  while (start < trimmed.length && TRIMMABLE.test(trimmed[start])) start += 1;
  return trimmed.slice(start);
}

function limitLength(value: string): string {
  if (value.length <= MAX_FILE_NAME_LENGTH) return value;
  const dot = value.lastIndexOf('.');
  const extension =
    dot > 0 && value.length - dot <= MAX_KEPT_EXTENSION ? value.slice(dot) : '';
  let cut = MAX_FILE_NAME_LENGTH - extension.length;
  const before = value.charCodeAt(cut - 1);
  if (cut > 0 && before >= 0xd800 && before <= 0xdbff) cut -= 1;
  return value.slice(0, cut) + extension;
}

/**
 * The name as GO shows and saves it. Empty when nothing is left, so the
 * caller can put its own (translated) fallback in its place.
 */
export function cleanFileName(name: unknown): string {
  if (name === null || name === undefined) return '';
  const raw = typeof name === 'string' ? name : String(name);
  const cleaned = raw
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(FORBIDDEN_CHARACTERS, '_');
  return trimEnds(limitLength(trimEnds(cleaned)));
}

/**
 * A cleaned name split for display: the stem may be cut short with an
 * ellipsis, the extension is always shown whole, so the real type of the
 * file stays visible however long the name is. `extension` keeps its dot
 * and is empty when there is none (or it is too long to be one).
 */
export function splitFileNameForDisplay(name: unknown): {
  stem: string;
  extension: string;
} {
  const cleaned = cleanFileName(name);
  const dot = cleaned.lastIndexOf('.');
  if (
    dot <= 0 ||
    dot === cleaned.length - 1 ||
    cleaned.length - dot > MAX_KEPT_EXTENSION
  ) {
    return { stem: cleaned, extension: '' };
  }
  return { stem: cleaned.slice(0, dot), extension: cleaned.slice(dot) };
}

/** "JPG" for "holiday.jpg"; empty when the name has no extension. */
export function fileExtensionLabel(name: unknown): string {
  return splitFileNameForDisplay(name).extension.slice(1).toUpperCase();
}
