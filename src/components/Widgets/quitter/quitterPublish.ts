import Compressor from 'compressorjs';
import ShortUniqueId from 'short-unique-id';
import { createNamedFile } from '../../../utils/namedFile';
import {
  compressImageFile,
  ensureImageMetadataFree,
  stripImageFileMetadata,
} from '../../../utils/imageCompression';
import { objectToBase64 } from '../../../qdn/encryption/group-encryption';
import {
  discardPublishFile,
  stashPublishFile,
} from '../../../utils/publishFileStash';
import {
  bindPublishAbort,
  clearPublishAbort,
  isPublishAborted,
} from '../../../utils/publishAbort';
import {
  buildQuitterPostIdentifier,
  QTUBE_VIDEO_BASE,
  quitterHashString,
} from './quitterIdentity';
import {
  attachStreamedChunkUpload,
  type StreamedChunkUpload,
} from '../../../utils/streamedChunkUpload';
import i18n from '../../../i18n/i18n';
import { GO_INTERNAL_APP_INFO } from '../../../utils/qappApproval';

/** Quitter renders at most 2 images per post. */
export const QUITTER_MAX_IMAGES = 2;

/**
 * qapp-core lists skip any QDN resource of 5 MiB or more, and Quitter builds
 * its feed, profiles and replies from those lists — a bigger post never shows.
 * (Same limit Torq enforces in its publishPost.)
 */
export const QUITTER_MAX_POST_BYTES = 5 * 1024 * 1024;
/** Base64 characters the photos may use, leaving room for text, poll, links. */
export const POST_IMAGE_BUDGET = QUITTER_MAX_POST_BYTES - 256 * 1024;
/** Stronger settings, tried in turn, when a post's photos are too big. */
const IMAGE_FIT_STEPS = [
  { quality: 0.7, maxSide: 1600 },
  { quality: 0.6, maxSide: 1280 },
  { quality: 0.5, maxSide: 1024 },
  { quality: 0.4, maxSide: 800 },
];

const videoUid = new ShortUniqueId({ length: 8 });
const videoCodeUid = new ShortUniqueId({ length: 5 });

type QuitterVideoMetadata = {
  title: string;
  description?: string;
  duration?: number;
  category: number;
  subcategory?: number;
  videoImage?: string;
  /** Q-Tube hover frames — 4 WebP data URLs. */
  extracts?: string[];
};

type QuitterPublishImage = {
  file: File;
};

export type QuitterPublishVideo = {
  file: File;
  metadata: QuitterVideoMetadata;
  /** Pre-chosen VIDEO identifier (needed when chunks upload during compress). */
  identifier?: string;
  /** Chunks already sent to `identifier` while the file was compressing. */
  streamedUpload?: StreamedChunkUpload | null;
};

type QuitterPublishInput = {
  /**
   * Plain post body. Quitter renders with white-space: pre-wrap — do NOT send HTML.
   */
  text?: string;
  userName: string;
  images?: QuitterPublishImage[];
  video?: QuitterPublishVideo | null;
  onProgress?: (message: string, percent?: number) => void;
  signal?: AbortSignal;
};

/** Normalize stored/published thumbs for <img>/CSS — Quitter expects a data URL. */
export function quitterThumbSrc(videoImage?: string): string {
  if (!videoImage) return '';
  if (videoImage.startsWith('data:image/')) return videoImage;
  return `data:image/jpeg;base64,${videoImage}`;
}

function toQuitterVideoImageDataUrl(raw?: string): string | undefined {
  const src = quitterThumbSrc(raw);
  return src || undefined;
}

export class QuitterPublishCancelledError extends Error {
  constructor(message = 'Publish cancelled') {
    super(message);
    this.name = 'QuitterPublishCancelledError';
  }
}

const throwIfPublishAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new QuitterPublishCancelledError();
  }
};

type QuitterPublishResult = {
  postIdentifier: string;
};

const stripHtmlTags = (html: string): string => {
  if (!html) return '';
  // Prefer regex so we can keep paragraph breaks (textContent collapses them).
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const normalizeKeywords = (keywords: string[]) =>
  keywords.map((tag) => `~${tag}~`).join(',');

const fileToRawBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64 || '');
    };
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const IMAGE_COMPRESS_THRESHOLD_BYTES = 5 * 1024 * 1024;

