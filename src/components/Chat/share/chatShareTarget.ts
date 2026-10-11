/**
 * Where something shared from another Android app goes, after the share-sheet
 * entry that was used: "GO Groups" and "GO DMs" open that list with the share
 * waiting in its header (the chat tapped there takes it), "GO Self-DM" puts it
 * straight into Saved Messages.
 */
import { directDraftKey, groupDraftKey } from '../../../utils/chatPersistence';

export type ChatShareScope = 'groups' | 'directs' | 'self';

export type ChatShareChat =
  /** `channelId`: the channel picked in the share's channel step. */
  | { kind: 'group'; groupId: string; channelId?: string }
  | { kind: 'dm'; address: string };

/** ShareReceiverPlugin's target for each entry (ShareTrampolineActivity). */
const SCOPE_BY_TARGET = new Map<string, ChatShareScope>([
  ['chats:groups', 'groups'],
  ['chats:directs', 'directs'],
  ['chats:self', 'self'],
]);

/** The list (or Saved Messages) the share is for; null when unknown. */
export function parseShareTarget(target: unknown): ChatShareScope | null {
  if (typeof target !== 'string') return null;
  return SCOPE_BY_TARGET.get(target) ?? null;
}

/** Same keys as the chat drafts: one per group, one per DM partner. */
export function chatShareKey(chat: ChatShareChat): string {
  return chat.kind === 'group'
    ? groupDraftKey(chat.groupId)
    : directDraftKey(chat.address);
}
