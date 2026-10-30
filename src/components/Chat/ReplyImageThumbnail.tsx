/**
 * The small square picture in a reply: the composer's reply strip and the
 * quote on a sent reply (Telegram style).
 *
 * It only shows what this device already has. A Reticulum picture is read
 * from the local resource store once its own row has downloaded it, a library
 * GIF from the GIF memory cache, and a private QDN picture from the blob the
 * chat's embed already decrypted. It never starts a download, never makes a
 * network request and never revokes an object URL: every URL it uses belongs
 * to someone else (the mobile resource blob map, gifMediaCache,
 * blobControllerAtom).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { alpha, Box, useTheme, type SxProps, type Theme } from '@mui/material';
import GifRoundedIcon from '@mui/icons-material/GifRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { blobKeySelector } from '../../atoms/global';
import {
  peekLibraryGifUrl,
  subscribeLibraryGifCached,
} from './gifs/gifMediaCache';
import {
  isSafeReplyThumbnailSrc,
  REPLY_THUMBNAIL_MAX_RESOURCE_BYTES,
  type ReplyMedia,
} from './replyMedia';

// Under the desktop's 20 min resource URL token lifetime; mobile blob URLs
// never expire.
const URL_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;
const NO_QDN_KEY = '__no_reply_qdn__';

const urlCache = new Map<string, { url: string; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

const peekCachedUrl = (hash: string): string | null => {
  const entry = urlCache.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.at >= URL_TTL_MS) {
    urlCache.delete(hash);
    return null;
  }
  return entry.url;
};

const rememberUrl = (hash: string, url: string) => {
  urlCache.delete(hash);
  urlCache.set(hash, { url, at: Date.now() });
  while (urlCache.size > MAX_ENTRIES) {
    const oldest = urlCache.keys().next().value;
    if (oldest === undefined) break;
    urlCache.delete(oldest);
  }
};

const lookUpLocalUrl = async (hash: string): Promise<string | null> => {
  const resources =
    typeof window !== 'undefined' ? window.reticulumResources : undefined;
  if (
    typeof resources?.getStatus !== 'function' ||
    typeof resources?.getUrl !== 'function'
  ) {
    return null;
  }
  let status: Awaited<ReturnType<typeof resources.getStatus>> | null = null;
  try {
    status = await resources.getStatus(hash);
  } catch {
    return null;
  }
  // Only a file this device has fully assembled; nothing is fetched here.
  if (!status?.success || status.complete !== true) return null;
  const manifest =
    status.manifest && typeof status.manifest === 'object'
      ? (status.manifest as Record<string, unknown>)
      : null;
  if (manifest?.encrypted === true) return null;
  const mime =
    typeof manifest?.mimeType === 'string'
      ? manifest.mimeType.trim().toLowerCase()
      : '';
  if (mime && !mime.startsWith('image/')) return null;
  // The local manifest is authoritative for the size.
  const size = Number(status.totalBytes ?? manifest?.sizeBytes);
  if (Number.isFinite(size) && size >= REPLY_THUMBNAIL_MAX_RESOURCE_BYTES) {
    return null;
  }
  let result: Awaited<ReturnType<typeof resources.getUrl>> | null = null;
  try {
    result = await resources.getUrl(hash);
  } catch {
    return null;
  }
  const url = result?.success ? result.url : null;
  if (!isSafeReplyThumbnailSrc(url)) return null;
  rememberUrl(hash, url);
  return url;
};

/**
 * A displayable URL for a Reticulum picture this device already has, or null.
 * Reads only the local resource store (`getStatus`, then `getUrl`); never
 * requests the resource from peers. `fresh` skips joining a lookup that
 * started earlier, for when the resource has just completed.
 */
export async function resolveLocalReticulumThumbnailUrl(
  fileHash: string,
  options: { fresh?: boolean } = {}
): Promise<string | null> {
  const hash = typeof fileHash === 'string' ? fileHash : '';
  if (!hash.trim()) return null;
  const cached = peekCachedUrl(hash);
  if (cached) return cached;
  const running = options.fresh ? undefined : inflight.get(hash);
  if (running) return running;
  const lookup = lookUpLocalUrl(hash).catch(() => null);
  inflight.set(hash, lookup);
  try {
    return await lookup;
  } finally {
    if (inflight.get(hash) === lookup) inflight.delete(hash);
  }
}

const forgetReticulumThumbnailUrl = (hash: string) => urlCache.delete(hash);

export const __resetReplyThumbnailCacheForTests = () => {
  urlCache.clear();
  inflight.clear();
};

const noSubscription = () => () => {};
const noSnapshot = () => null;

/**
 * The thumbnail's src for `media`, or null for an icon. `onError` marks the
 * src as failed; a Reticulum URL gets one fresh lookup first (an expired
 * desktop token).
 */
