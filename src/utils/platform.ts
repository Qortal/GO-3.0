/** True when running inside the Electron desktop app (has coreSetup). */
export const isElectron = (): boolean =>
  typeof window !== 'undefined' && !!window?.coreSetup;

/** True when running inside the native Capacitor Android/iOS WebView. */
export const isCapacitor = (): boolean => {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  try {
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

/** True on a phone-sized viewport (mobile chrome). */
export const isMobileViewport = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;
