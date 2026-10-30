/**
 * Publish a public Torq post from the Home composer.
 *
 * Mirrors Torq's `publishPost` (Torq repo, src/utils/postQdn.ts): Torq posts
 * ARE Quitter posts (same `quitter` identifiers and DOCUMENT), plus Torq-only
 * fields (`gifs`, `attachments`, `poll`, `richText`, `videos[].source`) and
 * compat links appended to `text` so Quitter readers still get a link.
 */
import ShortUniqueId from 'short-unique-id';
import { objectToBase64 } from '../../../qdn/encryption/group-encryption';
import { compressImageFile } from '../../../utils/imageCompression';
import { stripAttachmentMetadata } from '../../../utils/stripFileMetadata';
import {
  discardPublishFile,
  stashPublishFile,
} from '../../../utils/publishFileStash';
import i18n from '../../../i18n/i18n';
import type { LibraryGif } from '../../Chat/gifs/libraryGifs';
import { buildQuitterPostIdentifier } from './quitterIdentity';
import {
  assertPostFitsQuitter,
  buildQtubeVideoResources,
  encodeImageForPost,
  firstMentionKeyword,
  normalizePostText,
  POST_IMAGE_BUDGET,
  publishMultipleResources,
  QuitterPublishCancelledError,
  shrinkPostImagesToBudget,
  throwIfVideoPublishFailed,
  type QtubeVideoResources,
  type QuitterPublishVideo,
} from './quitterPublish';

export const TORQ_MAX_IMAGES = 10;
/** Quitter's grid shows two rows of two and clips the rest. */
export const QUITTER_VISIBLE_IMAGES = 4;
export const TORQ_MAX_GIFS = 4;
export const TORQ_MIN_POLL_OPTIONS = 2;
export const TORQ_MAX_POLL_OPTIONS = 6;
export const TORQ_MAX_POLL_OPTION_LENGTH = 80;
/** Torq rejects attachments of 2 GB and up. */
export const TORQ_MAX_FILE_BYTES = 2 * 1024 ** 3 - 1;

const QSHARE_FILE_PREFIX = 'qshare_file_';
const QDN_DESCRIPTION_MAX_BYTES = 240;
const HASHTAG_MAX_CHARS = 70;
const qshareUid = new ShortUniqueId({ length: 6 });

export type TorqPollOption = { id: string; text: string };

export type TorqPoll = {
  options: TorqPollOption[];
  anonymous?: true;
  voteKey?: string;
};

export type TorqAttachmentThumbnail = {
  name: string;
  service: 'IMAGE';
  identifier: string;
};

export type TorqPostAttachment = {
  name: string;
  service: string;
  identifier: string;
  filename: string;
  mimeType: string;
  size?: number;
  title?: string;
  source?: 'upload';
  shareIdentifier?: string;
  shareName?: string;
  thumbnail?: TorqAttachmentThumbnail;
};

/** A file for the post, with the title, name and cover set in the composer. */
export type TorqFileInput = {
  file: File;
  title?: string;
  filename?: string;
  /** Cover picture; shrink it with prepareTorqThumbnail first. */
  thumbnail?: File | null;
};

export type TorqPublishInput = {
  /** Plain body; paragraphs separated by blank lines. */
  text: string;
  /** Sanitized HTML, only when the post has formatting. */
  richText?: string;
  userName: string;
  images?: { file: File }[];
  video?: QuitterPublishVideo | null;
  gifs?: LibraryGif[];
  poll?: TorqPoll | null;
  files?: TorqFileInput[];
  onProgress?: (message: string, percent?: number) => void;
  signal?: AbortSignal;
};

/**
 * Quitter drops use-embed links (GIFs, files, audio), ignores polls and clips
 * big photo sets, so those posts carry their own Torq link (Torq's
 * needsTorqPostLink; Torq hides that link again when it renders the post).
 */
export function needsTorqPostLink({
  hasPoll,
  imageCount,
  gifCount,
  attachmentCount,
}: {
  hasPoll: boolean;
  imageCount: number;
  gifCount: number;
  attachmentCount: number;
}): boolean {
  return (
    hasPoll ||
    gifCount > 0 ||
    attachmentCount > 0 ||
    imageCount > QUITTER_VISIBLE_IMAGES
  );
}