function useReplyThumbnailSrc(media: ReplyMedia | null): {
  src: string | null;
  onError: () => void;
} {
  const source = media?.source;
  const mediaKey = media?.key ?? '';
  const fileHash = source?.via === 'reticulum' ? source.fileHash : '';
  const gif = source?.via === 'library-gif' ? source.gif : null;
  const qdnKey = source?.via === 'qdn' ? source.qdnKey : null;

  const [resolved, setResolved] = useState<{
    hash: string;
    url: string;
  } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const retriedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fileHash) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const stop = () => {
      const current = unsubscribe;
      unsubscribe = null;
      if (!current) return;
      try {
        current();
      } catch {
        /* already gone */
      }
    };
    const run = (fresh: boolean) => {
      void resolveLocalReticulumThumbnailUrl(fileHash, { fresh }).then(
        (url) => {
          if (cancelled) return;
          if (url) {
            stop();
            setResolved({ hash: fileHash, url });
            return;
          }
          // Not on this device yet: wait for the original row's own
          // download to finish rather than asking for it.
          const onResource = window.reticulumChat?.onResource;
          if (unsubscribe || typeof onResource !== 'function') return;
          try {
            const off = onResource((payload) => {
              if (cancelled) return;
              if (
                payload?.fileHash === fileHash &&
                payload?.complete === true
              ) {
                run(true);
              }
            });
            unsubscribe = typeof off === 'function' ? off : null;
          } catch {
            unsubscribe = null;
          }
        }
      );
    };
    run(false);
    return () => {
      cancelled = true;
      stop();
    };
  }, [fileHash, mediaKey, retryNonce]);

  const gifUrl = useSyncExternalStore(
    gif ? subscribeLibraryGifCached : noSubscription,
    gif ? () => peekLibraryGifUrl(gif) : noSnapshot
  );

  // Hooks run unconditionally, so a sentinel key stands in when the source is
  // not a QDN picture. The jotai context store is used, as Embed does.
  const qdnBlob = useAtomValue(blobKeySelector(qdnKey ?? NO_QDN_KEY)) as {
    blobUrl?: unknown;
  } | null;

  let candidate: unknown = null;
  if (source?.via === 'data') {
    candidate = source.src;
  } else if (source?.via === 'reticulum') {
    candidate =
      resolved?.hash === fileHash ? resolved.url : peekCachedUrl(fileHash);
  } else if (source?.via === 'library-gif') {
    candidate = gifUrl;
  } else if (source?.via === 'qdn') {
    candidate = qdnBlob?.blobUrl ?? null;
  }
  const safe = isSafeReplyThumbnailSrc(candidate) ? candidate : null;
  const src = safe && failed !== `${mediaKey}|${safe}` ? safe : null;

  const onError = useCallback(() => {
    if (!src) return;
    setFailed(`${mediaKey}|${src}`);
    if (fileHash && retriedKeyRef.current !== mediaKey) {
      retriedKeyRef.current = mediaKey;
      forgetReticulumThumbnailUrl(fileHash);
      setRetryNonce((value) => value + 1);
    }
  }, [fileHash, mediaKey, src]);

  return { src, onError };
}

type ReplyImageThumbnailProps = {
  media: ReplyMedia;
  /** Width and height, a CSS length such as `'36px'` or `qchatTextSize(40)`. */
  size: string;
  /** True when text next to it already says what it is (empty alt). */
  decorative?: boolean;
  onClick?: () => void;
  sx?: SxProps<Theme>;
};

const KIND_ICONS = {
  image: ImageRoundedIcon,
  gif: GifRoundedIcon,
  video: VideocamRoundedIcon,
} as const;

/** Icon size as a share of the thumbnail; the bare GIF letters need more. */
const KIND_ICON_SCALE = { image: 0.55, gif: 0.8, video: 0.55 } as const;

export function ReplyImageThumbnail({
  media,
  size,
  decorative = false,
  onClick,
  sx,
}: ReplyImageThumbnailProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { src, onError } = useReplyThumbnailSrc(media);
  // The src whose picture has drawn; the icon under it then goes, so a
  // transparent picture does not show it through.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // Files keep today's look: text only.
  if (!media || media.kind === 'file') return null;
  const Icon = KIND_ICONS[media.kind] ?? ImageRoundedIcon;
  const iconScale = KIND_ICON_SCALE[media.kind] ?? 0.55;

  return (
    <Box
      data-testid="reply-thumbnail"
      onClick={onClick}
      sx={[
        {
          alignItems: 'center',
          backgroundColor: alpha(theme.palette.text.primary, 0.08),
          borderRadius: '6px',
          display: 'flex',
          flexShrink: 0,
          height: size,
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          width: size,
          // A hairline edge drawn over the picture, so a white picture on a
          // light card or a black one on a dark card keeps its outline.
          '&::after': {
            borderRadius: 'inherit',
            boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.12)}`,
            content: '""',
            inset: 0,
            pointerEvents: 'none',
            position: 'absolute',
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* The icon stays under the picture until it has drawn, with no change
          in size. */}
      {(!src || loadedSrc !== src) && (
        <Icon
          aria-hidden
          sx={{
            color: 'text.secondary',
            fontSize: `calc(${size} * ${iconScale})`,
          }}
        />
      )}
      {src && (
        <Box
          component="img"
          src={src}
          alt={
            decorative
              ? ''
              : t('core:reply_preview.thumbnail_alt', {
                  postProcess: 'capitalizeFirstChar',
                })
          }
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={onError}
          onLoad={() => setLoadedSrc(src)}
          sx={{
            display: 'block',
            height: '100%',
            inset: 0,
            objectFit: 'cover',
            position: 'absolute',
            width: '100%',
          }}
        />
      )}
    </Box>
  );
}
