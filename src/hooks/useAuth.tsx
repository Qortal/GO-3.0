import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  getDefaultLocalNodeUrl,
  EXT_NODE_QORTAL_LINK,
  HTTP_LOCALHOST_12391,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_SECONDS_40_IN_MILLISECONDS,
} from '../constants/constants';
import {
  isLocalPrivateHttpsUrl,
  ensureElectronCertIfLocalPrivateHttps,
  preferHttpForLocalPrivateUrl,
} from '../utils/helpers';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  authenticatePasswordAtom,
  balanceAtom,
  enableAuthWhenSyncingAtom,
  extStateAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isOpenDialogCustomApikey,
  isOpenDialogResetApikey,
  isOpenSettingUpLocalCoreAtom,
  isOpenSyncingDialogAtom,
  isOpenUrlInvalidAtom,
  isPublicNodeUnavailableAtom,
  isRunningPublicNodeAtom,
  qortBalanceLoadingAtom,
  rawWalletAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
  walletToBeDecryptedErrorAtom,
} from '../atoms/global';
import { handleSetGlobalApikey } from '../App';
import {
  getLocalApiKeyNotElectronCase,
  setLocalApiKeyNotElectronCase,
} from '../background/background-cases';
import { ApiKey } from '../types/auth';
import { useModalGlobal } from './useModalGlobal';
import { getWalletErrorMessage } from '../utils/walletErrorMessages';
import { markWalletUnlockedInSession } from '../utils/walletUnlockSession';
import { saveLastAuthenticatedWalletAddress } from '../utils/lastAuthenticatedWallet';
import { recordUnlockTiming } from '../utils/unlockTimings';

let balanceSetIntervalRef: null | NodeJS.Timeout = null;
const LOCAL_CORE_READY_SYNC_PERCENT = 99.95;
const ADMIN_STATUS_FETCH_TIMEOUT_MS = 5000;
// localAuthBypassEnabled / apikey/test / apikey/generate: a timeout counts as
// a network error.
const ADMIN_AUTH_FETCH_TIMEOUT_MS = 5000;

export type NodeCheckOptions = {
  /**
   * Re-fetch the account's user info against the node once it is saved
   * (default true). Unlock passes false: authenticate() fetches it after the
   * decrypt, so the KDF does not wait on extra node round trips.
   */
  refreshUserInfo?: boolean;
};

/**
 * Run `request` with a signal that aborts after `timeoutMs`, so a node that
 * accepts the connection but never answers (e.g. a dead SSH tunnel on
 * 127.0.0.1) cannot hold the unlock loader. Read the body inside `request`
 * so it is bounded too.
 */
async function withFetchTimeout<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await request(controller.signal);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/** GET `url` and read the body as text, aborting both after `timeoutMs`. */
function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  return withFetchTimeout(timeoutMs, async (signal) => {
    const response = await fetch(url, { signal });
    return response.text();
  });
}

function isLocalCoreStatusSynced(status: any) {
  const syncPercent = Number(status?.syncPercent);
  return (
    Number.isFinite(syncPercent) && syncPercent >= LOCAL_CORE_READY_SYNC_PERCENT
  );
}

function isGatewayNode(nodeInfo?: ApiKey | null) {
  return !nodeInfo?.url || nodeInfo.url.includes(EXT_NODE_QORTAL_LINK);
}

