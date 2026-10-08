import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from 'i18next';
import { executeEvent } from '../utils/events';
import {
  infoSnackGlobalAtom,
  navigationControllerAtom,
  openSnackGlobalAtom,
} from '../atoms/global';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { saveFile } from '../qortal/get';
import { mimeToExtensionMap } from '../utils/memeTypes';
import FileSaver from 'file-saver';
import { isCapacitor } from '../utils/platform';
import {
  describeMobileSave,
  isSilentSaveFile,
  mobileSaveLocationLabelFor,
  saveBlobToMobileDocuments,
} from '../utils/mobileFileSave';
import { openSavedFileActions } from '../components/Mobile/SavedFileActionsSheet';
import { isAndroidPackageFile } from '../utils/androidPackageFiles';
import {
  beginQdnSaveNotification,
  cancelQdnSaveNotification,
  claimQappFetchForSave,
  continueQdnSaveNotification,
  declineQdnSave,
  failQdnSaveNotification,
  finishQdnSaveNotification,
  reportQdnTransferProgress,
} from '../utils/qdnDownloadNotifications';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { qappFullScreenTabAtom } from '../components/Mobile/mobileQappFrame';
import { BACK_PRIORITY, useAndroidBack } from '../utils/androidBack';
import {
  QORTAL_PROTOCOL,
  TIME_HOURS_1_IN_MILLISECONDS,
  TIME_MINUTES_30_IN_MILLISECONDS,
  TIME_SECONDS_30_IN_MILLISECONDS,
} from '../constants/constants';
import { buildQortalResourceLink } from '../utils/qortalLink';
import { isSafeQappPath, pickQappTabTarget } from '../utils/qappPath';

/** Below this a save is over before a notification would be read. */
const NOTIFY_SAVE_MIN_BYTES = 4 * 1024 * 1024;

export const saveFileInChunks = async (
  blob: Blob,
  fileName: string,
  chunkSize = 1024 * 1024
) => {
  try {
    let offset = 0;
    let isFirstChunk = true;

    // Extract the MIME type from the blob
    const mimeType = blob.type || 'application/octet-stream';

    // Create the dynamic base64 prefix
    const base64Prefix = `data:${mimeType};base64,`;

    // Function to extract extension from fileName
    const getExtensionFromFileName = (name: string): string => {
      const lastDotIndex = name.lastIndexOf('.');
      if (lastDotIndex !== -1) {
        return name.substring(lastDotIndex); // includes the dot
      }
      return '';
    };

    // Extract existing extension from fileName
    const existingExtension = getExtensionFromFileName(fileName);

    // Remove existing extension from fileName to avoid duplication
    if (existingExtension) {
      fileName = fileName.substring(0, fileName.lastIndexOf('.'));
    }

    // Map MIME type to file extension
    const mimeTypeToExtension = (mimeType: string): string => {
      return mimeToExtensionMap[mimeType] || existingExtension || ''; // Use existing extension if MIME type not found
    };

    // Determine the final extension to use
    const extension = mimeTypeToExtension(mimeType);

    // Construct the full file name with timestamp and extension
    const fullFileName = `${fileName}_${Date.now()}${extension}`;

    // Read the blob in chunks
    while (offset < blob.size) {
      // Extract the current chunk
      const chunk = blob.slice(offset, offset + chunkSize);

      // Convert the chunk to Base64
      const base64Chunk = await blobToBase64(chunk);

      // Write the chunk to the file with the prefix added on the first chunk
      await Filesystem.writeFile({
        path: fullFileName,
        data: isFirstChunk ? base64Prefix + base64Chunk : base64Chunk,
        directory: Directory.Documents,
        recursive: true,
        append: !isFirstChunk, // Append after the first chunk
      });

      // Update offset and flag
      offset += chunkSize;
      isFirstChunk = false;
    }
  } catch (error) {
    console.error('Error saving file in chunks:', error);
  }
};

// Helper function to convert a Blob to a Base64 string
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result?.toString().split(',')[1];
      resolve(base64data || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

class Semaphore {
  constructor(count) {
    this.count = count;
    this.waiting = [];
  }
  acquire() {
    return new Promise((resolve) => {
      if (this.count > 0) {
        this.count--;
        resolve();
      } else {
        this.waiting.push(resolve);
      }
    });
  }
  release() {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve();
    } else {
      this.count++;
    }
  }
}
const semaphore = new Semaphore(1);
let reader = new FileReader();

