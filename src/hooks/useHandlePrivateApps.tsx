import { useState } from 'react';
import { executeEvent } from '../utils/events';
import { getBaseApiReact } from '../App';
import { createEndpoint } from '../background/background.ts';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';
import { base64ToUint8Array } from '../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../encryption/encryption.ts';
import { isValidBase64 } from '../utils/decode.ts';
import {
  buildPrivateAppOnDevice,
  canBuildPrivateAppsOnDevice,
} from '../plugins/PrivateQappHost';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

/** What the node answers for a preview it built: /render/hash/<hash>?secret=<secret>. */
const NODE_PREVIEW_PATH =
  /^\/render\/hash\/[1-9A-HJ-NP-Za-km-z]+\?secret=[1-9A-HJ-NP-Za-km-z]+$/;

export const useHandlePrivateApps = () => {
  const [status, setStatus] = useState('');
  const [openSnackGlobal, setOpenSnackGlobal] = useAtom(openSnackGlobalAtom);
  const [infoSnackCustom, setInfoSnackCustom] = useAtom(infoSnackGlobalAtom);
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  /**
   * The address to show the decrypted app at. On Android GO builds it itself
   * and serves it from memory (plugins/PrivateQappHost): a public node cannot
   * build it (that takes the node's API key) and no node sees it decrypted.
   * Elsewhere the node builds a preview, which needs a node with its API key.
   */
  const buildPrivateApp = async (
    name: string,
    appBase64: string
  ): Promise<string> => {
    if (canBuildPrivateAppsOnDevice()) {
      try {
        return (await buildPrivateAppOnDevice(getBaseApiReact(), appBase64))
          .url;
      } catch (error) {
        console.warn('Private Q-App not built on this device', error);
        throw new Error(
          t('core:message.error.build_app', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    }

    const endpoint = await createEndpoint(
      `/arbitrary/APP/${encodeURIComponent(name)}/zip?preview=true`
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: appBase64,
    });
    const previewPath = response.ok ? (await response.text()).trim() : '';
    if (!NODE_PREVIEW_PATH.test(previewPath)) {
      const needsKey = response.status === 401 || response.status === 403;
      throw new Error(
        t(
          needsKey
            ? 'core:message.error.private_app_needs_own_node'
            : 'core:message.error.build_app',
          { postProcess: 'capitalizeFirstChar' }
        )
      );
    }
    // The node authorizes its own preview, so the frame's address carries
    // no API key (createEndpoint would add it, for the app to read).
    return `${getBaseApiReact()}${previewPath}`;
  };

  const openApp = async (
    privateAppProperties,
    addToPinnedApps,
    setLoadingStatePrivateApp
  ) => {
    try {
      if (setLoadingStatePrivateApp) {
        setLoadingStatePrivateApp(
          t('core:message.generic.downloading_decrypting_app', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      setOpenSnackGlobal(true);

      setInfoSnackCustom({
        type: 'info',
        message: t('core:message.generic.fetching_data', {
          postProcess: 'capitalizeFirstChar',
        }),
        duration: null,
      });
      const urlData = `${getBaseApiReact()}/arbitrary/${
        privateAppProperties?.service
      }/${privateAppProperties?.name}/${
        privateAppProperties?.identifier
      }?encoding=base64`;
      let data;
      try {
        const responseData = await fetch(urlData);
        // A node that cannot get the app answers with an error (a public node
        // often: 404 "Data unavailable"); never treat that text as the app.
        data = responseData?.ok ? (await responseData.text()).trim() : '';
        if (!data || !isValidBase64(data)) {
          throw new Error(
            t('core:message.error.private_app_not_available', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp(
            t('core:message.error.download_private_app', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
        throw error;
      }

      let decryptedData;
      try {
        decryptedData = await window.sendMessage('DECRYPT_QORTAL_GROUP_DATA', {
          base64: data,
          groupId: privateAppProperties?.groupId,
        });
        if (decryptedData?.error) {
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(
              t('core:message.error.decrypt_app', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          throw new Error(decryptedData?.error);
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp(
            t('core:message.error.decrypt_app', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
        throw error;
      }

      try {
        const convertToUint = base64ToUint8Array(decryptedData);
        const UintToObject = uint8ArrayToObject(convertToUint);

        if (decryptedData) {
          if (typeof UintToObject?.app !== 'string' || !UintToObject.app) {
            throw new Error(
              t('core:message.error.build_app', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          setInfoSnackCustom({
            type: 'info',
            message: t('core:message.generic.building_app', {
              postProcess: 'capitalizeFirstChar',
            }),
          });

          const previewUrl = await buildPrivateApp(
            privateAppProperties?.name,
            UintToObject.app
          );

          // Refresh builds the app again (on the phone: a new address, so the
          // frame reloads) and AppsDesktop swaps the tab's address.
          const refreshFunc = async (tabId) => {
            try {
              setOpenSnackGlobal(true);
              setInfoSnackCustom({
                type: 'info',
                message: t('core:message.generic.building_app', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              executeEvent('updateAppUrl', {
                tabId,
                url: await buildPrivateApp(
                  privateAppProperties?.name,
                  UintToObject.app
                ),
              });
            } catch (error) {
              setOpenSnackGlobal(true);
              setInfoSnackCustom({
                type: 'error',
                message:
                  error?.message ||
                  t('core:message.error.build_app', {
                    postProcess: 'capitalizeFirstChar',
                  }),
              });
            }
          };

          const appName = UintToObject?.name;
          const logo = UintToObject?.logo
            ? `data:image/png;base64,${UintToObject?.logo}`
            : null;

          const dataBody = {
            url: previewUrl,
            isPreview: true,
            isPrivate: true,
            // Lift identity to top-level so session restore, tab keys, and
            // qortal:// URLs survive APK refresh without privateAppProperties-only lookups.
            service: privateAppProperties?.service || 'APP',
            name: privateAppProperties?.name,
            identifier: privateAppProperties?.identifier,
            label: appName || privateAppProperties?.name,
            privateAppProperties: { ...privateAppProperties, logo, appName },
            filePath: '',
            refreshFunc: (tabId) => {
              void refreshFunc(tabId);
            },
          };
          executeEvent('addTab', {
            data: dataBody,
          });
          setInfoSnackCustom({
            type: 'success',
            message: t('core:message.generic.opened', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(``);
          }
          if (addToPinnedApps) {
            let pinned = false;
            setSortablePinnedApps((prev) => {
              // Adding the same private app again opens it; it is pinned once.
              const samePrivateApp = (pinned) => {
                const props = pinned?.privateAppProperties;
                return (
                  pinned?.isPrivate === true &&
                  props?.service === privateAppProperties?.service &&
                  props?.name === privateAppProperties?.name &&
                  props?.identifier === privateAppProperties?.identifier &&
                  String(props?.groupId) ===
                    String(privateAppProperties?.groupId)
                );
              };
              if (prev.some(samePrivateApp)) return prev;
              pinned = true;
              const updatedApps = [
                ...prev,
                {
                  isPrivate: true,
                  isPreview: true,
                  privateAppProperties: {
                    ...privateAppProperties,
                    logo,
                    appName,
                  },
                },
              ];

              saveToLocalStorage(
                'ext_saved_settings',
                'sortablePinnedApps',
                updatedApps
              );
              return updatedApps;
            });
            if (pinned) setSettingsLocalLastUpdated(Date.now());
          }
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp(
            `Error! ${
              error?.message ||
              t('core:message.error.build_app', {
                postProcess: 'capitalizeFirstChar',
              })
            }`
          );
        }
        throw error;
      }
    } catch (error) {
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.fetch_app', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
    }
  };
  return {
    openApp,
    status,
  };
};
