import { forwardRef, useEffect } from 'react';
import { Avatar, type AvatarProps } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import {
  putQdnAvatarImage,
  qdnAvatarKey,
  useQdnAvatar,
  type QdnAvatarPriority,
  type QdnAvatarSnapshot,
} from '../lib/qdnAvatars';
import {
  walletAvatarCacheMatchesName,
  type WalletAvatarCacheEntry,
} from '../utils/walletAvatarCache';
import {
  markOwnQdnAvatarChecked,
  useOwnQdnAvatarRefresh,
} from '../hooks/useOwnQdnAvatarRefresh';
import {
  FULL_SIZE_AVATAR_MIN_PX,
  useFullSizeQdnAvatarSrc,
} from '../hooks/useFullSizeQdnAvatarSrc';

type QortalUserAvatarProps = Omit<AvatarProps, 'src'> & {
  primaryName?: string | null;
  /** Accepted for older callers; never sent to the node. */
  walletAddress?: string;
  /** This device's saved avatar of the wallet (shown at once, offline too). */
  cachedAvatarEntry?: WalletAvatarCacheEntry | null;
  /**
   * Shown instead of any looked-up avatar. An empty string means "no image"
   * and keeps the node out of it (the wallet picker sends the node nothing).
   */
  srcOverride?: string | null;
  fallbackIconSize?: number;
  /** Queue position of the avatar fetch. Default 'normal' ('high' for own). */
  avatarPriority?: QdnAvatarPriority;
  /**
   * The signed-in user's own avatar: fetched first, and asked from the node
   * once per app session even when the device copy is fresh (it may have been
   * changed from a Q-App or another device).
   */
  ownAvatar?: boolean;
  /**
   * Load the full-size node image once the cached copy (at most 128 px) is
   * shown, for big avatars (unlock screen). Default: on when `sx` gives a
   * numeric width or height above 64 px.
   */
  fullSize?: boolean;
};

/** True when `sx` sets a numeric width or height above 64 px. */
function hasBigSx(sx: AvatarProps['sx']): boolean {
  if (!sx || typeof sx !== 'object' || Array.isArray(sx)) return false;
  const style = sx as Record<string, unknown>;
  const size = Math.max(Number(style.width) || 0, Number(style.height) || 0);
  return size > FULL_SIZE_AVATAR_MIN_PX;
}

/** The wallet copy was saved for exactly this name (not a legacy entry). */
function isExactNameEntry(
  name: string,
  entry: WalletAvatarCacheEntry | null | undefined
): boolean {
  const saved = entry?.primaryName?.trim().toLowerCase();
  return !!name && !!saved && saved === name.toLowerCase();
}

/** The wallet's saved data URL, when it belongs to this name. */
function walletDataUrlFor(
  primaryName: string,
  entry: WalletAvatarCacheEntry | null | undefined
): string | undefined {
  if (!entry?.dataUrl?.startsWith('data:')) return undefined;
  if (primaryName && !walletAvatarCacheMatchesName(entry, primaryName)) {
    return undefined;
  }
  return entry.dataUrl;
}

/**
 * Which image a QortalUserAvatar shows: the override, else the loaded
 * full-size node image, else (big avatars) the wallet copy saved for exactly
 * this name, which is full size too, else the cached node image, else the
 * wallet avatar saved on this device, else a bundled seed.
 * undefined = the person icon.
 */
