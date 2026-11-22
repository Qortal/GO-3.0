import { useCallback } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  isAppPinnedAtomFamily,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { saveToLocalStorage } from './AppsNavBarDesktop';

const PINNED_KEY_SEP = '\0';

/**
 * Where a pin shows: the Pinned tab of the library on phones, the dashboard
 * on wider screens. Either way it is the same pin list, the one the desktop
 * Hub keeps and saves to QDN.
 */
type LibraryPinTarget = 'pinned' | 'dashboard';

/** Pin state for a Q-Apps library entry, as on the desktop Hub. */
export function useLibraryAppPin(app: any) {
  const theme = useTheme();
  // Same breakpoint that mounts the Tabs overlay in App.tsx.
  const target: LibraryPinTarget = useMediaQuery(theme.breakpoints.down('md'), {
    noSsr: true,
  })
    ? 'pinned'
    : 'dashboard';

  const name = app?.name;
  const service = app?.service;

  const isPinned = useAtomValue(
    isAppPinnedAtomFamily(`${service ?? ''}${PINNED_KEY_SEP}${name ?? ''}`)
  );
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const togglePin = useCallback(() => {
    if (!name || !service) return;
    setSortablePinnedApps((prev) => {
      const wasPinned = !!prev?.find(
        (item) => item?.name === name && item?.service === service
      );
      const updatedApps = wasPinned
        ? prev.filter(
            (item) => !(item?.name === name && item?.service === service)
          )
        : [...(prev ?? []), { name, service }];
      saveToLocalStorage(
        'ext_saved_settings',
        'sortablePinnedApps',
        updatedApps
      );
      return updatedApps;
    });
    setSettingsLocalLastUpdated(Date.now());
  }, [name, service, setSettingsLocalLastUpdated, setSortablePinnedApps]);

  return { target, isPinned, togglePin };
}
