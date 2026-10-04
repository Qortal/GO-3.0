import { noteAvatarPublishedHere } from '../components/Group/avatarPreviewUrls';
import { markOwnQdnAvatarChecked } from '../hooks/useOwnQdnAvatarRefresh';
import { putQdnAvatarImage, refreshQdnAvatar } from '../lib/qdnAvatars';
import { setWalletAvatarCache } from './walletAvatarCache';

/**
 * After the user published a new own avatar (`dataUrl`, the published
 * file): shows it everywhere at once instead of after the cache's next
 * refresh, since a node that has not caught up would still hand back the old
 * file. Puts it in the avatar cache, keeps full-size loads off the old node
 * file for a while, and saves it for the account picker before login. When
 * the cache does not take it (not a recognisable image, too big), the node is
 * asked again instead, so the old avatar does not stay for a day. Resolves to
 * whether the cache took it. Never rejects.
 */
export async function applyPublishedOwnAvatar(
  name: string | null | undefined,
  dataUrl: string,
  address?: string | null
): Promise<boolean> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || typeof dataUrl !== 'string') return false;
  try {
    // Set before the put resolves: a session refresh started meanwhile
    // could fetch the old file from the node.
    markOwnQdnAvatarChecked(trimmed);
    noteAvatarPublishedHere(trimmed);
  } catch {
    // ignore
  }
  if (address) {
    void setWalletAvatarCache(address, dataUrl, trimmed).catch(() => undefined);
  }
  let stored = false;
  try {
    stored = await putQdnAvatarImage(trimmed, dataUrl);
  } catch {
    stored = false;
  }
  if (!stored) {
    try {
      refreshQdnAvatar(trimmed);
    } catch {
      // ignore
    }
  }
  return stored;
}