export const buildTorqPostLink = (name: string, identifier: string) =>
  `qortal://APP/Torq/post/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;

export const createTorqPollOptionId = (index: number) => `opt_${index + 1}`;

/** Torq anon polls: votes are sealed with this 32-byte key (base64). */
export function createTorqAnonVoteKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/** Torq's normalizePoll: trim, clip, drop empty and duplicate choices. */
export function normalizeTorqPoll(
  choices: string[],
  settings?: { anonymous?: boolean; voteKey?: string }
): TorqPoll | null {
  const seen = new Set<string>();
  const options: TorqPollOption[] = [];
  choices.forEach((raw, index) => {
    const text = raw.trim().slice(0, TORQ_MAX_POLL_OPTION_LENGTH);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ id: createTorqPollOptionId(index), text });
  });
  if (options.length < TORQ_MIN_POLL_OPTIONS) return null;
  if (!settings?.anonymous) return { options };
  const voteKey = settings.voteKey || createTorqAnonVoteKey();
  return { options, anonymous: true, voteKey };
}

/** `~#tag~` keywords that fit the 240-byte description beside the mention. */
export function packTorqHashtagKeywords(
  tags: string[],
  extras: string[] = []
): string {
  const seen = new Set<string>();
  const chosen: string[] = [];
  const reserved = extras.filter((part) => part.length > 0);
  const wrap = (tag: string) => `~${tag.trim().toLowerCase()}~`;
  for (const raw of tags) {
    const clipped = raw.trim().slice(0, HASHTAG_MAX_CHARS);
    if (!clipped) continue;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    const description = [[...chosen, clipped].map(wrap).join(','), ...reserved]
      .join(',');
    if (new TextEncoder().encode(description).length > QDN_DESCRIPTION_MAX_BYTES) {
      break;
    }
    seen.add(key);
    chosen.push(clipped);
  }
  return chosen.map(wrap).join(',');
}

export function appendLinkIfMissing(text: string, url: string): string {
  const link = url.trim();
  if (!link || text.includes(link)) return text;
  const trimmed = text.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${link}` : link;
}

export function buildTorqGifEmbed(gif: LibraryGif, timestamp: number): string {
  const params = new URLSearchParams({
    name: gif.name,
    identifier: gif.identifier,
    service: 'IMAGE',
    mimeType: 'image/gif',
    timestamp: String(timestamp),
  });
  return `qortal://use-embed/IMAGE?${params.toString()}`;
}

export function buildTorqAttachmentEmbed(attachment: TorqPostAttachment): string {
  const params = new URLSearchParams({
    name: attachment.name,
    service: attachment.service,
    identifier: attachment.identifier,
    mimeType: attachment.mimeType,
    fileName: attachment.filename,
  });
  if (attachment.title) params.set('title', attachment.title);
  if (attachment.size) params.set('size', String(attachment.size));
  if (attachment.source) params.set('source', attachment.source);
  if (attachment.shareIdentifier) {
    params.set('shareIdentifier', attachment.shareIdentifier);
  }
  if (attachment.shareName) params.set('shareName', attachment.shareName);
  if (attachment.thumbnail) {
    params.set('thumbName', attachment.thumbnail.name);
    params.set('thumbService', attachment.thumbnail.service);
    params.set('thumbIdentifier', attachment.thumbnail.identifier);
  }
  return `qortal://use-embed/ATTACHMENT?${params.toString()}`;
}

/** Q-Share description: post text (or title) plus the post link, ≤ 240 chars. */
export function buildQshareDescription(options: {
  title?: string;
  postText?: string;
  postLink?: string;
}): { body: string; resource: string } {
  const title = String(options.title || '').trim();
  const postText = String(options.postText || '').trim();
  const postLink = String(options.postLink || '').trim();
  const chunks: string[] = [];
  if (postText) chunks.push(postText);
  else if (title) chunks.push(title);
  if (postLink && !chunks.some((part) => part.includes(postLink))) {
    chunks.push(postLink);
  }
  const body = chunks.join('\n\n') || title || 'Files';
  if (body.length <= QDN_DESCRIPTION_MAX_BYTES) return { body, resource: body };
  if (postLink && postLink.length < QDN_DESCRIPTION_MAX_BYTES - 4) {
    const room = QDN_DESCRIPTION_MAX_BYTES - postLink.length - 2;
    const head = body.includes(postLink)
      ? body.slice(0, body.lastIndexOf(postLink))
      : body;
    return {
      body,
      resource: `${head.slice(0, Math.max(0, room)).trimEnd()}\n\n${postLink}`,
    };
  }
  return { body, resource: body.slice(0, QDN_DESCRIPTION_MAX_BYTES) };
}

