import { useCallback, useEffect } from 'react';
import {
  canSaveSettingToQdnAtom,
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { useAtom, useSetAtom } from 'jotai';
import { getExtSavedSettings, getExtSavedSettingsRecord } from './qdnSavedSettings';

function fetchFromLocalStorage(key) {
  try {
    const serializedValue = localStorage.getItem(key);
    if (serializedValue === null) {
      console.log(`No data found for key: ${key}`);
      return null;
    }
    return JSON.parse(serializedValue);
  } catch (error) {
    console.error('Error fetching from localStorage:', error);
    return null;
  }
}

export const useQortalGetSaveSettings = (myName, isAuthenticated) => {
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setCanSave = useSetAtom(canSaveSettingToQdnAtom);
  const setSettingsQDNLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);

  const [settingsLocalLastUpdated] = useAtom(settingsLocalLastUpdatedAtom);
  const [isUsingImportExportSettings] = useAtom(
    isUsingImportExportSettingsAtom
  );
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);

  const getSavedSettings = useCallback(
    async (myName, settingsLocalLastUpdated) => {
      try {
        const { hasPublishRecord, timestamp } =
          await getExtSavedSettingsRecord(myName);
        if (hasPublishRecord) {
          const settings = await getExtSavedSettings(myName);
          if (
            settings?.sortablePinnedApps &&
            timestamp > settingsLocalLastUpdated
          ) {
            setSortablePinnedApps(settings.sortablePinnedApps);

            setSettingsQDNLastUpdated(timestamp || 0);
          } else if (settings?.sortablePinnedApps) {
            setSettingsQDNLastUpdated(timestamp || 0);
            setOldPinnedApps(settings.sortablePinnedApps);
          }
          if (!settings) {
            // set -100 to indicate that it couldn't fetch the publish
            setSettingsQDNLastUpdated(-100);
          }
        } else {
          setSettingsQDNLastUpdated(0);
        }
        setCanSave(true);
      } catch (error) {
        console.log(error);
      }
    },
    []
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
    getSavedSettings(myName, settingsLocalLastUpdated);
  }, [
    getSavedSettings,
    myName,
    settingsLocalLastUpdated,
    isAuthenticated,
    isUsingImportExportSettings,
  ]);
};
