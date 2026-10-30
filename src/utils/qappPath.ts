/**
 * Q-App names and paths, checked before they become a node `/render` URL
 * (audit GO-21).
 *
 * A Q-App tab is trusted by its name: saved permissions ("always allow", silent
 * chat sends, wallet reads) are keyed on the name the tab was opened with. If a
 * link's name or path could climb out of `/render/<SERVICE>/<name>/` — with
 * `..`, `%2e%2e`, `%252e%252e`, an overlong `%c0%ae`, a backslash, an encoded
 * slash or Jetty's `..;` — the tab would show one app's name and carry its
 * grants while running another publisher's code. These helpers refuse such
 * names and paths, percent-encode each segment, and check that the finished URL
 * still points inside the app it is labelled as.
 */

type QappTabTarget = {
  service: string;
  name: string;
  identifier?: string;
  path?: string;
};

// Qortal service names: APP, WEBSITE, QCHAT_ATTACHMENT, ...
const SERVICE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Registered names are at most 40 characters; leave room for older callers.
const MAX_NAME_LENGTH = 128;
// RFC 3986 pchar (unreserved, sub-delims, ':' and '@'): left as they are, the
// way the browser itself leaves them in a path.
const PCHAR = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]$/;
const PERCENT_ESCAPE = /^%[0-9A-Fa-f]{2}/;
const ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
// "%252e" is "%2e" after one decode and "." after two. Names and paths are
// checked in every form up to this many decodes, in case the node or an app
// decodes more than once; anything still changing after that is refused.
const MAX_DECODE_ROUNDS = 3;
const NAME_DELIMITERS = /[/?#]/;
// Only used to resolve a relative node base the same way for both URLs.
const URL_PARSE_FALLBACK = 'http://localhost/';

const hasControlChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

/**
 * Decode every run of `%XX` escapes once; a "%" that starts no escape
 * ("100%") stays as it is. Null when a run is not valid UTF-8, such as the
 * overlong "%c0%ae" some servers read as ".".
 */
const decodeEscapes = (value: string): string | null => {
  let invalid = false;
  const decoded = value.replace(ESCAPE_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      invalid = true;
      return run;
    }
  });
  return invalid ? null : decoded;
};

const decodeOnce = (value: string): string => decodeEscapes(value) ?? value;

/**
 * The value as written and after each decode until it stops changing. Null
 * when an escape is not valid UTF-8 or the value is still changing after
 * MAX_DECODE_ROUNDS decodes: no real name or path is written that way.
 */
const decodedForms = (value: string): string[] | null => {
  const forms = [value];
  let current = value;
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round += 1) {
    const next = decodeEscapes(current);
    if (next === null) return null;
    if (next === current) return forms;
    if (round === MAX_DECODE_ROUNDS) return null;
    forms.push(next);
    current = next;
  }
  return null;
};

/** "." and "..", and "..;x": Jetty drops the ";x" before resolving dots. */
const isDotSegment = (segment: string): boolean => {
  const withoutParams = segment.split(';')[0];
  return withoutParams === '.' || withoutParams === '..';
};

/**
 * True when a single path segment (or a name) could move the URL to another
 * resource: dot segments in any spelling, backslashes (the browser reads them
 * as "/"), encoded slashes, control characters (the browser drops tabs and
 * newlines, which can turn ".\n." into ".."), escapes that are not valid
 * UTF-8, and any of these hidden under more than one layer of encoding.
 */
const isUnsafeSegment = (segment: string): boolean => {
  const forms = decodedForms(segment);
  if (forms === null) return true;
  return forms.some(
    (form) =>
      hasControlChar(form) ||
      form.includes('\\') ||
      form.includes('/') ||
      isDotSegment(form)
  );
};

/** Split "a/b?x#y" into the path part and the "?x#y" that follows it. */
const splitPathSuffix = (path: string): [string, string] => {
  const query = path.indexOf('?');
  const hash = path.indexOf('#');
  const cut = query === -1 ? hash : hash === -1 ? query : Math.min(query, hash);
  return cut === -1 ? [path, ''] : [path.slice(0, cut), path.slice(cut)];
};

/**
 * Percent-encode one path segment. Existing `%XX` escapes are kept (links
 * often carry `Q%20Tube`), characters that are safe in a path stay as they
 * are, and everything else is encoded. `encodeSemicolon` is set for names, so
 * the node cannot read part of the name as a Jetty path parameter.
 */
export const encodeQappSegment = (
  segment: string,
  { encodeSemicolon = false }: { encodeSemicolon?: boolean } = {}
): string | null => {
  let out = '';
  let i = 0;
  while (i < segment.length) {
    const char = segment[i];
    if (char === '%' && PERCENT_ESCAPE.test(segment.slice(i, i + 3))) {
      out += segment.slice(i, i + 3);
      i += 3;
      continue;
    }
    if (PCHAR.test(char) && !(encodeSemicolon && char === ';')) {
      out += char;
      i += 1;
      continue;
    }
    const codePoint = String.fromCodePoint(segment.codePointAt(i) ?? 0);
    try {
      out += encodeURIComponent(codePoint);
    } catch {
      // A lone surrogate cannot be encoded.
      return null;
    }
    i += codePoint.length;
  }
  return out;
};

