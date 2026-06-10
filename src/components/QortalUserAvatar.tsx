import { forwardRef, useEffect, useRef, useState } from 'react';
import { Avatar, type AvatarProps } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import {
  buildQortalAvatarUrl,
  resolveWalletAvatarSrc,
  type WalletAvatarCacheEntry,
} from '../utils/walletAvatarCache';

const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 3;

// Session-scoped memory of which avatar URLs resolved or definitively failed.
// Without it, every mount of an avatar-less user re-attempted the full
// initial + 3 cache-busted retries (4 futile network hits per list row).
const avatarUrlOutcome = new Map<string, 'ok' | 'failed'>();

type QortalUserAvatarProps = Omit<AvatarProps, 'src'> & {
  primaryName?: string | null;
  walletAddress?: string;
  cachedAvatarEntry?: WalletAvatarCacheEntry | null;
  srcOverride?: string | null;
  fallbackIconSize?: number;
};

export const QortalUserAvatar = forwardRef<HTMLDivElement, QortalUserAvatarProps>(
  function QortalUserAvatar(
    {
      primaryName,
      walletAddress,
      cachedAvatarEntry,
      srcOverride,
      fallbackIconSize = 28,
      sx,
      ...rest
    },
    ref
  ) {
  const baseSrc =
    srcOverride ??
    resolveWalletAvatarSrc({
      primaryName,
      walletAddress,
      cachedAvatarEntry,
    });
  const knownOutcome = baseSrc ? avatarUrlOutcome.get(baseSrc) : undefined;
  const [src, setSrc] = useState<string | undefined>(
    knownOutcome === 'failed' ? undefined : baseSrc
  );
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const outcome = baseSrc ? avatarUrlOutcome.get(baseSrc) : undefined;
    setSrc(outcome === 'failed' ? undefined : baseSrc);
    retryCountRef.current = 0;
  }, [baseSrc]);

  useEffect(
    () => () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    },
    []
  );

  const handleLoad = () => {
    if (baseSrc) avatarUrlOutcome.set(baseSrc, 'ok');
  };

  const handleError = () => {
    if (!baseSrc || retryCountRef.current >= MAX_RETRIES) {
      if (baseSrc) avatarUrlOutcome.set(baseSrc, 'failed');
      setSrc(undefined);
      return;
    }

    // A previously-confirmed URL failing now is likely transient; don't burn
    // retries with cache busters.
    if (avatarUrlOutcome.get(baseSrc) === 'ok') {
      setSrc(undefined);
      return;
    }

    retryCountRef.current += 1;
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      const separator = baseSrc.includes('?') ? '&' : '?';
      setSrc(`${baseSrc}${separator}_retry=${Date.now()}`);
    }, RETRY_DELAY_MS);
  };

  return (
    <Avatar
      {...rest}
      ref={ref}
      src={src}
      imgProps={{ onError: handleError, onLoad: handleLoad }}
      sx={{
        '& img': { objectFit: 'cover' },
        ...sx,
      }}
    >
      <PersonIcon sx={{ fontSize: fallbackIconSize }} />
    </Avatar>
  );
});

export { buildQortalAvatarUrl, resolveWalletAvatarSrc };
