const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '0.0.0.0']);

/**
 * GO's own origin and this phone's loopback are never "outside": on Android,
 * window.open of GO's origin navigates GO itself (a reload, or a Capacitor
 * file path), and a loopback link reaches services on the phone.
 */
const isAppOrLoopback = (url: URL): boolean => {
  const host = url.hostname.toLowerCase();
  return (
    url.origin === window.location.origin ||
    LOOPBACK_HOSTS.has(host) ||
    host.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
};

/**
 * Opens http(s) URLs in the system browser. In Electron, uses openExternal
 * (must stay allowlisted — see electron preload). Else uses window.open.
 * Links that point back into GO or at this phone's loopback are refused.
 */
export function openHttpUrlExternally(url: string | null | undefined): boolean {
  if (url == null || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname || isAppOrLoopback(parsed)) {
    return false;
  }

  const href = parsed.toString();

  if (window?.electronAPI?.openExternal) {
    window.electronAPI.openExternal(href);
    return true;
  }

  window.open(href, '_blank', 'noopener,noreferrer');
  return true;
}