export const isSafeQappService = (service: unknown): service is string =>
  typeof service === 'string' && SERVICE_PATTERN.test(service);

/**
 * A registered name as it may appear in a tab: not empty, not a dot segment in
 * any spelling, and free of "/", "\", "?", "#" and control characters, both as
 * written and after each percent-decode.
 */
export const isSafeQappName = (name: unknown): name is string => {
  if (typeof name !== 'string') return false;
  if (!name.trim() || name.length > MAX_NAME_LENGTH) return false;
  const forms = decodedForms(name);
  if (forms === null || forms.some((form) => NAME_DELIMITERS.test(form))) {
    return false;
  }
  if (isUnsafeSegment(name)) return false;
  return encodeQappSegment(name, { encodeSemicolon: true }) !== null;
};

/**
 * A path inside a Q-App ("video/abc", "/post/a/b?x=1", "#/route"). Only the
 * part before "?" or "#" is checked; the query and fragment cannot change
 * which resource loads.
 */
export const isSafeQappPath = (path: unknown): boolean => {
  if (path == null || path === '') return true;
  if (typeof path !== 'string') return false;
  return encodeQappPath(path) !== null;
};

/** Encode each segment of the path part; null when any segment is unsafe. */
export const encodeQappPath = (path: string): string | null => {
  const [pathname, suffix] = splitPathSuffix(path);
  const encoded: string[] = [];
  for (const segment of pathname.split('/')) {
    if (segment === '') {
      encoded.push('');
      continue;
    }
    if (isUnsafeSegment(segment)) return null;
    const value = encodeQappSegment(segment);
    if (value === null) return null;
    encoded.push(value);
  }
  return `${encoded.join('/')}${suffix}`;
};

/**
 * Decode a name taken from a link once ("Q%20Tube" → "Q Tube"); a stray "%"
 * stays, and the name is returned raw if an escape is malformed.
 */
export const decodeQappName = (name: string): string => decodeOnce(name);

const pathIsInside = (url: string, root: string): boolean => {
  let full: URL;
  let rootUrl: URL;
  try {
    full = new URL(url, URL_PARSE_FALLBACK);
    rootUrl = new URL(root, URL_PARSE_FALLBACK);
  } catch {
    return false;
  }
  if (full.origin !== rootUrl.origin) return false;
  return (
    full.pathname === rootUrl.pathname ||
    full.pathname.startsWith(`${rootUrl.pathname}/`)
  );
};

/**
 * Build `${baseUrl}/render/${service}/${name}${rest}${query}` with the name
 * and every path segment encoded, or null when the result would not stay
 * inside `/render/<service>/<name>`.
 *
 * `rest` is whatever follows the name ("", "/path", "/path?x=1", "#/route");
 * a leading "/" is added when it starts with a path segment. `query` is GO's
 * own suffix ("?theme=…&lang=…") and is appended unchanged.
 */
export const buildQappRenderUrl = ({
  baseUrl,
  service,
  name,
  rest,
  query = '',
}: {
  baseUrl: string;
  service: unknown;
  name: unknown;
  rest?: string | null;
  query?: string;
}): string | null => {
  if (!isSafeQappService(service) || !isSafeQappName(name)) return null;
  const encodedName = encodeQappSegment(name, { encodeSemicolon: true });
  if (encodedName === null) return null;
  let after = rest ?? '';
  if (typeof after !== 'string') return null;
  if (after && !['/', '?', '#'].includes(after[0])) after = `/${after}`;
  const encodedRest = encodeQappPath(after);
  if (encodedRest === null) return null;
  const root = `${baseUrl}/render/${service}/${encodedName}`;
  const url = `${root}${encodedRest}${query}`;
  return pathIsInside(url, root) ? url : null;
};

/**
 * True when an addTab request may open: internal tabs and private-app
 * previews (which load their own URL) skip the name check, every other tab
 * needs a safe service and name, and any path must be safe.
 */
export const isQappTabTargetSafe = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const tab = data as Record<string, unknown>;
  if (tab.internal) return true;
  const needsIdentity = !tab.isPreview;
  if ((needsIdentity || tab.service != null) && !isSafeQappService(tab.service))
    return false;
  if ((needsIdentity || tab.name != null) && !isSafeQappName(tab.name))
    return false;
  return isSafeQappPath(tab.path);
};

/**
 * The fields a Q-App may set when it asks GO to open a tab (SET_TAB). Anything
 * else — `url`, `isPreview`, `internal`, `navigateIfAlreadyOpen`, … — is
 * dropped, so an app can never point a tab at a URL of its choosing. Returns
 * null when the service, name or path is unsafe.
 */
export const pickQappTabTarget = (payload: unknown): QappTabTarget | null => {
  if (!payload || typeof payload !== 'object') return null;
  const { service, name, identifier, path } = payload as Record<
    string,
    unknown
  >;
  if (!isSafeQappService(service) || !isSafeQappName(name)) return null;
  if (path != null && typeof path !== 'string') return null;
  if (!isSafeQappPath(path)) return null;
  const target: QappTabTarget = { service, name };
  if (typeof identifier === 'string' || typeof identifier === 'number') {
    target.identifier = String(identifier);
  }
  if (typeof path === 'string') target.path = path;
  return target;
};
