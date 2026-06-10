import { useEffect, useRef, useState } from 'react';
import { Avatar, type AvatarProps } from '@mui/material';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { buildAppThumbnailUrl } from '../../utils/walletAvatarCache';

const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 3;

type AppThumbnailAvatarProps = Omit<AvatarProps, 'src'> & {
  appName?: string;
  privateLogo?: string;
  fallbackSize?: number;
};

export function AppThumbnailAvatar({
  appName,
  privateLogo,
  fallbackSize = 31,
  sx,
  ...rest
}: AppThumbnailAvatarProps) {
  const baseUrl = privateLogo || (appName ? buildAppThumbnailUrl(appName) : undefined);
  const [src, setSrc] = useState<string | undefined>(baseUrl);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSrc(baseUrl);
    retryCountRef.current = 0;
  }, [baseUrl]);

  useEffect(
    () => () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    },
    []
  );

  const handleError = () => {
    if (!baseUrl || retryCountRef.current >= MAX_RETRIES) {
      setSrc(LogoSelected);
      return;
    }

    retryCountRef.current += 1;
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      setSrc(`${baseUrl}&_retry=${Date.now()}`);
    }, RETRY_DELAY_MS);
  };

  return (
    <Avatar
      {...rest}
      src={src}
      imgProps={{ onError: handleError }}
      sx={{
        '& img': { objectFit: 'fill' },
        ...sx,
      }}
    >
      <img
        style={{ width: `${fallbackSize}px`, height: 'auto' }}
        src={LogoSelected}
        alt=""
      />
    </Avatar>
  );
}
