import { Capacitor } from '@capacitor/core';

/**
 * True only inside GO's Android app. `isCapacitor()` from ./platform is also
 * true in the desktop app, whose Capacitor platform is "electron".
 */
export const isAndroidApp = (): boolean => {
  try {
    return Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
};
