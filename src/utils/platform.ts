/** True when running inside the Electron desktop app (has coreSetup). */
export const isElectron = (): boolean =>
  typeof window !== 'undefined' && !!window?.coreSetup;

/**
 * True when running inside the native Capacitor Android/iOS WebView.
 *
 * The Electron desktop also runs Capacitor: its preload names the platform
 * 'electron' (CapacitorCustomPlatform), and Capacitor counts every platform
 * other than 'web' as native. That one is excluded here, so GO-only code
 * stays off the desktop.
 */
export const isCapacitor = (): boolean => {
  if (typeof window === 'undefined') return false;
  const cap = (
    window as unknown as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
      };
    }
  ).Capacitor;
  try {
    return (
      cap?.isNativePlatform?.() === true && cap.getPlatform?.() !== 'electron'
    );
  } catch {
    return false;
  }
};

/**
 * True in GO, the phone app. isCapacitor() already leaves out the desktop;
 * the coreSetup check is a second guard, since only the desktop has it.
 */
export const isGoApp = (): boolean => isCapacitor() && !isElectron();

/** True on a phone-sized viewport (mobile chrome). */
export const isMobileViewport = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 899px)').matches;
