import { Sha256 } from 'asmcrypto.js';
import {
  createEndpoint,
  getBalanceInfo,
  getFee,
  getKeyPair,
  ensureAltcoinKeyPair,
  getLastRef,
  getSaveWallet,
  processTransactionVersion2,
  signChatFunc,
  joinGroup as joinGroupFunc,
  sendQortFee,
  sendCoin as sendCoinFunc,
  createBuyOrderTx,
  performPowTask,
  parseErrorResponse,
  groupSecretkeys,
  registerName,
  updateName,
  leaveGroup,
  inviteToGroup,
  getNameInfoForOthers,
  kickFromGroup,
  banFromGroup,
  cancelBan,
  makeAdmin,
  removeAdmin,
  cancelInvitationToGroup,
  createGroup,
  updateGroup,
  sellName,
  cancelSellName,
  buyName,
  getBaseApi,
  getAssetBalanceInfo,
  getAssetInfo,
  getPublicKey,
  resolveRecipient,
  transferAsset,
  sendChatNotification,
  sendChatGroup,
} from '../background/background.ts';
import { encodeQdnPathSegment, qdnResourcePath } from '../utils/qdnPath';
import {
  encryptAndPublishSymmetricKeyGroupChat,
  getAllUserNames,
  getNameInfo,
  uint8ArrayToObject,
} from '../encryption/encryption.ts';
import { showSaveFilePicker } from '../hooks/useQortalMessageListener.tsx';
import { getPublishesFromAdminsAdminSpace } from '../components/Chat/AdminSpaceInner.tsx';
import { extractComponents } from '../components/Chat/MessageDisplay.tsx';
import { decryptResource } from '../components/Group/groupDataPublishes.ts';
import {
  getGroupAdmins,
  getPublishesFromAdmins,
} from '../components/Group/groupApi.ts';
import { validateSecretKey } from '../components/Group/groupValidation.ts';
import {
  BTC_FEE_PER_BYTE,
  DGB_FEE_PER_BYTE,
  DOGE_FEE_PER_BYTE,
  LTC_FEE_PER_BYTE,
  MAX_SIZE_PUBLIC_NODE,
  MAX_SIZE_PUBLISH,
  MIN_REQUIRED_QORTS,
  PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY,
  QORT_DECIMALS,
  QORTAL_PROTOCOL,
  RVN_FEE_PER_BYTE,
  SELLER_FOREIGN_FEE,
  TIME_MINUTES_1_IN_MILLISECONDS,
  TIME_MINUTES_20_IN_MILLISECONDS,
  TIME_SECONDS_10_IN_MILLISECONDS,
  TIME_SECONDS_1_IN_MILLISECONDS,
  TIME_SECONDS_2_IN_MILLISECONDS,
  TIME_SECONDS_5_IN_MILLISECONDS,
} from '../constants/constants.ts';
import Base58 from '../encryption/Base58.ts';
import ed2curve from '../encryption/ed2curve.ts';
import nacl from '../encryption/nacl-fast.ts';
import {
  base64ToUint8Array,
  createSymmetricKeyAndNonce,
  decryptDeprecatedSingle,
  decryptGroupDataQortalRequest,
  decryptGroupEncryptionWithSharingKey,
  decryptSingle,
  encryptDataGroup,
  encryptSingle,
  hasPrivateString,
  objectToBase64,
  uint8ArrayStartsWith,
  uint8ArrayToBase64,
} from '../qdn/encryption/group-encryption.ts';
import { publishData } from '../qdn/publish/publish.ts';
import { startQappPublishTracker } from '../qdn/publish/qappPublishTracker.ts';
import {
  isPublishAborted,
  PublishAbortedError,
} from '../utils/publishAbort.ts';
import {
  getNotificationPermissionKey,
  getPermission,
  isRunningGateway,
  setPermission,
  setSessionPermissions,
  hasSessionPermission,
  VALID_SESSION_PERMISSIONS,
  AUTO_GRANTED_PERMISSIONS_ON_AUTH,
} from './qortal-requests.ts';
import TradeBotCreateRequest from '../transactions/TradeBotCreateRequest.ts';
import DeleteTradeOffer from '../transactions/TradeBotDeleteRequest.ts';
import signTradeBotTransaction from '../transactions/signTradeBotTransaction.ts';
import { createTransaction } from '../transactions/transactions.ts';
import { executeEvent } from '../utils/events.ts';
import { getElectronPersistentStorage } from '../utils/electronPersistentStorage';
import { fileToBase64 } from '../utils/fileReading/index.ts';
import { mimeToExtensionMap } from '../utils/memeTypes.ts';
import { filterSeenInAppKeysForApp } from '../utils/notificationSeenInAppScope.ts';
import { RequestQueueWithPromise } from '../utils/queue/queue.ts';
import utils from '../utils/utils.ts';
import ShortUniqueId from 'short-unique-id';
import {
  isValidBase64,
  isValidBase64WithDecode,
  validateAesCtrIvAndKey,
} from '../utils/decode.ts';
import { hasInvisibleCharacters } from '../utils/hasInvisibleCharacters';
import {
  assertForeignKeyEgress,
  foreignKeyConsentFields,
  foreignKeyProxyConsentFields,
} from '../utils/foreignKeyEgress';
import { nodePathSegment } from '../utils/nodeEndpointPath';
import { assertPublicKeyForAddress } from '../encryption/addressKeyCheck';
import {
  formatAtomicAmount,
  parseDecimalAmount,
  recipientDisplayLabel,
} from '../transactions/paymentSafety';
import {
  foreignCoinPathSegment,
  foreignFeeType,
  isArrrCoin,
  listNamePathSegment,
  nodeOriginForQApp,
  requireForeignCoinTicker,
  tradeBlockchainName,
} from './qappNodePaths';
import {
  ensureForeignKeyConsent,
  foreignKeyConsentScope,
} from './foreignKeySessionConsent';
import { validateAddress } from '../utils/validateAddress.ts';
import i18n from 'i18next';
import aesjs from 'aes-js';
import { roundUpToDecimals } from '../utils/numberFunctions.ts';
import {
  downloadFromLocation,
  normalizeFilename,
} from '../utils/downloadFromLocation.ts';
import { isCapacitor } from '../utils/platform.ts';

const uid = new ShortUniqueId({ length: 6 });

export const requestQueueGetAtAddresses = new RequestQueueWithPromise(10);

const MAX_RETRIES = 3; // Set max number of retries

