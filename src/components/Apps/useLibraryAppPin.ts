import { useCallback, useMemo } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isAppPinnedAtomFamily,
  rawWalletAtom,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { executeEvent } from '../../utils/events';
import {
  getOpenTabKey,
  libraryAppToOpenTab,
} from '../Mobile/mobileTabOrganization';
import {
  tabKeyFolderNameAtomFamily,
  toggleLibraryFolderPin,
} from '../Mobile/mobileTabOrganizationStore';
import { saveToLocalStorage } from './AppsNavBarDesktop';

const PINNED_KEY_SEP = '\0';

type LibraryPinTarget = 'tabs' | 'dashboard';

/**
 * Pin state for a Q-Apps library entry. Phones have no Hub dashboard, so there
 * the pin saves the app into the Library folder of the Tabs overlay. Wider
 * screens keep pinning to the dashboard.
 */
export function useLibraryAppPin(app: any) {
  const theme = useTheme();
  // Same breakpoint that mounts the Tabs overlay in App.tsx.
  const target: LibraryPinTarget = useMediaQuery(theme.breakpoints.down('md'), {
    noSsr: true,
  })
    ? 'tabs'
    : 'dashboard';
  const { t } = useTranslation(['core']);
  const store = useStore();
  const userInfo = useAtomValue(userInfoAtom);
  const rawWallet = useAtomValue(rawWalletAtom);
  const walletAddress = userInfo?.address || rawWallet?.address0 || '';

  const name = app?.name;
  const service = app?.service;
  const title = app?.metadata?.title;
  const identifier = app?.identifier;

  const isDashboardPinned = useAtomValue(
    isAppPinnedAtomFamily(`${service ?? ''}${PINNED_KEY_SEP}${name ?? ''}`)
  );
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const tab = useMemo(
    () =>
      libraryAppToOpenTab({ name, service, identifier, metadata: { title } }),
    [identifier, name, service, title]
  );
  const tabsFolderName = useAtomValue(
    tabKeyFolderNameAtomFamily(tab ? getOpenTabKey(tab) : '')
  );

  const toggleDashboardPin = useCallback(() => {
    setSortablePinnedApps((prev) => {
      const isPinned = !!prev?.find(
        (item) => item?.name === name && item?.service === service
      );
      const updatedApps = isPinned
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

  const toggleTabsPin = useCallback(async () => {
    const showFailure = () =>
      executeEvent('openGlobalSnackBar', {
        message: t('core:tabs_overlay.pin_failed', {
          postProcess: 'capitalizeFirstChar',
        }),
        type: 'error',
      });
    if (!tab || !walletAddress) {
      showFailure();
      return;
    }
    try {
      const { pinned, folderName } = await toggleLibraryFolderPin(
        store,
        walletAddress,
        tab
      );
      executeEvent('openGlobalSnackBar', {
        message: t(
          pinned
            ? 'core:tabs_overlay.pinned_to_folder'
            : 'core:tabs_overlay.unpinned_from_folder',
          { folder: folderName, postProcess: 'capitalizeFirstChar' }
        ),
        type: 'success',
        duration: 2400,
      });
    } catch (error) {
      console.error('Failed to update the Tabs Library folder', error);
      showFailure();
    }
  }, [store, t, tab, walletAddress]);

  const togglePin = useCallback(() => {
    if (target === 'tabs') {
      void toggleTabsPin();
    } else {
      toggleDashboardPin();
    }
  }, [target, toggleDashboardPin, toggleTabsPin]);

  return {
    target,
    isPinned: target === 'tabs' ? tabsFolderName != null : isDashboardPinned,
    togglePin,
  };
}