export function pickQortalUserAvatarSrc(options: {
  srcOverride?: string | null;
  primaryName?: string | null;
  cachedAvatarEntry?: WalletAvatarCacheEntry | null;
  cached: QdnAvatarSnapshot;
  /** Full-size node image, once loaded. */
  fullSizeSrc?: string;
  /** Prefer the exact-name wallet copy over the (128 px) cached image. */
  preferWalletCopy?: boolean;
}): string | undefined {
  if (options.srcOverride != null) return options.srcOverride || undefined;
  const name = options.primaryName?.trim() ?? '';
  const walletDataUrl = walletDataUrlFor(name, options.cachedAvatarEntry);
  if (!name) return walletDataUrl;
  if (options.fullSizeSrc) return options.fullSizeSrc;
  if (
    options.preferWalletCopy &&
    walletDataUrl &&
    isExactNameEntry(name, options.cachedAvatarEntry)
  ) {
    return walletDataUrl;
  }
  if (options.cached.source === 'cache' && options.cached.src) {
    return options.cached.src;
  }
  return walletDataUrl ?? options.cached.src;
}

// Names whose wallet avatar was already copied into the shared cache.
const sharedWalletAvatars = new Set<string>();

export const QortalUserAvatar = forwardRef<
  HTMLDivElement,
  QortalUserAvatarProps
>(function QortalUserAvatar(
  {
    primaryName,
    walletAddress: _walletAddress,
    cachedAvatarEntry,
    srcOverride,
    fallbackIconSize = 28,
    avatarPriority,
    ownAvatar = false,
    fullSize,
    sx,
    ...rest
  },
  ref
) {
  const name = primaryName?.trim() ?? '';
  const cacheEnabled = srcOverride == null && !!name;
  const cached = useQdnAvatar(name, {
    enabled: cacheEnabled,
    priority: avatarPriority ?? (ownAvatar ? 'high' : 'normal'),
  });
  useOwnQdnAvatarRefresh(name, cached.status, ownAvatar && cacheEnabled);
  const wantsFullSize = fullSize ?? hasBigSx(sx);
  const full = useFullSizeQdnAvatarSrc(
    name,
    cached,
    cacheEnabled && wantsFullSize
  );
  const src = pickQortalUserAvatarSrc({
    srcOverride,
    primaryName: name,
    cachedAvatarEntry,
    cached,
    fullSizeSrc: full.isFullSize ? full.src : undefined,
    // Right after a publish here the cached copy is the new image and the
    // wallet copy handed in may still be the old one.
    preferWalletCopy: wantsFullSize && !full.justPublished,
  });

  // The node has no answer for this name (confirmed missing: not synced; or
  // failed: slow or unreachable), but the device has the wallet's copy:
  // share it so chat, Home and other screens show it too. The cache asks the
  // node again 10 min later (putImage), and a newer node avatar replaces the
  // copy. Not while a fetch is running ('loading'): the put would drop it.
  // Only a copy saved for exactly this name (an older entry without a name
  // may belong to a previous name of the address).
  const shareableDataUrl =
    srcOverride == null && isExactNameEntry(name, cachedAvatarEntry)
      ? walletDataUrlFor(name, cachedAvatarEntry)
      : undefined;
  const nodeGaveNoImage =
    cached.source !== 'cache' &&
    (cached.status === 'missing' || cached.status === 'failed');
  useEffect(() => {
    if (!shareableDataUrl || !nodeGaveNoImage) return;
    const key = qdnAvatarKey(name);
    if (!key || sharedWalletAvatars.has(key)) return;
    sharedWalletAvatars.add(key);
    // Wallet copies are own avatars: the cache re-checks the node 10 min
    // after the put, so the once-per-session refresh is not needed on top.
    markOwnQdnAvatarChecked(name);
    void putQdnAvatarImage(name, shareableDataUrl).catch(() => false);
  }, [name, nodeGaveNoImage, shareableDataUrl]);

  // MUI Avatar falls back to the children when the image fails to load.
  return (
    <Avatar
      {...rest}
      ref={ref}
      src={src}
      sx={{
        '& img': { objectFit: 'cover' },
        ...sx,
      }}
    >
      <PersonIcon sx={{ fontSize: fallbackIconSize }} />
    </Avatar>
  );
});

/** Tests only: forget which wallet avatars were shared this session. */
export function resetSharedWalletAvatarsForTests(): void {
  sharedWalletAvatars.clear();
}