const fileToBase64 = (file) =>
  // eslint-disable-next-line no-async-promise-executor -- waits for the shared FileReader first
  new Promise(async (resolve, reject) => {
    if (!reader) {
      reader = new FileReader();
    }
    await semaphore.acquire();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string') {
        const base64String = dataUrl.split(',')[1];
        reader.onload = null;
        reader.onerror = null;
        resolve(base64String);
      } else {
        reader.onload = null;
        reader.onerror = null;
        reject(new Error('Invalid data URL'));
      }
      semaphore.release();
    };
    reader.onerror = (error) => {
      reader.onload = null;
      reader.onerror = null;
      reject(error);
      semaphore.release();
    };
  });

export function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fileStorageDB', 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function () {
      reject('Error opening IndexedDB');
    };
  });
}

export const listOfAllQortalRequests = [
  'ADD_FOREIGN_SERVER',
  'ADD_GROUP_ADMIN',
  'ADD_LIST_ITEMS',
  'ADMIN_ACTION',
  'BAN_FROM_GROUP',
  'BUY_NAME',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'CANCEL_SELL_NAME',
  'CANCEL_TRADE_SELL_ORDER',
  'CREATE_AND_COPY_EMBED_LINK',
  'CREATE_GROUP',
  'CREATE_POLL',
  'CREATE_TRADE_BUY_ORDER',
  'CREATE_TRADE_SELL_ORDER',
  'DECRYPT_AESGCM',
  'DECRYPT_DATA_WITH_SHARING_KEY',
  'DECRYPT_DATA',
  'DECRYPT_QORTAL_GROUP_DATA',
  'DELETE_HOSTED_DATA',
  'DELETE_LIST_ITEM',
  'DEPLOY_AT',
  'ENCRYPT_DATA_WITH_SHARING_KEY',
  'ENCRYPT_DATA',
  'ENCRYPT_QORTAL_GROUP_DATA',
  'FETCH_BLOCK_RANGE',
  'FETCH_BLOCK',
  'FETCH_QDN_RESOURCE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_NAMES',
  'GET_ARRR_SYNC_STATUS',
  'GET_AT_DATA',
  'GET_AT',
  'GET_BALANCE',
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_DAY_SUMMARY',
  'GET_FOREIGN_FEE',
  'GET_HOSTED_DATA',
  'GET_LIST_ITEMS',
  'GET_NAME_DATA',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_PRICE',
  'GET_PRIMARY_NAME',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'GET_SERVER_CONNECTION_HISTORY',
  'GET_TX_ACTIVITY_SUMMARY',
  'GET_USER_ACCOUNT',
  'GET_USER_WALLET_INFO',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'INVITE_TO_GROUP',
  'IS_USING_PUBLIC_NODE',
  'JOIN_GROUP',
  'KICK_FROM_GROUP',
  'LEAVE_GROUP',
  'LINK_TO_QDN_RESOURCE',
  'LIST_ATS',
  'LIST_GROUPS',
  'LIST_QDN_RESOURCES',
  'LOCK_TAB',
  'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA',
  'NOTIFICATION_ADD',
  'NOTIFICATION_GET',
  'NOTIFICATION_HAS_PERMISSION',
  'NOTIFICATION_MARK_SEEN',
  'NOTIFICATION_PERMISSION',
  'NOTIFICATION_REMOVE',
  'OPEN_NEW_TAB',
  'OPEN_USER_LOOKUP',
  'PLAY_ENCRYPTED_MEDIA',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'PUBLISH_QDN_RESOURCE',
  'REENCRYPT_GROUP_KEYS',
  'REGISTER_NAME',
  'REMOVE_FOREIGN_SERVER',
  'REMOVE_GROUP_ADMIN',
  'SAVE_FILE',
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_NAMES',
  'SEARCH_QDN_RESOURCES',
  'SEARCH_TRANSACTIONS',
  'SELL_NAME',
  'SEND_CHAT_MESSAGE',
  'SEND_COIN',
  'SESSION_PERMISSIONS',
  'SET_CURRENT_FOREIGN_SERVER',
  'SHOW_ACTIONS',
  'SHOW_PDF_READER',
  'SIGN_FOREIGN_FEES',
  'SIGN_TRANSACTION',
  'START_CROSSCHAIN_SERVER',
  'TRANSFER_ASSET',
  'UNLOCK_TAB',
  'UPDATE_FOREIGN_FEE',
  'UPDATE_GROUP',
  'UPDATE_NAME',
  'UPDATE_SUBSCRIPTIONS',
  'VOTE_ON_POLL',
  'WHICH_UI',
];

