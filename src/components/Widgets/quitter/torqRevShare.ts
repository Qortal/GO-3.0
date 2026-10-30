/**
 * Torq Revs from GO: the Home composer's "Rev" button and the "Torq Rev"
 * share-sheet entry open Torq's own Rev editor (Torq ≥ 1.3).
 *
 * - qortal://APP/Torq/rev/new opens the editor over Torq's Home; an open Torq
 *   tab is reused and sent there.
 * - A shared photo or video follows in an OPEN_REV_COMPOSER message to the
 *   Torq frame, sent until Torq answers OPEN_REV_COMPOSER_RECEIVED (it may
 *   still be loading), so the editor starts from it.
 */
import { Capacitor } from '@capacitor/core';
import i18n from 'i18next';
import { executeEvent } from '../../../utils/events';
import { createNamedFile } from '../../../utils/namedFile';
import { stripImageFileMetadata } from '../../../utils/imageCompression';
import {
  ShareReceiver,
  type PendingRevShare,
} from '../../../plugins/ShareReceiver';

const TORQ_APP_NAME = 'Torq';
const TORQ_REV_COMPOSE_PATH = 'rev/new';
export const OPEN_REV_COMPOSER_ACTION = 'OPEN_REV_COMPOSER';
export const OPEN_REV_COMPOSER_RECEIVED_ACTION = 'OPEN_REV_COMPOSER_RECEIVED';
/** Torq takes Rev videos up to 100 MB (REV_MAX_VIDEO_BYTES). */
const TORQ_REV_MAX_FILE_BYTES = 100 * 1024 * 1024;
/** How often, and for how long, the file is offered to a loading Torq. */
const REV_HANDOFF_RETRY_MS = 500;
const REV_HANDOFF_TIMEOUT_MS = 30_000;

const sentence = { postProcess: 'capitalizeFirstChar' };

const notify = (key: string, options: Record<string, unknown> = {}) =>
  executeEvent('openGlobalSnackBar', {
    message: i18n.t(`group:home_composer.${key}`, { ...sentence, ...options }),
    type: 'info',
  });

let handoffSeq = 0;

/** Opens Torq's Rev editor, starting from `file` when there is one. */
export function openTorqRevComposer(file?: File | null): Promise<boolean> {
  executeEvent('addTab', {
    data: {
      identifier: '',
      name: TORQ_APP_NAME,
      navigateIfAlreadyOpen: true,
      path: TORQ_REV_COMPOSE_PATH,
      service: 'APP',
    },
  });
  executeEvent('open-apps-mode', {});
  if (!file) return Promise.resolve(true);
  return handOffRevFile(file);
}

/**
 * Offers the file to the Torq frame until it answers. Resolves true once
 * Torq has it, false when it never answered (an older Torq).
 */
export function handOffRevFile(
  file: File,
  {
    retryMs = REV_HANDOFF_RETRY_MS,
    timeoutMs = REV_HANDOFF_TIMEOUT_MS,
  }: { retryMs?: number; timeoutMs?: number } = {}
): Promise<boolean> {
  handoffSeq += 1;
  const requestId = `go-rev-${Date.now()}-${handoffSeq}`;
  return new Promise((resolve) => {
    let timer: number | null = null;
    const startedAt = Date.now();
    const finish = (received: boolean) => {
      window.removeEventListener('message', onMessage);
      if (timer !== null) window.clearTimeout(timer);
      resolve(received);
    };
    // Only ends the retries, so where the answer comes from does not matter.
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { action?: unknown; requestId?: unknown };
      if (
        data?.action === OPEN_REV_COMPOSER_RECEIVED_ACTION &&
        data.requestId === requestId
      ) {
        finish(true);
      }
    };
    const offer = () => {
      executeEvent('sendToApp', {
        service: 'APP',
        name: TORQ_APP_NAME,
        message: { action: OPEN_REV_COMPOSER_ACTION, requestId, file },
      });
      if (Date.now() - startedAt >= timeoutMs) {
        notify('rev_not_received');
        finish(false);
        return;
      }
      timer = window.setTimeout(offer, retryMs);
    };
    window.addEventListener('message', onMessage);
    offer();
  });
}

/** The shared item's bytes as a File; photos lose their location data. */
async function revShareToFile(share: PendingRevShare): Promise<File | null> {
  const item = share.item;
  if (!item?.path) return null;
  try {
    const response = await fetch(Capacitor.convertFileSrc(item.path));
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.size) return null;
    const mimeType = item.mimeType || blob.type || 'application/octet-stream';
    if (!/^(image|video)\//.test(mimeType)) return null;
    const named = createNamedFile(
      [blob],
      item.name ||
        (mimeType.startsWith('video/') ? 'shared-video.mp4' : 'shared.jpg'),
      { type: mimeType }
    );
    return mimeType.startsWith('image/')
      ? await stripImageFileMetadata(named)
      : named;
  } catch {
    return null;
  } finally {
    // In the page now (or unreadable): the cache copy goes either way.
    void ShareReceiver.consumeSharedFile(item.path);
  }
}

/** A "Torq Rev" share: Torq's Rev editor with the photo or video in it. */
export async function drainRevShare(): Promise<void> {
  const share = await ShareReceiver.getPendingRevShare();
  if (!share) return;
  if (!share.item) {
    notify(share.tooLarge ? 'rev_too_large' : 'rev_unreadable', {
      max: Math.round(
        (share.maxFileBytes || TORQ_REV_MAX_FILE_BYTES) / (1024 * 1024)
      ),
    });
    // The editor still opens, to pick something else.
    void openTorqRevComposer();
    return;
  }
  const file = await revShareToFile(share);
  if (!file) notify('rev_unreadable');
  void openTorqRevComposer(file);
}
