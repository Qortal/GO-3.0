import { forwardRef, type ReactNode, type Ref } from 'react';
import { Avatar, type AvatarProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  useQdnAvatar,
  useQdnGroupAvatar,
  type QdnAvatarPriority,
  type QdnAvatarSnapshot,
} from '../../lib/qdnAvatars';

/**
 * MUI avatars backed by the device avatar cache (src/lib/qdnAvatars): the
 * cached image shows at once, also when the node is slow or unreachable, and
 * the children stay the fallback while there is no image.
 */

type CachedAvatarCommonProps = Omit<AvatarProps, 'src'> & {
  /** Queue position of the fetch. Default 'normal'. */
  priority?: QdnAvatarPriority;
  /** false: no lookup at all; the fallback shows. */
  enabled?: boolean;
  /**
   * Count this mount toward keeping the image cached (default true). false
   * for browse-only lists (search results, Find Groups), so they do not push
   * the user's own contacts out of the cache.
   */
  countUse?: boolean;
  /** Extra styles that depend on whether an image is shown. */
  sxWithImage?: (hasImage: boolean) => SxProps<Theme>;
};

type CachedUserAvatarProps = CachedAvatarCommonProps & {
  /** Registered name (user, Q-App or QDN website). */
  name?: string | null;
  /** QDN identifier; defaults to `qortal_avatar`. */
  identifier?: string | null;
};

type CachedGroupAvatarProps = CachedAvatarCommonProps & {
  /** Name of the group owner, who publishes the group avatar. */
  ownerName?: string | null;
  groupId?: string | number | null;
};

type SxEntry = Exclude<SxProps<Theme>, ReadonlyArray<unknown>>;

const toSxList = (sx: SxProps<Theme> | undefined): SxEntry[] => {
  if (sx == null) return [];
  return (Array.isArray(sx) ? sx : [sx]) as SxEntry[];
};

/** Combines the caller's sx with the image-dependent sx (later wins). */
export function mergeAvatarSx(
  sx: SxProps<Theme> | undefined,
  extra: SxProps<Theme> | undefined
): SxProps<Theme> | undefined {
  if (extra == null) return sx;
  if (sx == null) return extra;
  return [...toSxList(sx), ...toSxList(extra)];
}

/**
 * Without children, MUI showed the first letter of `alt` when a named avatar
 * failed to load, and a person icon when there was no name. Keep that.
 */
export function avatarFallback(
  children: ReactNode,
  hasName: boolean,
  alt: unknown
): ReactNode {
  if (children != null) return children;
  if (hasName && typeof alt === 'string' && alt) return alt.charAt(0);
  return undefined;
}

function renderCachedAvatar(
  props: CachedAvatarCommonProps,
  snapshot: QdnAvatarSnapshot,
  hasName: boolean,
  ref: Ref<HTMLDivElement>
) {
  const {
    children,
    sx,
    sxWithImage,
    priority: _priority,
    enabled: _enabled,
    countUse: _countUse,
    ...rest
  } = props;
  const src = snapshot.src;
  return (
    <Avatar
      {...rest}
      ref={ref}
      src={src}
      data-qdn-avatar={snapshot.status}
      sx={mergeAvatarSx(sx, sxWithImage?.(Boolean(src)))}
    >
      {avatarFallback(children, hasName, rest.alt)}
    </Avatar>
  );
}

/** Avatar of a registered name from the device cache. */
export const CachedUserAvatar = forwardRef<
  HTMLDivElement,
  CachedUserAvatarProps
>(function CachedUserAvatar({ name, identifier, ...props }, ref) {
  const snapshot = useQdnAvatar(name, {
    identifier,
    priority: props.priority,
    enabled: props.enabled !== false,
    countUse: props.countUse !== false,
  });
  const hasName = typeof name === 'string' && name.trim() !== '';
  return renderCachedAvatar(props, snapshot, hasName, ref);
});

/** Group avatar (published by the owner) from the device cache. */
export const CachedGroupAvatar = forwardRef<
  HTMLDivElement,
  CachedGroupAvatarProps
>(function CachedGroupAvatar({ ownerName, groupId, ...props }, ref) {
  const snapshot = useQdnGroupAvatar(ownerName, groupId, {
    priority: props.priority,
    enabled: props.enabled !== false,
    countUse: props.countUse !== false,
  });
  const hasName = typeof ownerName === 'string' && ownerName.trim() !== '';
  return renderCachedAvatar(props, snapshot, hasName, ref);
});