export const UIQortalRequests = [
  'ADD_FOREIGN_SERVER',
  'ADD_GROUP_ADMIN',
  'ADD_LIST_ITEMS',
  'ADMIN_ACTION',
  'BAN_FROM_GROUP',
  'BUY_NAME',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'CANCEL_SELL_NAME',
  'CANCEL_TRADE_SELL_ORDER',
  'CREATE_AND_COPY_EMBED_LINK',
  'CREATE_GROUP',
  'CREATE_POLL',
  'CREATE_TRADE_BUY_ORDER',
  'CREATE_TRADE_SELL_ORDER',
  'DECRYPT_AESGCM',
  'DECRYPT_DATA_WITH_SHARING_KEY',
  'DECRYPT_DATA',
  'DECRYPT_QORTAL_GROUP_DATA',
  'DELETE_HOSTED_DATA',
  'DELETE_LIST_ITEM',
  'DEPLOY_AT',
  'GET_ARRR_SYNC_STATUS',
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_DAY_SUMMARY',
  'GET_FOREIGN_FEE',
  'GET_HOSTED_DATA',
  'GET_LIST_ITEMS',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_PRIMARY_NAME',
  'GET_SERVER_CONNECTION_HISTORY',
  'GET_TX_ACTIVITY_SUMMARY',
  'GET_USER_ACCOUNT',
  'GET_USER_WALLET_INFO',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'INVITE_TO_GROUP',
  'IS_USING_PUBLIC_NODE',
  'JOIN_GROUP',
  'KICK_FROM_GROUP',
  'LEAVE_GROUP',
  'LOCK_TAB',
  'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA',
  'NOTIFICATION_ADD',
  'NOTIFICATION_GET',
  'NOTIFICATION_HAS_PERMISSION',
  'NOTIFICATION_MARK_SEEN',
  'NOTIFICATION_PERMISSION',
  'NOTIFICATION_REMOVE',
  'OPEN_NEW_TAB',
  'OPEN_USER_LOOKUP',
  'PLAY_ENCRYPTED_MEDIA',
  'REENCRYPT_GROUP_KEYS',
  'REGISTER_NAME',
  'REMOVE_FOREIGN_SERVER',
  'REMOVE_GROUP_ADMIN',
  'SELL_NAME',
  'SEND_CHAT_MESSAGE',
  'SEND_COIN',
  'SESSION_PERMISSIONS',
  'SET_CURRENT_FOREIGN_SERVER',
  'SHOW_ACTIONS',
  'SHOW_PDF_READER',
  'SIGN_FOREIGN_FEES',
  'SIGN_TRANSACTION',
  'START_CROSSCHAIN_SERVER',
  'TRANSFER_ASSET',
  'UNLOCK_TAB',
  'UPDATE_FOREIGN_FEE',
  'UPDATE_GROUP',
  'UPDATE_NAME',
  'UPDATE_SUBSCRIPTIONS',
  'VOTE_ON_POLL',
  'WHICH_UI',
];

async function retrieveFileFromIndexedDB(fileId) {
  const db = await openIndexedDB();
  const transaction = db.transaction(['files'], 'readwrite');
  const objectStore = transaction.objectStore('files');

  return new Promise((resolve, reject) => {
    const getRequest = objectStore.get(fileId);

    getRequest.onsuccess = function (event) {
      if (getRequest.result) {
        // File found, resolve it and delete from IndexedDB
        const file = getRequest.result.data;
        objectStore.delete(fileId);
        resolve(file);
      } else {
        reject('File not found in IndexedDB');
      }
    };

    getRequest.onerror = function () {
      reject('Error retrieving file from IndexedDB');
    };
  });
}

