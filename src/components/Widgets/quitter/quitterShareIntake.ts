/**
 * "Share to Quitter / Torq" intake: photos/videos shared from other Android
 * apps arrive via the native ShareReceiver plugin (the share-sheet entry is
 * named after the app the composer posts to). This module drains the native
 * queue, converts the items into composer-ready media, navigates Home and
 * hands them to HomeQuitterComposer.
 */
import { Capacitor } from '@capacitor/core';
import {
  isShareReceiverAvailable,
  ShareReceiver,
  type SharedMediaItem,
} from '../../../plugins/ShareReceiver';
import { executeEvent } from '../../../utils/events';
import { createNamedFile } from '../../../utils/namedFile';
import { stripImageFileMetadata } from '../../../utils/imageCompression';
import { getDefaultStore } from 'jotai';
import { composerTargetAtom, syncComposerShareTarget } from './composerTarget';
import { QUITTER_MAX_IMAGES } from './quitterPublish';
import { TORQ_MAX_IMAGES } from './torqPublish';
import { drainRevShare } from './torqRevShare';

export type SharedComposerVideo = {
  /** Native cache path — the compress/publish pipeline reads it directly. */
  nativePath: string;
  mimeType: string;
  size: number;
  fileName: string;
};

/** The mime comes from the native side — `File.type` is unreliable here. */
export type SharedComposerImage = {
  file: File;
  mimeType: string;
};

export type SharedComposerMedia = {
  images: SharedComposerImage[];
  video: SharedComposerVideo | null;
};

export const QUITTER_SHARED_MEDIA_EVENT = 'quitterSharedMedia';

let pending: SharedComposerMedia | null = null;
let initialized = false;

/** Composer pulls (and clears) media that arrived before it mounted. */
export function takePendingQuitterShare(): SharedComposerMedia | null {
  const media = pending;
  pending = null;
  return media;
}

async function imageItemToFile(
  item: SharedMediaItem
): Promise<SharedComposerImage | null> {
  try {
    const res = await fetch(Capacitor.convertFileSrc(item.path));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const mimeType =
      (typeof item.mimeType === 'string' && item.mimeType) ||
      (typeof blob.type === 'string' && blob.type) ||
      'image/jpeg';
    // Gallery apps often share the original file, GPS and camera EXIF
    // included; drop it before the photo reaches the composer.
    const file = await stripImageFileMetadata(
      createNamedFile([blob], item.name || 'shared-image.jpg', {
        type: mimeType,
      })
    );
    // Bytes are in memory now — free the native cache copy.
    void ShareReceiver.consumeSharedFile(item.path);
    return { file, mimeType };
  } catch {
    return null;
  }
}

async function drainNativeQueue(): Promise<void> {
  const items = await ShareReceiver.getPendingShare();
  if (!items.length) return;

  // Quitter posts take up to 2 images, Torq posts 10; one video either way.
  const maxImages =
    getDefaultStore().get(composerTargetAtom) === 'torq'
      ? TORQ_MAX_IMAGES
      : QUITTER_MAX_IMAGES;
  const imageItems = items
    .filter((i) => i.mimeType?.startsWith('image/'))
    .slice(0, maxImages);
  const videoItem = items.find((i) => i.mimeType?.startsWith('video/')) || null;

  const images = (
    await Promise.all(imageItems.map((item) => imageItemToFile(item)))
  ).filter((f): f is SharedComposerImage => f != null);
  const video: SharedComposerVideo | null = videoItem
    ? {
        nativePath: videoItem.path,
        mimeType: videoItem.mimeType || 'video/mp4',
        size: videoItem.size,
        fileName: videoItem.name || 'shared-video.mp4',
      }
    : null;
  if (!images.length && !video) return;

  pending = { images, video };
  // Composer lives on the Home dashboard — navigate there, then notify a
  // mounted composer (a freshly mounting one pulls takePendingQuitterShare).
  executeEvent('open-home-mode', {});
  executeEvent(QUITTER_SHARED_MEDIA_EVENT, {});
}

/**
 * Start listening for share-sheet media. Call once the user is
 * authenticated (the composer needs a logged-in account to be useful).
 */
export function initQuitterShareIntake(): void {
  if (initialized || !isShareReceiverAvailable()) return;
  initialized = true;
  syncComposerShareTarget();
  void drainNativeQueue().catch(() => undefined);
  void drainRevShare().catch(() => undefined);
  void ShareReceiver.addShareListener((event) => {
    // Shares into a group or a DM have their own intake (chatShareIntake).
    if (event?.kind === 'chat') return;
    // "Torq Rev": Torq's own Rev editor, not the Home composer.
    if (event?.kind === 'rev') {
      void drainRevShare().catch(() => undefined);
      return;
    }
    void drainNativeQueue().catch(() => undefined);
  });
}
