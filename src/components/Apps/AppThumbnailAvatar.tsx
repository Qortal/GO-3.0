import { Avatar, type AvatarProps } from '@mui/material';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import type { QdnAvatarPriority } from '../../lib/qdnAvatars';
import { useViewportQdnAvatar } from './useViewportQdnAvatar';

type AppThumbnailAvatarProps = Omit<AvatarProps, 'src' | 'ref'> & {
  appName?: string;
  privateLogo?: string;
  fallbackSize?: number;
  /** Queue position of the icon fetch while on screen. Default 'normal'. */
  priority?: QdnAvatarPriority;
};

/**
 * Icon of a Q-App or QDN website: the private app's own logo when it has one,
 * otherwise the name's QDN avatar from the device cache (or the icon GO ships
 * for well-known Q-Apps), and the Qortal logo while there is none or when the
 * image cannot be shown. A slow node never leaves an empty circle. In lists,
 * the node is asked for the icons on screen first.
 */
export function AppThumbnailAvatar({
  appName,
  privateLogo,
  fallbackSize = 31,
  priority,
  sx,
  ...rest
}: AppThumbnailAvatarProps) {
  const { snapshot, ref } = useViewportQdnAvatar(appName, {
    enabled: !privateLogo,
    priority,
  });
  const src = privateLogo || snapshot.src;

  return (
    <Avatar
      {...rest}
      ref={ref}
      src={src}
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
