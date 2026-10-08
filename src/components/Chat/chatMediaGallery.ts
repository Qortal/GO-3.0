/**
 * The pictures and videos of the open chat, oldest first, for swiping
 * through them in the full-screen viewer (ReticulumImageViewer): Reticulum
 * resources (an inline picture, or a file attachment that is a picture or a
 * video), library GIFs, and QDN pictures (a message's picture, or an image
 * embed link in its text). Whether one can be shown is checked when the
 * viewer gets to it (see `resolveChatMediaItem`).
 */
import { createContext } from 'react';
import { getDefaultStore } from 'jotai';
import { blobControllerAtom } from '../../atoms/global';
import { getBaseApiReact } from '../../utils/globalApi';
import { parseQortalLink } from '../Embeds/embed-utils';
import { requestLibraryGifUrl } from './gifs/gifMediaCache';
import { isLibraryGifImage } from './gifs/libraryGifs';

export type ChatMediaKind = 'image' | 'video';

export type QdnPicture = {
  service: string;
  name: string;
  identifier: string;
  /** Decrypted by the embed in the chat; the viewer can only reuse that. */
  encrypted: boolean;
};

export type ChatMediaItem = {
  /** Unique in the chat: message signature plus which attachment. */
  key: string;
  /** The message's signature. */
  messageKey: string;
  kind: ChatMediaKind;
  fileName?: string;
  mimeType?: string;
  /** Where it comes from: exactly one of these is set. */
  fileHash?: string;
  gif?: { name: string; identifier: string };
  qdn?: QdnPicture;
  /** An inline `data:` picture. */
  url?: string;
};

type ResourceView = {
  reticulumResource?: unknown;
  fileHash?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  metadata?: { originalMimeType?: unknown } | null;
};

type MessageView = {
  signature?: unknown;
  isTemp?: unknown;
  deleted?: unknown;
  reticulumChat?: unknown;
  reticulumDirect?: unknown;
  images?: unknown;
  attachments?: unknown;
  messageText?: unknown;
  text?: unknown;
};

type ImageView = ResourceView & {
  name?: unknown;
  identifier?: unknown;
  service?: unknown;
  libraryGif?: unknown;
  dataUrl?: unknown;
  base64?: unknown;
};

const EMBED_LINK = /qortal:\/\/use-embed\/[^\s<>"']+/;

/** The picture an image embed link in the message's text points at. */
const embeddedPicture = (message: MessageView): QdnPicture | null => {
  const html =
    typeof message.messageText === 'string'
      ? message.messageText
      : typeof message.text === 'string'
        ? message.text
        : '';
  const link = html.match(EMBED_LINK)?.[0];
  if (!link) return null;
  try {
    const parsed = parseQortalLink(link) as Record<string, unknown>;
    if (String(parsed?.type ?? '').toUpperCase() !== 'IMAGE') return null;
    const service = textOf(parsed.service);
    const name = textOf(parsed.name);
    const identifier = textOf(parsed.identifier);
    if (!service || !name || !identifier) return null;
    return {
      service,
      name,
      identifier,
      encrypted: Boolean(parsed.encryptionType || parsed.key),
    };
  } catch {
    return null;
  }
};

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|3gp|ogv)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i;

const asResource = (value: unknown): ResourceView | null =>
  value && typeof value === 'object' ? (value as ResourceView) : null;

const textOf = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const mimeOf = (resource: ResourceView) =>
  textOf(resource.mimeType) ?? textOf(resource.metadata?.originalMimeType);

/** What a file attachment is, by its type or else its name. */
export const mediaKindOf = (
  mimeType?: string,
  fileName?: string
): ChatMediaKind | null => {
  const mime = mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (fileName && VIDEO_EXTENSIONS.test(fileName)) return 'video';
  if (fileName && IMAGE_EXTENSIONS.test(fileName)) return 'image';
  return null;
};

