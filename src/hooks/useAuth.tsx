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
import { isGoApp } from '../utils/platform';

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
 * Why a node check failed:
 * - 'unreachable': no usable answer from the node (offline, node or SSH
 *   tunnel down, timeout).
 * - 'key-rejected': the node answered but did not accept the API key.
 * - 'error': anything else.
 */
export type NodeCheckFailure = 'unreachable' | 'key-rejected' | 'error';

export type ValidateApiKeyResult = {
  isValid: boolean;
  validatedNodeInfo: any;
  /** Set when isValid is false. */
  failure?: NodeCheckFailure;
};

export type NodeCheckResult = {
  ok: boolean;
  /** Set when ok is false. */
  failure?: NodeCheckFailure;
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

type NodeTextAnswer = { ok: boolean; status: number; text: string };

/** GET `url` and read the body as text, aborting both after `timeoutMs`. */
function fetchTextWithTimeout(
  url: string,
  timeoutMs: number
): Promise<NodeTextAnswer> {
  return withFetchTimeout(timeoutMs, async (signal) => {
    const response = await fetch(url, { signal });
    return {
      ok: response.ok,
      status: response.status,
      text: (await response.text()).trim(),
    };
  });
}

/**
 * Core refuses a key with 401/403 ("API key invalid"). Anything else that is
 * not 'true' (a 502/503/504 page from the proxy in front of a busy node, a
 * 429) is no answer, not a refused key.
 */
function isKeyRefusal(answer: NodeTextAnswer) {
  return (
    answer.status === 401 ||
    answer.status === 403 ||
    (answer.ok && answer.text === 'false')
  );
}

function isLocalCoreStatusSynced(status: any) {
  const syncPercent = Number(status?.syncPercent);
  return (
    Number.isFinite(syncPercent) && syncPercent >= LOCAL_CORE_READY_SYNC_PERCENT
  );
}

/** False only when the device says it has no network (navigator.onLine). */
function isDeviceOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
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
    async (
      currentNode,
      disablePopup = false
    ): Promise<ValidateApiKeyResult | undefined> => {
      const isElectron = !!window?.coreSetup;
      // GO has no Core of its own to set up, and its unlock goes on without a
      // node that cannot be reached (like the fingerprint unlock). Offline it
      // stays silent; online, a chosen node (not the public one) that does not
      // answer gets the "url invalid" note, so a bad URL or a tunnel that is
      // down is not hidden. The unlock still goes on.
      const goApp = isGoApp();
      const noteGoNodeUnreachable = () => {
        if (!disablePopup && isDeviceOnline()) setIsUrlInvalid(true);
      };
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
            if (goApp) {
              noteGoNodeUnreachable();
            } else {
              setIsOpenCoreSetup(true);
            }
            return {
              isValid: false,
              validatedNodeInfo,
              failure: 'unreachable',
            };
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
            if (goApp) {
              if (validatedNodeInfo?.url !== HTTPS_EXT_NODE_QORTAL_LINK) {
                noteGoNodeUnreachable();
              }
            } else if (!disablePopup) {
              if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
                setPublicNodeUnavailable(true);
                setIsOpenCoreSetup(true);
              } else {
                setIsUrlInvalid(true);
              }
            }
            return {
              isValid: false,
              validatedNodeInfo,
              failure: 'unreachable',
            };
          }

          if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
            setPublicNodeUnavailable(false);
          }
        }

        let isValid = false;

        // Asked first so a node that stopped answering ends here, with no
        // key test and no dialog. Its answer no longer decides anything.
        const url = `${baseUrl}/admin/settings/localAuthBypassEnabled`;
        try {
          await fetchTextWithTimeout(url, ADMIN_AUTH_FETCH_TIMEOUT_MS);
        } catch (error) {
          return {
            isValid: false,
            validatedNodeInfo,
            failure: 'unreachable',
          };
        }
        // False when the key test got no answer (network error, timeout, or
        // an error page instead of Core's answer).
        let keyTestAnswered = false;
        // Always asked, bypass or not. Core's local auth bypass skips the key
        // only when the request reaches Core from a loopback address, and a
        // 127.0.0.1 URL does not say that: an SSH tunnel that ends on the
        // server's LAN address, or a Core in Docker, still needs the key for a
        // QDN publish. apikey/test runs the same check as a publish (key, or
        // bypass from loopback as Core sees it), so it answers for both.
        try {
          const url2 = `${baseUrl}/admin/apikey/test?apiKey=${encodeURIComponent(validatedNodeInfo?.apikey)}`;
          const keyTest = await fetchTextWithTimeout(
            url2,
            ADMIN_AUTH_FETCH_TIMEOUT_MS
          );
          if (keyTest.ok && keyTest.text === 'true') {
            isValid = true;
            keyTestAnswered = true;
          } else if (isKeyRefusal(keyTest)) {
            keyTestAnswered = true;
          }
        } catch (error) {
          // Network error or timeout: the key stays untested (isValid false).
        }
        if (!isValid && !keyTestAnswered && goApp) {
          // GO: the key was never tested, so no key dialog.
          return {
            isValid: false,
            validatedNodeInfo,
            failure: 'unreachable',
          };
        }
        // GO on the public node: there is no key the user could type in, so a
        // refusal does not ask for one (checkNodeBeforeUnlock goes on too).
        const askForKey = !(goApp && isGatewayNode(validatedNodeInfo));
        if (!isValid && isLocal && !isElectron) {
          const resGenerateApiKey = await generateApiKey();
          if (resGenerateApiKey) {
            validatedNodeInfo.apikey = resGenerateApiKey;
            isValid = true;
          }
        }
        if (!isValid && isLocal && !disablePopup) {
          setIsOpenResetApikey(true);
        } else if (!isValid && !isLocal && !disablePopup && askForKey) {
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

        return {
          isValid,
          validatedNodeInfo,
          failure: isValid
            ? undefined
            : keyTestAnswered
              ? 'key-rejected'
              : 'unreachable',
        };
      } catch (error) {
        return { isValid: false, validatedNodeInfo, failure: 'error' };
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

  /**
   * Check the selected node and save it when it works. On failure it says
   * why, so a node that cannot be reached is not mistaken for a rejected key.
   */
  const checkNode = useCallback(
    async (options?: NodeCheckOptions): Promise<NodeCheckResult> => {
      const startedAt = performance.now();
      let isCurrentLocalNode = false;
      let isCurrentPublicNode = false;
      let result: NodeCheckResult = { ok: false, failure: 'error' };
      try {
        const currentSelectedNode = store.get(selectedNodeInfoAtom);
        isCurrentLocalNode = isLocalNodeUrl(currentSelectedNode?.url);
        isCurrentPublicNode =
          !isCurrentLocalNode && isGatewayNode(currentSelectedNode);

        const payload = isCurrentLocalNode
          ? {
              apikey: '',
              url: getDefaultLocalNodeUrl(),
            }
          : currentSelectedNode;
        if (!payload) return result;
        const validation = await validateApiKey(payload);

        if (validation?.isValid) {
          await handleSaveNodeInfo(validation.validatedNodeInfo, options);
          result = { ok: true };
        } else {
          result = { ok: false, failure: validation?.failure ?? 'error' };
        }
        return result;
      } catch (error) {
        return result;
      } finally {
        // GO's diagnostics also say why it failed.
        const outcome = result.ok
          ? 'ok'
          : isGoApp()
            ? `failed (${result.failure})`
            : 'failed';
        const nodeKind = isCurrentLocalNode
          ? 'local node'
          : isCurrentPublicNode && isGoApp()
            ? 'public node'
            : 'remote node';
        recordUnlockTiming(
          'node-check',
          performance.now() - startedAt,
          `${outcome}, ${nodeKind}`
        );
      }
    },
    [store, validateApiKey, handleSaveNodeInfo]
  );

  const isNodeValid = useCallback(
    async (options?: NodeCheckOptions): Promise<boolean> =>
      (await checkNode(options)).ok,
    [checkNode]
  );

  /**
   * The password unlock's node check: true when the unlock may go on. GO goes
   * on without a node it cannot reach (offline, public node down, SSH tunnel
   * down), like its fingerprint unlock; a rejected key still stops it with
   * the key dialog, except on the public node, which has no key to ask for.
   * Elsewhere the node must work, as before.
   */
  const checkNodeBeforeUnlock = useCallback(
    async (options?: NodeCheckOptions): Promise<boolean> => {
      const result = await checkNode(options);
      if (result.ok) return true;
      if (!isGoApp()) return false;
      return (
        result.failure === 'unreachable' ||
        (result.failure === 'key-rejected' &&
          isGatewayNode(store.get(selectedNodeInfoAtom)))
      );
    },
    [checkNode, store]
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
    // GO: a local node that does not answer (offline, SSH tunnel down) does
    // not stop the unlock, as with its fingerprint unlock. One that answers
    // keeps the sync check below.
    const goOnWithoutAnswer = isGoApp();
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
      if (!status) return goOnWithoutAnswer;
      if (!isLocalCoreStatusSynced(status.data)) {
        if (enableAuthWhenSyncing) {
          return true;
        }
        setIsOpenSyncingDialog(true);
        return false;
      }
      return true;
    } catch (error) {
      return goOnWithoutAnswer;
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
      checkNode,
      isNodeValid,
      checkNodeBeforeUnlock,
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
      checkNode,
      isNodeValid,
      checkNodeBeforeUnlock,
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
