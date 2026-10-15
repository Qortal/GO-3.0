/**
 * A group channel's unsent attachments wait in that channel while another
 * one is open, like its draft text (chatPersistence's groupChannelDraftKey):
 * a channel switch parks what the composer holds under the draft key it was
 * picked for and brings back what was parked for the key opened. They live
 * as long as the open chat; only the text is saved across restarts.
 */
export type ComposerAttachments<File, Gif> = {
  files: File[];
  gif: Gif | null;
};

export function hasComposerAttachments<File, Gif>(
  attachments: ComposerAttachments<File, Gif>
): boolean {
  return attachments.files.length > 0 || attachments.gif != null;
}

/**
 * The composer moves from `fromKey` to `toKey`: `current` is parked under
 * `fromKey` (when it holds anything) and the attachments for `toKey` come
 * out of `parked`. Returns what the composer holds next.
 */
export function swapParkedAttachments<File, Gif>(
  parked: Map<string, ComposerAttachments<File, Gif>>,
  fromKey: string | null,
  toKey: string,
  current: ComposerAttachments<File, Gif>
): ComposerAttachments<File, Gif> {
  if (fromKey === toKey) return current;
  if (fromKey !== null && hasComposerAttachments(current)) {
    parked.set(fromKey, current);
  }
  const next = parked.get(toKey) ?? { files: [], gif: null };
  parked.delete(toKey);
  return next;
}
