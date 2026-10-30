/**
 * Hands something shared from another app to the composer of the chat it was
 * sent to. The share is queued under the chat's key before the chat opens;
 * the chat takes it once its own draft is in the editor (so restoring the
 * draft cannot wipe it) and the composer can take files, or at once when it
 * is already open.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../../utils/events';
import { escapeHtml } from '../../../utils/escapeHtml';

export type ChatShareNotice =
  /** More files were shared; a message carries one. */
  | { kind: 'extra_files'; count: number }
  /** A file over the size limit was left out. */
  | { kind: 'too_large'; maxMb: number }
  /** A file could not be read. */
  | { kind: 'unreadable' }
  /** A picture could not be cleaned of location data and was left out. */
  | { kind: 'unsafe_image' };

export type ChatShareContent = {
  text: string;
  /** Read from the native cache in the background; [] when nothing. */
  files: Promise<File[]>;
  /** Told once the share is in the composer. */
  notices: ChatShareNotice[];
  /**
   * For a group: the channel picked in the share's channel step, opened
   * before the share goes in. None: the channel that opens takes it.
   */
  channelId?: string;
};

const CHAT_SHARE_DELIVER_EVENT = 'chat-share-deliver';
/** A chat that could not take its share hands it back to the lists. */
export const CHAT_SHARE_RETURN_EVENT = 'chat-share-return';

/** A share no chat took by then (the chat never opened) is dropped. */
const PENDING_TTL_MS = 2 * 60 * 1_000;
/** How long a chat that is not ready yet holds a share before taking it. */
export const CHAT_SHARE_READY_WAIT_MS = 4_000;

let pending: { key: string; content: ChatShareContent; at: number } | null =
  null;

/** Queue `content` for the chat with `key` and tell an open one. */
export function queueChatShareFor(key: string, content: ChatShareContent) {
  pending = { key, content, at: Date.now() };
  executeEvent(CHAT_SHARE_DELIVER_EVENT, { key });
}

/** The share waiting for `key`, once (null when none or too old). */
export function takeChatShareFor(key: string): ChatShareContent | null {
  if (!pending || pending.key !== key) return null;
  const { content, at } = pending;
  pending = null;
  return Date.now() - at > PENDING_TTL_MS ? null : content;
}

/** Whether a share (still fresh) waits for `key`. */
export function hasChatShareFor(key: string): boolean {
  return Boolean(
    pending && pending.key === key && Date.now() - pending.at <= PENDING_TTL_MS
  );
}

/** Back to the Groups / DM lists, for another chat to take (ChatShareHost). */
export function returnChatShare(content: ChatShareContent) {
  executeEvent(CHAT_SHARE_RETURN_EVENT, { share: content });
}

/** Test helper. */
export function resetChatShareInbox() {
  pending = null;
}

type ChatShareInboxOptions = {
  /**
   * Whether the composer can take a share now (a DM's Reticulum check is
   * done, a group's channels are known). A share waits for it, but at most
   * `maxWaitMs`.
   */
  ready?: boolean;
  maxWaitMs?: number;
};

/**
 * For a chat composer. `chatKey` is the chat on screen (chatShareKey). The
 * returned `markReady(key)` is called once that chat's draft has been put in
 * the editor; from then on a share for it is delivered, now or when it
 * arrives (and `ready` holds).
 */
export function useChatShareInbox(
  chatKey: string | null,
  deliver: (content: ChatShareContent) => void | Promise<void>,
  {
    ready = true,
    maxWaitMs = CHAT_SHARE_READY_WAIT_MS,
  }: ChatShareInboxOptions = {}
): (readyKey: string) => void {
  const chatKeyRef = useRef(chatKey);
  chatKeyRef.current = chatKey;
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const maxWaitRef = useRef(maxWaitMs);
  maxWaitRef.current = maxWaitMs;
  const readyKeyRef = useRef<string | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWait = useCallback(() => {
    if (!waitTimerRef.current) return;
    clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
  }, []);

  const tryTake = useCallback(
    (force = false) => {
      const key = readyKeyRef.current;
      if (!key || key !== chatKeyRef.current) return;
      if (!force && !readyRef.current) {
        // Not ready: the share goes in once it is, or after the wait anyway.
        if (hasChatShareFor(key) && !waitTimerRef.current) {
          waitTimerRef.current = setTimeout(() => {
            waitTimerRef.current = null;
            tryTake(true);
          }, maxWaitRef.current);
        }
        return;
      }
      clearWait();
      const content = takeChatShareFor(key);
      if (content) void deliverRef.current(content);
    },
    [clearWait]
  );

  useEffect(() => {
    const onShare = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && key === readyKeyRef.current) tryTake();
    };
    subscribeToEvent(CHAT_SHARE_DELIVER_EVENT, onShare);
    // A share queued while this chat was hidden (Chat parked in an
    // <Activity> runs no effects, so nothing heard it) goes in now.
    tryTake();
    return () => {
      unsubscribeFromEvent(CHAT_SHARE_DELIVER_EVENT, onShare);
      clearWait();
    };
  }, [clearWait, tryTake]);

  useEffect(() => {
    if (ready) tryTake();
  }, [ready, tryTake]);

  return useCallback(
    (readyKey: string) => {
      if (readyKeyRef.current !== readyKey) clearWait();
      readyKeyRef.current = readyKey;
      tryTake();
    },
    [clearWait, tryTake]
  );
}

/** Shared text as editor paragraphs (escaped; line breaks kept). */
export function sharedTextToHtml(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

type ShareEditor = {
  isEmpty?: boolean;
  state?: { doc?: { content?: { size?: number } } };
  commands: {
    setContent: (content: string, emitUpdate?: boolean) => unknown;
    insertContentAt: (position: number, content: string) => unknown;
  };
};

/**
 * Puts shared text in the composer: replaces an empty one, or goes after
 * what is already typed (a kept draft stays). Returns false without an
 * editor.
 */
export function insertSharedText(
  editor: ShareEditor | null | undefined,
  text: string
): boolean {
  if (!editor || !text.trim()) return false;
  const html = sharedTextToHtml(text.trim());
  if (editor.isEmpty) {
    // emitUpdate: the draft is saved and the send button shows.
    editor.commands.setContent(html, true);
  } else {
    const end = editor.state?.doc?.content?.size ?? 0;
    editor.commands.insertContentAt(end, html);
  }
  return true;
}