/**
 * Only compress Quitter images above 5 MB. Smaller images keep their pixels
 * but lose their EXIF/XMP/IPTC metadata (GPS, camera, capture time) — posts
 * are public and permanent. When compressing, retry harder if the first pass
 * stays over the threshold.
 */
async function compressImageForQuitter(file: File): Promise<File> {
  return compressImageFile(file, {
    thresholdBytes: IMAGE_COMPRESS_THRESHOLD_BYTES,
    first: { quality: 0.72, maxWidth: 1920, mimeType: 'image/webp' },
    second: { quality: 0.6, maxWidth: 1280, mimeType: 'image/webp' },
    fallback: { quality: 0.65, maxWidth: 1600, mimeType: 'image/jpeg' },
  });
}

export const publishMultipleResources = async (
  resources: unknown[],
  signal?: AbortSignal,
  timeoutMs = 240000
) => {
  throwIfPublishAborted(signal);
  // Bind cooperative abort so chunk uploads + remaining resources stop for real.
  // Do NOT Promise.race-abandon sendMessage — that left Q-Tube VIDEO/metadata publishing.
  bindPublishAbort(signal);
  try {
    if (signal?.aborted) {
      throw new QuitterPublishCancelledError();
    }
    const res = await (window as any).sendMessage(
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      { resources },
      timeoutMs,
      true,
      GO_INTERNAL_APP_INFO
    );

    if (signal?.aborted || isPublishAborted() || res?.error?.cancelled) {
      throw new QuitterPublishCancelledError();
    }

    // Success responses often include a benign `message` — only fail on real errors.
    const unsuccessful =
      res?.error?.unsuccessfulPublishes ||
      res?.unsuccessfulPublishes ||
      res?.failedPublishes;
    const hasFailedPublishes =
      Array.isArray(unsuccessful) && unsuccessful.length > 0;
    if (res?.error || hasFailedPublishes) {
      const cancelled =
        /cancel/i.test(String(res?.message || '')) ||
        (hasFailedPublishes &&
          unsuccessful.some((item: any) =>
            /cancel/i.test(String(item?.reason || ''))
          ));
      if (cancelled) {
        throw new QuitterPublishCancelledError();
      }
      const reasons = hasFailedPublishes
        ? unsuccessful
            .map((item: any) => item?.reason)
            .filter(Boolean)
            .join('; ')
        : '';
      const detail =
        reasons ||
        (typeof res.error === 'string' && res.error) ||
        (typeof res.message === 'string' && res.message) ||
        i18n.t('group:home_composer.error.publish_failed', {
          postProcess: 'capitalizeFirstChar',
        });
      console.error('[Quitter] PUBLISH_MULTIPLE_QDN_RESOURCES failed', res);
      throw new Error(detail);
    }
    return res;
  } finally {
    clearPublishAbort();
  }
};

/** Shrink a data-URL thumbnail so QDN metadata stays small and WebView stays stable. */
async function shrinkVideoImageDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  // Already compact enough (~120KB raw ≈ ~160KB data URL).
  if (dataUrl.length < 160_000) return dataUrl;

  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = createNamedFile([blob], 'thumb.webp', {
    type: blob.type || 'image/jpeg',
  });

  const compressed = await new Promise<Blob>((resolve, reject) => {
    new Compressor(file, {
      quality: 0.7,
      maxWidth: 640,
      maxHeight: 640,
      mimeType: 'image/webp',
      success: resolve,
      error: reject,
    });
  });

  const out = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to read thumbnail'));
    reader.readAsDataURL(compressed);
  });
  return out.startsWith('data:image/') ? out : dataUrl;
}

export type QtubeVideoResources = {
  /** VIDEO then its Q-Tube metadata DOCUMENT — VIDEO must publish first. */
  resources: Record<string, unknown>[];
  videoIdentifier: string;
  metadataIdentifier: string;
  mimeType: string;
  stashedFileId: string;
};

