/**
 * GO's end of the Q-App download reports (see qappFetchReporter.ts): each
 * report becomes a stage of the transfer card and tray notification.
 */
import { getBaseApiReact } from './globalApi';
import {
  parseQappFetchMessage,
  type QappFetchMessage,
} from './qappFetchReporter';
import { qdnResourcePath } from './qdnPath';
import {
  beginQappFetchNotification,
  cancelQdnSaveNotification,
  completeQappFetch,
  failQappFetch,
  renameQdnTransfer,
  reportQappFetchProgress,
} from './qdnDownloadNotifications';

export const qappFetchTransferId = (message: QappFetchMessage): string =>
  `qapp-fetch:${message.id}`;

/** Q-App frames are served by GO's node; reports from anywhere else are not ours. */
function nodeOrigin(): string | null {
  try {
    return new URL(getBaseApiReact()).origin;
  } catch {
    return null;
  }
}

/**
 * The frame only knows the URL. The file name ("GO 3.0 v0.0.11.apk") is in
 * the resource properties, asked of GO's own node rather than of the frame.
 */
async function lookUpFilename(
  message: QappFetchMessage,
  transferId: string
): Promise<void> {
  try {
    const response = await fetch(
      `${getBaseApiReact()}/arbitrary/resource/properties/${qdnResourcePath({
        service: message.service,
        name: message.name,
        identifier: message.identifier || undefined,
      })}`
    );
    if (!response.ok) return;
    const properties = await response.json();
    const filename =
      typeof properties?.filename === 'string'
        ? properties.filename.trim().slice(0, 200)
        : '';
    if (filename) renameQdnTransfer(transferId, filename);
  } catch {
    /* the card keeps the resource name */
  }
}

export function handleQappFetchMessage(message: QappFetchMessage): void {
  const id = qappFetchTransferId(message);
  switch (message.phase) {
    case 'start':
      if (beginQappFetchNotification(id, message.name, message.total)) {
        void lookUpFilename(message, id);
      }
      break;
    case 'progress':
      reportQappFetchProgress(id, message.loaded, message.total);
      break;
    case 'done':
      completeQappFetch(id);
      break;
    case 'error':
      failQappFetch(id, message.message);
      break;
    case 'cancel':
      cancelQdnSaveNotification(id);
      break;
  }
}

export function startQappFetchProgressListener(): () => void {
  const onMessage = (event: MessageEvent) => {
    const message = parseQappFetchMessage(event.data);
    if (!message) return;
    const origin = nodeOrigin();
    if (!origin || event.origin !== origin) return;
    handleQappFetchMessage(message);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
