import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  checkForAppUpdate,
  refreshInstallPermission,
} from './appUpdateController';

/** Startup is busy enough without a QDN search competing with it. */
const FIRST_CHECK_DELAY_MS = 25_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Watches the publishing name for a newer build: shortly after launch, every
 * six hours after that, and on the way back from the background when the last
 * look was long enough ago to be stale.
 */
export const useAppUpdateWatcher = (enabled = true) => {
  const lastCheckRef = useRef(0);

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return undefined;

    const check = () => {
      lastCheckRef.current = Date.now();
      void checkForAppUpdate();
    };

    const first = window.setTimeout(check, FIRST_CHECK_DELAY_MS);
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.hidden) return;
      // Whatever else happens on the way back, an update waiting on Android's
      // install permission asks again first: the trip to settings is the
      // reason the app was in the background.
      void refreshInstallPermission();
      if (Date.now() - lastCheckRef.current < CHECK_INTERVAL_MS) return;
      check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
};
