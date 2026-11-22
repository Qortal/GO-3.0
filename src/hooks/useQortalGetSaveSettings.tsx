import { useCallback, useEffect, useRef } from 'react';
import {
  canSaveSettingToQdnAtom,
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { type ExtractAtomValue, useAtom, useSetAtom, useStore } from 'jotai';
import { removeBrokenPinnedApps } from '../utils/pinnedAppsSettings';
import { localPinnedAppsTimestamp } from '../utils/pinnedAppsStorage';
import { isGoApp } from '../utils/platform';
import {
  type FoundSettings,
  useRecordSavedAppsChanges,
  useSavedAppsSync,
} from '../components/Apps/AppsLauncher/savedAppsSync';
import { useSetLauncherViewOf } from '../components/Apps/AppsLauncher/useLauncherView';
import {
  ensureGoLauncherReady,
  settlePinList,
} from '../components/Mobile/goLauncher/goLauncherStore';
import {
  getExtSavedSettings,
  getExtSavedSettingsRecord,
} from './qdnSavedSettings';
import { rememberSettingsCopy } from './qdnSettingsCopy';

/**
 * Reads the account's settings on QDN at sign-in: the pinned apps, folders
 * and bookmarks (saved apps), merged item by item with this phone's own, as
 * the desktop Hub does. The same as Hub's hook of this name, without Home's
 * layout and the side panel, which GO keeps as they are on QDN.
 */
export const useQortalGetSaveSettings = (
  myName,
  isAuthenticated,
  myAddress?: string | null
) => {
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setCanSave = useSetAtom(canSaveSettingToQdnAtom);
  const setSettingsQDNLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);

  const [settingsLocalLastUpdated] = useAtom(settingsLocalLastUpdatedAtom);
  const [isUsingImportExportSettings] = useAtom(
    isUsingImportExportSettingsAtom
  );
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);
  // The name whose settings are wanted now: an answer for another one (an
  // account switched meanwhile) is dropped.
  const currentNameRef = useRef(myName);
  currentNameRef.current = myName;
  const savedApps = useSavedAppsSync();
  const store = useStore();
  const setLauncherViewOf = useSetLauncherViewOf();
  // Each change to the pins, folders and bookmarks gets the time it's made.
  useRecordSavedAppsChanges(isAuthenticated ? myAddress : null);

  /** The pins, folders and bookmarks (saved apps), from the same settings. */
  const takeInLauncher = useCallback(
    async (
      myAddress: string | null | undefined,
      found: FoundSettings | null
    ) => {
      if (!myAddress) return;
      try {
        if (isGoApp()) {
          // The phone's old Tabs folders become bookmark folders first, so
          // what was saved on QDN is merged with them, not put in their
          // place. Pins the move makes wait: the take-in decides the pin
          // list, and a pin added before it would look newer than QDN's.
          await ensureGoLauncherReady(store, myAddress, {
            setView: setLauncherViewOf,
            pinListSettled: false,
          });
        }
        const base = await savedApps.takeIn(myAddress, found);
        // The pin list is decided: pins the move held back join it now.
        if (base && isGoApp()) await settlePinList(store, myAddress);
      } catch (error) {
        console.error(error);
      }
    },
    [savedApps, setLauncherViewOf, store]
  );

  const getSavedSettings = useCallback(
    async (myName, settingsLocalLastUpdated, myAddress) => {
      try {
        const { hasPublishRecord, timestamp } =
          await getExtSavedSettingsRecord(myName);
        if (hasPublishRecord) {
          const settings = await getExtSavedSettings(myName);
          if (currentNameRef.current !== myName) return;
          if (!myAddress) {
            // No account to keep saved apps for: the pin list alone, as
            // before. Compare with the pins as they are now, not as they were
            // when this fetch started: a pin made meanwhile is newer.
            const latestLocal = Math.max(
              settingsLocalLastUpdated,
              localPinnedAppsTimestamp()
            );
            if (settings?.sortablePinnedApps && timestamp > latestLocal) {
              setSortablePinnedApps(
                removeBrokenPinnedApps(
                  settings.sortablePinnedApps
                ) as ExtractAtomValue<typeof sortablePinnedAppsAtom>
              );
            } else if (settings?.sortablePinnedApps) {
              setOldPinnedApps(settings.sortablePinnedApps);
            }
          }
          if (!settings) {
            // set -100 to indicate that it couldn't fetch the publish
            setSettingsQDNLastUpdated(-100);
          } else {
            setSettingsQDNLastUpdated(timestamp || 0);
            const found = { settings, updated: timestamp || 0 };
            // A save keeps what GO doesn't write as this copy holds it.
            if (myAddress) rememberSettingsCopy(myAddress, found);
            await takeInLauncher(myAddress, found);
          }
        } else {
          setSettingsQDNLastUpdated(0);
          await takeInLauncher(myAddress, null);
        }
        setCanSave(true);
      } catch (error) {
        console.log(error);
      }
    },
    [takeInLauncher]
  );

  useEffect(() => {
    if (
      !myName ||
      !settingsLocalLastUpdated ||
      !isAuthenticated ||
      isUsingImportExportSettings === null
    )
      return;
    if (isUsingImportExportSettings) return;
    getSavedSettings(myName, settingsLocalLastUpdated, myAddress);
  }, [
    getSavedSettings,
    myAddress,
    myName,
    settingsLocalLastUpdated,
    isAuthenticated,
    isUsingImportExportSettings,
  ]);
};