export function sanitizeFileSlug(value: string): string {
  const slug = String(value || '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .toLowerCase();
  return slug.slice(0, 30) || 'file';
}

export function sanitizePublishFilename(filename: string): string {
  return (
    String(filename || 'file').replace(/[\r\n/<>:"'\\*|?]+/g, '') || 'file'
  );
}

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'];

// Players only know the registered types: there is no `audio/m4a`, and a post
// labelled with it sat at 0:00 in Torq on phones (Torq's AUDIO_MIME).
const AUDIO_MIME: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

const fileExtension = (filename: string) =>
  /\.([^.]+)$/.exec(String(filename || ''))?.[1]?.toLowerCase() || '';

export function guessFileMime(file: File, filename: string): string {
  const type =
    typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  const ext = fileExtension(filename) || fileExtension(file.name);
  if (type === 'audio/m4a' || type === 'audio/x-m4a') return 'audio/mp4';
  if (type.startsWith('audio/')) return type;
  // Phones often report nothing, or a generic type, for audio files.
  if (AUDIO_EXT.includes(ext)) return AUDIO_MIME[ext] || `audio/${ext}`;
  if (type && type !== 'application/octet-stream') return type;
  const known: Record<string, string> = {
    apk: 'application/vnd.android.package-archive',
    epub: 'application/epub+zip',
    json: 'application/json',
    md: 'text/markdown',
    pdf: 'application/pdf',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  return known[ext] || type || 'application/octet-stream';
}

export const TORQ_THUMBNAIL_MAX_PX = 400;
export const TORQ_THUMBNAIL_MAX_BYTES = 450_000;

const IMAGE_EXT_MIME: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * A file card or audio cover, as Torq makes it: at most 400 px, JPEG,
 * under 450 KB (Torq's prepareAttachmentThumbnail).
 */
export async function prepareTorqThumbnail(file: File): Promise<File> {
  const declared = typeof file.type === 'string' ? file.type : '';
  const type = declared.startsWith('image/')
    ? declared
    : IMAGE_EXT_MIME[fileExtension(file.name)] || '';
  if (!type || type === 'image/gif') {
    throw new Error(
      i18n.t('group:home_composer.error.thumbnail_not_image', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const typed =
    type === declared ? file : new File([file], file.name || 'cover', { type });
  const resized = await compressImageFile(typed, {
    first: {
      quality: 0.72,
      maxWidth: TORQ_THUMBNAIL_MAX_PX,
      maxHeight: TORQ_THUMBNAIL_MAX_PX,
      mimeType: 'image/jpeg',
    },
  });
  if (resized.size > 0 && resized.size <= TORQ_THUMBNAIL_MAX_BYTES) {
    return new File([resized], 'cover.jpg', {
      type: resized.type || 'image/jpeg',
    });
  }
  throw new Error(
    i18n.t('group:home_composer.error.thumbnail_too_large', {
      postProcess: 'capitalizeFirstChar',
    })
  );
}

/** Torq's picker refuses these: GIFs and videos have their own buttons. */
export function torqFileRejection(file: File): string | null {
  const type = typeof file.type === 'string' ? file.type : '';
  if (type === 'image/gif' || /\.gif$/i.test(file.name)) {
    return i18n.t('group:home_composer.error.file_use_gif_picker', {
      postProcess: 'capitalizeFirstChar',
    });
  }
  if (type.startsWith('video/')) {
    return i18n.t('group:home_composer.error.file_use_video_button', {
      postProcess: 'capitalizeFirstChar',
    });
  }
  if (file.size > TORQ_MAX_FILE_BYTES) {
    return i18n.t('group:home_composer.error.file_too_large', {
      postProcess: 'capitalizeFirstChar',
    });
  }
  return null;
}

/** Same settings as Torq's compressImage: WebP 0.75, 1920 px wide. */
function compressImageForTorq(file: File): Promise<File> {
  return compressImageFile(file, {
    first: { quality: 0.75, maxWidth: 1920, mimeType: 'image/webp' },
    fallback: { quality: 0.72, maxWidth: 1920, mimeType: 'image/jpeg' },
  });
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new QuitterPublishCancelledError();
};

export async function publishTorqPost(
  input: TorqPublishInput
): Promise<{ postIdentifier: string }> {
  const { userName, onProgress, signal } = input;
  const images = input.images || [];
  const gifs = input.gifs || [];
  const files = input.files || [];
  const video = input.video || null;
  const poll = input.poll || null;
  const t = (key: string, options: Record<string, unknown> = {}) =>
    i18n.t(`group:home_composer.${key}`, {
      ...options,
      postProcess: 'capitalizeFirstChar',
    });

  if (!userName?.trim()) throw new Error(t('error.name_required'));
  if (images.length > TORQ_MAX_IMAGES) {
    throw new Error(t('error.too_many_images', { count: TORQ_MAX_IMAGES }));
  }
  if (gifs.length > TORQ_MAX_GIFS) {
    throw new Error(t('error.too_many_gifs', { count: TORQ_MAX_GIFS }));
  }
  if (video && !video.metadata?.title?.trim()) {
    throw new Error(t('error.video_title_required'));
  }
  if (video && !video.metadata?.category) {
    throw new Error(t('error.video_category_required'));
  }
  for (const item of files) {
    const rejection = torqFileRejection(item.file);
    if (rejection) throw new Error(rejection);
  }

  const text = normalizePostText(input.text || '');
  const hasContent =
    text ||
    images.length ||
    gifs.length ||
    files.length ||
    video ||
    (poll && poll.options.length >= TORQ_MIN_POLL_OPTIONS);
  if (!hasContent) throw new Error(t('error.empty_post'));

  throwIfAborted(signal);
  onProgress?.(t('progress.preparing_post'), 5);

  const postIdentifier = await buildQuitterPostIdentifier();
  const postLink = buildTorqPostLink(userName, postIdentifier);
  const resources: Record<string, unknown>[] = [];
  const stashedIds: string[] = [];

  // 1) Files → FILE resources + one Q-Share catalog, like Torq.
  const attachments: TorqPostAttachment[] = [];
  for (const item of files) {
    throwIfAborted(signal);
    // A photo or video attached as a file goes to public, permanent QDN:
    // publish it without its GPS position, camera model and capture time.
    // Name and type do not change, so they still come from item.file.
    const file = await stripAttachmentMetadata(item.file);
    throwIfAborted(signal);
    const filename = sanitizePublishFilename(
      item.filename?.trim() || item.file.name
    );
    const title = item.title?.trim() || item.file.name || filename || 'file';
    const identifier = `${QSHARE_FILE_PREFIX}${sanitizeFileSlug(title)}_${qshareUid.rnd()}`;
    const fileId = stashPublishFile(file);
    stashedIds.push(fileId);
    resources.push({
      identifier,
      service: 'FILE',
      fileId,
      name: userName,
      title: title.slice(0, 50),
      filename,
      tag1: QSHARE_FILE_PREFIX,
      description: buildQshareDescription({ title, postText: text, postLink })
        .resource,
    });
    const attachment: TorqPostAttachment = {
      name: userName,
      service: 'FILE',
      identifier,
      filename,
      mimeType: guessFileMime(item.file, filename),
      size: file.size,
      title,
      source: 'upload',
    };
    if (item.thumbnail) {
      // Torq's cover: its own IMAGE resource, named after the file.
      const thumbId = `${identifier}_thumb`;
      const thumbFileId = stashPublishFile(item.thumbnail);
      stashedIds.push(thumbFileId);
      resources.push({
        identifier: thumbId,
        service: 'IMAGE',
        fileId: thumbFileId,
        name: userName,
        title: `${title.slice(0, 40)} cover`,
        filename: item.thumbnail.name || 'cover.jpg',
      });
      attachment.thumbnail = {
        name: userName,
        service: 'IMAGE',
        identifier: thumbId,
      };
    }
    attachments.push(attachment);
  }
  if (attachments.length > 0) {
    const title = attachments[0].title || attachments[0].filename || 'Files';
    const idMeta = qshareUid.rnd();
    const identifier = `${QSHARE_FILE_PREFIX}${sanitizeFileSlug(title)}_${idMeta}_metadata`;
    const described = buildQshareDescription({ title, postText: text, postLink });
    const cover = attachments.find((item) => item.thumbnail)?.thumbnail;
    resources.push({
      identifier,
      service: 'DOCUMENT',
      base64: await objectToBase64({
        title,
        version: 1,
        fullDescription: described.body,
        htmlDescription: described.body,
        commentsId: `${QSHARE_FILE_PREFIX}_cm_${idMeta}`,
        files: attachments.map((file) => ({
          filename: file.filename,
          identifier: file.identifier,
          name: file.name,
          service: file.service,
          mimetype: file.mimeType,
          size: file.size,
        })),
        ...(cover
          ? {
              videoImage: `qortal://${cover.service}/${encodeURIComponent(cover.name)}/${encodeURIComponent(cover.identifier)}`,
            }
          : {}),
      }),
      name: userName,
      title: title.slice(0, 50),
      description: described.resource,
      filename: 'video_metadata.json',
      tag1: QSHARE_FILE_PREFIX,
    });
    for (const attachment of attachments) {
      attachment.shareIdentifier = identifier;
      attachment.shareName = userName;
    }
  }

  // 2) Images stay inline in the post, as raw base64.
  const postImages: { src: string }[] = [];
  for (let index = 0; index < images.length; index += 1) {
    throwIfAborted(signal);
    onProgress?.(
      t('progress.compressing_images', {
        current: index + 1,
        total: images.length,
      }),
      8 + Math.round((index / Math.max(1, images.length)) * 12)
    );
    const prepared = await compressImageForTorq(images[index].file);
    postImages.push({ src: await encodeImageForPost(prepared, index) });
  }
  // Ten full-size photos easily pass the 5 MiB Quitter lists allow.
  const fitted = await shrinkPostImagesToBudget(
    images.map((item) => item.file),
    postImages.map((item) => item.src),
    POST_IMAGE_BUDGET,
    signal
  );
  fitted.forEach((src, index) => {
    postImages[index] = { src };
  });

  // 3) Video → Q-Tube VIDEO + metadata, referenced by its metadata DOCUMENT.
  let videoParts: QtubeVideoResources | null = null;
  const postVideos: Record<string, unknown>[] = [];
  if (video) {
    videoParts = await buildQtubeVideoResources({
      video,
      userName,
      onProgress,
      signal,
    });
    resources.push(...videoParts.resources);
    postVideos.push({
      identifier: videoParts.metadataIdentifier,
      service: 'DOCUMENT',
      name: userName,
      mimeType: /webm/i.test(videoParts.mimeType) ? 'video/webm' : 'video/mp4',
      source: 'upload',
    });
  }

  // 4) GIFs are pointers into the GIFs Q-App library, never re-uploads.
  const gifTimestamp = Date.now();
  const postGifs = gifs.map((gif) => ({
    identifier: gif.identifier,
    libraryGif: true,
    mimeType: 'image/gif',
    name: gif.name,
    service: 'IMAGE',
    timestamp: gifTimestamp,
    ...(gif.description ? { description: gif.description } : {}),
  }));

  // 5) Compat links for Quitter readers: Torq post link, then media links.
  let publishedText = needsTorqPostLink({
    hasPoll: Boolean(poll),
    imageCount: postImages.length,
    gifCount: gifs.length,
    attachmentCount: attachments.length,
  })
    ? appendLinkIfMissing(text, postLink)
    : text;
  const sourceUrls = [
    ...gifs.map((gif) => buildTorqGifEmbed(gif, gifTimestamp)),
    ...attachments.map(buildTorqAttachmentEmbed),
  ];
  for (const url of sourceUrls) {
    publishedText = appendLinkIfMissing(publishedText, url);
  }

  const post = {
    text: publishedText,
    timestamp: Date.now(),
    name: userName,
    ...(postImages.length > 0 ? { images: postImages } : {}),
    ...(postVideos.length > 0 ? { videos: postVideos } : {}),
    ...(postGifs.length > 0 ? { gifs: postGifs } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(poll ? { poll } : {}),
    ...(input.richText ? { richText: input.richText } : {}),
  };

  const mentionString = await firstMentionKeyword(text);
  const keywordString = packTorqHashtagKeywords(text.match(/#\w+/g) ?? [], [
    mentionString,
  ]);
  const postBase64 = String(await objectToBase64(post));
  assertPostFitsQuitter(postBase64);
  const postResource: Record<string, unknown> = {
    identifier: postIdentifier,
    service: 'DOCUMENT',
    base64: postBase64,
    name: userName,
  };
  const description = [keywordString, mentionString].filter(Boolean).join(',');
  if (description) postResource.description = description;
  resources.push(postResource);

  throwIfAborted(signal);
  onProgress?.(
    t(video ? 'progress.publishing_video' : 'progress.publishing_post'),
    video ? 35 : 70
  );
  const heavy = Boolean(video) || files.length > 0;
  try {
    const result = await publishMultipleResources(
      resources,
      signal,
      heavy ? 1_800_000 : 300_000
    );
    onProgress?.(t('progress.finalizing'), 95);
    throwIfVideoPublishFailed(result, videoParts?.videoIdentifier || null);
    throwIfAborted(signal);
    return { postIdentifier };
  } catch (err) {
    stashedIds.forEach(discardPublishFile);
    if (videoParts) discardPublishFile(videoParts.stashedFileId);
    throw err;
  }
}
