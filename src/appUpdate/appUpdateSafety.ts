/**
 * The updater's safety rules as the JS side sees them.
 *
 * The native plugin (AppUpdatePlugin / AppUpdatePolicy.java) has the final
 * say: it only downloads over HTTPS or from a node on this phone, and only
 * starts Android's installer for GO's own package, signed with the installed
 * GO's key, with a higher versionCode. These helpers check the address early,
 * so nobody waits for QDN to gather a build that will be refused, and turn the
 * plugin's refusal codes into messages in the user's language.
 */
import { redactUrlQueries } from '../utils/nativeNodeRequest';

/** Refusal codes AppUpdatePlugin rejects with, and the message each one gets. */
const ERROR_KEYS: Record<string, string> = {
  UPDATE_BAD_PATH: 'error.fetch_failed',
  UPDATE_BAD_URL: 'error.fetch_failed',
  UPDATE_INSECURE_URL: 'error.insecure_node',
  UPDATE_NOT_NEWER: 'error.not_newer',
  UPDATE_UNREADABLE: 'error.unreadable',
  UPDATE_WRONG_PACKAGE: 'error.not_go_build',
  UPDATE_WRONG_SIGNER: 'error.wrong_signer',
};

/**
 * localhost, 127.x.x.x or ::1 in their plain spelling: no trailing dot, no
 * leading zeros. AppUpdatePolicy.isLoopbackHost refuses the rest too.
 */
const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }
  const parts = host.split('.');
  if (parts.length !== 4 || parts[0] !== '127') return false;
  return parts.every(
    (part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255
  );
};

/**
 * The host exactly as the URL text spells it, without user info or port.
 * URL.hostname is no use for the loopback test: it turns "127.1",
 * "0x7f.0.0.1" and "2130706433" into "127.0.0.1", which the native check
 * (java.net.URI) does not.
 */
const writtenHost = (url: string): string => {
  const authority =
    /^[a-z][a-z\d+.-]*:\/\/([^/?#\\]*)/i.exec(url.trim())?.[1] ?? '';
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close < 0 ? '' : host.slice(0, close + 1);
  }
  const colon = host.indexOf(':');
  return colon < 0 ? host : host.slice(0, colon);
};

/**
 * HTTPS anywhere, plain HTTP only to a node on this phone: the same rule as
 * AppUpdatePolicy.checkDownloadUrl, so an address the native side would
 * refuse is caught before QDN spends minutes gathering the build.
 */
export function isSecureUpdateUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = writtenHost(url);
  if (!parsed.hostname || !host) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') {
    return isLoopbackHost(host) && isLoopbackHost(parsed.hostname);
  }
  return false;
}

/** The refusal code a plugin rejection carries, if it is one of ours. */
export function appUpdateErrorCode(error: unknown): string | null {
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_KEYS, code)
    ? code
    : null;
}

/**
 * What to show for a failed download or install: the translated refusal for
 * a known code, otherwise the error's own text (without any URL query, which
 * may hold the node API key), otherwise `fallbackKey`.
 */
export function describeAppUpdateError(
  error: unknown,
  tr: (key: string) => string,
  fallbackKey = 'error.fetch_failed'
): string {
  const code = appUpdateErrorCode(error);
  if (code) return tr(ERROR_KEYS[code]);
  const message =
    error instanceof Error
      ? error.message
      : error &&
          typeof error === 'object' &&
          typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : '';
  return message ? redactUrlQueries(message) : tr(fallbackKey);
}

/** The error for an insecure node, shaped like the plugin's own refusal. */
export function insecureNodeError(): Error & { code: string } {
  return Object.assign(new Error('insecure update address'), {
    code: 'UPDATE_INSECURE_URL',
  });
}