async function deleteQortalFilesFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['files'], 'readwrite');
    const objectStore = transaction.objectStore('files');

    // Create a request to get all keys
    const getAllKeysRequest = objectStore.getAllKeys();

    getAllKeysRequest.onsuccess = function (event) {
      const keys = event.target.result;

      // Iterate through keys to find and delete those containing '_qortalfile'
      for (const key of keys) {
        if (key.includes('_qortalfile')) {
          const deleteRequest = objectStore.delete(key);

          deleteRequest.onsuccess = function () {
            console.log(
              `File with key '${key}' has been deleted from IndexedDB`
            );
          };

          deleteRequest.onerror = function () {
            console.error(
              `Failed to delete file with key '${key}' from IndexedDB`
            );
          };
        }
      }
    };

    getAllKeysRequest.onerror = function () {
      console.error('Failed to retrieve keys from IndexedDB');
    };

    transaction.oncomplete = function () {
      console.log('Transaction complete for deleting files from IndexedDB');
    };

    transaction.onerror = function () {
      console.error('Error occurred during transaction for deleting files');
    };
  } catch (error) {
    console.error('Error opening IndexedDB:', error);
  }
}

export const showSaveFilePicker = async (
  data,
  { openSnackGlobal, setOpenSnackGlobal, infoSnackCustom, setInfoSnackCustom }
) => {
  try {
    const { filename, mimeType, blob, fileHandleOptions, transferId } = data;
    const silent = isSilentSaveFile(filename);

    if (isCapacitor()) {
      // FileSaver's anchor-tag download does nothing inside the Capacitor
      // WebView — write to Documents/Qortal Go via the native plugin instead.
      //
      // A big file takes long enough that the screen it was started from is
      // usually gone by the time it lands, so the wait goes to the progress
      // card and the tray. A Q-App download already on the card (the app
      // fetched the file itself first) carries straight on into the save.
      const notificationId = transferId || `qdn-save:${filename}:${Date.now()}`;
      const announce =
        !silent &&
        (transferId
          ? continueQdnSaveNotification(transferId, filename)
          : blob?.size > NOTIFY_SAVE_MIN_BYTES &&
            beginQdnSaveNotification(notificationId, filename, {
              stage: 'saving',
            }));
      if (!silent && !announce) {
        setInfoSnackCustom({
          type: 'info',
          message: i18n.t('core:file_transfer.saving_file'),
        });
        setOpenSnackGlobal(true);
      }
      let saved: { path: string; uri: string };
      try {
        saved = await saveBlobToMobileDocuments(
          filename,
          blob,
          announce
            ? (written, total) =>
                reportQdnTransferProgress(notificationId, written, total)
            : undefined
        );
      } catch (error: any) {
        if (announce) failQdnSaveNotification(notificationId, error?.message);
        throw error;
      }
      if (announce) {
        // The card says where it went and offers to open it. A package type
        // from either source wins, so a Q-App that declares octet-stream for
        // a package-typed blob still gets no Open.
        const savedType = isAndroidPackageFile(null, blob?.type)
          ? blob.type
          : mimeType || blob?.type;
        finishQdnSaveNotification(
          notificationId,
          mobileSaveLocationLabelFor(filename, savedType),
          { uri: saved?.uri, mimeType: savedType, sizeBytes: blob?.size }
        );
        return;
      }
      if (silent) return;
      const savedName = describeMobileSave(
        saved,
        filename,
        mimeType || blob?.type
      );
      setInfoSnackCustom({
        type: 'success',
        message: i18n.t('core:file_transfer.saved_to', {
          location: savedName.folder,
        }),
        // Tapping the popup offers to open the file in another app or share it.
        duration: 7000,
        tapHint: i18n.t('core:file_transfer.tap_to_open_or_share'),
        onTap: () =>
          openSavedFileActions({
            fileName: savedName.name,
            folder: savedName.folder,
            uri: saved?.uri,
            mimeType: mimeType || blob?.type,
            blob,
          }),
      });
      setOpenSnackGlobal(true);
      return;
    }

    if (!silent) {
      setInfoSnackCustom({
        type: 'info',
        message: i18n.t('core:file_transfer.saving_file'),
      });

      setOpenSnackGlobal(true);
    }

    FileSaver.saveAs(blob, filename);

    if (silent) return;

    setInfoSnackCustom({
      type: 'success',
      message: i18n.t('core:file_transfer.save_success'),
    });

    setOpenSnackGlobal(true);
  } catch (error) {
    setInfoSnackCustom({
      type: 'error',
      message: error?.message
        ? i18n.t('core:file_transfer.save_error', {
            message: error.message,
          })
        : i18n.t('core:file_transfer.save_error_generic'),
    });

    setOpenSnackGlobal(true);
    console.error('Error saving file:', error);
  }
};