export async function retryTransaction(
  fn,
  args,
  throwError,
  retries = MAX_RETRIES
) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed: ${error.message}`);
      attempt++;
      if (attempt === retries) {
        console.error(
          i18n.t('question:message.generic.max_retry_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        if (throwError) {
          throw new Error(
            error?.message ||
              i18n.t('question:message.error.process_transaction', {
                postProcess: 'capitalizeFirstChar',
              })
          );
        } else {
          throw new Error(
            error?.message ||
              i18n.t('question:message.error.process_transaction', {
                postProcess: 'capitalizeFirstChar',
              })
          );
        }
      }
      await new Promise((res) =>
        setTimeout(res, TIME_SECONDS_10_IN_MILLISECONDS)
      );
    }
  }
}

export const _createPoll = async (
  { pollName, pollDescription, options },
  isFromExtension,
  skipPermission,
  appInfo?
) => {
  const fee = await getFee('CREATE_POLL');
  let resPermission = {};
  if (!skipPermission) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:request_create_poll', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:poll', {
          name: pollName,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:description', {
          description: pollDescription,
          postProcess: 'capitalizeFirstChar',
        }),
        text4: i18n.t('question:options', {
          optionList: options?.join(', '),
          postProcess: 'capitalizeFirstChar',
        }),
        fee: fee.fee,
      },
      isFromExtension,
      appInfo
    );
  }

  const { accepted = false } = resPermission;

  if (accepted || skipPermission) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(8, keyPair, {
      fee: fee.fee,
      ownerAddress: address,
      rPollName: pollName,
      rPollDesc: pollDescription,
      rOptions: options,
      lastReference: lastRef,
    });
    const signedBytes = Base58.encode(tx.signedBytes);
    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

const _deployAt = async (
  { name, description, tags, creationBytes, amount, assetId, atType },
  isFromExtension,
  appInfo?
) => {
  const fee = await getFee('DEPLOY_AT');

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:deploy_at', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:name', {
        name: name,
        postProcess: 'capitalizeFirstChar',
      }),
      text3: i18n.t('question:description', {
        description: description,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('core:message.generic.amount_qort', {
        amount: amount,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
      confirmCheckbox: true,
    },
    isFromExtension,
    appInfo
  );

  const { accepted } = resPermission;

  if (accepted) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const lastReference = await getLastRef();
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    const tx = await createTransaction(16, keyPair, {
      fee: fee.fee,
      rName: name,
      rDescription: description,
      rTags: tags,
      rAmount: amount,
      rAssetId: assetId,
      rCreationBytes: creationBytes,
      atType: atType,
      lastReference: lastReference,
    });

    const signedBytes = Base58.encode(tx.signedBytes);

    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const _voteOnPoll = async (
  { pollName, optionIndex, optionName },
  isFromExtension,
  skipPermission,
  appInfo?
) => {
  const fee = await getFee('VOTE_ON_POLL');
  let resPermission = {};

  if (!skipPermission) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:request_vote_poll', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:poll', {
          name: pollName,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:option', {
          option: optionName,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: fee.fee,
      },
      isFromExtension,
      appInfo
    );
  }

  const { accepted = false } = resPermission;

  if (accepted || skipPermission) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(9, keyPair, {
      fee: fee.fee,
      voterAddress: address,
      rPollName: pollName,
      rOptionIndex: optionIndex,
      lastReference: lastRef,
    });
    const signedBytes = Base58.encode(tx.signedBytes);
    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

// Map to store resolvers and rejectors by requestId
const fileRequestResolvers = new Map();

const handleFileMessage = (event) => {
  if (event.origin !== window.location.origin || event.source !== window) {
    return;
  }

  const { action, requestId, result, error } = event.data;

  if (
    action === 'getFileFromIndexedDBResponse' &&
    fileRequestResolvers.has(requestId)
  ) {
    const { resolve, reject } = fileRequestResolvers.get(requestId);
    fileRequestResolvers.delete(requestId); // Clean up after resolving

    if (result) {
      resolve(result);
    } else {
      reject(
        error ||
          i18n.t('question:message.error.retrieve_file', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  }
};

window.addEventListener('message', handleFileMessage);

function getFileFromContentScript(fileId) {
  return new Promise((resolve, reject) => {
    const requestId = `getFile_${fileId}_${Date.now()}`;

    fileRequestResolvers.set(requestId, { resolve, reject }); // Store resolvers by requestId
    const targetOrigin = window.location.origin;

    // Send the request message
    window.postMessage(
      { action: 'getFileFromIndexedDB', fileId, requestId },
      targetOrigin
    );

    // Timeout to handle no response scenario
    setTimeout(() => {
      if (fileRequestResolvers.has(requestId)) {
        fileRequestResolvers.get(requestId).reject(
          i18n.t('question:message.error.timeout_request', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        fileRequestResolvers.delete(requestId); // Clean up on timeout
      }
    }, TIME_SECONDS_10_IN_MILLISECONDS);
  });
}

const responseResolvers = new Map();
const notificationPermissionResolvers = new Map();

function generatePermissionRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `qortalRequest_${globalThis.crypto.randomUUID()}`;
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `qortalRequest_${Date.now()}_${randomPart}`;
}

const handleMessage = (event) => {
  if (event.origin !== window.location.origin || event.source !== window) {
    return;
  }

  const { action, requestId, result } = event.data;

  // Check if this is the expected response action and if we have a stored resolver
  if (
    action === 'QORTAL_REQUEST_PERMISSION_RESPONSE' &&
    responseResolvers.has(requestId)
  ) {
    // Resolve the stored promise with the result
    responseResolvers.get(requestId)(result || false);
    responseResolvers.delete(requestId); // Clean up after resolving
  } else if (
    action === 'NOTIFICATION_PERMISSION_RESPONSE' &&
    notificationPermissionResolvers.has(requestId)
  ) {
    notificationPermissionResolvers.get(requestId)(result || false);
    notificationPermissionResolvers.delete(requestId);
  }
};

window.addEventListener('message', handleMessage);

/**
 * Asks the user in the approval dialog (App.tsx). `appInfo` is GO's record of
 * the tab the request came from; the dialog names the app from it, never from
 * the payload (GO-28). `expiresAt` lets a request that waits behind another
 * one show the time it really has left.
 */
async function getUserPermission(payload, isFromExtension, appInfo?) {
  return new Promise((resolve) => {
    const requestId = generatePermissionRequestId();
    responseResolvers.set(requestId, resolve); // Store resolver by requestId
    const targetOrigin = window.location.origin;

    // Send the request message
    window.postMessage(
      {
        action: 'QORTAL_REQUEST_PERMISSION',
        payload,
        requestId,
        isFromExtension,
        appInfo:
          appInfo && typeof appInfo === 'object'
            ? {
                name: appInfo.name,
                service: appInfo.service,
                // GO's own screens (never a Q-App: their appInfo comes from
                // the tab, see useQortalMessageListener).
                ...(appInfo.internal === true ? { internal: true } : {}),
              }
            : null,
        expiresAt: Date.now() + TIME_MINUTES_1_IN_MILLISECONDS,
      },
      targetOrigin
    );

    // Optional timeout to handle no response scenario
    setTimeout(() => {
      if (responseResolvers.has(requestId)) {
        responseResolvers.get(requestId)(false); // Resolve with `false` if no response
        responseResolvers.delete(requestId);
      }
    }, TIME_MINUTES_1_IN_MILLISECONDS);
  });
}

export const getWhichUI = async () => {
  try {
    // Check if we're running in Electron
    const isElectron = !!window?.electronAPI;
    return isElectron ? 'HUB_ELECTRON' : 'HUB_WEB';
  } catch (error) {
    // Default to web if detection fails
    return 'HUB_WEB';
  }
};

export const getUserAccount = async ({ isFromExtension, appInfo }) => {
  try {
    const value =
      (await getPermission(`qAPPAutoAuth-${appInfo?.name}`)) || false;
    let skip = false;
    if (value) {
      skip = true;
    }
    let hadSessionPermissions = false;
    // Check for session permission
    if (
      appInfo?.tabId &&
      appInfo?.name &&
      hasSessionPermission(appInfo.tabId, appInfo.name, 'GET_USER_ACCOUNT')
    ) {
      skip = true;
      hadSessionPermissions = true;
    }

    let resPermission;
    if (!skip) {
      resPermission = await getUserPermission(
        {
          text1: i18n.t('question:permission.authenticate', {
            postProcess: 'capitalizeFirstChar',
          }),
          checkbox1: {
            value: false,
            label: i18n.t('question:always_authenticate', {
              postProcess: 'capitalizeFirstChar',
            }),
          },
        },
        isFromExtension,
        appInfo
      );
    }

    const { accepted = false, checkbox1 = false } = resPermission || {};
    if (resPermission) {
      setPermission(`qAPPAutoAuth-${appInfo?.name}`, checkbox1);
    }
    if (accepted || skip) {
      // Auto-grant read-only permissions for authenticated session
      if (!hadSessionPermissions && appInfo?.tabId && appInfo?.name) {
        setSessionPermissions(
          appInfo.tabId,
          appInfo.name,
          AUTO_GRANTED_PERMISSIONS_ON_AUTH
        );
      }

      const wallet = await getSaveWallet();
      const address = wallet.address0;
      const publicKey = wallet.publicKey;
      return {
        address,
        publicKey,
      };
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      i18n.t('auth:message.error.fetch_user_account', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getNotificationPermission = async ({ appInfo }) => {
  try {
    const stored =
      (await getPermission(getNotificationPermissionKey(appInfo?.name))) ||
      false;
    let skip = !!stored;
    let hadSessionPermissions = false;

    if (
      appInfo?.tabId &&
      appInfo?.name &&
      hasSessionPermission(
        appInfo.tabId,
        appInfo.name,
        'NOTIFICATION_PERMISSION'
      )
    ) {
      skip = true;
      hadSessionPermissions = true;
    }

    let resPermission;
    if (!skip) {
      resPermission = await new Promise((resolve) => {
        const requestId = `notificationPermission_${Date.now()}`;
        notificationPermissionResolvers.set(requestId, resolve);
        window.postMessage(
          {
            action: 'NOTIFICATION_PERMISSION_REQUEST',
            requestId,
            appInfo,
            payload: {
              text1: i18n.t('question:permission.notification', {
                defaultValue: 'Allow this app to send you GO notifications?',
                postProcess: 'capitalizeFirstChar',
              }),
            },
          },
          window.location.origin
        );
        setTimeout(() => {
          if (notificationPermissionResolvers.has(requestId)) {
            notificationPermissionResolvers.get(requestId)(false);
            notificationPermissionResolvers.delete(requestId);
          }
        }, TIME_MINUTES_1_IN_MILLISECONDS);
      });
    }

    const { accepted = false } = resPermission || {};
    if (resPermission && accepted) {
      setPermission(getNotificationPermissionKey(appInfo?.name), true);
    }
    if (accepted || skip) {
      if (!hadSessionPermissions && appInfo?.tabId && appInfo?.name) {
        setSessionPermissions(appInfo.tabId, appInfo.name, [
          'NOTIFICATION_PERMISSION',
        ]);
      }
      return true;
    }
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('auth:message.error.fetch_user_account', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const notificationHasPermission = async ({
  appInfo,
}: {
  appInfo?: { name?: string; tabId?: number };
}) => {
  if (!appInfo?.name) return false;
  const stored =
    (await getPermission(getNotificationPermissionKey(appInfo.name))) === true;
  const session =
    appInfo.tabId != null &&
    hasSessionPermission(
      appInfo.tabId,
      appInfo.name,
      'NOTIFICATION_PERMISSION'
    );
  return stored || session;
};

export const sessionPermissions = async (data, isFromExtension, appInfo) => {
  try {
    const { permissions = [] } = data;

    if (!appInfo?.tabId) {
      throw new Error('tabId is required from appInfo');
    }

    if (!appInfo?.name) {
      throw new Error('App name is required');
    }

    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new Error('permissions array is required and must not be empty');
    }

    const tabId = appInfo.tabId;

    // Validate all permissions are valid
    const invalidPermissions = permissions.filter(
      (permission) => !VALID_SESSION_PERMISSIONS.includes(permission)
    );

    if (invalidPermissions.length > 0) {
      throw new Error(
        `Invalid permissions: ${invalidPermissions.join(', ')}. Valid permissions are: ${VALID_SESSION_PERMISSIONS.join(', ')}`
      );
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.session_permissions', {
          defaultValue: `${appInfo.name} is requesting session permissions`,
          appName: appInfo.name,
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.session_permissions_description', {
          defaultValue:
            'The following permissions will be automatically granted for this session:',
          postProcess: 'capitalizeFirstChar',
        }),
        details: {
          type: 'sessionPermissions',
          permissions,
        },
        confirmCheckbox: true,
        confirmCheckboxLabel: i18n.t('question:permission.session_understand', {
          postProcess: 'capitalizeFirstChar',
        }),
        isSessionPermission: true,
      },
      isFromExtension,
      appInfo
    );

    const { accepted = false } = resPermission || {};
    if (!accepted) {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }

    if (accepted) {
      setSessionPermissions(tabId, appInfo.name, permissions);
      return true;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(error?.message || 'Failed to set session permissions');
  }
};

export const encryptData = async (data, sender) => {
  let data64 = data.data64 || data.base64;
  const publicKeys = data.publicKeys || [];
  if (data?.file || data?.blob) {
    data64 = await fileToBase64(data?.file || data?.blob);
  }
  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const privateKey = parsedData.privateKey;
  const userPublicKey = parsedData.publicKey;

  const encryptDataResponse = encryptDataGroup({
    data64,
    publicKeys: publicKeys,
    privateKey,
    userPublicKey,
  });
  if (encryptDataResponse) {
    return encryptDataResponse;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const encryptQortalGroupData = async (data, sender) => {
  let data64 = data?.data64 || data?.base64;
  const groupId = data?.groupId;
  const isAdmins = data?.isAdmins;
  const refreshCache = data?.refreshCache === true;

  if (!groupId) {
    throw new Error(
      i18n.t('question:message.generic.provide_group_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (data?.file || data?.blob) {
    data64 = await fileToBase64(data?.file || data?.blob);
  }
  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let secretKeyObject;
  if (!isAdmins) {
    if (
      !refreshCache &&
      groupSecretkeys[groupId] &&
      groupSecretkeys[groupId].secretKeyObject &&
      groupSecretkeys[groupId]?.timestamp &&
      Date.now() - groupSecretkeys[groupId]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[groupId].secretKeyObject;
    }

    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdmins(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const resData = await fetchGroupKeyPublish(url);

      const decryptedKey: any = await decryptResource(resData, true);

      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[groupId] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  } else {
    if (
      !refreshCache &&
      groupSecretkeys[`admins-${groupId}`] &&
      groupSecretkeys[`admins-${groupId}`].secretKeyObject &&
      groupSecretkeys[`admins-${groupId}`]?.timestamp &&
      Date.now() - groupSecretkeys[`admins-${groupId}`]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[`admins-${groupId}`].secretKeyObject;
    }

    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdminsAdminSpace(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const resData = await fetchGroupKeyPublish(url);
      const decryptedKey: any = await decryptResource(resData, true);
      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[`admins-${groupId}`] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  }

  const resGroupEncryptedResource = encryptSingle({
    data64,
    secretKeyObject: secretKeyObject,
  });

  if (resGroupEncryptedResource) {
    return resGroupEncryptedResource;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

/**
 * A group key publish (base64) from the node. A node that cannot get the
 * publish answers with an error, and a public node often does (404 "Data
 * unavailable. Please try again later."); decoding that text as the key used
 * to fail with "Failed to execute 'atob'".
 */
export const fetchGroupKeyPublish = async (url: string): Promise<string> => {
  let text = '';
  try {
    const res = await fetch(url);
    text = res.ok ? (await res.text()).trim() : '';
  } catch {
    text = '';
  }
  if (!text || !isValidBase64(text)) {
    throw new Error(
      i18n.t('question:message.error.group_key_unavailable', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return text;
};

export const decryptQortalGroupData = async (data, sender) => {
  const data64 = data?.data64 || data?.base64;
  const groupId = data?.groupId;
  const isAdmins = data?.isAdmins;
  const refreshCache = data?.refreshCache === true;
  if (!groupId) {
    throw new Error(
      i18n.t('question:message.generic.provide_group_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let secretKeyObject;
  if (!isAdmins) {
    if (
      !refreshCache &&
      groupSecretkeys[groupId] &&
      groupSecretkeys[groupId].secretKeyObject &&
      groupSecretkeys[groupId]?.timestamp &&
      Date.now() - groupSecretkeys[groupId]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[groupId].secretKeyObject;
    }

    if (secretKeyObject) {
      const decodeForNumber = atob(data64);

      // Extract the key (assuming it's always the first 10 characters)
      const keyStr = decodeForNumber.slice(0, 10);

      // Convert the key string back to a number
      const highestKey = parseInt(keyStr, 10);
      if (!secretKeyObject[highestKey]) {
        secretKeyObject = null;
      }
    }
    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdmins(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const resData = await fetchGroupKeyPublish(url);
      const decryptedKey: any = await decryptResource(resData, true);

      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[groupId] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  } else {
    if (
      !refreshCache &&
      groupSecretkeys[`admins-${groupId}`] &&
      groupSecretkeys[`admins-${groupId}`].secretKeyObject &&
      groupSecretkeys[`admins-${groupId}`]?.timestamp &&
      Date.now() - groupSecretkeys[`admins-${groupId}`]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[`admins-${groupId}`].secretKeyObject;
    }
    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdminsAdminSpace(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const resData = await fetchGroupKeyPublish(url);
      const decryptedKey: any = await decryptResource(resData, true);

      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[`admins-${groupId}`] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  }

  const resGroupDecryptResource = decryptSingle({
    data64,
    secretKeyObject: secretKeyObject,
    skipDecodeBase64: true,
  });
  if (resGroupDecryptResource) {
    return resGroupDecryptResource;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const encryptDataWithSharingKey = async (data, sender) => {
  let data64 = data?.data64 || data?.base64;
  const publicKeys = data.publicKeys || [];
  if (data?.file || data?.blob) {
    data64 = await fileToBase64(data?.file || data?.blob);
  }
  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const symmetricKey = createSymmetricKeyAndNonce();
  const dataObject = {
    data: data64,
    key: symmetricKey.messageKey,
  };
  const dataObjectBase64 = await objectToBase64(dataObject);

  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const privateKey = parsedData.privateKey;
  const userPublicKey = parsedData.publicKey;

  const encryptDataResponse = encryptDataGroup({
    data64: dataObjectBase64,
    publicKeys: publicKeys,
    privateKey,
    userPublicKey,
    customSymmetricKey: symmetricKey.messageKey,
  });
  if (encryptDataResponse) {
    return encryptDataResponse;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const decryptDataWithSharingKey = async (data, sender) => {
  const { encryptedData, key } = data;

  if (!encryptedData) {
    throw new Error(
      i18n.t('question:message.generic.include_data_decrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const decryptedData = await decryptGroupEncryptionWithSharingKey({
    data64EncryptedData: encryptedData,
    key,
  });

  const base64ToObject = JSON.parse(atob(decryptedData));

  if (!base64ToObject.data)
    throw new Error(
      i18n.t('question:message.error.no_data_encrypted_resource', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  return base64ToObject.data;
};

export const getHostedData = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.list_hosted_data', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;

  if (accepted) {
    const limit = data?.limit ? data?.limit : 20;
    const query = data?.query ? data?.query : '';
    const offset = data?.offset ? data?.offset : 0;

    let urlPath = `/arbitrary/hosted/resources/?limit=${encodeURIComponent(
      limit
    )}&offset=${encodeURIComponent(offset)}`;
    if (query) {
      urlPath = urlPath + `&query=${encodeURIComponent(query)}`;
    }

    const url = await createEndpoint(urlPath);
    const response = await fetch(url);
    const dataResponse = await response.json();
    return dataResponse;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const deleteHostedData = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['hostedData'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.delete_hosts_resources', {
        size: data?.hostedData?.length,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;

  if (accepted) {
    const { hostedData } = data;
    const failures: {
      service: string;
      name: string;
      identifier: string;
      status: number;
      error: string;
    }[] = [];

    for (const hostedDataItem of hostedData) {
      try {
        const url = await createEndpoint(
          `/arbitrary/resource/${encodeQdnPathSegment(
            `${hostedDataItem.service}`
          )}/${encodeQdnPathSegment(
            `${hostedDataItem.name}`
          )}/${encodeQdnPathSegment(`${hostedDataItem.identifier}`)}`
        );
        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (!response.ok) {
          let errorText = '';
          try {
            errorText = await response.text();
          } catch (_) {
            // ignore body read errors
          }
          failures.push({
            service: hostedDataItem.service,
            name: hostedDataItem.name,
            identifier: hostedDataItem.identifier,
            status: response.status,
            error: errorText,
          });
        }
      } catch (error) {
        failures.push({
          service: hostedDataItem.service,
          name: hostedDataItem.name,
          identifier: hostedDataItem.identifier,
          status: 0,
          error: error?.message || String(error),
        });
      }
    }

    return {
      deletedCount: hostedData.length - failures.length,
      failedCount: failures.length,
      failures,
    };
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_delete_hosted_resources', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const decryptData = async (data) => {
  const { encryptedData, publicKey } = data;

  if (!encryptedData) {
    throw new Error(`Missing fields: encryptedData`);
  }
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8Array = base64ToUint8Array(encryptedData);
  const startsWithQortalEncryptedData = uint8ArrayStartsWith(
    uint8Array,
    'qortalEncryptedData'
  );
  if (startsWithQortalEncryptedData) {
    if (!publicKey) {
      throw new Error(`Missing fields: publicKey`);
    }

    const decryptedDataToBase64 = decryptDeprecatedSingle(
      uint8Array,
      publicKey,
      uint8PrivateKey
    );
    return decryptedDataToBase64;
  }
  const startsWithQortalGroupEncryptedData = uint8ArrayStartsWith(
    uint8Array,
    'qortalGroupEncryptedData'
  );
  if (startsWithQortalGroupEncryptedData) {
    const decryptedData = decryptGroupDataQortalRequest(
      encryptedData,
      parsedData.privateKey
    );
    const decryptedDataToBase64 = uint8ArrayToBase64(decryptedData);
    return decryptedDataToBase64;
  }
  throw new Error(
    i18n.t('question:message.error.encrypt', {
      postProcess: 'capitalizeFirstChar',
    })
  );
};

export const getListItems = async (data, appInfo, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['list_name'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  listNamePathSegment(data.list_name);
  const value = (await getPermission('qAPPAutoLists')) || false;

  let skip = false;
  if (value) {
    skip = true;
  }
  if (
    !skip &&
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'GET_LIST_ITEMS')
  ) {
    skip = true;
  }
  let resPermission;
  let acceptedVar;
  let checkbox1Var;
  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.access_list', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: data.list_name,
        checkbox1: {
          value: value,
          label: i18n.t('question:always_retrieve_list', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension,
      appInfo
    );
    const { accepted, checkbox1 } = resPermission;
    acceptedVar = accepted;
    checkbox1Var = checkbox1;
    setPermission('qAPPAutoLists', checkbox1);
  }

  if (acceptedVar || skip) {
    const url = await createEndpoint(
      `/lists/${listNamePathSegment(data.list_name)}`
    );
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_list', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    const list = await response.json();
    return list;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_share_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const addListItems = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['list_name', 'items'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const items = data.items;
  const list_name = data.list_name;
  listNamePathSegment(list_name);

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.all_item_list', {
        name: list_name,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: items.join(', '),
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;

  if (accepted) {
    const url = await createEndpoint(
      `/lists/${listNamePathSegment(list_name)}`
    );
    const body = {
      items: items,
    };
    const bodyToString = JSON.stringify(body);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyToString,
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.add_to_list', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_add_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const deleteListItems = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['list_name'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (!data?.item && !data?.items) {
    throw new Error(
      i18n.t('question:message.error.missing_fields', {
        fields: 'items',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const item = data?.item;
  const items = data?.items;
  const list_name = data.list_name;
  listNamePathSegment(list_name);

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.remove_from_list', {
        name: list_name,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: items ? JSON.stringify(items) : item,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;

  if (accepted) {
    const url = await createEndpoint(
      `/lists/${listNamePathSegment(list_name)}`
    );
    const body = {
      items: items || [item],
    };
    const bodyToString = JSON.stringify(body);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyToString,
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.add_to_list', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_delete_from_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

/**
 * Pays the app fee the user approved with a publish, once the publish went
 * through. The publish result is returned without waiting for it, as before.
 * If the payment is refused (a node fee above the approved fee, an unknown
 * fee recipient, a network error), the user is told instead of the failure
 * being lost as an unhandled rejection.
 */
export function payAppFeeAfterPublish(payment: {
  amount: unknown;
  receiver: string;
  approvedFee: unknown;
}): Promise<void> {
  return sendCoinFunc({ ...payment }, true).then(
    () => undefined,
    (error) => {
      const reason = typeof error?.message === 'string' ? error.message : '';
      console.warn('[app fee] payment not sent', reason);
      executeEvent('openGlobalSnackBar', {
        message: i18n.t('question:message.error.app_fee_not_sent', {
          error: reason,
          postProcess: 'capitalizeFirstChar',
        }),
        type: 'error',
        duration: 8000,
      });
    }
  );
}

export const publishQDNResource = async (
  data: any,
  sender,
  isFromExtension,
  appInfo?
) => {
  const requiredFields = ['service'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (!data.file && !data.data64 && !data.base64) {
    throw new Error(
      i18n.t('question:message.error.no_data_file_submitted', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (
    typeof data.identifier === 'string' &&
    data.identifier.trim().startsWith('symmetric-qchat-group-')
  ) {
    throw new Error(
      i18n.t('group:message.generic.invalid_data', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  // Use "default" if user hasn't specified an identifier
  const service = data.service;
  const appFee = data?.appFee ? +data.appFee : undefined;
  const appFeeRecipient = data?.appFeeRecipient;
  let hasAppFee = false;
  if (appFee && appFee > 0 && appFeeRecipient) {
    hasAppFee = true;
  }
  const registeredName = data?.name || (await getNameInfo());
  const name = registeredName;
  if (!name) {
    throw new Error(
      i18n.t('question:message.error.user_qortal_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let identifier = data.identifier;
  let data64 = data.data64 || data.base64;
  const filename = data.filename;
  const title = data.title;
  const description = data.description;
  const category = data.category;
  const file = data?.file || data?.blob;
  const tags = data?.tags || [];
  const result = {};
  const isMultiFileZip = data?.isMultiFileZip === true;
  let encryption: any = null;
  if (data?.encryption) {
    encryption = structuredClone(data?.encryption);
  }

  const encryptionType = encryption?.encryptionType || 'standard';
  const isStreamedEncryption = encryptionType === 'streamed-v1';
  if (isStreamedEncryption && (!encryption?.iv || !encryption?.key)) {
    throw new Error('Missing IV or Key');
  }

  if (isStreamedEncryption && !file) {
    throw new Error('File required for encryption streamed-v1');
  }
  if (isStreamedEncryption && encryption?.iv && encryption?.key) {
    const { isValid } = validateAesCtrIvAndKey(encryption.iv, encryption.key);
    if (!isValid) {
      throw new Error('Invalid IV or Key');
    }
    encryption.iv = base64ToUint8Array(encryption.iv);
    encryption.key = base64ToUint8Array(encryption.key);
  }

  if (file && file.size > MAX_SIZE_PUBLISH) {
    throw new Error(
      i18n.t('question:message.error.max_size_publish', {
        size: 2,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (file && file.size > MAX_SIZE_PUBLIC_NODE) {
    const isPublicNode = await isRunningGateway();
    if (isPublicNode) {
      throw new Error(
        i18n.t('question:message.error.max_size_publish_public', {
          size: 500,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }

  // Fill tags dynamically while maintaining backward compatibility
  for (let i = 0; i < 5; i++) {
    result[`tag${i + 1}`] = tags[i] || data[`tag${i + 1}`] || undefined;
  }

  // Access tag1 to tag5 from result
  const { tag1, tag2, tag3, tag4, tag5 } = result;

  if (data.identifier == null) {
    identifier = 'default';
  }

  if (
    data.encrypt &&
    (!data.publicKeys ||
      (Array.isArray(data.publicKeys) && data.publicKeys.length === 0))
  ) {
    throw new Error(
      i18n.t('question:message.error.encryption_requires_public_key', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (data.encrypt) {
    try {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const privateKey = parsedData.privateKey;
      const userPublicKey = parsedData.publicKey;
      if (data?.file || data?.blob) {
        data64 = await fileToBase64(data?.file || data?.blob);
      }
      const encryptDataResponse = encryptDataGroup({
        data64,
        publicKeys: data.publicKeys,
        privateKey,
        userPublicKey,
      });
      if (encryptDataResponse) {
        data64 = encryptDataResponse;
      }
    } catch (error) {
      throw new Error(
        error.message ||
          i18n.t('question:message.error.upload_encryption', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  }

  const fee = await getFee('ARBITRARY');

  const handleDynamicValues = {};
  // The PAYMENT fee included in the app fee shown in the dialog; the app-fee
  // payment refuses a higher fee from the node (GO-19).
  let appFeePaymentFee;
  if (hasAppFee) {
    const feePayment = await getFee('PAYMENT');
    appFeePaymentFee = feePayment.fee;

    ((handleDynamicValues['appFee'] = +appFee + +feePayment.fee),
      (handleDynamicValues['checkbox1'] = {
        value: true,
        label: i18n.t('question:accept_app_fee', {
          postProcess: 'capitalizeFirstChar',
        }),
      }));
    // An app fee moves QORT to the app's recipient: tick required (GO-28).
    handleDynamicValues['confirmCheckbox'] = true;
  }
  if (!!data?.encrypt) {
    handleDynamicValues['highlightedText'] = `isEncrypted: ${!!data.encrypt}`;
  }

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'PUBLISH_QDN_RESOURCE');

  let acceptVar = hasPermission || false;
  let checkbox1Var = false;
  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.publish_qdn', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: `service: ${service}`,
        text3: `identifier: ${identifier || null}`,
        text4: `name: ${registeredName}`,
        fee: fee.fee,
        ...handleDynamicValues,
      },
      isFromExtension,
      appInfo
    );
    const { accepted, checkbox1 = false } = resPermission || {
      accepted: false,
      checkbox1: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
    if (checkbox1) {
      checkbox1Var = checkbox1;
    }
  }

  if (acceptVar) {
    // GO's publish window (qdn/publish/publishJobs.ts) follows it from here.
    const publishTracker = startQappPublishTracker(appInfo, [data]);
    publishTracker?.rowStarted(0);
    try {
      const resPublish = await publishData({
        onProgress: publishTracker?.progressFor(0),
        registeredName: encodeURIComponent(name),
        data: data64 ? data64 : file,
        service: service,
        identifier: encodeURIComponent(identifier),
        uploadType: isStreamedEncryption
          ? 'file'
          : isMultiFileZip
            ? 'zip'
            : data64
              ? 'base64'
              : 'file',
        filename: filename,
        title,
        description,
        category,
        tag1,
        tag2,
        tag3,
        tag4,
        tag5,
        apiVersion: 2,
        withFee: true,
        encryption: isStreamedEncryption ? encryption : null,
      });
      if (resPublish?.signature) publishTracker?.rowPublished(0);
      publishTracker?.finish();
      if (resPublish?.signature && hasAppFee && checkbox1Var) {
        void payAppFeeAfterPublish({
          amount: appFee,
          receiver: appFeeRecipient,
          approvedFee: appFeePaymentFee,
        });
      }
      return resPublish;
    } catch (error) {
      publishTracker?.rowFailed(0, error);
      publishTracker?.finish();
      throw new Error(error?.message || 'Upload failed');
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

/**
 * Every ARRR wallet read (address, balance, transactions, sync status) sends the
 * ARRR seed, which spends the wallet, to the node. Before the first one in a
 * Q-App tab, show the same "your private key will be sent to the node" warning
 * and tick box that sends show. One consent covers that tab, app, account and
 * node until the tab closes; the general "authenticate" grant and the "always"
 * boxes never cover it.
 */
async function confirmArrrSeedEgress(
  isFromExtension,
  appInfo?: { tabId?: unknown; name?: unknown }
) {
  const endpoint = await createEndpoint('/crosschain/arrr/syncstatus');
  const egress = assertForeignKeyEgress(endpoint, 'ARRR');
  const wallet = await getSaveWallet();
  const scope = foreignKeyConsentScope({
    tabId: appInfo?.tabId,
    appName: appInfo?.name,
    address: wallet?.address0,
    // The whole origin, not just the host: another port on 127.0.0.1 can be
    // another app, and http/https on one host get different warnings.
    node: nodeOriginForQApp(endpoint),
    coin: 'ARRR',
  });
  const accepted = await ensureForeignKeyConsent(scope, async () => {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.arrr_wallet_access', {
          postProcess: 'capitalizeFirstChar',
        }),
        ...foreignKeyConsentFields(egress, 'ARRR'),
      },
      isFromExtension,
      appInfo
    );
    return !!(resPermission as { accepted?: boolean } | undefined)?.accepted;
  });
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
}

/**
 * For Q-App requests that used to need no permission at all: pass when the app
 * is already authenticated in this tab, otherwise show the normal
 * "authenticate" prompt (skipped when the user ticked "always authenticate").
 */
async function requireAuthenticatedSession(
  isFromExtension,
  appInfo?: { tabId?: unknown; name?: unknown }
) {
  if (
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'GET_USER_ACCOUNT')
  ) {
    return;
  }
  await getUserAccount({ isFromExtension, appInfo });
}

export const checkArrrSyncStatus = async (seed) => {
  const _url = await createEndpoint(`/crosschain/arrr/syncstatus`);
  assertForeignKeyEgress(_url, 'ARRR');
  let tries = 0; // Track the number of attempts

  while (tries < 36) {
    const response = await fetch(_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: seed,
    });

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res.indexOf('<') > -1 || res !== 'Synchronized') {
      // Wait 2 seconds before trying again
      await new Promise((resolve) =>
        setTimeout(resolve, TIME_SECONDS_2_IN_MILLISECONDS)
      );
      tries += 1;
    } else {
      // If the response doesn't meet the two conditions, exit the function
      return;
    }
  }

  // If we exceed N tries, throw an error
  throw new Error(
    i18n.t('question:message.error.synchronization_attempts', {
      count: 36,
      postProcess: 'capitalizeFirstChar',
    })
  );
};

export const publishMultipleQDNResources = async (
  data: any,
  sender,
  isFromExtension,
  appInfo
) => {
  const requiredFields = ['resources'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const resources = data.resources;
  if (!Array.isArray(resources)) {
    throw new Error(
      i18n.t('group:message.generic.invalid_data', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (resources.length === 0) {
    throw new Error(
      i18n.t('question:message.error.no_resources_publish', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const FORBIDDEN_IDENTIFIER_PREFIX = 'symmetric-qchat-group-';
  const hasForbiddenIdentifier = resources.some(
    (resource) =>
      typeof resource?.identifier === 'string' &&
      resource.identifier.trim().startsWith(FORBIDDEN_IDENTIFIER_PREFIX)
  );
  if (hasForbiddenIdentifier) {
    throw new Error(
      i18n.t('group:message.generic.invalid_data', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const isPublicNode = await isRunningGateway();
  if (isPublicNode) {
    const hasOversizedFilePublicNode = resources.some((resource) => {
      const file = resource?.file;
      // `instanceof File` is unreliable: cordova-plugin-file replaces the
      // global File constructor, so real files fail the check.
      return file instanceof Blob && file.size > MAX_SIZE_PUBLIC_NODE;
    });

    if (hasOversizedFilePublicNode) {
      throw new Error(
        i18n.t('question:message.error.max_size_publish_public', {
          size: 500,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }

  const hasOversizedFile = resources.some((resource) => {
    const file = resource?.file;
    return file instanceof Blob && file.size > MAX_SIZE_PUBLISH;
  });

  if (hasOversizedFile) {
    throw new Error(
      i18n.t('question:message.error.max_size_publish', {
        size: 2,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const totalFileSize = resources.reduce((acc, resource) => {
    const file = resource?.file;
    if (file && file?.size && !isNaN(file?.size)) {
      return acc + file.size;
    }
    return acc;
  }, 0);
  if (totalFileSize > 0) {
    const urlCheck = `/arbitrary/check/tmp?totalSize=${totalFileSize}`;

    const checkEndpoint = await createEndpoint(urlCheck);
    const checkRes = await fetch(checkEndpoint);
    if (!checkRes.ok) {
      throw new Error('Not enough space on your hard drive');
    }
  }

  const encrypt = data?.encrypt;

  for (const resource of resources) {
    const resourceEncrypt = encrypt && resource?.disableEncrypt !== true;
    const base64Data = resource?.data64 || resource?.base64;
    if (
      !resourceEncrypt &&
      !!base64Data &&
      resource?.service.endsWith('_PRIVATE') &&
      hasPrivateString(base64Data)
    ) {
      continue;
    } else if (!resourceEncrypt && resource?.service.endsWith('_PRIVATE')) {
      const errorMsg = i18n.t('question:message.error.only_encrypted_data', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    } else if (resourceEncrypt && !resource?.service.endsWith('_PRIVATE')) {
      const errorMsg = i18n.t('question:message.error.use_private_service', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    } else {
      const encryption = resource?.encryption;

      const encryptionType = encryption?.encryptionType || 'standard';
      const isStreamedEncryption = encryptionType === 'streamed-v1';
      if (encryption && !isStreamedEncryption) {
        throw new Error('Encryption type not supported');
      }
      if (isStreamedEncryption && (!encryption?.iv || !encryption?.key)) {
        throw new Error('Missing IV or Key');
      }

      if (isStreamedEncryption && !resource?.file) {
        throw new Error('File required for encryption streamed-v1');
      }

      // Decode base64 iv and key to Uint8Array
      if (isStreamedEncryption && encryption?.iv && encryption?.key) {
        const { isValid } = validateAesCtrIvAndKey(
          encryption.iv,
          encryption.key
        );
        if (!isValid) {
          throw new Error('Invalid IV or Key');
        }
      }
    }
  }

  const fee = await getFee('ARBITRARY');
  const registeredName = await getNameInfo();

  const name = registeredName;

  if (!name) {
    throw new Error(
      i18n.t('question:message.error.registered_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const userNames = await getAllUserNames();
  data.resources?.forEach((item) => {
    if (item?.name && !userNames?.includes(item.name))
      throw new Error(
        `The name ${item.name}, does not belong to the publisher.`
      );
  });

  const appFee = data?.appFee ? +data.appFee : undefined;
  const appFeeRecipient = data?.appFeeRecipient;
  let hasAppFee = false;

  if (appFee && appFee > 0 && appFeeRecipient) {
    hasAppFee = true;
  }

  let paymentFeeAmount = 0;
  const handleDynamicValues = {};
  if (hasAppFee) {
    const feePayment = await getFee('PAYMENT');
    paymentFeeAmount = +feePayment.fee;

    ((handleDynamicValues['appFee'] = +appFee + +feePayment.fee),
      (handleDynamicValues['checkbox1'] = {
        value: true,
        label: i18n.t('question:accept_app_fee', {
          postProcess: 'capitalizeFirstChar',
        }),
      }));
    // An app fee moves QORT to the app's recipient: tick required (GO-28).
    handleDynamicValues['confirmCheckbox'] = true;
  }
  if (data?.encrypt) {
    handleDynamicValues['highlightedText'] = `isEncrypted: ${!!data.encrypt}`;
  }

  const totalRequiredQort =
    resources.length * +fee.fee +
    paymentFeeAmount +
    (hasAppFee && appFee ? +appFee : 0);
  const balance = await getBalanceInfo();
  if (+balance < totalRequiredQort) {
    throw new Error(
      i18n.t('question:message.error.insufficient_balance_qort', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(
      appInfo.tabId,
      appInfo.name,
      'PUBLISH_MULTIPLE_QDN_RESOURCES'
    );

  let acceptVar = hasPermission || false;
  let checkbox1Var = false;
  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.publish_qdn', {
          postProcess: 'capitalizeFirstChar',
        }),
        details: {
          type: 'resources',
          resources: data.resources.map((resource) => ({
            service: resource.service,
            name: resource?.name || name,
            identifier: resource.identifier,
            filename: resource.filename,
          })),
        },
        fee: +fee.fee * resources.length,
        ...handleDynamicValues,
      },
      isFromExtension,
      appInfo
    );
    const { accepted, checkbox1 = false } = resPermission || {
      accepted: false,
      checkbox1: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
    if (checkbox1) {
      checkbox1Var = checkbox1;
    }
  }

  if (!acceptVar) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  type FailedPublish = {
    reason: string;
    identifier: any;
    service: any;
    name?: any;
  };

  // GO's publish window (qdn/publish/publishJobs.ts) follows it from here.
  const publishTracker = startQappPublishTracker(appInfo, resources);
  let resourceIndex = -1;

  const failedPublishesIdentifiers: FailedPublish[] = [];
  const recordFailed = (failure: FailedPublish, cause?: unknown) => {
    failedPublishesIdentifiers.push(failure);
    publishTracker?.rowFailed(resourceIndex, failure.reason, cause);
  };
  const publishedResponses = [];
  const publishedResources: {
    service: string;
    name: string;
    identifier: string;
  }[] = [];
  let aborted = false;

  const cleanupPublishedOnAbort = async () => {
    // Best-effort: remove anything already finalized in this batch so cancel
    // does not leave orphan Q-Tube metadata / broken VIDEO entries.
    for (const item of publishedResources) {
      try {
        const url = await createEndpoint(
          `/arbitrary/resource/${encodeURIComponent(item.service)}/${encodeURIComponent(item.name)}/${encodeURIComponent(item.identifier)}`
        );
        await fetch(url, { method: 'DELETE' });
      } catch (err) {
        console.warn('[publish] failed to delete after cancel', item, err);
      }
    }
  };

  for (const resource of resources) {
    resourceIndex += 1;
    if (isPublishAborted() || aborted) {
      aborted = true;
      break;
    }
    publishTracker?.rowStarted(resourceIndex);
    try {
      const requiredFields = ['service'];
      const missingFields: string[] = [];
      requiredFields.forEach((field) => {
        if (!resource[field]) {
          missingFields.push(field);
        }
      });
      if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(', ');
        const errorMsg = i18n.t('question:message.error.missing_fields', {
          fields: missingFieldsString,
          postProcess: 'capitalizeFirstChar',
        });
        recordFailed({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        continue;
      }
      // Resolve stashed files (avoids cloning large Blobs through postMessage).
      if (resource.fileId && !resource.file) {
        try {
          const { takePublishFile } = await import('../utils/publishFileStash');
          const stashed = takePublishFile(String(resource.fileId));
          if (stashed) {
            resource.file = stashed;
            publishTracker?.rowBytes(resourceIndex, stashed.size);
          }
        } catch {
          // fall through to missing-file error below
        }
      }
      if (!resource.file && !resource.data64 && !resource?.base64) {
        const errorMsg = i18n.t(
          'question:message.error.no_data_file_submitted',
          {
            postProcess: 'capitalizeFirstChar',
          }
        );
        recordFailed({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        continue;
      }
      const service = resource.service;
      let identifier = resource.identifier;
      let rawData = resource?.data64 || resource?.base64;
      const filename = resource.filename;
      const title = resource.title;
      const description = resource.description;
      const category = resource.category;
      const tags = resource?.tags || [];
      const result = {};
      const isMultiFileZip = resource?.isMultiFileZip === true;

      // Fill tags dynamically while maintaining backward compatibility
      for (let i = 0; i < 5; i++) {
        result[`tag${i + 1}`] = tags[i] || resource[`tag${i + 1}`] || undefined;
      }

      // Access tag1 to tag5 from result
      const { tag1, tag2, tag3, tag4, tag5 } = result;
      const resourceEncrypt = encrypt && resource?.disableEncrypt !== true;
      if (resource.identifier == null) {
        identifier = 'default';
      }

      const skipEncryptIfAlreadyEncrypted =
        !resourceEncrypt &&
        service.endsWith('_PRIVATE') &&
        hasPrivateString(rawData);
      if (
        !resourceEncrypt &&
        service.endsWith('_PRIVATE') &&
        !skipEncryptIfAlreadyEncrypted
      ) {
        const errorMsg = i18n.t('question:message.error.only_encrypted_data', {
          postProcess: 'capitalizeFirstChar',
        });
        recordFailed({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        continue;
      }
      if (resource.file) {
        rawData = resource.file;
      }

      if (resourceEncrypt) {
        try {
          if (resource?.file) {
            rawData = await fileToBase64(resource.file);
          }
          const resKeyPair = await getKeyPair();
          const parsedData = resKeyPair;
          const privateKey = parsedData.privateKey;
          const userPublicKey = parsedData.publicKey;
          const encryptDataResponse = encryptDataGroup({
            data64: rawData,
            publicKeys: data.publicKeys,
            privateKey,
            userPublicKey,
          });
          if (encryptDataResponse) {
            rawData = encryptDataResponse;
          }
        } catch (error) {
          const errorMsg =
            error?.message ||
            i18n.t('question:message.error.upload_encryption', {
              postProcess: 'capitalizeFirstChar',
            });
          recordFailed({
            reason: errorMsg,
            identifier: resource.identifier,
            service: resource.service,
            name: resource?.name || name,
          });
          continue;
        }
      }

      try {
        if (isPublishAborted()) {
          aborted = true;
          break;
        }
        const preEncryption = resource?.encryption;
        let encryption: any = null;
        if (preEncryption) {
          encryption = structuredClone(preEncryption);
        }
        if (encryption) {
          encryption.iv = base64ToUint8Array(encryption.iv);
          encryption.key = base64ToUint8Array(encryption.key);
        }

        const dataType = encryption
          ? 'file'
          : isMultiFileZip
            ? 'zip'
            : resource?.base64 || resource?.data64 || resourceEncrypt
              ? 'base64'
              : 'file';

        const response = await publishData({
          apiVersion: 2,
          category,
          data: rawData,
          description,
          filename: filename,
          identifier: encodeURIComponent(identifier),
          registeredName: encodeURIComponent(resource?.name || name),
          service: service,
          tag1,
          tag2,
          tag3,
          tag4,
          tag5,
          title,
          uploadType: dataType,
          withFee: true,
          appInfo,
          encryption: encryption || null,
          onProgress: publishTracker?.progressFor(resourceIndex),
        });
        if (response?.signature) {
          publishedResponses.push(response);
          publishedResources.push({
            service,
            name: resource?.name || name,
            identifier,
          });
          publishTracker?.rowPublished(resourceIndex);
        }
        await new Promise((res) => {
          setTimeout(() => {
            res();
          }, TIME_SECONDS_1_IN_MILLISECONDS);
        });
      } catch (error) {
        if (
          error instanceof PublishAbortedError ||
          error?.name === 'PublishAbortedError' ||
          isPublishAborted()
        ) {
          aborted = true;
          recordFailed({
            reason: 'Publish cancelled',
            identifier: resource.identifier,
            service: resource.service,
            name: resource?.name || name,
          });
          break;
        }
        const errorMsg =
          error.message ||
          i18n.t('question:message.error.upload', {
            postProcess: 'capitalizeFirstChar',
          });
        recordFailed(
          {
            reason: errorMsg,
            identifier: resource.identifier,
            service: resource.service,
            name: resource?.name || name,
          },
          error
        );
      }
    } catch (error) {
      if (
        error instanceof PublishAbortedError ||
        error?.name === 'PublishAbortedError' ||
        isPublishAborted()
      ) {
        aborted = true;
        recordFailed({
          reason: 'Publish cancelled',
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        break;
      }
      recordFailed(
        {
          reason:
            error?.message ||
            i18n.t('question:message.error.unknown_error', {
              postProcess: 'capitalizeFirstChar',
            }),
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        },
        error
      );
    }
  }
  publishTracker?.finish({ aborted: aborted || isPublishAborted() });

  if (aborted || isPublishAborted()) {
    await cleanupPublishedOnAbort();
    const obj = {
      message: 'Publish cancelled',
      error: {
        cancelled: true,
        unsuccessfulPublishes: failedPublishesIdentifiers,
      },
    };
    return obj;
  }

  if (failedPublishesIdentifiers.length > 0) {
    const obj = {
      message: i18n.t('question:message.error.resources_publish', {
        postProcess: 'capitalizeFirstChar',
      }),
    };
    obj['error'] = {
      unsuccessfulPublishes: failedPublishesIdentifiers,
    };
    return obj;
  }
  if (hasAppFee && checkbox1Var) {
    void payAppFeeAfterPublish({
      amount: appFee,
      receiver: appFeeRecipient,
      // The PAYMENT fee shown in the dialog (GO-19).
      approvedFee: paymentFeeAmount,
    });
  }
  return publishedResponses;
};

export const voteOnPoll = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['pollName', 'optionIndex'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field] && data[field] !== 0) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const pollName = data.pollName;
  const optionIndex = data.optionIndex;
  let pollInfo = null;
  try {
    const url = await createEndpoint(`/polls/${encodeURIComponent(pollName)}`);
    const response = await fetch(url);
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(
        response,
        i18n.t('question:message.error.fetch_poll', {
          postProcess: 'capitalizeFirstChar',
        })
      );
      throw new Error(errorMessage);
    }

    pollInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_poll', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }
  if (!pollInfo || pollInfo.error) {
    const errorMsg =
      (pollInfo && pollInfo.message) ||
      i18n.t('question:message.error.no_poll', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }
  try {
    const optionName = pollInfo.pollOptions[optionIndex].optionName;
    const resVoteOnPoll = await _voteOnPoll(
      { pollName, optionIndex, optionName },
      isFromExtension,
      false,
      appInfo
    );
    return resVoteOnPoll;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.poll_vote', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const createPoll = async (data, isFromExtension, appInfo?) => {
  const requiredFields = [
    'pollName',
    'pollDescription',
    'pollOptions',
    'pollOwnerAddress',
  ];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const pollName = data.pollName;
  const pollDescription = data.pollDescription;
  const pollOptions = data.pollOptions;
  try {
    const resCreatePoll = await _createPoll(
      {
        pollName,
        pollDescription,
        options: pollOptions,
      },
      isFromExtension,
      false,
      appInfo
    );
    return resCreatePoll;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.poll_create', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

function isBase64(str) {
  const base64Regex =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  return base64Regex.test(str) && str.length % 4 === 0;
}

function checkValue(value) {
  if (typeof value === 'string') {
    if (isBase64(value)) {
      return 'string';
    } else {
      return 'string';
    }
  } else if (typeof value === 'object' && value !== null) {
    return 'object';
  } else {
    throw new Error(
      i18n.t('question:message.error.invalid_fullcontent', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
}

export const sendChatMessage = async (data, isFromExtension, appInfo) => {
  const message = data?.message;
  const fullMessageObject = data?.fullMessageObject || data?.fullContent;
  const recipient = data?.destinationAddress || data.recipient;
  const groupId = data.groupId;
  const isRecipient = groupId === undefined;
  const chatReference = data?.chatReference;
  if (groupId === undefined && recipient === undefined) {
    throw new Error(
      i18n.t('question:provide_recipient_group_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  let fullMessageObjectType;
  if (fullMessageObject) {
    fullMessageObjectType = checkValue(fullMessageObject);
  }
  const value =
    (await getPermission(`qAPPSendChatMessage-${appInfo?.name}`)) || false;
  let skip = false;
  if (value) {
    skip = true;
  }
  let resPermission;
  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_chat_message', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: isRecipient
          ? i18n.t('question:to_recipient', {
              recipient: recipient,
              postProcess: 'capitalizeFirstChar',
            })
          : i18n.t('question:to_group', {
              group_id: groupId,
              postProcess: 'capitalizeFirstChar',
            }),
        text3: fullMessageObject
          ? fullMessageObjectType === 'string'
            ? `${fullMessageObject?.slice(0, 25)}${fullMessageObject?.length > 25 ? '...' : ''}`
            : `${JSON.stringify(fullMessageObject)?.slice(0, 25)}${JSON.stringify(fullMessageObject)?.length > 25 ? '...' : ''}`
          : `${message?.slice(0, 25)}${message?.length > 25 ? '...' : ''}`,
        checkbox1: {
          value: false,
          label: i18n.t('question:always_chat_messages', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension,
      appInfo
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};
  if (resPermission && accepted) {
    setPermission(`qAPPSendChatMessage-${appInfo?.name}`, checkbox1);
  }
  if (accepted || skip) {
    const tiptapJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        },
      ],
    };
    const messageObject = fullMessageObject
      ? fullMessageObject
      : {
          messageText: tiptapJson,
          images: [],
          repliedTo: '',
          version: 3,
        };

    let stringifyMessageObject = JSON.stringify(messageObject);
    if (fullMessageObjectType === 'string') {
      stringifyMessageObject = messageObject;
    }

    const balance = await getBalanceInfo();
    const hasEnoughBalance = +balance < MIN_REQUIRED_QORTS ? false : true;
    if (!hasEnoughBalance) {
      throw new Error(
        i18n.t('group:message.error.qortals_required', {
          quantity: MIN_REQUIRED_QORTS,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    if (isRecipient && recipient) {
      const url = await createEndpoint(
        `/addresses/publickey/${nodePathSegment(recipient)}`
      );
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.fetch_recipient_public_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      let key;
      let hasPublicKey;
      let res;
      const contentType = response.headers.get('content-type');

      // If the response is JSON, parse it as JSON
      if (contentType && contentType.includes('application/json')) {
        res = await response.json();
      } else {
        // Otherwise, treat it as plain text
        res = await response.text();
      }
      if (res?.error === 102) {
        key = '';
        hasPublicKey = false;
      } else if (res !== false) {
        key = res;
        hasPublicKey = true;
      } else {
        key = '';
        hasPublicKey = false;
      }

      if (!hasPublicKey && isRecipient) {
        throw new Error(
          'Cannot send an encrypted message to this user since they do not have their publickey on chain.'
        );
      }
      // The message is encrypted to this key: it must belong to the recipient
      // address, not be one the node substituted (GO-30).
      key = assertPublicKeyForAddress(
        typeof key === 'string' ? key : '',
        recipient
      );
      let _reference = new Uint8Array(64);
      self.crypto.getRandomValues(_reference);

      let sendTimestamp = Date.now();

      let reference = Base58.encode(_reference);
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };

      let handleDynamicValues = {};
      if (chatReference) {
        handleDynamicValues['chatReference'] = chatReference;
      }

      const tx = await createTransaction(18, keyPair, {
        timestamp: sendTimestamp,
        recipient: recipient,
        recipientPublicKey: key,
        hasChatReference: chatReference ? 1 : 0,
        message: stringifyMessageObject,
        lastReference: reference,
        proofOfWorkNonce: 0,
        isEncrypted: 1,
        isText: 1,
        ...handleDynamicValues,
      });

      const chatBytes = tx.chatBytes;
      const difficulty = 8;
      const { nonce, chatBytesArray } = await performPowTask(
        chatBytes,
        difficulty
      );

      let _response = await signChatFunc(chatBytesArray, nonce, null, keyPair);
      if (_response?.error) {
        throw new Error(_response?.message);
      }
      return _response;
    } else if (!isRecipient && groupId) {
      let _reference = new Uint8Array(64);
      self.crypto.getRandomValues(_reference);

      let reference = Base58.encode(_reference);
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };

      let handleDynamicValues = {};
      if (chatReference) {
        handleDynamicValues['chatReference'] = chatReference;
      }

      const txBody = {
        timestamp: Date.now(),
        groupID: Number(groupId),
        hasReceipient: 0,
        hasChatReference: chatReference ? 1 : 0,
        message: stringifyMessageObject,
        lastReference: reference,
        proofOfWorkNonce: 0,
        isEncrypted: 0, // Set default to not encrypted for groups
        isText: 1,
        ...handleDynamicValues,
      };

      const tx = await createTransaction(181, keyPair, txBody);

      // if (!hasEnoughBalance) {
      //   throw new Error("Must have at least 4 QORT to send a chat message");
      // }

      const chatBytes = tx.chatBytes;
      const difficulty = 8;
      const { nonce, chatBytesArray } = await performPowTask(
        chatBytes,
        difficulty
      );

      let _response = await signChatFunc(chatBytesArray, nonce, null, keyPair);
      if (_response?.error) {
        throw new Error(_response?.message);
      }
      return _response;
    } else {
      throw new Error(
        i18n.t('question:provide_recipient_group_id', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_send_message', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const joinGroup = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['groupId'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  let groupInfo = null;
  try {
    const url = await createEndpoint(
      `/groups/${nodePathSegment(data.groupId)}`
    );
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }
  const fee = await getFee('JOIN_GROUP');

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'JOIN_GROUP');

  let acceptVar = hasPermission || false;

  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:message.generic.confirm_join_group', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${groupInfo.groupName}`,
        fee: fee.fee,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission || {
      accepted: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
  }

  if (acceptVar) {
    const groupId = data.groupId;

    if (!groupInfo || groupInfo.error) {
      const errorMsg =
        (groupInfo && groupInfo.message) ||
        i18n.t('question:message.error.no_group_found', {
          postProcess: 'capitalizeFirstChar',
        });
      throw new Error(errorMsg);
    }
    try {
      const resJoinGroup = await joinGroupFunc({ groupId });
      return resJoinGroup;
    } catch (error) {
      throw new Error(
        error?.message ||
          i18n.t('group:message.error.group_join', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_join', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

/**
 * `options.preApproved` is only ever set by GO itself — the Save button on a
 * file the person first declined — never taken from the Q-App's request.
 * `options.appInfo` names the asking app in the approval dialog (GO-28).
 */
export const saveFile = async (
  data,
  sender,
  isFromExtension,
  snackMethods,
  options: {
    preApproved?: boolean;
    appInfo?: { name?: string; service?: string };
  } = {}
) => {
  try {
    if (!data?.filename) throw new Error('Missing filename');

    // Handle location-based downloads (streaming approach)
    if (data?.location) {
      return await saveFileFromLocation(
        data,
        isFromExtension,
        snackMethods,
        options.appInfo
      );
    }
    const requiredFields = ['filename', 'blob'];
    const missingFields: string[] = [];
    requiredFields.forEach((field) => {
      if (!data[field]) {
        missingFields.push(field);
      }
    });
    if (missingFields.length > 0) {
      const missingFieldsString = missingFields.join(', ');
      const errorMsg = i18n.t('question:message.error.missing_fields', {
        fields: missingFieldsString,
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const filename = data.filename;
    const blob = data.blob;

    const resPermission = options.preApproved
      ? { accepted: true }
      : await getUserPermission(
          {
            text1: i18n.t('question:download_file', {
              postProcess: 'capitalizeFirstChar',
            }),
            highlightedText: `${filename}`,
          },
          isFromExtension,
          options.appInfo
        );
    const { accepted } = resPermission;

    if (accepted) {
      const mimeType = blob.type || data.mimeType;
      let backupExention = filename.split('.').pop();
      if (backupExention) {
        backupExention = '.' + backupExention;
      }
      const fileExtension = mimeToExtensionMap[mimeType] || backupExention;
      let fileHandleOptions = {};
      if (!mimeType) {
        throw new Error(
          i18n.t('question:message.error.mime_type', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      if (!fileExtension) {
        throw new Error(
          i18n.t('question:message.error.file_extension', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      if (fileExtension && mimeType) {
        fileHandleOptions = {
          accept: {
            [mimeType]: [fileExtension],
          },
        };
      }

      showSaveFilePicker(
        {
          filename,
          mimeType,
          blob,
          transferId: data.transferId,
        },
        snackMethods
      );
      return true;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_save_file', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('core:message.error.initiate_download', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

/**
 * Downloads a file from QDN location with optional decryption
 * Uses streaming to avoid loading entire file into memory
 */
async function saveFileFromLocation(
  data,
  isFromExtension,
  snackMethods,
  appInfo?
) {
  const {
    filename,
    location,
    encryption = undefined,
    mimeType = undefined,
  } = data;

  // Validate location
  const requiredFieldsLocation = ['service', 'name'];
  const missingFieldsLocation: string[] = [];
  requiredFieldsLocation.forEach((field) => {
    if (!location[field]) {
      missingFieldsLocation.push(field);
    }
  });
  if (missingFieldsLocation.length > 0) {
    const missingFieldsString = missingFieldsLocation.join(', ');
    throw new Error(`Missing location fields: ${missingFieldsString}`);
  }

  const { service, name, identifier } = location;
  const isEncrypted = encryption?.encryptionType === 'streamed-v1';

  // Validate encryption if present
  let ivBytes, keyBytes;
  if (isEncrypted) {
    if (!encryption?.iv || !encryption?.key) {
      throw new Error('Missing encryption IV or key');
    }

    ivBytes = base64ToUint8Array(encryption.iv);
    keyBytes = base64ToUint8Array(encryption.key);

    if (ivBytes.length !== 16) {
      throw new Error(
        `Invalid IV length: ${ivBytes.length} bytes, expected 16 bytes`
      );
    }
    if (keyBytes.length !== 32) {
      throw new Error(
        `Invalid key length: ${keyBytes.length} bytes, expected 32 bytes`
      );
    }
  }

  // Get user permission
  const resPermission: any = await getUserPermission(
    {
      text1: i18n.t('question:download_file', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: isEncrypted ? `${filename} (encrypted)` : filename,
    },
    isFromExtension,
    appInfo
  );

  if (!resPermission.accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_save_file', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  // Build the download URL
  const locationUrl = `/arbitrary/${qdnResourcePath({
    service,
    name,
    identifier,
  })}`;

  // Capacitor Android/iOS: no File System Access API and anchor-tag downloads
  // do nothing in the WebView — save into Documents/Qortal Go natively.
  //
  // Shared with the app's own download paths rather than repeated here: an
  // unencrypted file must never be pulled through the WebView, which is what
  // this used to do. A few hundred megabytes of base64 handed over the bridge
  // a chunk at a time took the whole app down with it.
  if (isCapacitor()) {
    const result = await downloadFromLocation({
      filename,
      location: { service, name, identifier },
      encryption,
      mimeType,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to download file');
    }

    // The progress card already ends on "Saved to …" with an Open button.
    return true;
  }

  // Check if we're in Electron
  const isElectron = !!window?.electron?.startStreamSave;

  if (isElectron) {
    // Use Electron streaming approach
    const saveResult = await window?.electron.startStreamSave({
      filename,
      mimeType,
    });

    if (saveResult.canceled) {
      throw new Error(
        i18n.t('question:message.generic.user_declined_save_file', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }

    const filePath = saveResult.filePath;

    try {
      const endpoint = isEncrypted
        ? await createEndpoint(locationUrl)
        : await createEndpoint(
            locationUrl +
              `?attachment=true&attachmentFilename=${encodeURIComponent(normalizeFilename(filename))}`
          );
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      if (!response.body) {
        throw new Error('Response body is empty');
      }

      // Get expected file size
      const contentLength = response.headers.get('Content-Length');
      const expectedSize = contentLength ? parseInt(contentLength, 10) : null;

      // Process the response body as a stream
      const reader = response.body.getReader();
      let bytesProcessed = 0;
      let bytesWritten = 0;
      let isFirstChunk = true;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (expectedSize && bytesProcessed !== expectedSize) {
              console.warn(
                `Size mismatch! Expected ${expectedSize} bytes but got ${bytesProcessed} bytes`
              );
            }
            break;
          }

          if (!value || value.length === 0) {
            console.warn('Received empty chunk, skipping');
            continue;
          }

          let chunkToWrite = value;

          // Decrypt chunk if encrypted
          if (isEncrypted) {
            try {
              const blockOffset = BigInt(bytesProcessed >> 4);
              chunkToWrite = await decryptAesCtrChunk(
                keyBytes,
                ivBytes,
                blockOffset,
                value
              );
            } catch (decryptError: any) {
              console.error(
                'Decryption failed for chunk at offset',
                bytesProcessed,
                decryptError
              );
              throw new Error(
                `Decryption failed at byte ${bytesProcessed}: ${decryptError?.message || 'Unknown error'}`
              );
            }
          }

          // Write chunk to disk via Electron IPC
          try {
            await window?.electron.writeChunk(
              filePath,
              chunkToWrite,
              !isFirstChunk
            );
            bytesWritten += chunkToWrite.length;
          } catch (writeError: any) {
            console.error(
              'Failed to write chunk at offset',
              bytesWritten,
              writeError
            );
            throw new Error(
              `Write failed at byte ${bytesWritten}: ${writeError?.message || 'Unknown error'}`
            );
          }

          bytesProcessed += value.length;
          isFirstChunk = false;
        }
      } catch (streamError) {
        console.error('Stream processing error:', streamError);
        throw streamError;
      }

      if (
        snackMethods?.setOpenSnackGlobal &&
        snackMethods?.setInfoSnackCustom
      ) {
        snackMethods.setInfoSnackCustom({
          type: 'success',
          message: 'Saving file success!',
        });
        snackMethods.setOpenSnackGlobal(true);
      }

      return true;
    } catch (error) {
      // Clean up partial file on error
      try {
        await window?.electron.deleteFile(filePath);
      } catch (cleanupError) {
        console.error('Failed to cleanup partial file:', cleanupError);
      }
      throw error;
    }
  } else {
    // Fallback for non-Electron (browser)
    // Check if File System Access API is available
    const hasFileSystemAccess = 'showSaveFilePicker' in window;

    if (isEncrypted) {
      // For encrypted files, we need to decrypt while streaming
      if (hasFileSystemAccess) {
        // Use File System Access API with streaming

        let fileHandle;
        try {
          fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: filename,
            types: mimeType
              ? [
                  {
                    description: 'File',
                    accept: {
                      [mimeType]: [`.${filename.split('.').pop() || '*'}`],
                    },
                  },
                ]
              : undefined,
          });
        } catch (error: any) {
          if (error.name === 'AbortError') {
            throw new Error(
              i18n.t('question:message.generic.user_declined_save_file', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          throw error;
        }

        const writable = await fileHandle.createWritable();

        try {
          const response = await fetch(await createEndpoint(locationUrl));

          if (!response.ok) {
            throw new Error('Failed to download encrypted file');
          }

          if (!response.body) {
            throw new Error('Response body is empty');
          }

          const contentLength = response.headers.get('Content-Length');
          const expectedSize = contentLength
            ? parseInt(contentLength, 10)
            : null;

          const reader = response.body.getReader();
          let bytesProcessed = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            const blockOffset = BigInt(bytesProcessed >> 4);
            const decryptedChunk = await decryptAesCtrChunk(
              keyBytes,
              ivBytes,
              blockOffset,
              value
            );

            await writable.write(decryptedChunk);
            bytesProcessed += value.length;
          }

          await writable.close();

          if (
            snackMethods?.setOpenSnackGlobal &&
            snackMethods?.setInfoSnackCustom
          ) {
            snackMethods.setInfoSnackCustom({
              type: 'success',
              message: 'Saving file success!',
            });
            snackMethods.setOpenSnackGlobal(true);
          }
        } catch (error) {
          await writable.abort();
          throw error;
        }
      } else {
        // Fallback to memory-based decryption (not ideal for large files)

        const response = await fetch(await createEndpoint(locationUrl));

        if (!response.ok) {
          throw new Error('Failed to download encrypted file');
        }

        if (!response.body) {
          throw new Error('Response body is empty');
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytesProcessed = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const blockOffset = BigInt(bytesProcessed >> 4);
          const decryptedChunk = await decryptAesCtrChunk(
            keyBytes,
            ivBytes,
            blockOffset,
            value
          );

          chunks.push(decryptedChunk);
          bytesProcessed += value.length;
        }

        const decryptedBlob = new Blob(chunks as BlobPart[]);
        const blobUrl = URL.createObjectURL(decryptedBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      // Non-encrypted files - try streaming first, fallback to direct download
      if (hasFileSystemAccess) {
        let fileHandle;
        try {
          fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: filename,
            types: mimeType
              ? [
                  {
                    description: 'File',
                    accept: {
                      [mimeType]: [`.${filename.split('.').pop() || '*'}`],
                    },
                  },
                ]
              : undefined,
          });
        } catch (error: any) {
          if (error.name === 'AbortError') {
            throw new Error(
              i18n.t('question:message.generic.user_declined_save_file', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          throw error;
        }

        const writable = await fileHandle.createWritable();

        try {
          const response = await fetch(
            await createEndpoint(
              locationUrl +
                `?attachment=true&attachmentFilename=${encodeURIComponent(normalizeFilename(filename))}`
            )
          );

          if (!response.ok) {
            throw new Error('Failed to download file');
          }

          if (!response.body) {
            throw new Error('Response body is empty');
          }

          // For non-encrypted files, we can pipe directly
          await response.body.pipeTo(writable);

          if (
            snackMethods?.setOpenSnackGlobal &&
            snackMethods?.setInfoSnackCustom
          ) {
            snackMethods.setInfoSnackCustom({
              type: 'success',
              message: 'Saving file success!',
            });
            snackMethods.setOpenSnackGlobal(true);
          }
        } catch (error) {
          await writable.abort();
          throw error;
        }
      } else {
        // Direct download using anchor tag
        const endpoint = await createEndpoint(
          locationUrl +
            `?attachment=true&attachmentFilename=${encodeURIComponent(normalizeFilename(filename))}`
        );
        const a = document.createElement('a');
        a.href = endpoint;
        a.download = encodeURIComponent(filename);
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }

    return true;
  }
}

/**
 * Decrypts a single chunk using AES-CTR
 */
async function decryptAesCtrChunk(keyBytes, ivBytes, blockOffset, ciphertext) {
  // Try WebCrypto first
  if (crypto?.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-CTR' },
        false,
        ['decrypt']
      );

      const counter = deriveCtrCounter(ivBytes, blockOffset);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-CTR',
          counter,
          length: 128,
        },
        cryptoKey,
        ciphertext
      );

      return new Uint8Array(decrypted);
    } catch (e) {
      console.warn('WebCrypto AES-CTR decrypt failed, falling back:', e);
    }
  }

  // Fallback using aes-js
  return fallbackDecryptCtr(keyBytes, ivBytes, blockOffset, ciphertext);
}

function deriveCtrCounter(iv, blockOffset) {
  const counter = new Uint8Array(iv);
  let carry = blockOffset;

  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

function fallbackDecryptCtr(keyBytes, ivBytes, blockOffset, ciphertext) {
  const counter = deriveCtrCounter(ivBytes, blockOffset);
  const aesCtr = new aesjs.ModeOfOperation.ctr(
    keyBytes,
    new aesjs.Counter(counter)
  );
  const decrypted = aesCtr.decrypt(ciphertext);
  return new Uint8Array(decrypted);
}

export const deployAt = async (data, isFromExtension, appInfo?) => {
  const requiredFields = [
    'name',
    'description',
    'tags',
    'creationBytes',
    'amount',
    'assetId',
    'type',
  ];

  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field] && data[field] !== 0) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  try {
    const resDeployAt = await _deployAt(
      {
        name: data.name,
        description: data.description,
        tags: data.tags,
        creationBytes: data.creationBytes,
        amount: data.amount,
        assetId: data.assetId,
        atType: data.type,
      },
      isFromExtension,
      appInfo
    );
    return resDeployAt;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('group:message.error.group_join', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getUserWallet = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const isGateway = await isRunningGateway();
  // Only ARRR asks the node for the address, which sends it the ARRR seed.
  const sendsArrrSeed = data?.coin === 'ARRR';

  if (sendsArrrSeed && isGateway)
    throw new Error(
      i18n.t('question:message.error.gateway_wallet_local_node', {
        token: 'ARRR',
        postProcess: 'capitalizeFirstChar',
      })
    );

  let skip = false;
  if (sendsArrrSeed) {
    // Replaces the plain prompt, the "always" box and the authenticate grant.
    await confirmArrrSeedEgress(isFromExtension, appInfo);
    skip = true;
  } else {
    const value =
      (await getPermission(
        `qAPPAutoGetUserWallet-${appInfo?.name}-${data.coin}`
      )) || false;
    if (value) {
      skip = true;
    }

    // Check for session permission
    if (
      !skip &&
      appInfo?.tabId &&
      appInfo?.name &&
      hasSessionPermission(appInfo.tabId, appInfo.name, 'GET_USER_WALLET')
    ) {
      skip = true;
    }
  }

  let resPermission;

  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.get_wallet_info', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `coin: ${data.coin}`,
        checkbox1: {
          value: false,
          label: i18n.t('question:always_retrieve_wallet', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension,
      appInfo
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};

  if (resPermission) {
    setPermission(
      `qAPPAutoGetUserWallet-${appInfo?.name}-${data.coin}`,
      checkbox1
    );
  }

  if (accepted || skip) {
    let coin = data.coin;
    let userWallet = {};
    let arrrAddress = '';
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair =
      coin === 'QORT' ? await getKeyPair() : await ensureAltcoinKeyPair();
    const parsedData = resKeyPair;
    const arrrSeed58 = parsedData.arrrSeed58;
    if (coin === 'ARRR') {
      const bodyToString = arrrSeed58;
      const url = await createEndpoint(`/crosschain/arrr/walletaddress`);
      assertForeignKeyEgress(url, coin);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bodyToString,
      });
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      if (res?.error && res?.message) {
        throw new Error(res.message);
      }
      arrrAddress = res;
    }
    switch (coin) {
      case 'QORT':
        userWallet['address'] = address;
        userWallet['publickey'] = parsedData.publicKey;
        break;
      case 'BTC':
        userWallet['address'] = parsedData.btcAddress;
        userWallet['publickey'] = parsedData.btcPublicKey;
        break;
      case 'LTC':
        userWallet['address'] = parsedData.ltcAddress;
        userWallet['publickey'] = parsedData.ltcPublicKey;
        break;
      case 'DOGE':
        userWallet['address'] = parsedData.dogeAddress;
        userWallet['publickey'] = parsedData.dogePublicKey;
        break;
      case 'DGB':
        userWallet['address'] = parsedData.dgbAddress;
        userWallet['publickey'] = parsedData.dgbPublicKey;
        break;
      case 'RVN':
        userWallet['address'] = parsedData.rvnAddress;
        userWallet['publickey'] = parsedData.rvnPublicKey;
        break;
      case 'ARRR':
        await checkArrrSyncStatus(parsedData.arrrSeed58);
        userWallet['address'] = arrrAddress;
        break;
      default:
        break;
    }
    return userWallet;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getWalletBalance = async (
  data,
  bypassPermission?: boolean,
  isFromExtension?: boolean,
  appInfo?: any
) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const isGateway = await isRunningGateway();
  // The ARRR balance comes from the node, which needs the ARRR seed for it.
  const sendsArrrSeed = data?.coin === 'ARRR';

  if (sendsArrrSeed && isGateway)
    throw new Error(
      i18n.t('question:message.error.gateway_balance_local_node', {
        token: 'ARRR',
        postProcess: 'capitalizeFirstChar',
      })
    );

  let skip = false;
  if (sendsArrrSeed) {
    // bypassPermission is only set by SEND_COIN, after the user has accepted
    // the send dialog and its private-key warning.
    if (!bypassPermission) {
      await confirmArrrSeedEgress(isFromExtension, appInfo);
    }
    skip = true;
  } else {
    const value =
      (await getPermission(
        `qAPPAutoWalletBalance-${appInfo?.name}-${data.coin}`
      )) || false;
    if (value) {
      skip = true;
    }

    // Check for session permission
    if (
      !skip &&
      appInfo?.tabId &&
      appInfo?.name &&
      hasSessionPermission(appInfo.tabId, appInfo.name, 'GET_WALLET_BALANCE')
    ) {
      skip = true;
    }
  }

  let resPermission;

  if (!bypassPermission && !skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.fetch_balance', {
          coin: data.coin, // TODO highlight coin in the modal
          postProcess: 'capitalizeFirstChar',
        }),
        checkbox1: {
          value: false,
          label: i18n.t('question:always_retrieve_balance', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension,
      appInfo
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};
  if (resPermission) {
    setPermission(
      `qAPPAutoWalletBalance-${appInfo?.name}-${data.coin}`,
      checkbox1
    );
  }
  if (accepted || bypassPermission || skip) {
    let coin = data.coin;
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair =
      coin === 'QORT' ? await getKeyPair() : await ensureAltcoinKeyPair();
    const parsedData = resKeyPair;
    if (coin === 'QORT') {
      let qortAddress = address;
      try {
        const url = await createEndpoint(`/addresses/balance/${qortAddress}`);
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            i18n.t('question:message.error.fetch_balance', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        let res;
        try {
          res = await response.clone().json();
        } catch (e) {
          res = await response.text();
        }
        return res;
      } catch (error) {
        throw new Error(
          error?.message ||
            i18n.t('question:message.error.fetch_wallet', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      }
    } else {
      let _url = ``;
      let _body = null;
      switch (coin) {
        case 'BTC':
          _url = await createEndpoint(`/crosschain/btc/walletbalance`);

          _body = parsedData.btcPublicKey;
          break;
        case 'LTC':
          _url = await createEndpoint(`/crosschain/ltc/walletbalance`);
          _body = parsedData.ltcPublicKey;
          break;
        case 'DOGE':
          _url = await createEndpoint(`/crosschain/doge/walletbalance`);
          _body = parsedData.dogePublicKey;
          break;
        case 'DGB':
          _url = await createEndpoint(`/crosschain/dgb/walletbalance`);
          _body = parsedData.dgbPublicKey;
          break;
        case 'RVN':
          _url = await createEndpoint(`/crosschain/rvn/walletbalance`);
          _body = parsedData.rvnPublicKey;
          break;
        case 'ARRR':
          await checkArrrSyncStatus(parsedData.arrrSeed58);
          _url = await createEndpoint(`/crosschain/arrr/walletbalance`);
          assertForeignKeyEgress(_url, coin);
          _body = parsedData.arrrSeed58;
          break;
        default:
          break;
      }
      try {
        const response = await fetch(_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: _body,
        });
        let res;
        try {
          res = await response.clone().json();
        } catch (e) {
          res = await response.text();
        }
        if (res?.error && res?.message) {
          throw new Error(res.message);
        }
        if (isNaN(Number(res))) {
          throw new Error(
            i18n.t('question:message.error.fetch_balance', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        } else {
          return (Number(res) / 1e8).toFixed(8);
        }
      } catch (error) {
        throw new Error(
          error?.message ||
            i18n.t('question:message.error.fetch_balance', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      }
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

const getPirateWallet = async (arrrSeed58) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.error.gateway_retrieve_balance', {
        token: 'PIRATECHAIN',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const bodyToString = arrrSeed58;
  await checkArrrSyncStatus(bodyToString);
  const url = await createEndpoint(`/crosschain/arrr/walletaddress`);
  assertForeignKeyEgress(url, 'ARRR');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyToString,
  });
  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }
  if (res?.error && res?.message) {
    throw new Error(res.message);
  }
  return res;
};

export const getUserWalletFunc = async (coin) => {
  let userWallet = {};
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const resKeyPair =
    String(coin || '').toUpperCase() === 'QORT'
      ? await getKeyPair()
      : await ensureAltcoinKeyPair();
  const parsedData = resKeyPair;
  switch (coin) {
    case 'QORT':
      userWallet['address'] = address;
      userWallet['publickey'] = parsedData.publicKey;
      break;
    case 'BTC':
    case 'BITCOIN':
      userWallet['address'] = parsedData.btcAddress;
      userWallet['publickey'] = parsedData.btcPublicKey;
      break;
    case 'LTC':
    case 'LITECOIN':
      userWallet['address'] = parsedData.ltcAddress;
      userWallet['publickey'] = parsedData.ltcPublicKey;
      break;
    case 'DOGE':
    case 'DOGECOIN':
      userWallet['address'] = parsedData.dogeAddress;
      userWallet['publickey'] = parsedData.dogePublicKey;
      break;
    case 'DGB':
    case 'DIGIBYTE':
      userWallet['address'] = parsedData.dgbAddress;
      userWallet['publickey'] = parsedData.dgbPublicKey;
      break;
    case 'RVN':
    case 'RAVENCOIN':
      userWallet['address'] = parsedData.rvnAddress;
      userWallet['publickey'] = parsedData.rvnPublicKey;
      break;
    case 'ARRR':
    case 'PIRATECHAIN': {
      const arrrAddress = await getPirateWallet(parsedData.arrrSeed58);
      userWallet['address'] = arrrAddress;
      break;
    }
    default:
      break;
  }
  return userWallet;
};

export const getUserWalletInfo = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  // Only the xpub coins have /addressinfos. ARRR (also as PIRATECHAIN) would
  // first send its seed to the node to look up the address.
  const ticker = requireForeignCoinTicker(data.coin);
  if (ticker === 'ARRR') {
    throw new Error(
      i18n.t('question:message.error.token_not_supported', {
        token: 'ARRR',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const value =
    (await getPermission(`getUserWalletInfo-${appInfo?.name}-${data.coin}`)) ||
    false;
  let skip = false;
  if (value) {
    skip = true;
  }

  // Check for session permission
  if (
    !skip &&
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'GET_USER_WALLET_INFO')
  ) {
    skip = true;
  }

  let resPermission;

  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.get_wallet_info', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `coin: ${data.coin}`,
        checkbox1: {
          value: false,
          label: i18n.t('question:always_retrieve_wallet', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension,
      appInfo
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};

  if (resPermission) {
    setPermission(`getUserWalletInfo-${appInfo?.name}-${data.coin}`, checkbox1);
  }

  if (accepted || skip) {
    const walletKeys = await getUserWalletFunc(ticker);

    const _url = await createEndpoint(
      `/crosschain/${foreignCoinPathSegment(ticker)}/addressinfos`
    );
    const _body = { xpub58: walletKeys['publickey'] };
    try {
      const response = await fetch(_url, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(_body),
      });
      if (!response?.ok)
        throw new Error(
          i18n.t('question:message.error.fetch_wallet_info', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      if (res?.error && res?.message) {
        throw new Error(res.message);
      }

      return res;
    } catch (error) {
      throw new Error(
        error?.message ||
          i18n.t('question:message.error.fetch_wallet', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getUserWalletTransactions = async (
  data,
  isFromExtension,
  appInfo
) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const ticker = requireForeignCoinTicker(data.coin);
  // For ARRR (also as PIRATECHAIN) the node needs the ARRR seed itself.
  const sendsArrrSeed = ticker === 'ARRR';

  let skip = false;
  if (sendsArrrSeed) {
    // Replaces the plain prompt, the "always" box and the authenticate grant.
    await confirmArrrSeedEgress(isFromExtension, appInfo);
    skip = true;
  } else {
    const value =
      (await getPermission(
        `getUserWalletTransactions-${appInfo?.name}-${data.coin}`
      )) || false;
    if (value) {
      skip = true;
    }

    // Check for session permission
    if (
      !skip &&
      appInfo?.tabId &&
      appInfo?.name &&
      hasSessionPermission(
        appInfo.tabId,
        appInfo.name,
        'GET_USER_WALLET_TRANSACTIONS'
      )
    ) {
      skip = true;
    }
  }

  let resPermission;

  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.get_wallet_transactions', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `coin: ${data.coin}`,
        checkbox1: {
          value: false,
          label: i18n.t('question:always_retrieve_wallet_transactions', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension,
      appInfo
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};

  if (resPermission) {
    setPermission(
      `getUserWalletTransactions-${appInfo?.name}-${data.coin}`,
      checkbox1
    );
  }

  if (accepted || skip) {
    const walletKeys = await getUserWalletFunc(ticker);
    let publicKey;
    if (sendsArrrSeed) {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      publicKey = parsedData.arrrSeed58;
    } else {
      publicKey = walletKeys['publickey'];
    }

    const _url = await createEndpoint(
      `/crosschain/${foreignCoinPathSegment(ticker)}/wallettransactions`
    );
    if (sendsArrrSeed) assertForeignKeyEgress(_url, ticker);
    const _body = publicKey;
    try {
      const response = await fetch(_url, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        body: _body,
      });
      if (!response?.ok)
        throw new Error(
          i18n.t('question:message.error.fetch_wallet_transactions', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      if (res?.error && res?.message) {
        throw new Error(res.message);
      }

      return res;
    } catch (error) {
      throw new Error(
        error?.message ||
          i18n.t('question:message.error.fetch_wallet_transactions', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getCrossChainServerInfo = async (data) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const _url = `/crosschain/${foreignCoinPathSegment(data.coin)}/serverinfos`;
  try {
    const url = await createEndpoint(_url);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res.servers;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.server_info', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const startCrossChainServer = async (
  data,
  isFromExtension?: boolean,
  appInfo?: { tabId?: number; name?: string }
) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  // Require authenticated session (START_CROSSCHAIN_SERVER is in AUTO_GRANTED_PERMISSIONS_ON_AUTH)
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(
      appInfo.tabId,
      appInfo.name,
      'START_CROSSCHAIN_SERVER'
    );
  if (!hasPermission) {
    throw new Error('User not authenticated');
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const coin = foreignCoinPathSegment(data.coin);
  const url = `/crosschain/${coin}/start`;
  try {
    const endpoint = await createEndpoint(url);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getTxActivitySummary = async (
  data,
  isFromExtension?: boolean,
  appInfo?: { tabId?: unknown; name?: unknown }
) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const foreignBlockchain = tradeBlockchainName(data.coin);
  // Core only serves this with the node API key, so the app must be signed in.
  await requireAuthenticatedSession(isFromExtension, appInfo);
  const url = `/crosschain/txactivity?foreignBlockchain=${encodeURIComponent(
    foreignBlockchain
  )}`;

  try {
    const endpoint = await createEndpoint(url);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res; // Return full response here
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.transaction_activity_summary', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getForeignFee = async (data) => {
  const requiredFields = ['coin', 'type'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  // Only /crosschain/<coin>/feekb or /feerequired, both readable without the
  // node API key.
  const coin = foreignCoinPathSegment(data.coin);
  const type = foreignFeeType(data.type);
  const url = `/crosschain/${coin}/${type}`;

  try {
    const endpoint = await createEndpoint(url);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res; // Return full response here
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.get_foreign_fee', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

function calculateRateFromFee(totalFee, sizeInBytes) {
  const fee = (totalFee / sizeInBytes) * 1000;
  return fee.toFixed(0);
}

export const updateForeignFee = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin', 'type', 'value'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, value } = data;
  const coinSegment = foreignCoinPathSegment(coin);
  const type = foreignFeeType(data.type);

  const text3 =
    type === 'feerequired'
      ? i18n.t('question:sats', {
          amount: value,
          postProcess: 'capitalizeFirstChar',
        })
      : i18n.t('question:sats_per_kb', {
          amount: value,
          postProcess: 'capitalizeFirstChar',
        });
  const text4 =
    type === 'feerequired'
      ? i18n.t('question:message.generic.calculate_fee', {
          amount: value,
          rate: calculateRateFromFee(value, 300),
          postProcess: 'capitalizeFirstChar',
        })
      : '';

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'UPDATE_FOREIGN_FEE');

  let acceptVar = hasPermission || false;

  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.update_foreign_fee', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: `type: ${type === 'feerequired' ? 'unlocking' : 'locking'}`,
        text3: i18n.t('question:value', {
          value: text3,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: i18n.t('question:coin', {
          coin: coin,
          postProcess: 'capitalizeFirstChar',
        }),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission || {
      accepted: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
  }

  if (!acceptVar) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const url = `/crosschain/${coinSegment}/update${type}`;
  const valueStringified = JSON.stringify(+value);

  const endpoint = await createEndpoint(url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: valueStringified,
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.update_foreign_fee', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }
  if (res?.error && res?.message) {
    throw new Error(res.message);
  }
  return res; // Return full response here
};

export const getServerConnectionHistory = async (data) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const coin = foreignCoinPathSegment(data.coin);
  const url = `/crosschain/${coin}/serverconnectionhistory`;

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_connection_history', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return full response here
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.fetch_connection_history', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const setCurrentForeignServer = async (
  data,
  isFromExtension,
  appInfo?
) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, host, port, type } = data;
  const coinSegment = foreignCoinPathSegment(coin);

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(
      appInfo.tabId,
      appInfo.name,
      'SET_CURRENT_FOREIGN_SERVER'
    );

  let acceptVar = hasPermission || false;
  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.set_current_server', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:server_type', {
          type: type,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:server_host', {
          host: host,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: i18n.t('question:coin', {
          coin: coin,
          postProcess: 'capitalizeFirstChar',
        }),
      },
      isFromExtension,
      appInfo
    );

    const { accepted } = resPermission || {
      accepted: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
  }

  if (!acceptVar) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const body = {
    hostName: host,
    port: port,
    connectionType: type,
  };

  const url = `/crosschain/${coinSegment}/setcurrentserver`;

  const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.server_current_set', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }

  if (res?.error && res?.message) {
    throw new Error(res.message);
  }

  return res; // Return the full response
};

export const addForeignServer = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, host, port, type } = data;
  const coinSegment = foreignCoinPathSegment(coin);

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'ADD_FOREIGN_SERVER');

  let acceptVar = hasPermission || false;
  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.server_add', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:server_type', {
          type: type,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:server_host', {
          host: host,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: i18n.t('question:coin', {
          coin: coin,
          postProcess: 'capitalizeFirstChar',
        }),
      },
      isFromExtension,
      appInfo
    );

    const { accepted } = resPermission || {
      accepted: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
  }

  if (!acceptVar) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const body = {
    hostName: host,
    port: port,
    connectionType: type,
  };

  const url = `/crosschain/${coinSegment}/addserver`;

  const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.server_current_add', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }

  if (res?.error && res?.message) {
    throw new Error(res.message);
  }

  return res; // Return the full response
};

export const removeForeignServer = async (data, isFromExtension, appInfo?) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, host, port, type } = data;
  const coinSegment = foreignCoinPathSegment(coin);

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'REMOVE_FOREIGN_SERVER');

  let acceptVar = hasPermission || false;
  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.server_remove', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:server_type', {
          type: type,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:server_host', {
          host: host,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: i18n.t('question:coin', {
          coin: coin,
          postProcess: 'capitalizeFirstChar',
        }),
      },
      isFromExtension,
      appInfo
    );

    const { accepted } = resPermission || {
      accepted: false,
    };
    if (accepted) {
      acceptVar = accepted;
    }
  }

  if (!acceptVar) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const body = {
    hostName: host,
    port: port,
    connectionType: type,
  };

  const url = `/crosschain/${coinSegment}/removeserver`;

  const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.server_remove', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }

  if (res?.error && res?.message) {
    throw new Error(res.message);
  }

  return res; // Return the full response
};

export const getDaySummary = async () => {
  const url = `/admin/summary`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.retrieve_summary', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.retrieve_summary', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getNodeInfo = async () => {
  const url = `/admin/info`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.node_info', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.node_info', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getNodeStatus = async () => {
  const url = `/admin/status`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.node_status', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.node_status', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getArrrSyncStatus = async (
  _payload?: unknown,
  isFromExtension?: boolean,
  appInfo?: { tabId?: unknown; name?: unknown }
) => {
  // The node needs the ARRR seed to report sync status, so this asks first
  // like every other ARRR read (it used to send the seed with no prompt).
  await confirmArrrSeedEgress(isFromExtension, appInfo);
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const arrrSeed = parsedData.arrrSeed58;
  const url = `/crosschain/arrr/syncstatus`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    assertForeignKeyEgress(endpoint, 'ARRR');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: '*/*',
      },
      body: arrrSeed,
    });

    let res;

    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.retrieve_sync_status', {
          token: 'ARRR',
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

const CUSTOM_WS_SUBSCRIPTIONS_KEY = 'qortal_custom_ws_subscriptions';

/** Current user address for address-scoped storage (set by app when user logs in). */
function getCurrentAddress(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { __qortalCurrentAddress?: string | null };
  return w.__qortalCurrentAddress ?? null;
}

function getAppStorage() {
  if (typeof window === 'undefined') return undefined;
  return (
    window as {
      appStorage?: {
        get: (k: string) => Promise<unknown>;
        set: (k: string, v: unknown) => Promise<void>;
      };
    }
  ).appStorage;
}

function parseSubscriptionsRecord(value: unknown): Record<string, any[]> {
  if (value != null && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, any[]>;
  if (Array.isArray(value)) return { __legacy: value };
  return {};
}

async function getStoredCustomSubscriptions() {
  const address = getCurrentAddress();
  const appStorage = getAppStorage();
  if (appStorage) {
    try {
      const value = await appStorage.get(CUSTOM_WS_SUBSCRIPTIONS_KEY);
      const record = parseSubscriptionsRecord(value);
      if (!address) return [];
      return Array.isArray(record[address]) ? record[address] : [];
    } catch (_) {
      return [];
    }
  }
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_WS_SUBSCRIPTIONS_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    const record = parseSubscriptionsRecord(value);
    if (!address) return [];
    return Array.isArray(record[address]) ? record[address] : [];
  } catch (_) {
    return [];
  }
}

async function setStoredCustomSubscriptions(list: any[]) {
  const address = getCurrentAddress();
  const appStorage = getAppStorage();
  if (appStorage) {
    try {
      const value = await appStorage.get(CUSTOM_WS_SUBSCRIPTIONS_KEY);
      const record = parseSubscriptionsRecord(value);
      if (address) record[address] = list;
      await appStorage.set(CUSTOM_WS_SUBSCRIPTIONS_KEY, record);
    } catch (err) {
      console.error(
        '[get.ts] setStoredCustomSubscriptions appStorage failed:',
        err
      );
    }
  } else if (typeof localStorage !== 'undefined' && address) {
    try {
      const raw = localStorage.getItem(CUSTOM_WS_SUBSCRIPTIONS_KEY);
      const record = parseSubscriptionsRecord(raw ? JSON.parse(raw) : null);
      record[address] = list;
      localStorage.setItem(CUSTOM_WS_SUBSCRIPTIONS_KEY, JSON.stringify(record));
    } catch (err) {
      console.error(
        '[get.ts] setStoredCustomSubscriptions localStorage failed:',
        err
      );
    }
  }
  // Legacy shape (the list itself) for the notifications socket listener, plus
  // an address-tagged event for the cross-device notification state sync.
  executeEvent('custom-ws-subscriptions-updated', list);
  executeEvent('custom-ws-subscriptions-changed', { address, list });
}

/**
 * Every write to the stored subscription list goes through this chain so a
 * Q-app NOTIFICATION_ADD/NOTIFICATION_REMOVE and a sync apply arriving from
 * another device can never interleave their read-modify-write.
 */
let subscriptionWriteChain: Promise<unknown> = Promise.resolve();

function withSubscriptionWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const run = subscriptionWriteChain.then(task, task);
  subscriptionWriteChain = run.catch(() => undefined);
  return run;
}

export type NotificationRuleRef = {
  notificationId: string;
  appName: string;
  appService: string;
};

function subscriptionIdentity(sub: any): string {
  return `${sub?.notificationId ?? ''}-${(sub?.appName ?? '').toLowerCase()}-${
    sub?.appService ?? 'APP'
  }`;
}

function toNotificationRuleRef(sub: any): NotificationRuleRef {
  return {
    notificationId: sub?.notificationId ?? '',
    appName: sub?.appName ?? '',
    appService: sub?.appService ?? 'APP',
  };
}

function emitSubscriptionsRemoved(
  address: string | null,
  items: NotificationRuleRef[]
) {
  if (!address || items.length === 0) return;
  executeEvent('custom-ws-subscriptions-removed', { address, items });
}

/** Allowed filter keys and their types for notification subscription resourceFilter. */
const NOTIFICATION_FILTER_SPEC = {
  service: 'string',
  query: 'string',
  identifier: 'string',
  names: 'arrayOfString',
  title: 'string',
  description: 'string',
  keywords: 'arrayOfString',
  prefix: 'boolean',
  defaultResource: 'boolean',
  followedOnly: 'boolean',
  excludeBlocked: 'boolean',
  after: 'long',
  before: 'long',
  mode: 'string', // ALL | ANY, internal
};

function validateNotificationFilters(filters) {
  if (filters == null || typeof filters !== 'object') return;
  for (const [key, value] of Object.entries(filters)) {
    if (!(key in NOTIFICATION_FILTER_SPEC)) {
      throw new Error(`Unknown filter key: "${key}"`);
    }
    if (value === undefined || value === null) continue;
    const type = NOTIFICATION_FILTER_SPEC[key];
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Filter "${key}" must be a string`);
        }
        break;
      case 'arrayOfString':
        if (!Array.isArray(value)) {
          throw new Error(`Filter "${key}" must be an array of strings`);
        }
        if (value.some((v) => typeof v !== 'string')) {
          throw new Error(`Filter "${key}" must be an array of strings`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Filter "${key}" must be a boolean`);
        }
        break;
      case 'integer':
      case 'long':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new Error(`Filter "${key}" must be an integer`);
        }
        break;
      default:
        break;
    }
  }
}

export const addNotificationSubscriptions = async (payload, appInfo) => {
  if (
    !appInfo?.tabId ||
    !appInfo?.name ||
    !hasSessionPermission(
      appInfo.tabId,
      appInfo.name,
      'NOTIFICATION_PERMISSION'
    )
  ) {
    throw new Error(
      'Notification permission required. Call NOTIFICATION_PERMISSION first.'
    );
  }
  const notifications = payload?.notifications;
  if (!Array.isArray(notifications) || notifications.length === 0) {
    throw new Error('notifications must be a non-empty array');
  }
  const appName = (appInfo?.name ?? '').toLowerCase();
  const appService = appInfo?.service ?? 'APP';

  const toSubscription = (item) => {
    if (
      !item ||
      typeof item.notificationId !== 'string' ||
      !item.notificationId.trim()
    ) {
      throw new Error('Each item must have a non-empty notificationId');
    }
    if (typeof item.link !== 'string' || !item.link.trim()) {
      throw new Error('Each item must have a non-empty link');
    }
    const filters = item.filters;
    if (!filters || typeof filters !== 'object') {
      throw new Error('Each item must have filters (object)');
    }
    validateNotificationFilters(filters);
    const message = item.message;
    if (
      !message ||
      typeof message !== 'object' ||
      typeof message.en !== 'string' ||
      !message.en.trim()
    ) {
      throw new Error("Each item must have message with at least 'en'");
    }
    return {
      event: 'RESOURCE_PUBLISHED',
      resourceFilter: { ...filters, mode: filters.mode ?? 'ALL' },
      image: typeof item.image === 'string' ? item.image : undefined,
      link: item.link.trim(),
      notificationId: item.notificationId.trim(),
      appName,
      appService,
      message: { ...message },
    };
  };

  const transformed = notifications.map(toSubscription);
  await withSubscriptionWriteLock(async () => {
    const current = await getStoredCustomSubscriptions();
    const byKey = new Map(current.map((s) => [subscriptionIdentity(s), s]));
    transformed.forEach((s) => byKey.set(subscriptionIdentity(s), s));
    const merged = Array.from(byKey.values());
    await setStoredCustomSubscriptions(merged);
  });
  return true;
};

/**
 * Drops every rule of one app (any service, optionally limited to a set of
 * notification ids). Emits `custom-ws-subscriptions-removed`, which is the ONLY
 * source of rule tombstones for the cross-device sync, and unsubscribes the
 * live socket. Returns the removed rule references.
 */
async function removeRulesForApp(
  appName: string,
  appService: string | null,
  idsSet: Set<string> | null
): Promise<NotificationRuleRef[]> {
  const normalizedApp = (appName ?? '').toLowerCase();
  return withSubscriptionWriteLock(async () => {
    const address = getCurrentAddress();
    const current = await getStoredCustomSubscriptions();
    const toUnsubscribe: NotificationRuleRef[] = [];
    const filtered = current.filter((sub) => {
      const sameApp =
        (sub.appName ?? '').toLowerCase() === normalizedApp &&
        (appService == null || (sub.appService ?? 'APP') === appService);
      if (!sameApp) return true;
      if (idsSet != null && !idsSet.has(sub.notificationId ?? '')) return true;
      toUnsubscribe.push(toNotificationRuleRef(sub));
      return false;
    });
    if (toUnsubscribe.length === 0 && filtered.length === current.length) {
      return [];
    }
    await setStoredCustomSubscriptions(filtered);
    emitSubscriptionsRemoved(address, toUnsubscribe);
    if (toUnsubscribe.length > 0) {
      executeEvent('custom-ws-unsubscribe', toUnsubscribe);
    }
    return toUnsubscribe;
  });
}

export const removeNotificationSubscriptions = async (payload, appInfo) => {
  const appName = (appInfo?.name ?? '').toLowerCase();
  const appService = appInfo?.service ?? 'APP';
  const notificationIds = payload?.notificationIds;
  const idsSet =
    Array.isArray(notificationIds) && notificationIds.length > 0
      ? new Set<string>(notificationIds.map((id) => String(id).trim()))
      : null;
  await removeRulesForApp(appName, appService, idsSet);
  return true;
};

/**
 * Used by the "Revoke" button in the notification settings: removes every
 * stored rule of the app (all services) through the persisted list, so the
 * removal reaches storage, the socket and the other devices.
 */
export const revokeAppNotificationRules = async (
  appName: string
): Promise<NotificationRuleRef[]> => {
  return removeRulesForApp(appName, null, null);
};

/**
 * Merge rules that arrived from another device into the stored list. Rules are
 * matched by (notificationId, appName, appService). RESOURCE_PUBLISHED rules
 * whose app has no local notification permission are dropped, mirroring the
 * filter the notifications socket applies at connect time. The caller is
 * responsible for `custom-ws-unsubscribe` for the removals; no tombstone event
 * is emitted here (tombstones only ever come from explicit local removals).
 */
export const applySyncedCustomSubscriptions = async (
  address: string,
  upserts: any[],
  removals: NotificationRuleRef[]
): Promise<void> => {
  if (!address || address !== getCurrentAddress()) return;
  await withSubscriptionWriteLock(async () => {
    if (address !== getCurrentAddress()) return;
    const current = await getStoredCustomSubscriptions();
    const byKey = new Map(current.map((s) => [subscriptionIdentity(s), s]));
    for (const ref of removals ?? []) {
      byKey.delete(subscriptionIdentity(ref));
    }
    for (const sub of upserts ?? []) {
      if (!sub || typeof sub !== 'object') continue;
      byKey.set(subscriptionIdentity(sub), sub);
    }
    const merged: any[] = [];
    const permissionByApp = new Map<string, boolean>();
    for (const sub of byKey.values()) {
      if (sub?.event !== 'RESOURCE_PUBLISHED') {
        merged.push(sub);
        continue;
      }
      const app = (sub?.appName ?? '').toLowerCase();
      if (!app) continue;
      let allowed = permissionByApp.get(app);
      if (allowed === undefined) {
        allowed =
          (await getPermission(getNotificationPermissionKey(app))) === true;
        permissionByApp.set(app, allowed);
      }
      if (allowed) merged.push(sub);
    }
    const unchanged =
      merged.length === current.length &&
      merged.every((s, i) => s === current[i]);
    if (unchanged) return;
    await setStoredCustomSubscriptions(merged);
  });
};

const NOTIFICATION_SEEN_IN_APP_KEY = 'qortal_notification_seen_in_app';
const NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** Stored shape: address -> notificationKey -> timestamp. Electron: appStorage (sync read from cache); else localStorage. */
function getStoredSeenInAppRecord(): Record<string, Record<string, number>> {
  const appStorage = getAppStorage();
  const electronStorage = getElectronPersistentStorage();
  let raw: string | null | unknown = null;
  if (appStorage != null && electronStorage != null) {
    raw = (electronStorage as any).getItem(NOTIFICATION_SEEN_IN_APP_KEY, null);
  } else if (typeof localStorage !== 'undefined') {
    raw = localStorage.getItem(NOTIFICATION_SEEN_IN_APP_KEY);
  }
  if (raw == null) return {};
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    const cutoff = Date.now() - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
    const result: Record<string, Record<string, number>> = {};
    for (const [addr, inner] of Object.entries(obj)) {
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        const keyRecord: Record<string, number> = {};
        for (const [k, t] of Object.entries(inner)) {
          if (typeof t === 'number' && t > cutoff) keyRecord[k] = t;
        }
        if (Object.keys(keyRecord).length > 0) result[addr] = keyRecord;
      }
    }
    return result;
  } catch (_) {
    return {};
  }
}

function getStoredSeenInAppKeys(address: string | null): string[] {
  if (!address) return [];
  const record = getStoredSeenInAppRecord();
  const byAddr = record[address] ?? {};
  const cutoff = Date.now() - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
  return Object.keys(byAddr).filter(
    (k) => typeof byAddr[k] === 'number' && byAddr[k] > cutoff
  );
}

/** Seen-in-app key → mark time (ms) for an address, already pruned to the retention window. */
export function getSeenInAppKeyTimesForAddress(
  address: string | null
): Record<string, number> {
  if (!address) return {};
  const record = getStoredSeenInAppRecord();
  return { ...(record[address] ?? {}) };
}

function setStoredSeenInAppKeys(
  address: string | null,
  keys: string[]
): string[] {
  if (!address || keys.length === 0) return [];
  const now = Date.now();
  return writeSeenInAppKeyTimes(
    address,
    keys.map((k) => [now, k] as [number, string]),
    'overwrite'
  );
}

/**
 * Seen keys arriving from another device carry their ORIGINAL mark time, which
 * must be preserved (a prefix key only hides resources published before its
 * mark time). When the key already exists locally the newer time wins.
 */
export function addSeenInAppKeysForAddress(
  address: string | null,
  entries: Array<[number, string]>
): string[] {
  if (!address || !Array.isArray(entries) || entries.length === 0) return [];
  return writeSeenInAppKeyTimes(address, entries, 'keep-newer');
}

function writeSeenInAppKeyTimes(
  address: string,
  entries: Array<[number, string]>,
  mode: 'overwrite' | 'keep-newer'
): string[] {
  const record = getStoredSeenInAppRecord();
  const now = Date.now();
  const cutoff = now - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
  record[address] = record[address] ?? {};
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const [time, k] = entry;
    if (typeof k !== 'string' || !k || typeof time !== 'number') continue;
    if (!Number.isFinite(time) || time <= cutoff) continue;
    const existing = record[address][k];
    if (
      mode === 'keep-newer' &&
      typeof existing === 'number' &&
      existing >= time
    ) {
      continue;
    }
    record[address][k] = Math.min(time, now);
  }
  const pruned: Record<string, Record<string, number>> = {};
  for (const [addr, inner] of Object.entries(record)) {
    const filtered = Object.fromEntries(
      Object.entries(inner).filter(
        ([, t]) => typeof t === 'number' && t > cutoff
      )
    );
    if (Object.keys(filtered).length > 0) pruned[addr] = filtered;
  }
  const appStorage = getAppStorage();
  const electronStorage = getElectronPersistentStorage();
  if (appStorage != null && electronStorage != null) {
    (electronStorage as any).setItem(NOTIFICATION_SEEN_IN_APP_KEY, pruned);
    appStorage
      .set(NOTIFICATION_SEEN_IN_APP_KEY, pruned)
      .catch((err) =>
        console.error('[get.ts] setStoredSeenInAppKeys appStorage failed:', err)
      );
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(NOTIFICATION_SEEN_IN_APP_KEY, JSON.stringify(pruned));
  }
  const keyTimes: Record<string, number> = {};
  for (const [k, t] of Object.entries(record[address] ?? {})) {
    if (typeof t === 'number' && t > cutoff) keyTimes[k] = t;
  }
  const keysList = Object.keys(keyTimes);
  executeEvent('notification-seen-in-app-updated', {
    address,
    keys: keysList,
    keyTimes,
  });
  return keysList;
}

/**
 * Mark notifications as "seen in app" for the current address.
 * Payload: { notificationIds: (string | { notificationId: string, identifier?: string })[] }.
 * App name/service from appInfo.
 * - String: add prefix key only (all with that notificationId).
 * - Object with optional identifier: add prefix key; if identifier present, also add full key for that item.
 */
export const markNotificationSeenInApp = (payload, appInfo) => {
  const notificationIds = payload?.notificationIds;
  if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
    return [];
  }
  const address = getCurrentAddress();
  if (!address) return [];
  const appName = (appInfo?.name ?? '').toLowerCase();
  const appService = appInfo?.service ?? 'APP';
  // Only the keys this request names are (re)marked at now. Re-writing every
  // stored key would move other apps' prefix marks forward too, hiding their
  // newer notifications, and the sync would carry that to other devices.
  const toMark = new Set<string>();
  notificationIds.forEach((item) => {
    const notificationId =
      typeof item === 'string'
        ? String(item).trim()
        : item && typeof item === 'object' && item.notificationId != null
          ? String(item.notificationId).trim()
          : '';
    if (!notificationId) return;
    const prefixKey = `RESOURCE_PUBLISHED-${appName}-${appService}-${notificationId}`;
    const identifier =
      item && typeof item === 'object' && item.identifier != null
        ? String(item.identifier).trim()
        : '';
    if (identifier) {
      toMark.add(`${prefixKey}-${identifier}`);
    } else {
      toMark.add(prefixKey);
    }
  });
  // The stored list spans every app; only this app's keys go back to it.
  const keys =
    toMark.size === 0
      ? getStoredSeenInAppKeys(address)
      : setStoredSeenInAppKeys(address, Array.from(toMark));
  return filterSeenInAppKeysForApp(keys, appName, appService);
};

/** Returns notification rules for the app in the same format as NOTIFICATION_ADD (image, link, notificationId, message, filters). */
export const getNotificationSubscriptions = async (_payload, appInfo) => {
  const appName = (appInfo?.name ?? '').toLowerCase();
  const appService = appInfo?.service ?? 'APP';
  const current = await getStoredCustomSubscriptions();
  const forApp = current.filter(
    (sub) =>
      (sub.appName ?? '').toLowerCase() === appName &&
      (sub.appService ?? 'APP') === appService
  );
  return forApp.map((sub) => {
    const rf = sub.resourceFilter ?? {};
    const filters = {
      service: typeof rf.service === 'string' ? rf.service : '',
      identifier: typeof rf.identifier === 'string' ? rf.identifier : '',
    };
    if (typeof rf.name === 'string') filters.name = rf.name;
    if (rf.excludeBlocked !== undefined)
      filters.excludeBlocked = !!rf.excludeBlocked;
    if (typeof rf.mode === 'string') filters.mode = rf.mode;
    return {
      image: typeof sub.image === 'string' ? sub.image : undefined,
      link: typeof sub.link === 'string' ? sub.link : '',
      notificationId:
        typeof sub.notificationId === 'string' ? sub.notificationId : '',
      message:
        sub.message && typeof sub.message === 'object'
          ? { ...sub.message }
          : { en: '' },
      filters,
    };
  });
};

export const sendCoin = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['coin', 'amount'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (!data?.destinationAddress && !data?.recipient) {
    throw new Error(
      i18n.t('question:message.error.missing_fields', {
        fields: 'recipient',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const checkCoin = data.coin;
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const resKeyPair =
    checkCoin === 'QORT' ? await getKeyPair() : await ensureAltcoinKeyPair();
  const parsedData = resKeyPair;
  const isGateway = await isRunningGateway();

  if (checkCoin !== 'QORT' && isGateway)
    throw new Error(
      i18n.t('question:message.error.gateway_non_qort_local_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  if (checkCoin === 'QORT') {
    // Params: data.coin, data.recipient, data.amount, data.fee
    // TODO: prompt user to send. If they confirm, call `POST /crosschain/:coin/send`, or for QORT, broadcast a PAYMENT transaction
    // then set the response string from the core to the `response` variable (defined above)
    // If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
    // Plain decimals only ("1e3", "0x10" are refused); the dialog shows the
    // normalised amount that is signed.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    if (typeof recipient !== 'string' || recipient.trim().length === 0) {
      const errorMsg = i18n.t('question:message.error.empty_receiver', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const url = await createEndpoint(`/addresses/balance/${address}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_balance', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let walletBalance;
    try {
      walletBalance = await response.clone().json();
    } catch (e) {
      walletBalance = await response.text();
    }
    if (isNaN(Number(walletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'QORT',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const transformDecimals = (Number(walletBalance) * QORT_DECIMALS).toFixed(
      0
    );
    const walletBalanceDecimals = Number(transformDecimals);
    const amountDecimals = Number(amount) * QORT_DECIMALS;
    const fee: number = await sendQortFee();
    if (amountDecimals + fee * QORT_DECIMALS > walletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    if (amount <= 0) {
      const errorMsg = i18n.t('core:message.error.invalid_amount', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    if (!validateAddress(recipient) && hasInvisibleCharacters(recipient)) {
      throw new Error('Recipient name contains invisible characters');
    }
    // Resolve a name before asking, show the name and the full address, and
    // pay that address: nothing is looked up again after approval.
    const resolvedRecipient = await resolveRecipient(recipient);

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipientDisplayLabel(resolvedRecipient),
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        fee: fee,
        confirmCheckbox: true,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const makePayment = await sendCoinFunc(
        {
          amount,
          password: null,
          receiver: resolvedRecipient.address,
          approvedFee: fee,
        },
        true
      );
      return makePayment.res?.data;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'BTC') {
    // Plain decimals with at most 8 places, as for QORT ("1e3", "0x10" are
    // refused); the dialog shows the normalised amount that is sent.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.btcPrivateKey;
    const feePerByte = data.fee ? data.fee : BTC_FEE_PER_BYTE;

    const btcWalletBalance = await getWalletBalance({ coin: checkCoin }, true);

    if (isNaN(Number(btcWalletBalance))) {
      throw new Error(
        i18n.t('question:message.error.fetch_balance_token', {
          token: 'BTC',
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    const btcWalletBalanceDecimals = Number(btcWalletBalance);
    const btcAmountDecimals = Number(amount);
    const fee = feePerByte * 500; // default 0.00050000
    if (btcAmountDecimals + fee > btcWalletBalanceDecimals) {
      throw new Error(
        i18n.t('question:message.error.insufficient_funds', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }

    const url = await createEndpoint(`/crosschain/btc/send`);
    const egress = assertForeignKeyEgress(url, checkCoin);

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        foreignFee: `${fee} BTC`,
        confirmCheckbox: true,
        ...foreignKeyConsentFields(egress, checkCoin),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        bitcoinAmount: amount,
        feePerByte: feePerByte,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'LTC') {
    // Plain decimals with at most 8 places, as for QORT ("1e3", "0x10" are
    // refused); the dialog shows the normalised amount that is sent.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.ltcPrivateKey;
    const feePerByte = data.fee ? data.fee : LTC_FEE_PER_BYTE;
    const ltcWalletBalance = await getWalletBalance({ coin: checkCoin }, true);

    if (isNaN(Number(ltcWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'LTC',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const ltcWalletBalanceDecimals = Number(ltcWalletBalance);
    const ltcAmountDecimals = Number(amount);
    const fee = feePerByte * 1000; // default 0.00030000
    if (ltcAmountDecimals + fee > ltcWalletBalanceDecimals) {
      throw new Error(
        i18n.t('question:message.error.insufficient_funds', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    const url = await createEndpoint(`/crosschain/ltc/send`);
    const egress = assertForeignKeyEgress(url, checkCoin);
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        foreignFee: `${fee} LTC`,
        confirmCheckbox: true,
        ...foreignKeyConsentFields(egress, checkCoin),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        litecoinAmount: amount,
        feePerByte: feePerByte,
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'DOGE') {
    // Plain decimals with at most 8 places, as for QORT ("1e3", "0x10" are
    // refused); the dialog shows the normalised amount that is sent.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.dogePrivateKey;
    const feePerByte = data.fee ? data.fee : DOGE_FEE_PER_BYTE;
    const dogeWalletBalance = await getWalletBalance({ coin: checkCoin }, true);
    if (isNaN(Number(dogeWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'DOGE',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const dogeWalletBalanceDecimals = Number(dogeWalletBalance);
    const dogeAmountDecimals = Number(amount);
    const fee = feePerByte * 5000; // default 0.05000000
    if (dogeAmountDecimals + fee > dogeWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const url = await createEndpoint(`/crosschain/doge/send`);
    const egress = assertForeignKeyEgress(url, checkCoin);

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        foreignFee: `${fee} DOGE`,
        confirmCheckbox: true,
        ...foreignKeyConsentFields(egress, checkCoin),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        dogecoinAmount: amount,
        feePerByte: feePerByte,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'DGB') {
    // Plain decimals with at most 8 places, as for QORT ("1e3", "0x10" are
    // refused); the dialog shows the normalised amount that is sent.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.dgbPrivateKey;
    const feePerByte = data.fee ? data.fee : DGB_FEE_PER_BYTE;
    const dgbWalletBalance = await getWalletBalance({ coin: checkCoin }, true);
    if (isNaN(Number(dgbWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'DGB',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const dgbWalletBalanceDecimals = Number(dgbWalletBalance);
    const dgbAmountDecimals = Number(amount);
    const fee = feePerByte * 500; // default 0.00005000
    if (dgbAmountDecimals + fee > dgbWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const url = await createEndpoint(`/crosschain/dgb/send`);
    const egress = assertForeignKeyEgress(url, checkCoin);

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        foreignFee: `${fee} DGB`,
        confirmCheckbox: true,
        ...foreignKeyConsentFields(egress, checkCoin),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        digibyteAmount: amount,
        feePerByte: feePerByte,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'RVN') {
    // Plain decimals with at most 8 places, as for QORT ("1e3", "0x10" are
    // refused); the dialog shows the normalised amount that is sent.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.rvnPrivateKey;
    const feePerByte = data.fee ? data.fee : RVN_FEE_PER_BYTE;
    const rvnWalletBalance = await getWalletBalance({ coin: checkCoin }, true);
    if (isNaN(Number(rvnWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'RVN',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const rvnWalletBalanceDecimals = Number(rvnWalletBalance);
    const rvnAmountDecimals = Number(amount);
    const fee = feePerByte * 500; // default 0.00562500
    if (rvnAmountDecimals + fee > rvnWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const url = await createEndpoint(`/crosschain/rvn/send`);
    const egress = assertForeignKeyEgress(url, checkCoin);

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        foreignFee: `${fee} RVN`,
        confirmCheckbox: true,
        ...foreignKeyConsentFields(egress, checkCoin),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        ravencoinAmount: amount,
        feePerByte: feePerByte,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'ARRR') {
    // Plain decimals with at most 8 places, as for QORT ("1e3", "0x10" are
    // refused); the dialog shows the normalised amount that is sent.
    const parsedAmount = parseDecimalAmount(data.amount);
    const amount = parsedAmount.value;
    const recipient = data?.recipient || data.destinationAddress;
    const memo = data?.memo;
    const url = await createEndpoint(`/crosschain/arrr/send`);
    const egress = assertForeignKeyEgress(url, checkCoin);
    const fee = 0.0001;

    // The balance check sends the ARRR seed to the node, so it waits until the
    // user has accepted the send and its private-key warning.
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${parsedAmount.text} ${checkCoin}`,
        foreignFee: `${fee} ARRR`,
        confirmCheckbox: true,
        ...foreignKeyConsentFields(egress, checkCoin),
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    if (accepted) {
      const arrrWalletBalance = await getWalletBalance(
        { coin: checkCoin },
        true
      );

      if (isNaN(Number(arrrWalletBalance))) {
        const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
          token: 'ARRR',
          postProcess: 'capitalizeFirstChar',
        });
        throw new Error(errorMsg);
      }
      const arrrWalletBalanceDecimals = Number(arrrWalletBalance);
      const arrrAmountDecimals = Number(amount);
      if (arrrAmountDecimals + fee > arrrWalletBalanceDecimals) {
        const errorMsg = i18n.t('question:message.error.insufficient_funds', {
          postProcess: 'capitalizeFirstChar',
        });
        throw new Error(errorMsg);
      }

      const opts = {
        entropy58: parsedData.arrrSeed58,
        receivingAddress: recipient,
        arrrAmount: amount,
        memo: memo,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }
};

const getBuyingFees = async (foreignBlockchain) => {
  const ticker = SELLER_FOREIGN_FEE[foreignBlockchain].ticker;
  if (!ticker) throw new Error('invalid foreign blockchain');
  const unlockFee = await getForeignFee({
    coin: ticker,
    type: 'feerequired',
  });
  const lockFee = await getForeignFee({
    coin: ticker,
    type: 'feekb',
  });
  return {
    ticker: ticker,
    lock: {
      sats: lockFee,
      fee: lockFee / QORT_DECIMALS,
    },
    unlock: {
      sats: unlockFee,
      fee: unlockFee / QORT_DECIMALS,
      feePerKb: +calculateRateFromFee(+unlockFee, 300) / QORT_DECIMALS,
    },
  };
};

export const createBuyOrder = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['crosschainAtInfo', 'foreignBlockchain'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const isGateway = await isRunningGateway();
  const foreignBlockchain = data.foreignBlockchain;
  const atAddresses = data.crosschainAtInfo?.map(
    (order) => order.qortalAtAddress
  );

  const atPromises = atAddresses.map((atAddress) =>
    requestQueueGetAtAddresses.enqueue(async () => {
      const url = await createEndpoint(
        `/crosschain/trade/${nodePathSegment(atAddress)}`
      );
      const resAddress = await fetch(url);
      const resData = await resAddress.json();
      if (foreignBlockchain !== resData?.foreignBlockchain) {
        throw new Error(
          i18n.t('core:message.error.same_foreign_blockchain', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      return resData;
    })
  );

  const crosschainAtInfo = await Promise.all(atPromises);

  try {
    const buyingFees = await getBuyingFees(foreignBlockchain);
    const foreignKeyFields = isGateway
      ? foreignKeyProxyConsentFields(buyingFees.ticker)
      : foreignKeyConsentFields(
          assertForeignKeyEgress(
            await createEndpoint(
              foreignBlockchain === 'PIRATECHAIN'
                ? '/crosschain/tradebot/respond'
                : '/crosschain/tradebot/respondmultiple'
            ),
            buyingFees.ticker
          ),
          buyingFees.ticker
        );
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.buy_order', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.buy_order_quantity', {
          count: atAddresses?.length,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:permission.buy_order_ticker', {
          qort_amount: crosschainAtInfo?.reduce((latest, cur) => {
            return latest + +cur?.qortAmount;
          }, 0),
          foreign_amount: roundUpToDecimals(
            crosschainAtInfo?.reduce((latest, cur) => {
              return latest + +cur?.expectedForeignAmount;
            }, 0)
          ),
          ticker: buyingFees.ticker,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: i18n.t('auth:node.using_public_gateway', {
          gateway: isGateway,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: '',
        details: {
          type: 'buyOrderFees',
          unlockLabel: i18n.t('question:total_unlocking_fee', {
            postProcess: 'capitalizeFirstChar',
          }),
          unlockAmount: (
            +buyingFees?.unlock?.fee * atAddresses?.length
          )?.toFixed(8),
          ticker: buyingFees.ticker,
          unlockDescription: i18n.t(
            'question:permission.buy_order_fee_estimation',
            {
              count: atAddresses?.length,
              fee: buyingFees?.unlock?.feePerKb?.toFixed(8),
              ticker: buyingFees.ticker,
              postProcess: 'capitalizeFirstChar',
            }
          ),
          lockLabel: i18n.t('question:total_locking_fee', {
            postProcess: 'capitalizeFirstChar',
          }),
          lockDescription: i18n.t('question:permission.buy_order_per_kb', {
            fee: +buyingFees?.lock.fee.toFixed(8),
            ticker: buyingFees.ticker,
            postProcess: 'capitalizeFirstChar',
          }),
        },
        confirmCheckbox: true,
        ...foreignKeyFields,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;
    if (accepted) {
      const resBuyOrder = await createBuyOrderTx({
        crosschainAtInfo,
        isGateway,
        foreignBlockchain,
      });
      return resBuyOrder;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.buy_order', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

const cancelTradeOfferTradeBot = async (body, keyPair) => {
  const txn = new DeleteTradeOffer().createTransaction(body);
  const url = await createEndpoint(`/crosschain/tradeoffer`);
  const bodyToString = JSON.stringify(txn);

  const deleteTradeBotResponse = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyToString,
  });

  if (!deleteTradeBotResponse.ok) {
    throw new Error(
      i18n.t('question:message.error.update_tradebot', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const unsignedTxn = await deleteTradeBotResponse.text();
  const signedTxnBytes = await signTradeBotTransaction(unsignedTxn, keyPair);
  const signedBytes = Base58.encode(signedTxnBytes);

  let res;
  try {
    res = await processTransactionVersion2(signedBytes);
  } catch (error) {
    return {
      error: i18n.t('question:message.error.cancel_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      failedTradeBot: {
        atAddress: body.atAddress,
        creatorAddress: body.creatorAddress,
      },
    };
  }
  if (res?.error) {
    return {
      error: i18n.t('question:message.error.cancel_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      failedTradeBot: {
        atAddress: body.atAddress,
        creatorAddress: body.creatorAddress,
      },
    };
  }
  if (res?.signature) {
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.error.cancel_sell_order', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};
const findFailedTradebot = async (createBotCreationTimestamp, body) => {
  //wait 5 secs
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  await new Promise((res) => {
    setTimeout(() => {
      res(null);
    }, TIME_SECONDS_5_IN_MILLISECONDS);
  });
  const url = await createEndpoint(
    `/crosschain/tradebot?foreignBlockchain=LITECOIN`
  );

  const tradeBotsReponse = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const data = await tradeBotsReponse.json();
  const latestItem = data
    .filter(
      (item) =>
        item.creatorAddress === address &&
        +item.foreignAmount === +body.foreignAmount
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (
    latestItem &&
    createBotCreationTimestamp - latestItem.timestamp <=
      TIME_SECONDS_5_IN_MILLISECONDS &&
    createBotCreationTimestamp > latestItem.timestamp // Ensure latestItem's timestamp is before createBotCreationTimestamp
  ) {
    return latestItem;
  } else {
    return null;
  }
};
const tradeBotCreateRequest = async (body, keyPair) => {
  const txn = new TradeBotCreateRequest().createTransaction(body);
  const url = await createEndpoint(`/crosschain/tradebot/create`);
  const bodyToString = JSON.stringify(txn);

  const unsignedTxnResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyToString,
  });
  if (!unsignedTxnResponse.ok)
    throw new Error(
      i18n.t('question:message.error.create_tradebot', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const createBotCreationTimestamp = Date.now();
  const unsignedTxn = await unsignedTxnResponse.text();
  const signedTxnBytes = await signTradeBotTransaction(unsignedTxn, keyPair);
  const signedBytes = Base58.encode(signedTxnBytes);

  let res;
  try {
    res = await processTransactionVersion2(signedBytes);
  } catch (error) {
    const findFailedTradeBot = await findFailedTradebot(
      createBotCreationTimestamp,
      body
    );
    return {
      error: i18n.t('question:message.error.create_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      failedTradeBot: findFailedTradeBot,
    };
  }

  if (res?.signature) {
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.error.create_sell_order', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const createSellOrder = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['qortAmount', 'foreignBlockchain', 'foreignAmount'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const parsedForeignAmount = Number(data.foreignAmount)?.toFixed(8);

  // An ARRR receiving address comes from the node, which needs the ARRR seed
  // for it: warn in the sell dialog and look the address up only after accept.
  const arrrSeedConsentFields = isArrrCoin(data.foreignBlockchain)
    ? foreignKeyConsentFields(
        assertForeignKeyEgress(
          await createEndpoint('/crosschain/arrr/walletaddress'),
          'ARRR'
        ),
        'ARRR'
      )
    : {};
  try {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.sell_order', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.order_detail', {
          qort_amount: data.qortAmount,
          foreign_amount: parsedForeignAmount,
          ticker: data.foreignBlockchain,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: '0.02',
        confirmCheckbox: true,
        ...arrrSeedConsentFields,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;
    if (accepted) {
      const receivingAddress = await getUserWalletFunc(data.foreignBlockchain);
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const userPublicKey = parsedData.publicKey;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };
      const response = await tradeBotCreateRequest(
        {
          creatorPublicKey: userPublicKey,
          qortAmount: parseFloat(data.qortAmount),
          fundingQortAmount: parseFloat(data.qortAmount) + 0.01,
          foreignBlockchain: data.foreignBlockchain,
          foreignAmount: parseFloat(parsedForeignAmount),
          tradeTimeout: 120,
          receivingAddress: receivingAddress.address,
        },
        keyPair
      );

      return response;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.submit_sell_order', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const cancelSellOrder = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['atAddress'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const url = await createEndpoint(
    `/crosschain/trade/${nodePathSegment(data.atAddress)}`
  );
  const resAddress = await fetch(url);
  const resData = await resAddress.json();

  if (!resData?.qortalAtAddress)
    throw new Error(
      i18n.t('question:message.error.at_info', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  try {
    const fee = await getFee('MESSAGE');

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.cancel_sell_order', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.order_detail', {
          qort_amount: resData.qortAmount,
          foreign_amount: resData.expectedForeignAmount,
          ticker: resData.foreignBlockchain,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: fee.fee,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;
    if (accepted) {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const userPublicKey = parsedData.publicKey;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };
      const response = await cancelTradeOfferTradeBot(
        {
          creatorPublicKey: userPublicKey,
          atAddress: data.atAddress,
        },
        keyPair
      );

      return response;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.submit_sell_order', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const openNewTab = async (data, isFromExtension) => {
  const requiredFields = ['qortalLink'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const res = extractComponents(data.qortalLink);
  if (res) {
    const { service, name, identifier, path } = res;
    if (!service && !name)
      throw new Error(
        i18n.t('auth:message.error.invalid_qortal_link', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    executeEvent('addTab', {
      data: {
        service,
        name,
        identifier,
        path,
        ...(data.navigateIfAlreadyOpen && { navigateIfAlreadyOpen: true }),
      },
    });
    executeEvent('open-apps-mode', {});
    return true;
  } else {
    throw new Error(
      i18n.t('auth:message.error.invalid_qortal_link', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const openUserLookup = async (data) => {
  const user = typeof data?.user === 'string' ? data.user.trim() : '';
  if (!user) {
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: 'user',
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  executeEvent('openUserLookupDrawer', {
    addressOrName: user,
  });
  return true;
};

export const lockTab = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['lockMessage'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { lockMessage } = data;
  const tabId = appInfo?.tabId;

  if (!tabId) {
    throw new Error('Tab ID not found');
  }

  // Check for session permission
  const hasPermission =
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'LOCK_TAB');

  if (!hasPermission) {
    const resPermission = await getUserPermission(
      {
        text1: 'Lock tab',
        text2: i18n.t('question:permission.lock_tab', {
          postProcess: 'capitalizeFirstChar',
        }),
      },
      isFromExtension,
      appInfo
    );

    const { accepted } = resPermission || { accepted: false };
    if (!accepted) {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }

  executeEvent('addLock', { data: { tabId, lockMessage } });
  return true;
};

export const unlockTab = async (data, isFromExtension, appInfo) => {
  const tabId = appInfo?.tabId;

  if (!tabId) {
    throw new Error('Tab ID not found');
  }

  executeEvent('removeLock', { data: { tabId } });
  return true;
};

export const adminAction = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['type'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  // For actions that require a value, check for 'value' field
  const actionsRequiringValue = [
    'adddatapeer',
    'addmintingaccount',
    'addpeer',
    'forcesync',
    'removedatapeer',
    'removemintingaccount',
    'removepeer',
  ];
  if (actionsRequiringValue.includes(data.type.toLowerCase()) && !data.value) {
    missingFields.push('value');
  }
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let apiEndpoint = '';
  let method = 'GET'; // Default method
  let includeValueInBody = false;
  switch (data.type.toLowerCase()) {
    case 'stop':
      apiEndpoint = await createEndpoint('/admin/stop');
      break;
    case 'restart':
      apiEndpoint = await createEndpoint('/admin/restart');
      break;
    case 'bootstrap':
      apiEndpoint = await createEndpoint('/admin/bootstrap');
      break;
    case 'addmintingaccount':
      apiEndpoint = await createEndpoint('/admin/mintingaccounts');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'getmintingaccounts':
      apiEndpoint = await createEndpoint('/admin/mintingaccounts');
      break;
    case 'getpeers':
      apiEndpoint = await createEndpoint('/peers');
      break;
    case 'removemintingaccount':
      apiEndpoint = await createEndpoint('/admin/mintingaccounts');
      method = 'DELETE';
      includeValueInBody = true;
      break;
    case 'forcesync':
      apiEndpoint = await createEndpoint('/admin/forcesync');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'addpeer':
      apiEndpoint = await createEndpoint('/peers');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'removepeer':
      apiEndpoint = await createEndpoint('/peers');
      method = 'DELETE';
      includeValueInBody = true;
      break;
    case 'adddatapeer':
      apiEndpoint = await createEndpoint('/peers/data');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'removedatapeer':
      apiEndpoint = await createEndpoint('/peers/data');
      method = 'DELETE';
      includeValueInBody = true;
      break;
    default:
      throw new Error(
        i18n.t('question:message.error.unknown_admin_action_type', {
          type: data.type,
          postProcess: 'capitalizeFirstChar',
        })
      );
  }
  // Prepare the permission prompt text
  let permissionText = i18n.t('question:permission.perform_admin_action', {
    type: data.type,
    postProcess: 'capitalizeFirstChar',
  });

  if (data.value) {
    permissionText +=
      ' ' +
      i18n.t('question:permission.perform_admin_action_with_value', {
        value: data.value,
        postProcess: 'capitalizeFirstChar',
      });
  }

  const resPermission = await getUserPermission(
    {
      text1: permissionText,
    },
    isFromExtension,
    appInfo
  );

  const { accepted } = resPermission;

  if (accepted) {
    // Set up options for the API call
    const options: RequestInit = {
      method: method,
      headers: {},
    };
    if (includeValueInBody) {
      options.headers['Content-Type'] = 'text/plain';
      options.body = data.value;
    }
    const response = await fetch(apiEndpoint, options);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.perform_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const signTransaction = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['unsignedBytes'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const shouldProcess = data?.process || false;
  const _url = await createEndpoint(
    '/transactions/decode?ignoreValidityChecks=false'
  );

  const _body = data.unsignedBytes;
  const response = await fetch(_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: _body,
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.decode_transaction', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const decodedData = await response.json();
  const resPermission = await getUserPermission(
    {
      text1: shouldProcess
        ? i18n.t('question:permission.sign_process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
        : i18n.t('question:permission.sign_transaction', {
            postProcess: 'capitalizeFirstChar',
          }),
      highlightedText: i18n.t(
        'question:message.generic.read_transaction_carefully',
        { postProcess: 'capitalizeFirstChar' }
      ),
      text2: `Tx type: ${decodedData.type}`,
      json: decodedData,
      confirmCheckbox: true,
    },
    isFromExtension,
    appInfo
  );

  const { accepted } = resPermission;
  if (accepted) {
    let urlConverted = await createEndpoint('/transactions/convert');

    const responseConverted = await fetch(urlConverted, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: data.unsignedBytes,
    });
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    const convertedBytes = await responseConverted.text();
    const txBytes = Base58.decode(data.unsignedBytes);
    const _arbitraryBytesBuffer = Object.keys(txBytes).map(function (key) {
      return txBytes[key];
    });
    const arbitraryBytesBuffer = new Uint8Array(_arbitraryBytesBuffer);
    const txByteSigned = Base58.decode(convertedBytes);
    const _bytesForSigningBuffer = Object.keys(txByteSigned).map(
      function (key) {
        return txByteSigned[key];
      }
    );
    const bytesForSigningBuffer = new Uint8Array(_bytesForSigningBuffer);
    const signature = nacl.sign.detached(
      bytesForSigningBuffer,
      keyPair.privateKey
    );
    const signedBytes = utils.appendBuffer(arbitraryBytesBuffer, signature);
    const signedBytesToBase58 = Base58.encode(signedBytes);
    if (!shouldProcess) {
      return signedBytesToBase58;
    }
    const res = await processTransactionVersion2(signedBytesToBase58);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

const missingFieldsFunc = (data, requiredFields) => {
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
};

const encode = (value) => encodeURIComponent(value.trim()); // Helper to encode values
const buildQueryParams = (data) => {
  const allowedParams = [
    'name',
    'service',
    'identifier',
    'mimeType',
    'fileName',
    'encryptionType',
    'key',
  ];
  return Object.entries(data)
    .map(([key, value]) => {
      if (
        value === undefined ||
        value === null ||
        value === false ||
        !allowedParams.includes(key)
      )
        return null; // Skip null, undefined, or false
      if (typeof value === 'boolean') return `${key}=${value}`; // Handle boolean values
      return `${key}=${encode(value)}`; // Encode other values
    })
    .filter(Boolean) // Remove null values
    .join('&'); // Join with `&`
};
export const createAndCopyEmbedLink = async (data, isFromExtension) => {
  const requiredFields = ['type'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  switch (data.type) {
    case 'POLL': {
      missingFieldsFunc(data, ['type', 'name']);

      const queryParams = [
        `name=${encode(data.name)}`,
        data.ref ? `ref=${encode(data.ref)}` : null, // Add only if ref exists
      ]
        .filter(Boolean) // Remove null values
        .join('&'); // Join with `&`
      const link = `${QORTAL_PROTOCOL}use-embed/POLL?${queryParams}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch (error) {
        throw new Error(
          i18n.t('question:message.error.copy_clipboard', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      return link;
    }
    case 'IMAGE':
    case 'ATTACHMENT': {
      missingFieldsFunc(data, ['type', 'name', 'service', 'identifier']);
      if (data?.encryptionType === 'private' && !data?.key) {
        throw new Error(
          i18n.t('question:message.error.provide_key_shared_link', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const queryParams = buildQueryParams(data);

      const link = `${QORTAL_PROTOCOL}use-embed/${data.type}?${queryParams}`;

      try {
        await navigator.clipboard.writeText(link);
      } catch (error) {
        throw new Error(
          i18n.t('question:message.error.copy_clipboard', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      return link;
    }

    default:
      throw new Error(
        i18n.t('question:message.error.invalid_type', {
          postProcess: 'capitalizeFirstChar',
        })
      );
  }
};

export const registerNameRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['name'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const fee = await getFee('REGISTER_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.register_name', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: data.name,
      text2: data?.description,
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const name = data.name;
    const description = data?.description || '';
    const response = await registerName({ name, description });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const updateNameRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['newName', 'oldName'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const oldName = data.oldName;
  const newName = data.newName;
  const description = data?.description || '';
  const fee = await getFee('UPDATE_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.update_name', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: `previous name: ${oldName}`,
      text3: `new name: ${newName}`,
      text4: data?.description,
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await updateName({ oldName, newName, description });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const leaveGroupRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['groupId'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const fee = await getFee('LEAVE_GROUP');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.leave_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: `${groupInfo.groupName}`,
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await leaveGroup({ groupId });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const inviteToGroupRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['groupId', 'inviteTime', 'inviteeAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.inviteeAddress;
  const inviteTime = data?.inviteTime;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('GROUP_INVITE');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.invite', {
        invitee: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await inviteToGroup({
      groupId,
      qortalAddress,
      inviteTime,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const kickFromGroupRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const reason = data?.reason;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('GROUP_KICK');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.kick', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await kickFromGroup({
      groupId,
      qortalAddress,
      rBanReason: reason,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const banFromGroupRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const rBanTime = data?.banTime;
  const reason = data?.reason;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('GROUP_BAN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.ban', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await banFromGroup({
      groupId,
      qortalAddress,
      rBanTime,
      rBanReason: reason,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const cancelGroupBanRequest = async (
  data,
  isFromExtension,
  appInfo?
) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('CANCEL_GROUP_BAN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.cancel_ban', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await cancelBan({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const addGroupAdminRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('ADD_GROUP_ADMIN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.add_admin', {
        invitee: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await makeAdmin({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const removeGroupAdminRequest = async (
  data,
  isFromExtension,
  appInfo?
) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('REMOVE_GROUP_ADMIN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.remove_admin', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await removeAdmin({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const cancelGroupInviteRequest = async (
  data,
  isFromExtension,
  appInfo?
) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('CANCEL_GROUP_INVITE');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.cancel_group_invite', {
        invitee: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );

  const { accepted } = resPermission;

  if (accepted) {
    const response = await cancelInvitationToGroup({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const createGroupRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = [
    'approvalThreshold',
    'groupName',
    'maxBlock',
    'minBlock',
    'type',
  ];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupName = data.groupName;
  const description = data?.description || '';
  const type = +data.type;
  const approvalThreshold = +data?.approvalThreshold;
  const minBlock = +data?.minBlock;
  const maxBlock = +data.maxBlock;

  const fee = await getFee('CREATE_GROUP');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.create_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await createGroup({
      groupName,
      groupDescription: description,
      groupType: type,
      groupApprovalThreshold: approvalThreshold,
      minBlock,
      maxBlock,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const updateGroupRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = [
    'groupId',
    'newOwner',
    'type',
    'approvalThreshold',
    'minBlock',
    'maxBlock',
  ];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = +data.groupId;
  const newOwner = data.newOwner;
  const description = data?.description || '';
  const type = +data.type;
  const approvalThreshold = +data?.approvalThreshold;
  const minBlock = +data?.minBlock;
  const maxBlock = +data.maxBlock;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${nodePathSegment(groupId)}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(newOwner);

  const fee = await getFee('CREATE_GROUP');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.update_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:permission.update_group_detail', {
        owner: displayInvitee || newOwner,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await updateGroup({
      groupId,
      newOwner,
      newIsOpen: type,
      newDescription: description,
      newApprovalThreshold: approvalThreshold,
      newMinimumBlockDelay: minBlock,
      newMaximumBlockDelay: maxBlock,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const decryptAESGCMRequest = async (data, isFromExtension) => {
  const requiredFields = ['encryptedData', 'iv', 'senderPublicKey'];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });

  const encryptedData = data.encryptedData;
  const iv = data.iv;
  const senderPublicKeyBase58 = data.senderPublicKey;

  // Decode keys and IV
  const senderPublicKey = Base58.decode(senderPublicKeyBase58);
  const resKeyPair = await getKeyPair(); // Assume this retrieves the current user's keypair
  const uint8PrivateKey = Base58.decode(resKeyPair.privateKey);

  // Convert ed25519 keys to Curve25519
  const convertedPrivateKey = ed2curve.convertSecretKey(uint8PrivateKey);
  const convertedPublicKey = ed2curve.convertPublicKey(senderPublicKey);

  // Generate shared secret
  const sharedSecret = new Uint8Array(32);
  nacl.lowlevel.crypto_scalarmult(
    sharedSecret,
    convertedPrivateKey,
    convertedPublicKey
  );

  // Derive encryption key
  const encryptionKey: Uint8Array = new Sha256()
    .process(sharedSecret)
    .finish().result;

  // Convert IV and ciphertext from Base64
  const base64ToUint8Array = (base64) =>
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const ivUint8Array = base64ToUint8Array(iv);
  const ciphertext = base64ToUint8Array(encryptedData);
  // Validate IV and key lengths
  if (ivUint8Array.length !== 12) {
    throw new Error(
      i18n.t('question:message.error.invalid_encryption_iv', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (encryptionKey.length !== 32) {
    throw new Error(
      i18n.t('question:message.error.invalid_encryption_key', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  try {
    // Decrypt data
    const algorithm = { name: 'AES-GCM', iv: ivUint8Array };
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encryptionKey,
      algorithm,
      false,
      ['decrypt']
    );
    const decryptedArrayBuffer = await crypto.subtle.decrypt(
      algorithm,
      cryptoKey,
      ciphertext
    );

    // Return decrypted data as Base64
    return uint8ArrayToBase64(new Uint8Array(decryptedArrayBuffer));
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error(
      i18n.t('question:message.error.decrypt_message', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const sellNameRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['salePrice', 'nameForSale'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const name = data.nameForSale;
  const sellPrice = +data.salePrice;

  const validApi = await getBaseApi();

  const response = await fetch(validApi + '/names/' + name);
  const nameData = await response.json();
  if (!nameData)
    throw new Error(
      i18n.t('auth:message.error.name_not_existing', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  if (nameData?.isForSale)
    throw new Error(
      i18n.t('question:message.error.name_already_for_sale', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const fee = await getFee('SELL_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.sell_name_transaction', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t(
        'question:permission.sell_name_transaction_detail',
        {
          name: name,
          price: sellPrice,
          postProcess: 'capitalizeFirstChar',
        }
      ),
      fee: fee.fee,
      // The Q-App sets the price: a name listed too cheap can be bought at
      // once (GO-28).
      confirmCheckbox: true,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await sellName({
      name,
      sellPrice,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const cancelSellNameRequest = async (
  data,
  isFromExtension,
  appInfo?
) => {
  const requiredFields = ['nameForSale'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const name = data.nameForSale;
  const validApi = await getBaseApi();

  const response = await fetch(validApi + '/names/' + name);
  const nameData = await response.json();
  if (!nameData?.isForSale)
    throw new Error(
      i18n.t('question:message.error.name_not_for_sale', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const fee = await getFee('CANCEL_SELL_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.sell_name_cancel', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:name', {
        name: name,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await cancelSellName({
      name,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const buyNameRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['nameForSale'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const name = data.nameForSale;
  const validApi = await getBaseApi();
  const response = await fetch(validApi + '/names/' + name);
  const nameData = await response.json();

  if (!nameData?.isForSale)
    throw new Error(
      i18n.t('question:message.error.name_not_for_sale', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const sellerAddress = nameData.owner;
  const sellPrice = +nameData.salePrice;

  const fee = await getFee('BUY_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.buy_name', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:permission.buy_name_detail', {
        name: name,
        price: sellPrice,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
      confirmCheckbox: true,
    },
    isFromExtension,
    appInfo
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await buyName({
      name,
      sellerAddress,
      sellPrice,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const signForeignFees = async (data, appInfo, isFromExtension) => {
  let skip = false;
  let acceptedVar = false;
  if (
    !skip &&
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'SIGN_FOREIGN_FEES')
  ) {
    skip = true;
  }
  let resPermission;
  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.sign_fee', {
          postProcess: 'capitalizeFirstChar',
        }),
        // Signs data from the node with the account key (GO-28).
        confirmCheckbox: true,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    acceptedVar = accepted;
  }
  if (acceptedVar || skip) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    const unsignedFeesUrl = await createEndpoint(
      `/crosschain/unsignedfees/${address}`
    );

    const unsignedFeesResponse = await fetch(unsignedFeesUrl);

    const unsignedFees = await unsignedFeesResponse.json();

    const signedFees = [];

    unsignedFees.forEach((unsignedFee) => {
      const unsignedDataDecoded = Base58.decode(unsignedFee.data);

      const signature = nacl.sign.detached(
        unsignedDataDecoded,
        keyPair.privateKey
      );

      const signedFee = {
        timestamp: unsignedFee.timestamp,
        data: `${Base58.encode(signature)}`,
        atAddress: unsignedFee.atAddress,
        fee: unsignedFee.fee,
      };

      signedFees.push(signedFee);
    });

    const signedFeesUrl = await createEndpoint(`/crosschain/signedfees`);

    await fetch(signedFeesUrl, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
      body: `${JSON.stringify(signedFees)}`,
    });

    return true;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};
export const multiPaymentWithPrivateData = async (
  data,
  isFromExtension,
  appInfo?
) => {
  const requiredFields = ['payments', 'assetId'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const privateKey = parsedData.privateKey;
  const userPublicKey = parsedData.publicKey;
  const { fee: paymentFee } = await getFee('TRANSFER_ASSET');
  const { fee: arbitraryFee } = await getFee('ARBITRARY');

  let name = null;
  const payments = data.payments;
  // The signer writes the id as an int64; text such as "abc" would become 0,
  // which is QORT.
  if (!isAssetId(data.assetId)) {
    throw new Error(
      i18n.t('question:message.error.invalid_asset_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const assetId = Number(data.assetId);
  const pendingTransactions = [];
  const pendingAdditionalArbitraryTxs = [];
  const additionalArbitraryTxsWithoutPayment =
    data?.additionalArbitraryTxsWithoutPayment || [];
  let totalAtomic = BigInt(0);
  let fee = 0;
  for (const payment of payments) {
    const paymentRefId = uid.rnd();
    const requiredFieldsPayment = ['recipient', 'amount'];

    for (const field of requiredFieldsPayment) {
      if (!payment[field]) {
        throw new Error(
          i18n.t('question:message.error.missing_fields', {
            fields: field,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    }

    // Resolved before the dialog; the dialog shows name and address, and the
    // transfer goes to this address.
    const resolvedRecipient = await resolveRecipient(payment.recipient);
    const confirmReceiver = resolvedRecipient.address;
    // Checked against the address (GO-30): the resource below is encrypted
    // to this key.
    const receiverPublicKey = await getPublicKey(confirmReceiver);

    const parsedAmount = parseDecimalAmount(payment.amount);
    const amount = parsedAmount.value;

    pendingTransactions.push({
      type: 'PAYMENT',
      recipientAddress: confirmReceiver,
      recipientLabel: recipientDisplayLabel(resolvedRecipient),
      amount: amount,
      amountText: parsedAmount.text,
      paymentRefId,
    });

    fee = fee + +paymentFee;
    totalAtomic = totalAtomic + parsedAmount.atomic;

    if (payment.arbitraryTxs && payment.arbitraryTxs.length > 0) {
      for (const arbitraryTx of payment.arbitraryTxs) {
        const requiredFieldsArbitraryTx = ['service', 'identifier', 'base64'];

        for (const field of requiredFieldsArbitraryTx) {
          if (!arbitraryTx[field]) {
            throw new Error(
              i18n.t('question:message.error.missing_fields', {
                fields: field,
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
        }

        if (!name) {
          const getName = await getNameInfo();
          if (!getName)
            throw new Error(
              i18n.t('question:message.error.registered_name', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          name = getName;
        }

        const isValid = isValidBase64WithDecode(arbitraryTx.base64);
        if (!isValid)
          throw new Error(
            i18n.t('core:message.error.invalid_base64', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        if (!arbitraryTx?.service?.includes('_PRIVATE'))
          throw new Error(
            i18n.t('question:message.generic.private_service', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        const additionalPublicKeys = arbitraryTx?.additionalPublicKeys || [];
        pendingTransactions.push({
          type: 'ARBITRARY',
          identifier: arbitraryTx.identifier,
          service: arbitraryTx.service,
          base64: arbitraryTx.base64,
          description: arbitraryTx?.description || '',
          paymentRefId,
          publicKeys: [receiverPublicKey, ...additionalPublicKeys],
        });

        fee = fee + +arbitraryFee;
      }
    }
  }

  if (
    additionalArbitraryTxsWithoutPayment &&
    additionalArbitraryTxsWithoutPayment.length > 0
  ) {
    for (const arbitraryTx of additionalArbitraryTxsWithoutPayment) {
      const requiredFieldsArbitraryTx = ['service', 'identifier', 'base64'];

      for (const field of requiredFieldsArbitraryTx) {
        if (!arbitraryTx[field]) {
          throw new Error(
            i18n.t('question:message.error.missing_fields', {
              fields: field,
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
      }

      if (!name) {
        const getName = await getNameInfo();
        if (!getName)
          throw new Error(
            i18n.t('question:message.error.registered_name', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        name = getName;
      }

      const isValid = isValidBase64WithDecode(arbitraryTx.base64);
      if (!isValid)
        throw new Error(
          i18n.t('core:message.error.invalid_base64', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (!arbitraryTx?.service?.includes('_PRIVATE'))
        throw new Error(
          i18n.t('question:message.generic.private_service', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const additionalPublicKeys = arbitraryTx?.additionalPublicKeys || [];
      pendingAdditionalArbitraryTxs.push({
        type: 'ARBITRARY',
        identifier: arbitraryTx.identifier,
        service: arbitraryTx.service,
        base64: arbitraryTx.base64,
        description: arbitraryTx?.description || '',
        publicKeys: additionalPublicKeys,
      });

      fee = fee + +arbitraryFee;
    }
  }

  if (!name)
    throw new Error(
      i18n.t('question:message.error.registered_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const balance = await getBalanceInfo();

  if (+balance < fee)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance_qort', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const totalAmountText = formatAtomicAmount(totalAtomic);
  const totalAmount = Number(totalAmountText);
  const assetBalance = await getAssetBalanceInfo(assetId);
  const assetInfo = await getAssetInfo(assetId);
  if (assetBalance < totalAmount)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.pay_publish', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:assets_used_pay', {
        asset: assetInfo.name,
        postProcess: 'capitalizeFirstChar',
      }),
      details: {
        type: 'paymentsAndResources',
        payments: pendingTransactions
          .filter((item) => item.type === 'PAYMENT')
          .map((payment) => ({
            // Display only: "name (address)" or the address.
            recipientAddress: payment.recipientLabel,
            amount: payment.amountText,
          })),
        resources: [...pendingTransactions, ...pendingAdditionalArbitraryTxs]
          .filter((item) => item.type === 'ARBITRARY')
          .map((arbitraryTx) => ({
            service: arbitraryTx.service,
            name,
            identifier: arbitraryTx.identifier,
          })),
      },
      highlightedText: i18n.t('question:total_amount', {
        amount: totalAmountText,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee,
      confirmCheckbox: true,
    },
    isFromExtension,
    appInfo
  );

  const { accepted, checkbox1 = false } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  // const failedTxs = []
  const paymentsDone = {};

  const transactionsDone = [];
  const paymentCount = pendingTransactions.filter(
    (item) => item.type === 'PAYMENT'
  ).length;
  let paymentsSent = 0;

  for (const transaction of pendingTransactions) {
    const type = transaction.type;

    if (type === 'PAYMENT') {
      let makePayment;
      try {
        // Each approved transfer is signed once. transferAsset resends the
        // same signed bytes after a failure and never signs a second copy, so
        // there is no retryTransaction here (that rebuilt and re-signed the
        // transfer, which could pay the recipient again).
        makePayment = await transferAsset({
          amount: transaction.amount,
          assetId,
          recipient: transaction.recipientAddress,
          approvedFee: paymentFee,
        });
      } catch (error) {
        if (paymentsSent === 0) throw error;
        throw new Error(
          i18n.t('question:message.error.payments_partially_sent', {
            sent: paymentsSent,
            total: paymentCount,
            error: error?.message || '',
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      paymentsSent += 1;
      if (makePayment) {
        transactionsDone.push(makePayment?.signature);
        if (transaction.paymentRefId) {
          paymentsDone[transaction.paymentRefId] = makePayment;
        }
      }
    } else if (type === 'ARBITRARY' && paymentsDone[transaction.paymentRefId]) {
      const objectToEncrypt = {
        data: transaction.base64,
        payment: paymentsDone[transaction.paymentRefId],
      };

      const toBase64 = await retryTransaction(
        objectToBase64,
        [objectToEncrypt],
        true
      );

      if (!toBase64) continue; // Skip if encryption fails

      const encryptDataResponse = await retryTransaction(
        encryptDataGroup,
        [
          {
            data64: toBase64,
            publicKeys: transaction.publicKeys,
            privateKey,
            userPublicKey,
          },
        ],
        true
      );

      if (!encryptDataResponse) continue; // Skip if encryption fails

      const resPublish = await retryTransaction(
        publishData,
        [
          {
            registeredName: encodeURIComponent(name),
            file: encryptDataResponse,
            service: transaction.service,
            identifier: encodeURIComponent(transaction.identifier),
            uploadType: 'file',
            description: transaction?.description,
            isBase64: true,
            apiVersion: 2,
            withFee: true,
          },
        ],
        true
      );

      if (resPublish?.signature) {
        transactionsDone.push(resPublish?.signature);
      }
    }
  }

  for (const transaction of pendingAdditionalArbitraryTxs) {
    const objectToEncrypt = {
      data: transaction.base64,
    };

    const toBase64 = await retryTransaction(
      objectToBase64,
      [objectToEncrypt],
      true
    );

    if (!toBase64) continue; // Skip if encryption fails

    const encryptDataResponse = await retryTransaction(
      encryptDataGroup,
      [
        {
          data64: toBase64,
          publicKeys: transaction.publicKeys,
          privateKey,
          userPublicKey,
        },
      ],
      true
    );

    if (!encryptDataResponse) continue; // Skip if encryption fails

    const resPublish = await retryTransaction(
      publishData,
      [
        {
          registeredName: encodeURIComponent(name),
          data: encryptDataResponse,
          service: transaction.service,
          identifier: encodeURIComponent(transaction.identifier),
          uploadType: 'base64',
          description: transaction?.description,
          apiVersion: 2,
          withFee: true,
        },
      ],
      true
    );

    if (resPublish?.signature) {
      transactionsDone.push(resPublish?.signature);
    }
  }

  return transactionsDone;
};

export const transferAssetRequest = async (data, isFromExtension, appInfo?) => {
  const requiredFields = ['amount', 'assetId', 'recipient'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });
  // Plain decimals only; the dialog shows the normalised amount that is signed.
  const parsedAmount = parseDecimalAmount(data.amount);
  const amount = parsedAmount.value;
  // The signer writes the id as an int64; text such as "abc" would become 0,
  // which is QORT.
  if (!isAssetId(data.assetId)) {
    throw new Error(
      i18n.t('question:message.error.invalid_asset_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const assetId = Number(data.assetId);
  const recipient = data.recipient;

  const { fee } = await getFee('TRANSFER_ASSET');
  const balance = await getBalanceInfo();

  if (+balance < +fee)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance_qort', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const assetBalance = await getAssetBalanceInfo(assetId);
  if (assetBalance < amount)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  // Resolved before the dialog, shown as name and full address, and paid to
  // that address without a second lookup.
  const resolvedRecipient = await resolveRecipient(recipient);
  const assetInfo = await getAssetInfo(assetId);
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.transfer_asset', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:asset_name_id', {
        asset: assetInfo?.name,
        id: String(assetId),
        postProcess: 'capitalizeFirstChar',
      }),
      text3: i18n.t('question:to_recipient', {
        recipient: recipientDisplayLabel(resolvedRecipient),
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:amount_qty', {
        quantity: parsedAmount.text,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee,
      confirmCheckbox: true,
    },
    isFromExtension,
    appInfo
  );

  const { accepted } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const res = await transferAsset({
    amount,
    recipient: resolvedRecipient.address,
    assetId,
    approvedFee: fee,
  });
  return res;
};

/** A Core asset id: a non-negative safe integer, as a number or digit string. */
function isAssetId(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0;
  }
  return (
    typeof value === 'string' &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

// Track last re-encryption timestamp per groupId
const lastReEncryptionTime = new Map<number, number>();
const RE_ENCRYPTION_COOLDOWN_MS = 150000; // 2.5 minutes in milliseconds

// Track which mediaIds belong to which tabId for automatic cleanup
const mediaIdsByTabId = new Map<string, Set<string>>();

export const reEncryptQortalKeys = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['groupId'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });

  // Check if re-encryption was done recently for this groupId
  const groupId = data.groupId;
  const lastTime = lastReEncryptionTime.get(groupId);
  const currentTime = Date.now();

  if (lastTime && currentTime - lastTime < RE_ENCRYPTION_COOLDOWN_MS) {
    const remainingTime = Math.ceil(
      (RE_ENCRYPTION_COOLDOWN_MS - (currentTime - lastTime)) / 1000
    );
    throw new Error(
      `Re-encryption cooldown in effect. Please wait ${remainingTime} seconds before re-encrypting keys for this group again.`
    );
  }

  const urlGroupInfo = await createEndpoint(
    `/groups/${nodePathSegment(data?.groupId)}`
  );
  const response = await fetch(urlGroupInfo);
  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.fetch_group', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const groupInfo = await response.json();
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  if (groupInfo?.owner !== address) {
    throw new Error('Only the group owner can perform this request');
  }
  let skip = false;
  let acceptedVar = false;
  if (
    !skip &&
    appInfo?.tabId &&
    appInfo?.name &&
    hasSessionPermission(appInfo.tabId, appInfo.name, 'REENCRYPT_GROUP_KEYS')
  ) {
    skip = true;
  }
  let resPermission;
  if (!skip) {
    const groupName = groupInfo?.groupName;
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.reencrypt_keys', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `Group: ${groupName}`,
      },
      isFromExtension,
      appInfo
    );
    const { accepted } = resPermission;

    acceptedVar = accepted;
  }
  if (acceptedVar || skip) {
    const groupId = data.groupId;
    const addKey = data?.addKey || false;

    const { names } = await getGroupAdmins(groupId);

    const publish = await getPublishesFromAdmins(names, groupId);
    if (publish === false) {
      // create new key

      await encryptAndPublishSymmetricKeyGroupChat({
        groupId,
        previousData: null,
        addKey: true,
      });

      sendChatGroup({
        groupId,
        typeMessage: undefined,
        chatReference: undefined,
        messageText: PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY,
      });

      // Update last re-encryption timestamp
      lastReEncryptionTime.set(groupId, Date.now());
      return true;
    }

    const url = await createEndpoint(
      `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
        publish.identifier
      }?encoding=base64&rebuild=true`
    );

    const resData = await fetchGroupKeyPublish(url);

    const decryptedKey: any = await decryptResource(resData, true);

    const dataint8Array = base64ToUint8Array(decryptedKey.data);
    const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
    if (!validateSecretKey(decryptedKeyToObject))
      throw new Error(
        i18n.t('auth:message.error.invalid_secret_key', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    const { data: responseData, numberOfMembers } =
      await encryptAndPublishSymmetricKeyGroupChat({
        groupId,
        previousData: decryptedKeyToObject,
        addKey: addKey,
      });

    sendChatNotification(
      responseData,
      groupId,
      decryptedKeyToObject,
      numberOfMembers
    );

    // Update last re-encryption timestamp
    lastReEncryptionTime.set(groupId, Date.now());
    return true;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const playEncryptedMedia = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['mediaId', 'key', 'iv', 'location'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });

  // Validate location object structure
  if (
    !data.location.service ||
    !data.location.name ||
    !data.location.identifier
  ) {
    throw new Error('Location must include service, name, and identifier');
  }

  // Construct resourceUrl from location object
  const resourceUrl = await createEndpoint(
    `/arbitrary/${encodeQdnPathSegment(
      `${data.location.service}`
    )}/${encodeQdnPathSegment(
      `${data.location.name}`
    )}/${encodeQdnPathSegment(`${data.location.identifier}`)}`
  );

  // Check if we're in Electron
  if (!window?.videoServer) {
    throw new Error(
      'Media server is not available. This feature only works in Electron.'
    );
  }

  // Helper to convert base64 to Uint8Array (browser-compatible)
  const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  // Validate key and iv lengths
  const keyBuffer = base64ToUint8Array(data.key);
  const ivBuffer = base64ToUint8Array(data.iv);

  if (keyBuffer.length !== 32) {
    throw new Error('Key must be 32 bytes');
  }
  if (ivBuffer.length !== 16) {
    throw new Error('IV must be 16 bytes');
  }

  // Get totalSize - either from data or fetch via HEAD request
  let totalSize = data.totalSize;
  if (!totalSize) {
    try {
      const headResponse = await fetch(resourceUrl, { method: 'HEAD' });
      const contentLength = headResponse.headers.get('content-length');
      if (contentLength) {
        totalSize = parseInt(contentLength, 10);
        console.log(
          `[playEncryptedMedia] Auto-detected totalSize: ${totalSize}`
        );
      } else {
        throw new Error(
          'Could not determine file size. Please provide totalSize parameter.'
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to fetch file size: ${error.message}. Please provide totalSize parameter manually.`
      );
    }
  }

  // No permission required - play media directly
  try {
    // Start media server if not running
    const isRunning = await window.videoServer.isRunning();
    let serverPort: number;

    if (!isRunning) {
      const startResult = await window.videoServer.start();
      if (!startResult.success) {
        throw new Error(`Failed to start media server: ${startResult.error}`);
      }
      serverPort = startResult.port!;
    } else {
      const port = await window.videoServer.getPort();
      if (!port) {
        throw new Error('Media server is running but port is unknown');
      }
      serverPort = port;
    }

    // Register media with server
    const registerUrl = `http://127.0.0.1:${serverPort}/api/video/register`;
    const registerResponse = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: data.mediaId,
        key: Array.from(keyBuffer),
        iv: Array.from(ivBuffer),
        resourceUrl: resourceUrl,
        totalSize: totalSize,
        mimeType: data.mimeType || 'video/mp4',
      }),
    });

    if (!registerResponse.ok) {
      const error = await registerResponse.json();
      throw new Error(`Failed to register media: ${error.error}`);
    }

    const registerResult = await registerResponse.json();

    // Return stream URL
    const streamUrl = `http://127.0.0.1:${serverPort}/api/video/${data.mediaId}/stream`;

    // Track this mediaId by tabId for automatic cleanup
    if (appInfo?.tabId) {
      if (!mediaIdsByTabId.has(appInfo.tabId)) {
        mediaIdsByTabId.set(appInfo.tabId, new Set());
      }
      mediaIdsByTabId.get(appInfo.tabId)!.add(data.mediaId);
      console.log(
        `[playEncryptedMedia] Tracking mediaId ${data.mediaId} for tabId ${appInfo.tabId}`
      );
    }

    return {
      success: true,
      mediaId: registerResult.videoId,
      streamUrl: streamUrl,
      serverPort: serverPort,
    };
  } catch (error) {
    console.error('[playEncryptedMedia] Error:', error);
    throw error;
  }
};

export const cleanupEncryptedMedia = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['mediaId'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });

  // Check if we're in Electron
  if (!window?.videoServer) {
    throw new Error(
      'Media server is not available. This feature only works in Electron.'
    );
  }

  try {
    const isRunning = await window.videoServer.isRunning();
    if (!isRunning) {
      return { success: true, message: 'Media server not running' };
    }

    const serverPort = await window.videoServer.getPort();
    if (!serverPort) {
      return { success: true, message: 'Media server port unknown' };
    }

    const deleteUrl = `http://127.0.0.1:${serverPort}/api/video/${data.mediaId}`;
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
    });

    if (!deleteResponse.ok) {
      const error = await deleteResponse.json();
      throw new Error(`Failed to cleanup media: ${error.error}`);
    }

    // Remove from tracking
    if (appInfo?.tabId && mediaIdsByTabId.has(appInfo.tabId)) {
      mediaIdsByTabId.get(appInfo.tabId)!.delete(data.mediaId);
      if (mediaIdsByTabId.get(appInfo.tabId)!.size === 0) {
        mediaIdsByTabId.delete(appInfo.tabId);
      }
    }

    const result = await deleteResponse.json();
    return {
      success: true,
      existed: result.existed,
    };
  } catch (error) {
    console.error('[cleanupEncryptedMedia] Error:', error);
    throw error;
  }
};

// Cleanup all media for a specific tabId (called when tab closes)
export const cleanupEncryptedMediaByTabId = async (tabId: string) => {
  const mediaIds = mediaIdsByTabId.get(tabId);
  if (!mediaIds || mediaIds.size === 0) {
    return { success: true, cleanedCount: 0 };
  }

  console.log(
    `[cleanupEncryptedMediaByTabId] Cleaning up ${mediaIds.size} media items for tabId ${tabId}`
  );

  // Check if we're in Electron
  if (!window?.videoServer) {
    console.warn('[cleanupEncryptedMediaByTabId] Video server not available');
    mediaIdsByTabId.delete(tabId);
    return { success: true, cleanedCount: 0 };
  }

  try {
    const isRunning = await window.videoServer.isRunning();
    if (!isRunning) {
      mediaIdsByTabId.delete(tabId);
      return {
        success: true,
        cleanedCount: 0,
        message: 'Media server not running',
      };
    }

    const serverPort = await window.videoServer.getPort();
    if (!serverPort) {
      mediaIdsByTabId.delete(tabId);
      return {
        success: true,
        cleanedCount: 0,
        message: 'Media server port unknown',
      };
    }

    let cleanedCount = 0;
    const mediaIdsArray = Array.from(mediaIds);

    // Cleanup each media
    for (const mediaId of mediaIdsArray) {
      try {
        const deleteUrl = `http://127.0.0.1:${serverPort}/api/video/${mediaId}`;
        const deleteResponse = await fetch(deleteUrl, {
          method: 'DELETE',
        });

        if (deleteResponse.ok) {
          cleanedCount++;
          console.log(
            `[cleanupEncryptedMediaByTabId] Cleaned up mediaId: ${mediaId}`
          );
        }
      } catch (error) {
        console.error(
          `[cleanupEncryptedMediaByTabId] Error cleaning mediaId ${mediaId}:`,
          error
        );
      }
    }

    // Remove all tracking for this tab
    mediaIdsByTabId.delete(tabId);

    return {
      success: true,
      cleanedCount: cleanedCount,
      totalAttempted: mediaIdsArray.length,
    };
  } catch (error) {
    console.error('[cleanupEncryptedMediaByTabId] Error:', error);
    // Still remove tracking even if cleanup failed
    mediaIdsByTabId.delete(tabId);
    return { success: false, error: error.message };
  }
};
