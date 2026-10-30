/**
 * Pictures on the Android clipboard (QortalClipboardPlugin.java), for the
 * chat composer and the image viewer's Copy. The WebView alone can neither
 * copy a picture nor be relied on to paste one. Elsewhere (desktop, browser)
 * every function here is a no-op and the web clipboard is used as before.
 */
import { registerPlugin } from '@capacitor/core';
import { isAndroidApp } from './androidApp';
import { createNamedFile } from './namedFile';
import { isGoApp } from './platform';

type ClipboardImage = { base64?: string; mimeType?: string; fileName?: string };

type QortalClipboardPlugin = {
  describe: () => Promise<{ hasImage: boolean; stamp?: number }>;
  readImage: () => Promise<ClipboardImage>;
  writeImage: (image: {
    base64: string;
    mimeType: string;
    fileName?: string;
  }) => Promise<void>;
  setImageInsertTarget: (options: { active: boolean }) => Promise<void>;
  note: (options: { message: string }) => Promise<void>;
  addListener: (
    event: 'keyboardImage',
    listener: (image: ClipboardImage) => void
  ) => Promise<{ remove: () => Promise<void> }>;
};

const QortalClipboard =
  registerPlugin<QortalClipboardPlugin>('QortalClipboard');

export const hasNativeClipboardImages = (): boolean =>
  isGoApp() && isAndroidApp();

const toFile = (image: ClipboardImage): File | null => {
  if (!image?.base64 || !image.mimeType?.startsWith('image/')) return null;
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  // Not `new File`: on Android cordova-plugin-file replaces it (namedFile.ts).
  return createNamedFile([bytes], image.fileName || 'pasted-image.png', {
    type: image.mimeType,
  });
};

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

/**
 * Whether the clipboard holds a picture, without reading it (so Android
 * shows no "pasted from your clipboard" notice). `stamp` tells one copy
 * from the next.
 */
export const describeClipboardImage = async (): Promise<{
  hasImage: boolean;
  stamp: number;
} | null> => {
  if (!hasNativeClipboardImages()) return null;
  try {
    const result = await QortalClipboard.describe();
    return { hasImage: Boolean(result?.hasImage), stamp: result?.stamp ?? 0 };
  } catch {
    return null;
  }
};

/** The picture on the clipboard as a file, or null if there is none. */
export const readClipboardImageFile = async (): Promise<File | null> => {
  if (!hasNativeClipboardImages()) return null;
  try {
    return toFile(await QortalClipboard.readImage());
  } catch {
    return null;
  }
};

/**
 * One line in the phone's own log about a picture that could not be pasted
 * or copied (why, its type and size; never the picture). A release build
 * does not log the page's console, so this is what can be looked at.
 */
export const noteClipboardIssue = (message: string): void => {
  if (!hasNativeClipboardImages()) return;
  void QortalClipboard.note({ message }).catch(() => undefined);
};

/** Puts a picture on the Android clipboard; false where that can't be done. */
export const writeClipboardImage = async (
  blob: Blob,
  fileName?: string
): Promise<boolean> => {
  if (!hasNativeClipboardImages()) return false;
  try {
    await QortalClipboard.writeImage({
      base64: await toBase64(blob),
      mimeType: blob.type || 'image/png',
      fileName,
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Pictures a keyboard inserts (Gboard's clipboard bar and the like) go to
 * the focused chat composer: the one that called this last, while focused.
 */
type ImageTarget = (file: File) => void;
let imageTarget: ImageTarget | null = null;
let listening = false;

const ensureKeyboardListener = () => {
  if (listening || !hasNativeClipboardImages()) return;
  listening = true;
  void QortalClipboard.addListener('keyboardImage', (image) => {
    const file = toFile(image);
    if (file && imageTarget) imageTarget(file);
  }).catch(() => {
    listening = false;
  });
};

/** A composer took focus: keyboard pictures go to `target` until released. */
export const claimKeyboardImageTarget = (target: ImageTarget): (() => void) => {
  if (!hasNativeClipboardImages()) return () => undefined;
  ensureKeyboardListener();
  imageTarget = target;
  void QortalClipboard.setImageInsertTarget({ active: true }).catch(
    () => undefined
  );
  return () => {
    if (imageTarget !== target) return;
    imageTarget = null;
    void QortalClipboard.setImageInsertTarget({ active: false }).catch(
      () => undefined
    );
  };
};
