import i18n from 'i18next';

/**
 * Every request GO makes to the node goes through createEndpoint, which adds
 * the node API key. Some paths carry text a Q-App chose (a coin, a list name, a
 * group id). If such text turns into a "." or ".." path segment, the browser's
 * URL parser removes it and the request reaches a different node endpoint (for
 * example /admin/apikey/generate or /crosschain/tradebot), still with the key.
 *
 * These checks refuse an endpoint whose path could be rewritten that way, and
 * confirm that the final URL still points at the node it was built for.
 */

const PATH_SEPARATORS = /[/\\]/;
const MAX_DECODE_ROUNDS = 4;

/**
 * The URL parser silently drops tab, LF and CR anywhere in the input, so
 * ".\t." becomes "..". No real endpoint contains a control character.
 */
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export class UnsafeNodeEndpointError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.unsafe_node_path', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'UnsafeNodeEndpointError';
  }
}

/**
 * Decodes valid %XX escapes byte by byte, and the legacy %uXXXX form that older
 * Jetty versions still accept, and leaves anything else as it is.
 */
function decodePercentEscapes(value: string): string {
  return value.replace(
    /%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g,
    (_, wide: string | undefined, hex: string | undefined) =>
      String.fromCharCode(parseInt(wide ?? hex, 16))
  );
}

/**
 * True for a segment the node may treat as "." or "..". Besides the plain
 * forms, servlet containers drop a ";parameter" before resolving dot segments
 * (older Jetty turns "..;x" into ".."), and native code can cut a string at a
 * NUL ("..\0").
 */
function isDotSegment(segment: string): boolean {
  const name = segment.split(';')[0].split('\0')[0];
  return name === '.' || name === '..';
}

/**
 * Escapes that GO never produces in a path and that some servers decode in
 * their own way: the legacy %uXXXX form and an encoded NUL.
 */
const UNUSUAL_PATH_ESCAPE = /%u[0-9a-f]{4}|%00/i;

/**
 * True when some layer of the path (raw, or after one or more rounds of
 * percent-decoding) has a "." or ".." segment, with "\" counted as "/" and a
 * ";parameter" or NUL ignored (see isDotSegment).
 */
export function hasDotSegment(path: string): boolean {
  let current = path;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    if (current.split(PATH_SEPARATORS).some(isDotSegment)) return true;
    const decoded = decodePercentEscapes(current);
    if (decoded === current) return false;
    current = decoded;
  }
  // Still decoding after several rounds: nobody encodes a real path like that.
  return true;
}

/** The part of an endpoint before its query string or fragment. */
export function endpointPathPart(endpoint: string): string {
  const end = endpoint.search(/[?#]/);
  return end === -1 ? endpoint : endpoint.slice(0, end);
}

/** Throws unless `endpoint` is a node path that the URL parser cannot rewrite. */
export function assertSafeNodeEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
    throw new UnsafeNodeEndpointError();
  }
  const path = endpointPathPart(endpoint);
  // A '#' before the query would turn the rest, API key included, into a fragment.
  if (endpoint.charAt(path.length) === '#') {
    throw new UnsafeNodeEndpointError();
  }
  if (
    hasControlCharacter(path) ||
    UNUSUAL_PATH_ESCAPE.test(path) ||
    hasDotSegment(path)
  ) {
    throw new UnsafeNodeEndpointError();
  }
  return endpoint;
}

function basePathname(base: URL): string {
  return base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
}

/**
 * Joins the node base URL and an endpoint exactly as before (`${base}${endpoint}`),
 * after checking the endpoint and that the joined URL stays on the same node and
 * under the base path.
 */
export function joinNodeEndpoint(base: string, endpoint: unknown): string {
  const safeEndpoint = assertSafeNodeEndpoint(endpoint);
  const joined = `${base}${safeEndpoint}`;

  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    // No usable base (not configured yet): the request fails on its own, and
    // the path itself has already been checked.
    return joined;
  }

  let joinedUrl: URL;
  try {
    joinedUrl = new URL(joined);
  } catch {
    throw new UnsafeNodeEndpointError();
  }
  if (joinedUrl.origin !== baseUrl.origin) {
    throw new UnsafeNodeEndpointError();
  }
  const prefix = basePathname(baseUrl);
  if (prefix !== '/' && !`${joinedUrl.pathname}/`.startsWith(prefix)) {
    throw new UnsafeNodeEndpointError();
  }
  return joined;
}

/**
 * Encodes one path segment that came from a Q-App (or other outside input).
 * Refuses values that are empty or would become "." / ".." segments.
 */
export function nodePathSegment(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new UnsafeNodeEndpointError();
  }
  const raw = String(value);
  if (!raw || hasControlCharacter(raw) || hasDotSegment(raw)) {
    throw new UnsafeNodeEndpointError();
  }
  return encodeURIComponent(raw);
}
