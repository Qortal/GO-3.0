import {
  API_ENDPOINTS,
  HTTP_LOCALHOST_12391,
  HTTPS_EXT_NODE_QORTAL_LINK,
  HTTPS_LOCALHOST_12391,
} from '../constants/constants';

/**
 * Where HTML written by other people (chat messages, forum posts, release
 * notes) may load images and media from: GO itself, data:/blob:, the local
 * Qortal node, the Qortal public nodes and whichever node GO is using now.
 * The desktop Hub enforces the same with its Electron CSP (img-src in
 * electron/src/setup.ts); the Android WebView has no such policy, so the
 * sanitizer applies it (see configureDomPurify.ts).
 *
 * Anything else may be a tracking pixel: fetching it tells that server the
 * reader's IP address and when the message was read.
 */

let resolveCurrentNodeBase: () => string | null | undefined = () => null;

/** globalApi.ts registers getBaseApiReact here; this module stays import-light. */
export function setCurrentNodeBaseResolver(
  resolve: () => string | null | undefined
): void {
  resolveCurrentNodeBase = resolve;
}

const originOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const QORTAL_NODE_ORIGINS = new Set(
  [
    HTTP_LOCALHOST_12391,
    HTTPS_LOCALHOST_12391,
    'http://localhost:12391',
    'https://localhost:12391',
    HTTPS_EXT_NODE_QORTAL_LINK,
    ...API_ENDPOINTS,
  ]
    .map(originOf)
    .filter((origin): origin is string => !!origin)
);

const pageOrigin = (): string | null =>
  typeof window === 'undefined' ? null : window.location.origin;

/**
 * Capacitor answers these paths itself, on any host: local files, content
 * URIs and (before 6.2.2) an HTTP proxy to any URL. Never a message image.
 * The WebView matches the decoded path, so decode before comparing.
 */
const isCapacitorPath = (url: URL): boolean => {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: compare the raw path.
  }
  return path.toLowerCase().startsWith('/_capacitor_');
};

/** True when untrusted HTML may load `raw` as an image or media source. */
export function isAllowedMediaUrl(raw: string | null | undefined): boolean {
  const value = String(raw ?? '').trim();
  if (!value) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'data' || scheme === 'blob') return true;
  let url: URL;
  try {
    url = new URL(value, pageOrigin() ?? undefined);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isCapacitorPath(url)) return false;
  if (url.origin === pageOrigin()) return true;
  if (QORTAL_NODE_ORIGINS.has(url.origin)) return true;
  let currentNode: string | null = null;
  try {
    currentNode = originOf(resolveCurrentNodeBase());
  } catch {
    // No node configured yet: only the fixed sources apply.
  }
  return url.origin === currentNode;
}

const SRCSET_DESCRIPTOR = /^\d+(\.\d+)?[wx]$/i;

/** Every candidate URL in a srcset must be allowed. */
export function isAllowedSrcset(value: string | null | undefined): boolean {
  return String(value ?? '')
    .split(/[\s,]+/)
    .filter((token) => token && !SRCSET_DESCRIPTOR.test(token))
    .every(isAllowedMediaUrl);
}

/** In-page fragment references (`#id`) stay local; anything else is a fetch. */
export function isAllowedSvgReference(
  value: string | null | undefined
): boolean {
  const ref = String(value ?? '').trim();
  return ref === '' || ref.startsWith('#') || isAllowedMediaUrl(ref);
}

const unescapeCss = (css: string): string =>
  css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\\(.)/g, '$1');

const CSS_FETCH =
  /(url|image-set|image|src|cross-fade|element|expression)\(|@import/;

/**
 * True when CSS (a style attribute or <style> element) could make the page
 * fetch something. Escapes, comments and whitespace are folded first, so an
 * escaped `u\72 l(` cannot hide a fetch. Over-matching only drops a style.
 */
export function cssCanFetch(css: string | null | undefined): boolean {
  const folded = unescapeCss(String(css ?? ''))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return CSS_FETCH.test(folded);
}
