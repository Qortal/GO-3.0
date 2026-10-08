import { atomWithReset } from 'jotai/utils';

/** A DM to open at one message (a message search result). */
export interface DirectMessageJump {
  /** The other person in the conversation. */
  address: string;
  /** The message to show (for an edit, the message it edits). Older
   * history is loaded from it when the chat has not loaded it. */
  eventId: string;
  /** A new jump to the same message scrolls to it again. */
  nonce: number;
}

/**
 * Set by the message search, then taken by the DM chat for `address` once it
 * opens (ChatDirect), which scrolls to the message.
 */
// atomWithReset: with strictNullChecks off, atom(null) would type as read-only.
export const directMessageJumpAtom = atomWithReset<DirectMessageJump | null>(
  null
);