/** The chat's pictures and videos, in the order of `messages` (oldest first). */
export const collectChatMedia = (
  messages: readonly unknown[]
): ChatMediaItem[] => {
  const items: ChatMediaItem[] = [];
  const seen = new Set<string>();
  const push = (item: ChatMediaItem) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push(item);
  };
  for (const raw of messages) {
    const message = raw as MessageView | null;
    if (!message || typeof message !== 'object') continue;
    if (message.isTemp === true || message.deleted === true) continue;
    const signature = textOf(message.signature);
    if (!signature) continue;
    const isReticulum =
      message.reticulumChat === true || message.reticulumDirect === true;
    const image = asResource(
      Array.isArray(message.images) ? message.images[0] : null
    ) as ImageView | null;
    const imageHash = textOf(image?.fileHash);
    if (image?.reticulumResource === true && imageHash) {
      if (isReticulum) {
        push({
          key: `${signature}:image`,
          messageKey: signature,
          fileHash: imageHash,
          kind: 'image',
          fileName: textOf(image.fileName),
          mimeType: mimeOf(image),
        });
      }
    } else if (image && isLibraryGifImage(image as never)) {
      push({
        key: `${signature}:gif`,
        messageKey: signature,
        gif: { name: String(image.name), identifier: String(image.identifier) },
        kind: 'image',
        fileName: `${String(image.identifier)}.gif`,
        mimeType: 'image/gif',
      });
    } else if (image && (textOf(image.dataUrl) || textOf(image.base64))) {
      const url =
        textOf(image.dataUrl) ??
        `data:${mimeOf(image) || 'image/webp'};base64,${textOf(image.base64)}`;
      if (url.startsWith('data:image/')) {
        push({
          key: `${signature}:image-data`,
          messageKey: signature,
          url,
          kind: 'image',
          mimeType: mimeOf(image),
        });
      }
    } else if (
      image &&
      textOf(image.name) &&
      textOf(image.identifier) &&
      textOf(image.service)
    ) {
      const identifier = String(textOf(image.identifier));
      push({
        key: `${signature}:image-embed`,
        messageKey: signature,
        qdn: {
          service: String(textOf(image.service)),
          name: String(textOf(image.name)),
          identifier,
          encrypted: identifier.startsWith('grp-q-manager_0'),
        },
        kind: 'image',
        mimeType: mimeOf(image),
      });
    }
    const embedded = embeddedPicture(message);
    if (embedded) {
      push({
        key: `${signature}:embed`,
        messageKey: signature,
        qdn: embedded,
        kind: 'image',
      });
    }
    if (!isReticulum || !Array.isArray(message.attachments)) continue;
    message.attachments.forEach((value, index) => {
      const attachment = asResource(value);
      const hash = textOf(attachment?.fileHash);
      if (attachment?.reticulumResource !== true || !hash) return;
      const fileName = textOf(attachment.fileName);
      const mimeType = mimeOf(attachment);
      const kind = mediaKindOf(mimeType, fileName);
      if (!kind) return;
      push({
        key: `${signature}:attachment:${index}`,
        messageKey: signature,
        fileHash: hash,
        kind,
        fileName,
        mimeType,
      });
    });
  }
  return items;
};

export type ChatMediaGallerySource = {
  /** The open chat's pictures and videos right now, oldest first. */
  getItems: () => ChatMediaItem[];
};

/** Provided by ChatList, read by the viewer a message opens. */
export const ChatMediaGalleryContext =
  createContext<ChatMediaGallerySource | null>(null);

export type ResolvedChatMedia =
  | { status: 'ready'; src: string }
  /** On this device, but not read into a URL yet (a video until shown). */
  | { status: 'available' }
  | { status: 'missing' };

/**
 * Whether `item` is on this device, and its URL when `load` is set. A video
 * is only loaded when asked: on a phone that reads the whole file into
 * memory, so neighbours are just checked.
 */
const encodeSegment = (value: string) => encodeURIComponent(value);

const resolveQdnPicture = async (
  picture: QdnPicture
): Promise<ResolvedChatMedia> => {
  // The embed in the chat may already have it (decrypted, for a group's).
  const cached = (
    getDefaultStore().get(blobControllerAtom) as Record<
      string,
      { blobUrl?: string } | undefined
    >
  )?.[`${picture.service}-${picture.name}-${picture.identifier}`]?.blobUrl;
  if (cached) return { status: 'ready', src: cached };
  if (picture.encrypted) return { status: 'missing' };
  const path = `${encodeSegment(picture.service)}/${encodeSegment(
    picture.name
  )}/${encodeSegment(picture.identifier)}`;
  try {
    const response = await fetch(
      `${getBaseApiReact()}/arbitrary/resource/status/${path}`
    );
    const status = (await response.json())?.status;
    return status === 'READY' || status === 'DOWNLOADED'
      ? { status: 'ready', src: `${getBaseApiReact()}/arbitrary/${path}` }
      : { status: 'missing' };
  } catch {
    return { status: 'missing' };
  }
};

export const resolveChatMediaItem = async (
  item: ChatMediaItem,
  load: boolean
): Promise<ResolvedChatMedia> => {
  if (item.url) return { status: 'ready', src: item.url };
  if (item.gif) {
    try {
      const src = await requestLibraryGifUrl(item.gif, 12);
      return src ? { status: 'ready', src } : { status: 'missing' };
    } catch {
      return { status: 'missing' };
    }
  }
  if (item.qdn) return resolveQdnPicture(item.qdn);
  if (!item.fileHash) return { status: 'missing' };
  const resources = window.reticulumResources;
  if (!resources) return { status: 'missing' };
  try {
    const status = await resources.getStatus?.(item.fileHash);
    if (!status?.success || !status.complete) return { status: 'missing' };
    if (!load) return { status: 'available' };
    const result = await resources.getUrl(item.fileHash);
    return result?.success && result.url
      ? { status: 'ready', src: result.url }
      : { status: 'missing' };
  } catch {
    return { status: 'missing' };
  }
};

/** The item for this message's picture: a QDN picture by its address. */
export const findChatMediaIndex = (
  items: readonly ChatMediaItem[],
  match: {
    messageKey?: string;
    qdn?: { service?: string; name?: string; identifier?: string } | null;
    gif?: boolean;
  }
): number => {
  const sameQdn = (item: ChatMediaItem) =>
    Boolean(
      match.qdn &&
      item.qdn &&
      item.qdn.service === match.qdn.service &&
      item.qdn.name === match.qdn.name &&
      item.qdn.identifier === match.qdn.identifier
    );
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      match.gif ? Boolean(item.gif) : match.qdn ? sameQdn(item) : false
    );
  const exact = candidates.find(
    ({ item }) => match.messageKey && item.messageKey === match.messageKey
  );
  return (exact ?? candidates[candidates.length - 1])?.index ?? -1;
};
