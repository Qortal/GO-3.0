/**
 * Shares into a group or a DM from other Android apps ("GO Groups",
 * "GO DMs" or "GO Self-DM" in the share sheet). This module drains the native
 * queue, starts reading the shared file, and hands a request to
 * ChatShareHost, which puts the share up in Q-Chat (pendingChatShareAtom).
 */
import { Capacitor } from '@capacitor/core';
import {
  isShareReceiverAvailable,
  ShareReceiver,
  type PendingChatShare,
  type SharedMediaItem,
} from '../../../plugins/ShareReceiver';
import { executeEvent } from '../../../utils/events';
import { createNamedFile } from '../../../utils/namedFile';
import { cleanPastedImage } from '../../../utils/cleanPastedImage';
import type { ChatShareContent, ChatShareNotice } from './chatShareInbox';
import { parseShareTarget, type ChatShareScope } from './chatShareTarget';

/** What was shared, for the Q-Chat header's preview and the composer. */
export type PreparedChatShare = ChatShareContent & {
  id: number;
  /** The share-sheet entry: which list opens, or Saved Messages. */
  scope: ChatShareScope;
  /** The shared file as Android named it (preview only). */
  items: SharedMediaItem[];
};

export type ChatShareRequest =
  | { kind: 'share'; share: PreparedChatShare }
  /** Nothing usable came (all files too large or unreadable): say why. */
  | { kind: 'nothing'; notices: ChatShareNotice[] };

/** Held while GO is locked (appLockEventGate) and delivered after unlock. */
export const CHAT_SHARE_REQUEST_EVENT = 'chat-share-request';

let initialized = false;
let pendingRequest: ChatShareRequest | null = null;
let nextShareId = 0;

/** ChatShareHost takes (and clears) the request waiting for it. */
export function takeChatShareRequest(): ChatShareRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}

async function readSharedFile(item: SharedMediaItem): Promise<File | null> {
  try {
    const res = await fetch(Capacitor.convertFileSrc(item.path));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const type =
      (typeof item.mimeType === 'string' && item.mimeType) ||
      blob.type ||
      'application/octet-stream';
    return createNamedFile([blob], item.name || 'shared-file', { type });
  } catch {
    return null;
  } finally {
    // The bytes are in the page now (or never will be): free the copy.
    void ShareReceiver.consumeSharedFile(item.path);
  }
}

/** The link or text that came with the share. */
export function sharedText(share: Pick<PendingChatShare, 'text' | 'subject'>) {
  const text = typeof share.text === 'string' ? share.text.trim() : '';
  if (text) return text;
  return typeof share.subject === 'string' ? share.subject.trim() : '';
}

export function prepareChatShare(
  share: PendingChatShare,
  scope: ChatShareScope
): PreparedChatShare {
  const notices: ChatShareNotice[] = [];
  if ((share.extraCount ?? 0) > 0) {
    notices.push({ kind: 'extra_files', count: share.extraCount ?? 0 });
  }
  if ((share.tooLargeCount ?? 0) > 0) {
    notices.push({
      kind: 'too_large',
      maxMb: Math.round((share.maxFileBytes ?? 100 * 1024 * 1024) / 1048576),
    });
  }
  if ((share.unreadableCount ?? 0) > 0 && share.items.length === 0) {
    notices.push({ kind: 'unreadable' });
  }
  const items = share.items.slice(0, 1);
  // Pictures are cleaned of location and camera data here, like pasted ones;
  // other files are cleaned when the composer stages them.
  const files = (async () => {
    const out: File[] = [];
    for (const item of items) {
      const file = await readSharedFile(item);
      if (!file) {
        notices.push({ kind: 'unreadable' });
        continue;
      }
      if (file.type?.startsWith('image/')) {
        const clean = await cleanPastedImage(file);
        if (clean) out.push(clean);
        else notices.push({ kind: 'unsafe_image' });
        continue;
      }
      out.push(file);
    }
    return out;
  })();
  return {
    id: ++nextShareId,
    scope,
    text: sharedText(share),
    files,
    items,
    notices,
  };
}

/** Nothing usable came with it (all files too large or unreadable). */
const isEmptyShare = (share: PendingChatShare) =>
  share.items.length === 0 && !sharedText(share);

function deliverRequest(request: ChatShareRequest) {
  pendingRequest = request;
  executeEvent(CHAT_SHARE_REQUEST_EVENT, {});
}

export function routeChatShare(share: PendingChatShare): void {
  const scope = parseShareTarget(share.target);
  if (!scope) return;
  if (isEmptyShare(share)) {
    // Say why nothing arrived, instead of an empty composer.
    deliverRequest({
      kind: 'nothing',
      notices: prepareChatShare(share, scope).notices,
    });
    return;
  }
  deliverRequest({ kind: 'share', share: prepareChatShare(share, scope) });
}

async function drainNativeQueue(): Promise<void> {
  const share = await ShareReceiver.getPendingChatShare();
  if (share) routeChatShare(share);
}

/**
 * Start listening for chat shares. Call once the user is signed in: the
 * share goes into that account's chats. Idempotent.
 */
export function initChatShareIntake(): void {
  if (initialized || !isShareReceiverAvailable()) return;
  initialized = true;
  void drainNativeQueue().catch(() => undefined);
  void ShareReceiver.addShareListener((event) => {
    if (event?.kind !== 'chat') return;
    void drainNativeQueue().catch(() => undefined);
  });
}

/** Test helper. */
export function resetChatShareIntake() {
  initialized = false;
  pendingRequest = null;
}
