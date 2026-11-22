import { useCallback, useContext } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { QORTAL_APP_CONTEXT } from '../../App';
import {
  oldPinnedAppsAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { getFee } from '../../background/background';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../constants/constants';
import {
  getExtSavedSettings as getPublish,
  getExtSavedSettingsRecord as getPublishRecord,
} from '../../hooks/qdnSavedSettings';
import {
  rememberedSettingsCopy,
  rememberSettingsCopy,
  type SettingsCopy,
} from '../../hooks/qdnSettingsCopy';
import { objectToBase64 } from '../../qdn/encryption/group-encryption';
import { serializePinnedAppsForQdn } from '../../utils/pinnedAppsSettings';
import { useSavedAppsSync } from '../Apps/AppsLauncher/savedAppsSync';

/** The account's settings on QDN: one encrypted file, saved as a whole. */
export const SETTINGS_IDENTIFIER = 'ext_saved_settings';
export const SETTINGS_SERVICE = 'DOCUMENT_PRIVATE';

export type SaveSettingsOutcome = 'saved' | 'canceled';

/** What the background answers; `window.sendMessage` is untyped. */
type MessageAnswer = {
  error?: unknown;
  message?: unknown;
  identifier?: unknown;
} | null;

const sendMessage = (
  action: string,
  payload: unknown,
  timeout?: number
): Promise<MessageAnswer> =>
  (
    window.sendMessage as (
      action: string,
      payload: unknown,
      timeout?: number
    ) => Promise<MessageAnswer>
  )(action, payload, timeout);

const errorOf = (reason: unknown, fallback: string) => {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string' && reason) return new Error(reason);
  const message = (reason as { message?: unknown } | null)?.message;
  return new Error(typeof message === 'string' && message ? message : fallback);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Saves the account's settings to QDN: the pinned apps, folders and bookmarks
 * (saved apps, with the fields older Hubs and GO versions read).
 *
 * - Settings saved on another device since they were read here are taken
 *   in first, item by item, so a save never undoes what another device did:
 *   an app pinned or removed there stays so, unless changed here since. They
 *   also become what Revert goes back to, even if this save is called off.
 *   With `overwrite`, settings that could not be read are written over.
 * - Every other field of the settings (Home's layout and the side panel the
 *   desktop Hub saves, and fields newer than this GO) goes as the newest copy
 *   read here holds it.
 * - It asks to confirm, with the fee, before it publishes. `canceled` means
 *   that was declined; a failure throws, with a message to show.
 */
export const useSaveSettingsToQdn = (
  address: string | null | undefined,
  name: string | null | undefined
) => {
  const pinnedApps = useAtomValue(sortablePinnedAppsAtom);
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);
  const setSettingsQdnLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);
  const savedApps = useSavedAppsSync();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const { t } = useTranslation(['core']);

  return useCallback(
    async ({
      overwrite = false,
    }: { overwrite?: boolean } = {}): Promise<SaveSettingsOutcome> => {
      const failure = t('core:message.error.save_qdn', {
        postProcess: 'capitalizeFirstChar',
      });

      // The settings the fields GO doesn't write come from.
      let copy: SettingsCopy | null = address
        ? rememberedSettingsCopy(address)
        : null;
      if (address && name && !overwrite) {
        const record = await getPublishRecord(name);
        if (record.hasPublishRecord) {
          // Only a copy newer than the one read here: a node that is behind
          // may answer with an older one.
          if (!copy || record.timestamp > copy.updated) {
            const settings = await getPublish(name);
            // Settings that cannot be read are not written over unasked.
            if (!settings) throw new Error(failure);
            copy = { settings, updated: record.timestamp };
            rememberSettingsCopy(address, copy);
          }
          const known = (await savedApps.readBase(address))?.updated ?? null;
          if (known === null || copy.updated > known) {
            // Taken in item by item: they become what Revert goes back to.
            const taken = await savedApps.takeIn(address, copy);
            if (!taken) throw new Error(failure);
          }
        }
      }

      // The pins, folders and bookmarks with this device's latest changes.
      const prepared = address ? await savedApps.forSave(address) : null;
      if (address && !prepared) throw new Error(failure);
      const data64 = await objectToBase64({
        ...(copy && isRecord(copy.settings) ? copy.settings : {}),
        ...(prepared
          ? prepared.fields
          : { sortablePinnedApps: serializePinnedAppsForQdn(pinnedApps) }),
      });
      const encrypted = await sendMessage(
        'ENCRYPT_DATA',
        { data64 },
        TIME_MINUTES_1_IN_MILLISECONDS
      ).then((response) => {
        if (!response || response.error) {
          throw errorOf(response?.message || response?.error, failure);
        }
        return response;
      });

      const fee = await getFee('ARBITRARY');
      try {
        await show({
          message: t('core:message.question.publish_qdn', {
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: `${fee.fee} QORT`,
        });
      } catch (reason) {
        if ((reason as { isCanceled?: boolean } | null)?.isCanceled) {
          return 'canceled';
        }
        throw errorOf(reason, failure);
      }

      const response = await sendMessage('publishOnQDN', {
        data: encrypted,
        identifier: SETTINGS_IDENTIFIER,
        service: SETTINGS_SERVICE,
        uploadType: 'base64',
      }).then(
        (answer) => {
          if (answer?.error) throw errorOf(answer.error, failure);
          return answer;
        },
        (reason) => {
          throw errorOf(reason, failure);
        }
      );
      if (!response?.identifier) throw new Error(failure);

      setSettingsQdnLastUpdated(Date.now());
      // What was published is what QDN holds now.
      if (address && prepared) {
        await savedApps.markPublished(address, prepared.apps);
      } else {
        setOldPinnedApps(pinnedApps);
      }
      return 'saved';
    },
    [
      address,
      name,
      pinnedApps,
      savedApps,
      setOldPinnedApps,
      setSettingsQdnLastUpdated,
      show,
      t,
    ]
  );
};