declare const cordova: any;

async function storeFilesInIndexedDB(obj) {
  // First delete any existing files in IndexedDB with '_qortalfile' in their ID
  await deleteQortalFilesFromIndexedDB();

  // Open the IndexedDB
  const db = await openIndexedDB();
  const transaction = db.transaction(['files'], 'readwrite');
  const objectStore = transaction.objectStore('files');

  // Handle the obj.file if it exists and is a File instance
  if (obj.file) {
    const fileId = Date.now() + 'objFile_qortalfile';

    // Store the file in IndexedDB
    const fileData = {
      id: fileId,
      data: obj.file,
    };
    objectStore.put(fileData);

    // Replace the file object with the file ID in the original object
    obj.fileId = fileId;
    delete obj.file;
  }
  if (obj.blob) {
    const fileId = Date.now() + 'objFile_qortalfile';

    // Store the file in IndexedDB
    const fileData = {
      id: fileId,
      data: obj.blob,
    };
    objectStore.put(fileData);

    // Replace the file object with the file ID in the original object
    const blobObj = {
      type: obj.blob?.type,
    };
    obj.fileId = fileId;
    delete obj.blob;
    obj.blob = blobObj;
  }

  // Iterate through resources to find files and save them to IndexedDB
  for (const resource of obj?.resources || []) {
    if (resource.file) {
      const fileId = resource.identifier + Date.now() + '_qortalfile';

      // Store the file in IndexedDB
      const fileData = {
        id: fileId,
        data: resource.file,
      };
      objectStore.put(fileData);

      // Replace the file object with the file ID in the original object
      resource.fileId = fileId;
      delete resource.file;
    }
  }

  // Set transaction completion handlers
  transaction.oncomplete = function () {
    console.log('Files saved successfully to IndexedDB');
  };

  transaction.onerror = function () {
    console.error('Error saving files to IndexedDB');
  };

  return obj; // Updated object with references to stored files
}