/** Q-Tube VIDEO identifier: `qtube_vid_<title-slug>_<id8>`. */
export function buildQtubeVideoIdentifier(title: string): string {
  const slug = title
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .toLowerCase();
  return `${QTUBE_VIDEO_BASE}${slug.slice(0, 30)}_${videoUid.rnd()}`;
}

/**
 * Build the Q-Tube VIDEO + metadata DOCUMENT pair shared by Quitter and Torq
 * posts. The file is stashed (not cloned through postMessage); a streamed
 * upload rides along on the same Blob so publishData can finish it.
 */
export async function buildQtubeVideoResources({
  video,
  userName,
  onProgress,
  signal,
}: {
  video: QuitterPublishVideo;
  userName: string;
  onProgress?: (message: string, percent?: number) => void;
  signal?: AbortSignal;
}): Promise<QtubeVideoResources> {
  throwIfPublishAborted(signal);
  onProgress?.(
    i18n.t('group:home_composer.progress.preparing_video', {
      postProcess: 'capitalizeFirstChar',
    }),
    22
  );

  if (!video.file || video.file.size < 32 * 1024) {
    throw new Error(
      i18n.t('group:home_composer.error.video_invalid', {
        size: video.file?.size || 0,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const title = video.metadata.title.trim();
  const videoIdentifier = video.identifier || buildQtubeVideoIdentifier(title);
  const id = videoIdentifier.slice(videoIdentifier.lastIndexOf('_') + 1);
  const metadataIdentifier = `${videoIdentifier}_metadata`;
  const videoCode = videoCodeUid.rnd();
  const commentsId = `${QTUBE_VIDEO_BASE}_cm_${id}`;
  // Q-Tube stores rich HTML here; plain description is fine as text content.
  const htmlDescription = video.metadata.description || '';
  const fullDescription = stripHtmlTags(htmlDescription) || htmlDescription;
  const subcategoryStr = video.metadata.subcategory || '';
  const metadescription =
    `**category:${video.metadata.category};subcategory:${subcategoryStr};code:${videoCode}**` +
    fullDescription.slice(0, 150);

  // Quitter/Q-Tube use videoImage as <img src> / poster — must be a data URL.
  let videoImage = toQuitterVideoImageDataUrl(video.metadata.videoImage);
  if (!videoImage) {
    onProgress?.(
      i18n.t('group:home_composer.progress.creating_thumbnail', {
        postProcess: 'capitalizeFirstChar',
      }),
      28
    );
    const extracted = await extractVideoThumbnailBase64(video.file);
    videoImage = toQuitterVideoImageDataUrl(extracted.videoImage);
  }
  if (!videoImage) {
    throw new Error(
      i18n.t('group:home_composer.error.video_thumbnail_required', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  // Keep metadata small — huge data-URL thumbs can crash the WebView mid-publish.
  try {
    videoImage = await shrinkVideoImageDataUrl(videoImage);
  } catch {
    // keep original data URL
  }

  // Q-Tube hover preview: exactly 4 WebP data URLs in `extracts`.
  // Missing/empty extracts → ResponsiveImage shows DeletedVideo.jpg on hover.
  onProgress?.(
    i18n.t('group:home_composer.progress.creating_hover_frames', {
      postProcess: 'capitalizeFirstChar',
    }),
    30
  );
  let extracts: string[] = Array.isArray(video.metadata.extracts)
    ? video.metadata.extracts.filter(
        (item) => typeof item === 'string' && item.startsWith('data:image/')
      )
    : [];
  if (extracts.length < 4) {
    try {
      const generated = await extractVideoHoverFrames(video.file);
      if (generated.length > extracts.length) extracts = generated;
    } catch (err) {
      console.warn('[Quitter] hover frame extract failed', err);
    }
  }
  // Last resort: repeat cover so hover never falls through to DeletedVideo.
  if (extracts.length === 0 && videoImage) {
    extracts = [videoImage, videoImage, videoImage, videoImage];
  } else if (extracts.length > 0 && extracts.length < 4 && videoImage) {
    while (extracts.length < 4) extracts.push(videoImage);
  }

  // Match Q-Tube filename sanitization (alphanumeric + underscore + ext).
  const fileExt =
    (video.file.name.split('.').pop() || 'mp4').replace(/[^\w]/g, '') || 'mp4';
  const safeBase = title
    .slice(0, 15)
    .replace(/[\s\uFEFF\xA0]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
  const publishFilename = `${safeBase || 'video'}.${fileExt}`;
  const mimeType = video.file.type || 'video/mp4';

  const videoMetadataDoc = {
    title,
    version: 1,
    htmlDescription,
    fullDescription,
    videoReference: {
      name: userName,
      identifier: videoIdentifier,
      service: 'VIDEO',
    },
    commentsId,
    code: videoCode,
    videoType: mimeType,
    filename: publishFilename,
    fileSize: video.file.size,
    duration: video.metadata.duration || 0,
    category: video.metadata.category,
    videoImage,
    // Always include — empty extracts make Q-Tube show DeletedVideo on hover.
    extracts: extracts.slice(0, 4),
    ...(video.metadata.subcategory
      ? { subcategory: video.metadata.subcategory }
      : {}),
  };

  const metadataBase64 = await objectToBase64(videoMetadataDoc);

  if (video.streamedUpload) {
    attachStreamedChunkUpload(video.file, video.streamedUpload);
  }
  // Stash the video Blob so postMessage does not clone tens of MB (OOM crash).
  const stashedFileId = stashPublishFile(video.file);

  return {
    videoIdentifier,
    metadataIdentifier,
    mimeType,
    stashedFileId,
    resources: [
      {
        identifier: videoIdentifier,
        service: 'VIDEO',
        fileId: stashedFileId,
        name: userName,
        title: title.slice(0, 50),
        description: metadescription,
        filename: publishFilename,
        tag1: QTUBE_VIDEO_BASE,
      },
      {
        identifier: metadataIdentifier,
        service: 'DOCUMENT',
        base64: metadataBase64,
        name: userName,
        title: title.slice(0, 50),
        description: metadescription,
        filename: 'video_metadata.json',
        tag1: QTUBE_VIDEO_BASE,
        code: videoCode,
      },
    ],
  };
}

/** Quitter `~@hash~` keyword for the first @mention, or ''. */
export async function firstMentionKeyword(text: string): Promise<string> {
  const mentionMatch = text.match(
    /@\{([^}]+)\}|(?:^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/
  );
  const mentionedName = mentionMatch?.[1] || mentionMatch?.[2];
  if (!mentionedName) return '';
  return `~@${await quitterHashString(mentionedName)}~`;
}

/** Hub may keep partial successes; a missing VIDEO must fail the post. */
export function throwIfVideoPublishFailed(
  publishResult: any,
  videoIdentifier: string | null
): void {
  if (!videoIdentifier) return;
  const unsuccessful =
    publishResult?.error?.unsuccessfulPublishes ||
    publishResult?.unsuccessfulPublishes ||
    publishResult?.failedPublishes;
  if (!Array.isArray(unsuccessful)) return;
  const videoFailed = unsuccessful.some(
    (item: any) =>
      item?.identifier === videoIdentifier || item?.service === 'VIDEO'
  );
  if (!videoFailed) return;
  const reason = unsuccessful
    .map((item: any) => item?.reason)
    .filter(Boolean)
    .join('; ');
  throw new Error(
    reason ||
      i18n.t('group:home_composer.error.video_publish_failed', {
        postProcess: 'capitalizeFirstChar',
      })
  );
}

/** Quitter/Torq posts render `text` as plain pre-wrap; never send HTML there. */
export function normalizePostText(raw: string): string {
  const plainText = stripHtmlTags(raw)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // stripHtmlTags would also drop newlines-only markup; keep plain input as-is.
  return /<\/?[a-z][\s\S]*>/i.test(raw)
    ? plainText
    : raw
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Publish a public Quitter post (text + up to 2 images + optional 1 video).
 * Matches Quitter's publishPost resource shape so posts appear in the feed.
 */
export async function publishQuitterPost(
  input: QuitterPublishInput
): Promise<QuitterPublishResult> {
  const { userName, onProgress, signal } = input;
  if (!userName?.trim()) {
    throw new Error(
      i18n.t('group:home_composer.error.name_required', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const images = input.images || [];
  const video = input.video || null;

  if (images.length > QUITTER_MAX_IMAGES) {
    throw new Error(
      i18n.t('group:home_composer.error.too_many_images', {
        count: QUITTER_MAX_IMAGES,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (images.some((item) => item.file.type === 'image/gif')) {
    throw new Error(
      i18n.t('group:home_composer.error.gif_images_unsupported', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (video && !video.metadata?.title?.trim()) {
    throw new Error(
      i18n.t('group:home_composer.error.video_title_required', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (video && !video.metadata?.category) {
    throw new Error(
      i18n.t('group:home_composer.error.video_category_required', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  // Quitter feed renders `text` as plain React children (pre-wrap) — never HTML.
  const publishText = normalizePostText(input.text ?? '');
  if (!publishText && images.length === 0 && !video) {
    throw new Error(
      i18n.t('group:home_composer.error.empty_post', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  throwIfPublishAborted(signal);
  onProgress?.(
    i18n.t('group:home_composer.progress.preparing_post', {
      postProcess: 'capitalizeFirstChar',
    }),
    5
  );

  const postIdentifier = await buildQuitterPostIdentifier();
  throwIfPublishAborted(signal);
  const resources: Record<string, unknown>[] = [];
  const postImages: { src: string }[] = [];
  const postVideos: {
    identifier: string;
    name: string;
    service: string;
    mimeType?: string;
  }[] = [];

  for (let imgIdx = 0; imgIdx < images.length; imgIdx += 1) {
    const attachment = images[imgIdx];
    throwIfPublishAborted(signal);
    const needsCompress =
      attachment.file.size > IMAGE_COMPRESS_THRESHOLD_BYTES &&
      attachment.file.type !== 'image/gif';
    onProgress?.(
      i18n.t(
        needsCompress
          ? 'group:home_composer.progress.compressing_images'
          : 'group:home_composer.progress.preparing_images',
        {
          current: imgIdx + 1,
          total: images.length,
          postProcess: 'capitalizeFirstChar',
        }
      ),
      8 + Math.round((imgIdx / Math.max(1, images.length)) * 10)
    );
    const prepared = await compressImageForQuitter(attachment.file);
    throwIfPublishAborted(signal);
    const base64 = await encodeImageForPost(prepared, imgIdx);
    // Quitter prefixes data:image/jpeg;base64, at render time for images[].src
    postImages.push({ src: base64 });
  }
  // Two photos just under the 5 MB compress threshold made a post Quitter
  // never lists; shrink them together to fit.
  const fitted = await shrinkPostImagesToBudget(
    images.map((item) => item.file),
    postImages.map((item) => item.src),
    POST_IMAGE_BUDGET,
    signal
  );
  fitted.forEach((src, index) => {
    postImages[index] = { src };
  });

  let videoParts: QtubeVideoResources | null = null;
  try {
    if (video) {
      videoParts = await buildQtubeVideoResources({
        video,
        userName,
        onProgress,
        signal,
      });
      // VIDEO first — if it fails we must not leave a post pointing at nothing.
      resources.push(...videoParts.resources);
      postVideos.push({
        identifier: videoParts.metadataIdentifier,
        service: 'DOCUMENT',
        name: userName,
        mimeType: videoParts.mimeType,
      });
    }

    const post = {
      text: publishText,
      timestamp: Date.now(),
      name: userName,
      ...(postImages.length > 0 ? { images: postImages } : {}),
      ...(postVideos.length > 0 ? { videos: postVideos } : {}),
    };

    const hashtagMatches = publishText.match(/#\w+/g);
    let keywordString = '';
    if (hashtagMatches?.length) {
      const keywords = hashtagMatches
        .slice(0, 2)
        .map((tag) => (tag.length > 70 ? tag.substring(0, 70) : tag));
      keywordString = normalizeKeywords(keywords);
    }
    const mentionString = await firstMentionKeyword(publishText);

    const postBase64 = String(await objectToBase64(post));
    assertPostFitsQuitter(postBase64);
    const postResource: Record<string, unknown> = {
      identifier: postIdentifier,
      service: 'DOCUMENT',
      base64: postBase64,
      name: userName,
    };

    const descriptionParts: string[] = [];
    if (keywordString) descriptionParts.push(keywordString);
    if (mentionString) descriptionParts.push(mentionString);
    if (descriptionParts.length > 0) {
      postResource.description = descriptionParts.join(',');
    }

    resources.push(postResource);

    throwIfPublishAborted(signal);
    onProgress?.(
      i18n.t(
        video
          ? 'group:home_composer.progress.publishing_video'
          : 'group:home_composer.progress.publishing_post',
        { postProcess: 'capitalizeFirstChar' }
      ),
      video ? 35 : 70
    );
    // Video publishes can take longer on private/public nodes.
    const timeoutMs = video ? 900_000 : 300_000;
    const publishResult = await publishMultipleResources(
      resources,
      signal,
      timeoutMs
    );
    onProgress?.(
      i18n.t('group:home_composer.progress.finalizing', {
        postProcess: 'capitalizeFirstChar',
      }),
      95
    );
    throwIfVideoPublishFailed(
      publishResult,
      videoParts?.videoIdentifier || null
    );
    throwIfPublishAborted(signal);
    return { postIdentifier };
  } catch (err) {
    if (videoParts) discardPublishFile(videoParts.stashedFileId);
    throw err;
  }
}

/**
 * Re-compress the largest photos (from their originals) until all of them fit
 * `budget` base64 characters together, like Torq's compressPostImages.
 */
export async function shrinkPostImagesToBudget(
  files: File[],
  encoded: string[],
  budget: number = POST_IMAGE_BUDGET,
  signal?: AbortSignal
): Promise<string[]> {
  const out = [...encoded];
  const total = () => out.reduce((sum, src) => sum + src.length, 0);
  for (const step of IMAGE_FIT_STEPS) {
    if (total() <= budget) break;
    const share = budget / Math.max(1, files.length);
    for (let i = 0; i < files.length; i += 1) {
      if (out[i].length <= share) continue;
      throwIfPublishAborted(signal);
      const pass = {
        quality: step.quality,
        maxWidth: step.maxSide,
        maxHeight: step.maxSide,
      };
      const smaller = await compressImageFile(files[i], {
        first: { ...pass, mimeType: 'image/webp' },
        fallback: { ...pass, mimeType: 'image/jpeg' },
      });
      // These start from the originals: only a result whose metadata is
      // known to be gone may replace the photo already encoded.
      const clean = await ensureImageMetadataFree(smaller);
      if (clean.ok === false) continue;
      const src = await fileToRawBase64(clean.file);
      if (src && src.length < out[i].length) out[i] = src;
    }
  }
  if (total() > budget) {
    throw new Error(
      i18n.t('group:home_composer.error.images_too_large', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return out;
}

/** Refuse a post that Quitter would silently leave out of its feed. */
export function assertPostFitsQuitter(postBase64: string): void {
  if (Math.ceil((postBase64.length * 3) / 4) >= QUITTER_MAX_POST_BYTES) {
    throw new Error(
      i18n.t('group:home_composer.error.post_too_large', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
}

/** Raw base64 (no data: prefix) for `images[].src`, as Quitter/Torq store it. */
export async function encodeImageForPost(
  prepared: File | Blob,
  index: number
): Promise<string> {
  if (!prepared || prepared.size < 32) {
    throw new Error(
      i18n.t('group:home_composer.error.image_invalid', {
        index: index + 1,
        size: prepared?.size || 0,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  // Posts are public and permanent: refuse an image whose location/camera
  // metadata could not be removed (HEIC, which the WebView cannot re-encode)
  // rather than publish it with that metadata.
  const clean = await ensureImageMetadataFree(prepared);
  if (clean.ok === false) {
    throw new Error(
      i18n.t('group:home_composer.error.image_metadata_unremovable', {
        index: index + 1,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const base64 = await fileToRawBase64(clean.file);
  if (!base64) {
    throw new Error(
      i18n.t('group:home_composer.error.image_encode_failed', {
        index: index + 1,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return base64;
}

export const QUITTER_VIDEO_CATEGORIES = [
  { id: 1, name: 'Movies' },
  { id: 2, name: 'Series' },
  { id: 3, name: 'Music' },
  { id: 4, name: 'Education' },
  { id: 5, name: 'Lifestyle' },
  { id: 6, name: 'Gaming' },
  { id: 7, name: 'Technology' },
  { id: 8, name: 'Sports' },
  { id: 9, name: 'News & Politics' },
  { id: 10, name: 'Cooking & Food' },
  { id: 11, name: 'Animation' },
  { id: 12, name: 'Science' },
  { id: 13, name: 'Health & Wellness' },
  { id: 14, name: 'DIY & Crafts' },
  { id: 15, name: 'Kids & Family' },
  { id: 16, name: 'Comedy' },
  { id: 17, name: 'Travel & Adventure' },
  { id: 18, name: 'Art & Design' },
  { id: 19, name: 'Nature & Environment' },
  { id: 20, name: 'Business & Finance' },
  { id: 21, name: 'Personal Development' },
  { id: 22, name: 'Religion' },
  { id: 23, name: 'History' },
  { id: 24, name: 'Anime' },
  { id: 25, name: 'Cartoons' },
  { id: 26, name: 'Qortal' },
  { id: 27, name: 'Paranormal' },
  { id: 28, name: 'Spirituality' },
  { id: 29, name: 'Privacy' },
  { id: 99, name: 'Other' },
] as const;

function frameInterestingnessScore(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): number {
  // Downsample a few pixels to detect black / near-black intro frames.
  const sampleW = Math.min(48, width);
  const sampleH = Math.min(27, height);
  if (sampleW < 2 || sampleH < 2) return 0;
  const tmp = document.createElement('canvas');
  tmp.width = sampleW;
  tmp.height = sampleH;
  const tctx = tmp.getContext('2d');
  if (!tctx) return 0;
  tctx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, sampleW, sampleH);
  const { data } = tctx.getImageData(0, 0, sampleW, sampleH);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Perceived luminance
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y;
    sumSq += y * y;
    n += 1;
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  // Prefer frames that are both bright enough and have some detail.
  return mean * 0.65 + Math.sqrt(variance) * 0.35;
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.02) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    try {
      video.currentTime = target;
    } catch {
      video.removeEventListener('seeked', done);
      resolve();
    }
  });
}

type ExtractVideoHoverFramesOptions = {
  /**
   * Called as each frame is ready (first frame is near t≈0 so the editor can
   * show a cover immediately while the remaining hover frames finish).
   */
  onFrame?: (frame: string, index: number) => void;
};

/**
 * Q-Tube hover frames: 4 snapshots compressed to data URLs — stored as `extracts`.
 * Frame 0 is the first readable frame; 1–3 are later quarters.
 */
export async function extractVideoHoverFrames(
  source: File | string,
  options?: ExtractVideoHoverFramesOptions
): Promise<string[]> {
  const objectUrl =
    typeof source === 'string' ? source : URL.createObjectURL(source);
  const shouldRevoke = typeof source !== 'string';
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () =>
        reject(new Error('Failed to load video for frames'));
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0.05) return [];

    const canvas = document.createElement('canvas');
    // Keep extracts modest so DOCUMENT metadata stays publishable on mobile.
    const maxW = 480;
    const vw = Math.max(1, video.videoWidth || 640);
    const vh = Math.max(1, video.videoHeight || 360);
    const scale = Math.min(1, maxW / vw);
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const section = duration / 4;
    // First frame ASAP for the cover; remaining three from later quarters.
    const timestamps = [
      Math.min(0.08, Math.max(0.02, duration * 0.01)),
      Math.min(1 * section + section * 0.45, Math.max(0, duration - 0.05)),
      Math.min(2 * section + section * 0.45, Math.max(0, duration - 0.05)),
      Math.min(3 * section + section * 0.45, Math.max(0, duration - 0.05)),
    ];

    const encodeFrame = async (): Promise<string | null> => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Prefer JPEG data URL first (most reliable on Android WebView).
      let dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      try {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72);
        });
        if (blob) {
          const file = createNamedFile([blob], 'extract.jpg', {
            type: 'image/jpeg',
          });
          dataUrl = await new Promise<string>((resolve, reject) => {
            new Compressor(file, {
              quality: 0.72,
              maxWidth: 480,
              mimeType: 'image/webp',
              success(result) {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () =>
                  reject(reader.error || new Error('Failed to encode extract'));
                reader.readAsDataURL(result);
              },
              error(err) {
                reject(err);
              },
            });
          });
        }
      } catch {
        // keep jpeg dataUrl
      }
      return dataUrl.startsWith('data:image/') ? dataUrl : null;
    };

    const frames: string[] = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      try {
        await seekVideo(video, timestamps[i]);
        const dataUrl = await encodeFrame();
        if (!dataUrl) continue;
        frames.push(dataUrl);
        options?.onFrame?.(dataUrl, frames.length - 1);
      } catch {
        // skip failed frame; publish can continue with fewer extracts
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    if (shouldRevoke) URL.revokeObjectURL(objectUrl);
  }
}

export async function extractVideoThumbnailBase64(
  source: File | string,
  seekSeconds?: number
): Promise<{ duration: number; videoImage?: string }> {
  const objectUrl =
    typeof source === 'string' ? source : URL.createObjectURL(source);
  const shouldRevoke = typeof source !== 'string';
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video preview'));
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const canvas = document.createElement('canvas');
    const maxW = 640;
    const vw = Math.max(1, video.videoWidth || 640);
    const vh = Math.max(1, video.videoHeight || 360);
    const scale = vw > maxW ? maxW / vw : 1;
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { duration };

    // Explicit seek (user picked a frame in the editor).
    if (seekSeconds != null) {
      const seekTo = Math.max(
        0,
        Math.min(seekSeconds, Math.max(0, duration - 0.05))
      );
      await seekVideo(video, seekTo);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Full data URL — Quitter/Q-Tube use this as <img src> / video poster.
      return { duration, videoImage: canvas.toDataURL('image/jpeg', 0.78) };
    }

    // Auto: sample several timestamps and pick the least black / most detailed.
    const candidates: number[] = [];
    if (duration > 0.2) {
      candidates.push(
        Math.min(0.35, duration * 0.05),
        Math.min(1.0, duration * 0.12),
        Math.min(2.5, duration * 0.25),
        Math.min(Math.max(0.5, duration * 0.4), Math.max(0, duration - 0.08)),
        Math.min(Math.max(1, duration * 0.55), Math.max(0, duration - 0.05))
      );
    } else {
      candidates.push(0);
    }
    const unique = [
      ...new Set(candidates.map((t) => Math.round(t * 100) / 100)),
    ];

    let bestScore = -1;
    let bestDataUrl = '';
    for (const t of unique) {
      await seekVideo(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const score = frameInterestingnessScore(ctx, canvas.width, canvas.height);
      if (score > bestScore) {
        bestScore = score;
        bestDataUrl = canvas.toDataURL('image/jpeg', 0.78);
      }
      // Good enough — stop early
      if (bestScore >= 40) break;
    }

    if (!bestDataUrl) return { duration };
    return { duration, videoImage: bestDataUrl };
  } catch {
    return { duration: 0 };
  } finally {
    if (shouldRevoke) URL.revokeObjectURL(objectUrl);
  }
}

/** Returns a full data URL (data:image/…;base64,…), matching Q-Tube ImageUploader. */
export function compressThumbnailFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    new Compressor(file, {
      quality: 0.78,
      maxWidth: 1280,
      mimeType: 'image/webp',
      async success(compressed) {
        // Compressor.js hands back the original (metadata and all) when its
        // output would be bigger, so strip it before it goes into the post.
        let result: Blob;
        try {
          result = await stripImageFileMetadata(compressed as File);
        } catch (err) {
          reject(err);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          if (!dataUrl.startsWith('data:')) {
            reject(new Error('Failed to encode thumbnail'));
            return;
          }
          resolve(dataUrl);
        };
        reader.onerror = () => reject(reader.error || new Error('Read failed'));
        reader.readAsDataURL(result);
      },
      error(err) {
        reject(err);
      },
    });
  });
}