export const useAuth = () => {
  const setIsOpenResetApikey = useSetAtom(isOpenDialogResetApikey);
  const setIsOpenCustomApikeyDialog = useSetAtom(isOpenDialogCustomApikey);
  const setBalance = useSetAtom(balanceAtom);
  const setQortBalanceLoading = useSetAtom(qortBalanceLoadingAtom);
  const setIsOpenSettingUpCore = useSetAtom(isOpenSettingUpLocalCoreAtom);
  const actions = useModalGlobal({ setGlobalOpen: setIsOpenSettingUpCore });

  const setIsOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const setIsOpenSyncingDialog = useSetAtom(isOpenSyncingDialogAtom);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const setUserInfo = useSetAtom(userInfoAtom);
  const setWalletToBeDecryptedError = useSetAtom(walletToBeDecryptedErrorAtom);
  const setIsUrlInvalid = useSetAtom(isOpenUrlInvalidAtom);
  const setPublicNodeUnavailable = useSetAtom(isPublicNodeUnavailableAtom);
  const setIsRunningPublicNode = useSetAtom(isRunningPublicNodeAtom);

  const setIsLoading = useSetAtom(isLoadingAuthenticateAtom);
  const setExtstate = useSetAtom(extStateAtom);
  const extState = useAtomValue(extStateAtom);
  const [enableAuthWhenSyncing] = useAtom(enableAuthWhenSyncingAtom);
  const setAuthenticatePassword = useSetAtom(authenticatePasswordAtom);
  const store = useStore();
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);
  const authenticateInFlightRef = useRef(false);

  const useLocalNode = isLocalNodeUrl(selectedNode?.url);

  useEffect(() => {
    if (extState === 'not-authenticated') {
      if (balanceSetIntervalRef) {
        clearInterval(balanceSetIntervalRef);
        balanceSetIntervalRef = null;
      }
    }
  }, [extState]);

  const checkIfLocalIsRunning = useCallback(async (baseUrl: string) => {
    try {
      const res = await withFetchTimeout(
        ADMIN_STATUS_FETCH_TIMEOUT_MS,
        (signal) => fetch(baseUrl + '/admin/status', { signal })
      );
      if (res?.ok) return true;
      return false;
    } catch (error) {
      return false;
    }
  }, []);

  const generateApiKey = useCallback(async () => {
    try {
      const key = await withFetchTimeout(
        ADMIN_AUTH_FETCH_TIMEOUT_MS,
        async (signal) => {
          const res = await fetch(
            `${getDefaultLocalNodeUrl()}/admin/apikey/generate`,
            {
              method: 'POST',
              signal,
            }
          );
          if (!res.ok) {
            return null;
          }
          return (await res.text()).trim();
        }
      );
      if (!key) return null;
      return key;
    } catch (error) {
      return null;
    }
  }, []);

  const validateApiKey = useCallback(
    async (currentNode, disablePopup = false) => {
      const isElectron = !!window?.coreSetup;
      const validatedNodeInfo = currentNode;

      const preferredUrl =
        preferHttpForLocalPrivateUrl(validatedNodeInfo?.url) ||
        validatedNodeInfo?.url;
      if (
        preferredUrl &&
        validatedNodeInfo?.url &&
        preferredUrl !== validatedNodeInfo.url
      ) {
        validatedNodeInfo.url = preferredUrl;
      }
      // Status/auth probes always use cleartext against local private HTTPS
      // bases; Electron later re-enables TLS via ensureCertForBase.
      let baseUrl = validatedNodeInfo?.url;
      if (isLocalPrivateHttpsUrl(baseUrl) && baseUrl) {
        baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
      }
      try {
        const isLocal = isLocalNodeUrl(validatedNodeInfo?.url);
        if (isLocal) {
          const runningRes = isElectron
            ? await window.coreSetup.isCoreRunning()
            : await checkIfLocalIsRunning(baseUrl);
          if (!runningRes && !disablePopup) {
            setIsOpenCoreSetup(true);
            return { isValid: false, validatedNodeInfo };
          }
          if (isLocal && isElectron && !disablePopup) {
            const statusAvailable = await checkIfLocalIsRunning(baseUrl);
            if (!statusAvailable) {
              const endpointsReady = await actions.show();
              if (!endpointsReady) {
                return;
              }
            }
          }
          const apiKey = isElectron
            ? await window.coreSetup.getApiKey()
            : await getLocalApiKeyNotElectronCase();
          if (apiKey) {
            validatedNodeInfo.apikey = apiKey;
          }
        }

        if (!isLocal) {
          let isUrlGood = true;
          try {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => {
              controller.abort();
            }, ADMIN_STATUS_FETCH_TIMEOUT_MS);
            let resUrlCheck: Response;
            try {
              resUrlCheck = await fetch(`${baseUrl}/admin/status`, {
                signal: controller.signal,
              });
            } finally {
              window.clearTimeout(timeoutId);
            }
            if (!resUrlCheck.ok) {
              isUrlGood = false;
            }
          } catch (error) {
            isUrlGood = false;
          }

          if (!isUrlGood) {
            if (!disablePopup) {
              if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
                setPublicNodeUnavailable(true);
                setIsOpenCoreSetup(true);
              } else {
                setIsUrlInvalid(true);
              }
            }
            return { isValid: false, validatedNodeInfo };
          }

          if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
            setPublicNodeUnavailable(false);
          }
        }

        let isValid = false;

        const url = `${baseUrl}/admin/settings/localAuthBypassEnabled`;
        // Assuming the response is in plain text and will be 'true' or 'false'
        const data = await fetchTextWithTimeout(
          url,
          ADMIN_AUTH_FETCH_TIMEOUT_MS
        );
        if (data && data === 'true') {
          isValid = true;
        } else {
          try {
            const url2 = `${baseUrl}/admin/apikey/test?apiKey=${encodeURIComponent(validatedNodeInfo?.apikey)}`;
            // Assuming the response is in plain text and will be 'true' or 'false'
            const data2 = await fetchTextWithTimeout(
              url2,
              ADMIN_AUTH_FETCH_TIMEOUT_MS
            );
            if (data2 === 'true') {
              isValid = true;
            }
          } catch (error) {
            // Network error or timeout: the key stays untested (isValid false).
          }
        }
        if (!isValid && isLocal && !isElectron) {
          const resGenerateApiKey = await generateApiKey();
          if (resGenerateApiKey) {
            validatedNodeInfo.apikey = resGenerateApiKey;
            isValid = true;
          }
        }
        if (!isValid && isLocal && !disablePopup) {
          setIsOpenResetApikey(true);
        } else if (!isValid && !isLocal && !disablePopup) {
          setIsOpenCustomApikeyDialog(true);
        }
        if (isValid && !isElectron && isLocal && !disablePopup) {
          setLocalApiKeyNotElectronCase(validatedNodeInfo.apikey);
        }

        if (isValid && isElectron) {
          const cert = await ensureElectronCertIfLocalPrivateHttps(
            validatedNodeInfo?.url,
            validatedNodeInfo?.apikey ?? ''
          );
          if (!cert.success) {
            throw new Error(cert.error || 'Failed to ensure cert for base');
          }
        }

        return { isValid, validatedNodeInfo };
      } catch (error) {
        return { isValid: false, validatedNodeInfo };
      }
    },
    [
      setIsOpenCustomApikeyDialog,
      setIsOpenResetApikey,
      checkIfLocalIsRunning,
      generateApiKey,
      setIsOpenCoreSetup,
      setIsUrlInvalid,
      setPublicNodeUnavailable,
    ]
  );

  const validateLocalApiKey = useCallback(async (apiKey) => {
    try {
      const url2 = `${getDefaultLocalNodeUrl()}/admin/apikey/test?apiKey=${encodeURIComponent(apiKey)}`;
      const response2 = await fetch(url2);

      // Assuming the response is in plain text and will be 'true' or 'false'
      const data2 = await response2.text();
      if (data2 === 'true') {
        setLocalApiKeyNotElectronCase(apiKey);
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }, []);

  const handleSaveNodeInfo = useCallback(
    async (nodeInfo, options?: NodeCheckOptions) => {
      const incoming = nodeInfo || {
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      };
      // Persist the scheme the runtime can actually use. On mobile/web,
      // https://localhost (e.g. SSH tunnel to a plain HTTP API) is rewritten
      // to http:// so later fetches do not fail the TLS handshake.
      const preferredUrl =
        preferHttpForLocalPrivateUrl(incoming.url) || incoming.url;
      const nextNodeInfo =
        preferredUrl === incoming.url
          ? incoming
          : { ...incoming, url: preferredUrl };

      await window.sendMessage('setApiKey', nextNodeInfo);
      setSelectedNode(nextNodeInfo);
      handleSetGlobalApikey(nextNodeInfo);
      try {
        setIsRunningPublicNode(isGatewayNode(nextNodeInfo));
      } catch (error) {
        console.error(error);
      }
      // Re-resolve the account name/info against the NEWLY selected node.
      // Without this the cached name from the previous node persists, and
      // chain interactions that require a registered name fail after a
      // private->public switch ("a registered name is needed").
      // Skipped (not deferred) when the caller fetches it itself: a late
      // answer for the previous session's account could land after the new one.
      if (options?.refreshUserInfo === false) return;
      try {
        const userResponse = await window.sendMessage('userInfo');
        if (userResponse && !userResponse.error) {
          setUserInfo(userResponse);
        }
      } catch (error) {
        console.error('Failed to refresh user info after node switch:', error);
      }
    },
    [setIsRunningPublicNode, setSelectedNode, setUserInfo]
  );

  const isNodeValid = useCallback(
    async (options?: NodeCheckOptions): Promise<boolean> => {
      const startedAt = performance.now();
      let isCurrentLocalNode = false;
      let isNodeOk = false;
      try {
        const currentSelectedNode = store.get(selectedNodeInfoAtom);
        isCurrentLocalNode = isLocalNodeUrl(currentSelectedNode?.url);

        const payload = isCurrentLocalNode
          ? {
              apikey: '',
              url: getDefaultLocalNodeUrl(),
            }
          : currentSelectedNode;
        if (!payload) return false;
        const { isValid, validatedNodeInfo } = await validateApiKey(payload);

        if (isValid) {
          await handleSaveNodeInfo(validatedNodeInfo, options);
          isNodeOk = true;
          return true;
        } else {
          return false;
        }
      } catch (error) {
        return false;
      } finally {
        recordUnlockTiming(
          'node-check',
          performance.now() - startedAt,
          `${isNodeOk ? 'ok' : 'failed'}, ${
            isCurrentLocalNode ? 'local node' : 'remote node'
          }`
        );
      }
    },
    [store, validateApiKey, handleSaveNodeInfo]
  );

  const balanceSetInterval = useCallback(() => {
    try {
      if (balanceSetIntervalRef) {
        clearInterval(balanceSetIntervalRef);
      }

      let isCalling = false;
      balanceSetIntervalRef = setInterval(async () => {
        if (isCalling) return;
        if (document.hidden) return; // skip while backgrounded (battery)
        isCalling = true;
        window
          .sendMessage('balance')
          .then((response) => {
            if (!response?.error && !isNaN(+response)) {
              setBalance(response);
            }
            isCalling = false;
          })
          .catch((error) => {
            console.error('Failed to get balance:', error);
            isCalling = false;
          });
      }, TIME_SECONDS_40_IN_MILLISECONDS);
    } catch (error) {
      console.error(error);
    }
  }, [setBalance]);

  const getBalanceFunc = useCallback(() => {
    setQortBalanceLoading(true);
    window
      .sendMessage('balance')
      .then((response) => {
        if (!response?.error && !isNaN(+response)) {
          setBalance(response);
        }

        setQortBalanceLoading(false);
      })
      .catch((error) => {
        console.error('Failed to get balance:', error);
        setQortBalanceLoading(false);
      })
      .finally(() => {
        balanceSetInterval();
      });
  }, [balanceSetInterval, setBalance, setQortBalanceLoading]);

  const resetApikey = useCallback(async () => {
    try {
      await window.coreSetup.resetApikey();
    } catch (error) {
      console.error(error);
    }
  }, []);

  const isSyncedLocal = useCallback(async () => {
    try {
      const currentSelectedNode = store.get(selectedNodeInfoAtom);
      if (!isLocalNodeUrl(currentSelectedNode?.url)) return true;
      const status = await withFetchTimeout(
        ADMIN_STATUS_FETCH_TIMEOUT_MS,
        async (signal) => {
          const res = await fetch(HTTP_LOCALHOST_12391 + '/admin/status', {
            signal,
          });
          return res?.ok ? { data: await res.json() } : null;
        }
      );
      if (!status) return false;
      if (!isLocalCoreStatusSynced(status.data)) {
        if (enableAuthWhenSyncing) {
          return true;
        }
        setIsOpenSyncingDialog(true);
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }, [store, setIsOpenSyncingDialog, enableAuthWhenSyncing]);

  const authenticate = useCallback(
    async (
      skipToPublic?: boolean,
      skipLocalCheck?: boolean
    ): Promise<boolean> => {
      const unlockStartedAt = performance.now();
      if (authenticateInFlightRef.current) {
        return false;
      }
      if (!skipToPublic && !skipLocalCheck) {
        const isInSync = await isSyncedLocal();
        if (!isInSync) {
          return false;
        }
      }
      authenticateInFlightRef.current = true;
      if (!skipLocalCheck) {
        setIsLoading(true);
      }
      setWalletToBeDecryptedError('');
      const password = store.get(authenticatePasswordAtom);
      const wallet = store.get(rawWalletAtom) ?? rawWallet;

      try {
        const walletAddress = wallet?.address0?.trim();

        if (skipLocalCheck && walletAddress) {
          const resumeResponse = await window.sendMessage(
            'tryResumeWalletSession',
            { address: walletAddress }
          );
          if (resumeResponse?.ok) {
            saveLastAuthenticatedWalletAddress(walletAddress);
            markWalletUnlockedInSession(walletAddress);
            setAuthenticatePassword('');
            setExtstate('authenticated');
            recordUnlockTiming(
              'unlock',
              performance.now() - unlockStartedAt,
              'resumed session'
            );
            setWalletToBeDecryptedError('');
            setIsLoading(false);

            window.sendMessage('startNotificationCheck').catch(() => {});
            window
              .sendMessage('userInfo')
              .then((userResponse) => {
                if (userResponse && !userResponse.error) {
                  setUserInfo(userResponse);
                }
              })
              .catch((error) => {
                console.error('Failed to get user info:', error);
              });
            getBalanceFunc();
            window
              .sendMessage('getWalletInfo')
              .then((walletResponse) => {
                if (walletResponse && walletResponse.walletInfo) {
                  setRawWallet(walletResponse.walletInfo);
                }
              })
              .catch((error) => {
                console.error('Failed to get wallet info:', error);
              });
            return true;
          }
        }

        const decryptStartedAt = performance.now();
        let decryptOutcome = 'error';
        let response;
        try {
          response = await window.sendMessage(
            'decryptWallet',
            {
              password,
              wallet,
            },
            TIME_MINUTES_2_IN_MILLISECONDS
          );
          decryptOutcome = response && !response.error ? 'ok' : 'failed';
        } finally {
          recordUnlockTiming(
            'decrypt',
            performance.now() - decryptStartedAt,
            decryptOutcome
          );
        }

        if (response && !response.error) {
          saveLastAuthenticatedWalletAddress(wallet?.address0);
          markWalletUnlockedInSession(wallet?.address0);
          setAuthenticatePassword('');
          setExtstate('authenticated');
          recordUnlockTiming(
            'unlock',
            performance.now() - unlockStartedAt,
            skipLocalCheck ? 'fingerprint' : 'password'
          );
          setWalletToBeDecryptedError('');
          setIsLoading(false);

          window.sendMessage('startNotificationCheck').catch(() => {});

          window
            .sendMessage('userInfo')
            .then((userResponse) => {
              if (userResponse && !userResponse.error) {
                setUserInfo(userResponse);
              }
            })
            .catch((error) => {
              console.error('Failed to get user info:', error);
            });

          getBalanceFunc();

          window
            .sendMessage('getWalletInfo')
            .then((walletResponse) => {
              if (walletResponse && walletResponse.walletInfo) {
                setRawWallet(walletResponse.walletInfo);
              }
            })
            .catch((error) => {
              console.error('Failed to get wallet info:', error);
            });

          return true;
        }

        setIsLoading(false);
        if (response?.error) {
          setWalletToBeDecryptedError(getWalletErrorMessage(response.error));
        }
        return false;
      } catch (error) {
        setIsLoading(false);
        setWalletToBeDecryptedError(getWalletErrorMessage(error));
        console.error('Failed to decrypt wallet:', error);
        return false;
      } finally {
        authenticateInFlightRef.current = false;
      }
    },
    [
      store,
      setIsLoading,
      setAuthenticatePassword,
      setExtstate,
      setUserInfo,
      setRawWallet,
      setWalletToBeDecryptedError,
      rawWallet,
      getBalanceFunc,
      isSyncedLocal,
    ]
  );

  const saveCustomNodes = useCallback(async (updatedNode: ApiKey) => {
    let nodes = [];

    try {
      nodes = await window.sendMessage('getCustomNodesFromStorage');
    } catch (error) {
      console.error(error);
    }
    if (!nodes) return;
    const customNodeToSaveIndex = nodes.findIndex(
      (n) => n?.url === updatedNode?.url
    );
    if (customNodeToSaveIndex === -1) return;

    nodes.splice(customNodeToSaveIndex, 1, updatedNode);

    window.sendMessage('setCustomNodes', nodes).catch(() => {
      console.error('Failed to set custom nodes');
    });
  }, []);

  const validateApiKeyFromRegistration = useCallback(async () => {
    try {
      const { isValid } = await validateApiKey(selectedNode, true);
      if (!isValid) {
        await handleSaveNodeInfo(null);
      }
    } catch (error) {
      await handleSaveNodeInfo(null);
      console.error(error);
    }
  }, [selectedNode, validateApiKey, handleSaveNodeInfo]);

  return useMemo(
    () => ({
      validateApiKey,
      isNodeValid,
      handleSaveNodeInfo,
      authenticate,
      getBalanceFunc,
      resetApikey,
      validateLocalApiKey,
      validateApiKeyFromRegistration,
      saveCustomNodes,
    }),
    [
      validateApiKey,
      isNodeValid,
      handleSaveNodeInfo,
      authenticate,
      getBalanceFunc,
      resetApikey,
      validateLocalApiKey,
      validateApiKeyFromRegistration,
      saveCustomNodes,
    ]
  );
};