export const useQortalMessageListener = (
  frameWindow,
  iframeRef,
  tabId,
  isDevMode,
  appName,
  appService,
  appIdentifier
) => {
  const [path, setPath] = useState('');
  const [history, setHistory] = useState({
    customQDNHistoryPaths: [],
    currentIndex: -1,
    isDOMContentLoaded: false,
  });
  const setHasSettingsChangedAtom = useSetAtom(navigationControllerAtom);

  // SET_FULL_SCREEN: this app's viewer wants the whole screen (GO phones
  // hide their bars). See qappFullScreenTabAtom.
  const [fullScreenTab, setFullScreenTab] = useAtom(qappFullScreenTabAtom);
  const isFullScreen = Boolean(tabId) && fullScreenTab === tabId;
  const wasFullScreenRef = useRef(false);
  useEffect(() => {
    // Ended by anything (the app itself, back, leaving or closing the tab):
    // tell the app, so a viewer that is still open can close too.
    if (wasFullScreenRef.current && !isFullScreen) {
      try {
        const frame = iframeRef?.current;
        if (frame?.contentWindow && frame.src) {
          frame.contentWindow.postMessage(
            {
              action: 'FULL_SCREEN_CHANGED',
              requestedHandler: 'UI',
              payload: { enabled: false },
            },
            new URL(frame.src).origin
          );
        }
      } catch {
        /* frame already gone */
      }
    }
    wasFullScreenRef.current = isFullScreen;
  }, [iframeRef, isFullScreen]);
  // The tab closes: its full screen goes with it.
  useEffect(
    () => () =>
      setFullScreenTab((current) => (current === tabId ? null : current)),
    [setFullScreenTab, tabId]
  );
  // Back always brings the bars back, even if the app never says so.
  useAndroidBack(
    () => {
      setFullScreenTab(null);
      return true;
    },
    { priority: BACK_PRIORITY.overlay, enabled: isFullScreen }
  );

  const openSnackGlobal = useAtomValue(openSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const infoSnackCustom = useAtomValue(infoSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);

  useEffect(() => {
    if (tabId && !isNaN(history?.currentIndex)) {
      setHasSettingsChangedAtom((prev) => {
        // Preserve identifier in qortal:// links when present because QDN
        // targeting depends on it. Links without identifier must still work.
        return {
          ...prev,
          [tabId]: {
            hasBack: history?.currentIndex > 0,
            hasForward:
              history?.currentIndex >= 0 &&
              history?.currentIndex <
                (history?.customQDNHistoryPaths?.length || 0) - 1,
            currentLink:
              appService && appName
                ? buildQortalResourceLink({
                    service: appService,
                    name: appName,
                    path: path || '',
                    identifier: appIdentifier,
                  })
                : '',
          },
        };
      });
    }
  }, [
    appIdentifier,
    appName,
    appService,
    history?.currentIndex,
    history?.customQDNHistoryPaths,
    path,
    tabId,
  ]);

  const changeCurrentIndex = useCallback((value) => {
    setHistory((prev) => {
      return {
        ...prev,
        currentIndex: value,
      };
    });
  }, []);

  const resetHistory = useCallback(() => {
    setHistory({
      customQDNHistoryPaths: [],
      currentIndex: -1,
      isManualNavigation: true,
      isDOMContentLoaded: false,
    });
  }, []);

  useEffect(() => {
    // Deduplication map: prevents identical concurrent requests from piling up
    const pendingRequests = new Map<string, Promise<any>>();

    // Actions that are safe to deduplicate (read-only / idempotent)
    const deduplicableActions = new Set([
      'FETCH_BLOCK_RANGE',
      'FETCH_BLOCK',
      'FETCH_QDN_RESOURCE',
      'GET_ACCOUNT_DATA',
      'GET_ACCOUNT_NAMES',
      'GET_ARRR_SYNC_STATUS',
      'GET_AT_DATA',
      'GET_AT',
      'GET_BALANCE',
      'GET_CROSSCHAIN_SERVER_INFO',
      'GET_DAY_SUMMARY',
      'GET_FOREIGN_FEE',
      'GET_HOSTED_DATA',
      'GET_LIST_ITEMS',
      'GET_NAME_DATA',
      'GET_NODE_INFO',
      'GET_NODE_STATUS',
      'GET_PRICE',
      'GET_PRIMARY_NAME',
      'GET_QDN_RESOURCE_METADATA',
      'GET_QDN_RESOURCE_PROPERTIES',
      'GET_QDN_RESOURCE_STATUS',
      'GET_QDN_RESOURCE_URL',
      'GET_SERVER_CONNECTION_HISTORY',
      'GET_TX_ACTIVITY_SUMMARY',
      'GET_USER_ACCOUNT',
      'GET_USER_WALLET_INFO',
      'GET_USER_WALLET_TRANSACTIONS',
      'GET_USER_WALLET',
      'GET_WALLET_BALANCE',
      'IS_USING_PUBLIC_NODE',
      'NOTIFICATION_HAS_PERMISSION',
      'LIST_ATS',
      'LIST_GROUPS',
      'LIST_QDN_RESOURCES',
      'SEARCH_CHAT_MESSAGES',
      'SEARCH_NAMES',
      'SEARCH_QDN_RESOURCES',
      'SEARCH_TRANSACTIONS',
      'WHICH_UI',
    ]);

    const listener = async (event) => {
      if (event?.data?.requestedHandler !== 'UI') return;

      const appWindow = iframeRef.current?.contentWindow;
      if (!appWindow || event.source !== appWindow) return;

      let appOrigin = null;
      try {
        appOrigin = iframeRef.current?.src
          ? new URL(iframeRef.current.src).origin
          : null;
      } catch {
        return;
      }
      if (appOrigin && event.origin !== appOrigin) return;

      const eventPort = event.ports?.[0];

      const sendMessageToRuntime = (message, eventPort) => {
        if (!eventPort) return;

        let timeout: number = TIME_SECONDS_30_IN_MILLISECONDS;
        if (
          message?.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' &&
          message?.payload?.resources?.length > 0
        ) {
          timeout =
            message?.payload?.resources?.length *
            TIME_MINUTES_30_IN_MILLISECONDS;
        } else if (message?.action === 'PUBLISH_QDN_RESOURCE') {
          timeout = TIME_HOURS_1_IN_MILLISECONDS;
        }

        // Build deduplication key for read-only actions
        const isDeduplicable = deduplicableActions.has(message?.action);
        let requestKey = '';
        if (isDeduplicable) {
          requestKey = `${message.action}-${JSON.stringify(message.payload || {})}`;
        }

        // If an identical request is already in-flight, reuse its result
        if (isDeduplicable && pendingRequests.has(requestKey)) {
          pendingRequests
            .get(requestKey)
            .then((response) => {
              if (response.error) {
                eventPort.postMessage({
                  result: null,
                  error: {
                    error: response?.error,
                    message:
                      typeof response?.error === 'string'
                        ? response?.error
                        : typeof response?.message === 'string'
                          ? response?.message
                          : 'An error has occurred',
                  },
                });
              } else {
                eventPort.postMessage({
                  result: response,
                  error: null,
                });
              }
            })
            .catch((error) => {
              eventPort.postMessage({
                result: null,
                error: {
                  error: error?.message || 'Request failed',
                  message: error?.message || 'An error has occurred',
                },
              });
            });
          return;
        }

        const requestPromise = window.sendMessage(
          message.action,
          message.payload,
          timeout,
          message.isExtension,
          {
            name: appName,
            service: appService,
            tabId,
          }
        );

        // Store the promise for deduplication
        if (isDeduplicable) {
          pendingRequests.set(requestKey, requestPromise);
          requestPromise.finally(() => {
            pendingRequests.delete(requestKey);
          });
        }

        requestPromise
          .then((response) => {
            if (response.error) {
              eventPort.postMessage({
                result: null,
                error: {
                  error: response?.error,
                  message:
                    typeof response?.error === 'string'
                      ? response?.error
                      : typeof response?.message === 'string'
                        ? response?.message
                        : 'An error has occurred',
                },
              });
            } else {
              eventPort.postMessage({
                result: response,
                error: null,
              });
            }
          })
          .catch((error) => {
            console.error('Failed qortalRequest', error);
            eventPort.postMessage({
              result: null,
              error: {
                error: error?.message || 'Request failed',
                message: error?.message || 'An error has occurred',
              },
            });
          });
      };

      // Check if action is included in the predefined list of UI requests
      if (UIQortalRequests.includes(event.data.action)) {
        sendMessageToRuntime(
          {
            action: event.data.action,
            type: 'qortalRequest',
            payload: event.data,
            isExtension: true,
          },
          eventPort
        );
      } else if (event?.data?.action === 'SAVE_FILE') {
        if (!eventPort) return;

        // A Q-App that downloaded this very file a moment ago (the card is
        // already showing it) hands it over here; the save continues that card.
        const transferId = isCapacitor()
          ? claimQappFetchForSave(event.data?.blob?.size)
          : null;
        const request = transferId ? { ...event.data, transferId } : event.data;
        const snackMethods = {
          openSnackGlobal,
          setOpenSnackGlobal,
          infoSnackCustom,
          setInfoSnackCustom,
        };
        try {
          await saveFile(request, null, true, snackMethods, {
            appInfo: { name: appName, service: appService },
          });
          eventPort.postMessage({
            result: true,
            error: null,
          });
        } catch (error) {
          if (transferId) {
            const declined =
              error?.message ===
              i18n.t('question:message.generic.user_declined_save_file', {
                postProcess: 'capitalizeFirstChar',
              });
            if (declined) {
              // The file is downloaded and GO still has it: keep it in the
              // notifications with a Save button, in case the answer changes.
              declineQdnSave(transferId, () =>
                saveFile(request, null, true, snackMethods, {
                  preApproved: true,
                  appInfo: { name: appName, service: appService },
                })
              );
            } else {
              cancelQdnSaveNotification(transferId);
            }
          }
          eventPort.postMessage({
            result: null,
            error: error?.message || 'Failed to save file',
          });
        }
      } else if (
        event?.data?.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' ||
        event?.data?.action === 'PUBLISH_QDN_RESOURCE' ||
        event?.data?.action === 'ENCRYPT_DATA' ||
        event?.data?.action === 'ENCRYPT_DATA_WITH_SHARING_KEY' ||
        event?.data?.action === 'ENCRYPT_QORTAL_GROUP_DATA'
      ) {
        const data = event.data;

        if (data) {
          sendMessageToRuntime(
            {
              action: event.data.action,
              type: 'qortalRequest',
              payload: data,
              isExtension: true,
            },
            eventPort
          );
        } else {
          eventPort?.postMessage({
            result: null,
            error: 'Failed to prepare data for publishing',
          });
        }
      } else if (
        event?.data?.action === 'LINK_TO_QDN_RESOURCE' ||
        event?.data?.action === 'QDN_RESOURCE_DISPLAYED'
      ) {
        const pathUrl =
          event?.data?.path != null
            ? (event?.data?.path.startsWith('/') ? '' : '/') + event?.data?.path
            : null;
        // GO-21: this path is reused for Refresh, Copy link and Duplicate, so
        // one that climbs out of the app ("/../../render/APP/Other") is ignored.
        if (isSafeQappPath(pathUrl)) setPath(pathUrl);
        if (appName?.toLowerCase() === 'q-mail') {
          window.sendMessage('addEnteredQmailTimestamp').catch((error) => {
            console.error(error);
          });
        } else if (appName?.toLowerCase() === 'q-wallets') {
          executeEvent('setLastEnteredTimestampPaymentEvent', {});
        }
        // Respond to close the MessageChannel and prevent pending connections
        if (event.ports[0]) {
          event.ports[0].postMessage({ result: true, error: null });
        }
      } else if (event?.data?.action === 'NAVIGATION_HISTORY') {
        if (event?.data?.payload?.isDOMContentLoaded) {
          setHistory((prev) => {
            const copyPrev = { ...prev };
            if (
              (copyPrev?.customQDNHistoryPaths || []).at(-1) ===
              (event?.data?.payload?.customQDNHistoryPaths || []).at(-1)
            ) {
              return {
                ...prev,
                currentIndex:
                  prev.customQDNHistoryPaths.length - 1 === -1
                    ? 0
                    : prev.customQDNHistoryPaths.length - 1,
              };
            }
            const copyHistory = { ...prev };
            const paths = [
              ...(copyHistory?.customQDNHistoryPaths.slice(
                0,
                copyHistory.currentIndex + 1
              ) || []),
              ...(event?.data?.payload?.customQDNHistoryPaths || []),
            ];
            return {
              ...prev,
              customQDNHistoryPaths: paths,
              currentIndex: paths.length - 1,
            };
          });
        } else {
          setHistory(event?.data?.payload);
        }
        // Respond to close the MessageChannel and prevent pending connections
        if (event.ports[0]) {
          event.ports[0].postMessage({ result: true, error: null });
        }
      } else if (event?.data?.action === 'SET_FULL_SCREEN') {
        // { action: 'SET_FULL_SCREEN', enabled: boolean }. Phones hide the
        // bars for this tab; elsewhere it is simply acknowledged.
        const enabled = Boolean(
          event?.data?.enabled ?? event?.data?.payload?.enabled
        );
        if (tabId) {
          setFullScreenTab((current) =>
            enabled ? tabId : current === tabId ? null : current
          );
        }
        event.ports?.[0]?.postMessage({ result: true, error: null });
      } else if (event?.data?.action === 'SET_TAB' && !isDevMode) {
        // GO-21: a Q-App may only say which app to open (service, name,
        // identifier, path). It never sets the tab's URL or preview flag, and a
        // path or name that climbs into another app is refused.
        const target = pickQappTabTarget(event?.data?.payload);
        if (!target) {
          event.ports?.[0]?.postMessage({
            result: null,
            error: i18n.t('auth:message.error.invalid_qortal_link', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          return;
        }
        executeEvent('addTab', {
          data: target,
        });
        const targetOrigin = iframeRef.current
          ? new URL(iframeRef.current.src).origin
          : '*';
        iframeRef.current.contentWindow.postMessage(
          {
            action: 'SET_TAB_SUCCESS',
            requestedHandler: 'UI',
            payload: {
              name: target.name,
            },
          },
          targetOrigin
        );
        // Respond to close the MessageChannel and prevent pending connections
        if (event.ports[0]) {
          event.ports[0].postMessage({ result: true, error: null });
        }
      }
    };

    // Add the listener for messages coming from the frameWindow
    frameWindow.addEventListener('message', listener);

    // Cleanup function to remove the event listener when the component is unmounted
    return () => {
      frameWindow.removeEventListener('message', listener);
    };
  }, [isDevMode, appName, appService, tabId, setFullScreenTab]); // Empty dependency array to run once when the component mounts

  return { path, history, resetHistory, changeCurrentIndex };
};
