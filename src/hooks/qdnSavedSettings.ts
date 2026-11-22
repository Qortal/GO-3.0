import { getArbitraryEndpointReact, getBaseApiReact } from '../utils/globalApi';
// Import from the small util module, not Group.tsx: this hook is in the eager
// pre-login bundle and a Group.tsx import would drag the whole authenticated
// tree into it.
import { decryptResource } from '../components/Group/groupDataPublishes';
import {
  base64ToUint8Array,
  uint8ArrayToObject,
} from '../encryption/encryption';

const EXT_SAVED_SETTINGS_SERVICE = 'DOCUMENT_PRIVATE';
const EXT_SAVED_SETTINGS_IDENTIFIER = 'ext_saved_settings';

export type SerializedPinnedApp = {
  name?: string;
  service?: string;
  label?: string;
  identifier?: string;
  isPrivate?: boolean;
  privateAppProperties?: {
    service?: string;
    name?: string;
    identifier?: string;
    groupId?: string | number;
    appName?: string;
  };
};

/**
 * The account's settings on QDN. Next to the pins, the desktop Hub saves the
 * pins, folders and bookmarks item by item (`savedApps`, see
 * docs/saved-apps.md) and, for clients that don't know that field, the
 * bookmarks, the folders and the order of the saved apps; also Home's layout
 * and the side panel, which GO keeps as they are.
 */
export type QdnSavedSettings = {
  sortablePinnedApps?: SerializedPinnedApp[];
  appBookmarks?: unknown;
  launcherOrder?: unknown;
  savedApps?: unknown;
  [field: string]: unknown;
};

export async function getExtSavedSettingsRecord(myName: string): Promise<{
  hasPublishRecord: boolean;
  timestamp?: number;
}> {
  const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${EXT_SAVED_SETTINGS_SERVICE}&identifier=${EXT_SAVED_SETTINGS_IDENTIFIER}&exactmatchnames=true&limit=1&prefix=true&name=${encodeURIComponent(myName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('network error');
  }
  const publishData = await response.json();

  if (publishData?.length > 0) {
    return {
      hasPublishRecord: true,
      timestamp: publishData[0]?.updated || publishData[0].created,
    };
  }

  return { hasPublishRecord: false };
}

export async function getExtSavedSettings(
  myName: string
): Promise<QdnSavedSettings | null> {
  try {
    const res = await fetch(
      `${getBaseApiReact()}/arbitrary/${EXT_SAVED_SETTINGS_SERVICE}/${encodeURIComponent(myName)}/${EXT_SAVED_SETTINGS_IDENTIFIER}?encoding=base64`
    );
    const data = await res.text();

    if (!data) throw new Error('Unable to fetch publish');

    const decryptedKey: any = await decryptResource(data);
    const dataint8Array = base64ToUint8Array(decryptedKey.data);
    const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
    return decryptedKeyToObject as QdnSavedSettings;
  } catch {
    return null;
  }
}
