import { forwardRef } from 'react';
import { Avatar, type AvatarProps } from '@mui/material';
import { useQdnAvatar, type QdnAvatarPriority } from '../../lib/qdnAvatars';

type QdnNameAvatarProps = Omit<AvatarProps, 'src'> & {
  /** Registered name whose QDN avatar to show (user, Q-App or website). */
  avatarName: string | null | undefined;
  /** QDN identifier; defaults to `qortal_avatar`. */
  avatarIdentifier?: string | null;
  avatarPriority?: QdnAvatarPriority;
  /** false: show the fallback only, without asking the node. */
  avatarEnabled?: boolean;
  /** An image to show instead of the QDN avatar (the cache is not asked). */
  overrideSrc?: string;
};

/**
 * MUI Avatar showing a name's QDN avatar from the device cache (or a bundled
 * seed). The children are the fallback while there is no image, and also when
 * the image fails to load. For rows rendered in a loop, where a hook cannot be
 * called directly.
 */
export const QdnNameAvatar = forwardRef<HTMLDivElement, QdnNameAvatarProps>(
  function QdnNameAvatar(
    {
      avatarName,
      avatarIdentifier,
      avatarPriority,
      avatarEnabled,
      overrideSrc,
      ...rest
    },
    ref
  ) {
    const hasOverride = overrideSrc !== undefined;
    const { src } = useQdnAvatar(avatarName, {
      identifier: avatarIdentifier,
      priority: avatarPriority,
      enabled: avatarEnabled !== false && !hasOverride,
    });
    return (
      <Avatar
        {...rest}
        ref={ref}
        src={hasOverride ? overrideSrc || undefined : src}
      />
    );
  }
);
