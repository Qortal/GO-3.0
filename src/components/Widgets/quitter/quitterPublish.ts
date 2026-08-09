import Compressor from 'compressorjs';
import ShortUniqueId from 'short-unique-id';
import { createNamedFile, nameBlob } from '../../../utils/namedFile';
import {
  blobToNamedImageFile,
  compressImageFile,
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

const videoUid = new ShortUniqueId({ length: 8 });
const videoCodeUid = new ShortUniqueId({ length: 5 });

export type QuitterVideoMetadata = {
  title: string;
  description?: string;
  duration?: number;
  category: number;
  subcategory?: number;
  videoImage?: string;
  /** Q-Tube hover frames — 4 WebP data URLs. */
  extracts?: string[];
};

export type QuitterPublishImage = {
  file: File;
};

export type QuitterPublishVideo = {
  file: File;
  metadata: QuitterVideoMetadata;
};

export type QuitterPublishInput = {
  /**
   * Plain post body. Quitter renders with white-space: pre-wrap — do NOT send HTML.
   * (`textHtml` kept as a deprecated alias.)
   */
  text?: string;
  /** @deprecated use `text` (plain). HTML will be stripped to plain text. */
  textHtml?: string;
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

export type QuitterPublishResult = {
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
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const IMAGE_COMPRESS_THRESHOLD_BYTES = 5 * 1024 * 1024;

const blobToPublishFile = blobToNamedImageFile;

/**
 * Only compress Quitter images above 5 MB. Smaller images publish as-is.
 * When compressing, retry harder if the first pass stays over the threshold.
 */
async function compressImageForQuitter(file: File): Promise<File> {
  return compressImageFile(file, {
    thresholdBytes: IMAGE_COMPRESS_THRESHOLD_BYTES,
    first: { quality: 0.72, maxWidth: 1920, mimeType: 'image/webp' },
    second: { quality: 0.6, maxWidth: 1280, mimeType: 'image/webp' },
    fallback: { quality: 0.65, maxWidth: 1600, mimeType: 'image/jpeg' },
  });
}

const publishMultipleResources = async (
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
      true
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
        'Failed to publish to Quitter';
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

/**
 * Publish a public Quitter post (text + up to 2 images + optional 1 video).
 * Matches Quitter's publishPost resource shape so posts appear in the feed.
 */
export async function publishQuitterPost(
  input: QuitterPublishInput
): Promise<QuitterPublishResult> {
  const { userName, onProgress, signal } = input;
  if (!userName?.trim()) {
    throw new Error('A Qortal name is required to publish to Quitter');
  }

  const images = input.images || [];
  const video = input.video || null;

  if (images.length > 2) {
    throw new Error('Maximum 2 images allowed per post');
  }
  if (images.some((item) => item.file.type === 'image/gif')) {
    throw new Error('GIF images are not supported');
  }
  if (video && !video.metadata?.title?.trim()) {
    throw new Error('Video title is required');
  }
  if (video && !video.metadata?.category) {
    throw new Error('Video category is required');
  }

  // Quitter feed renders `text` as plain React children (pre-wrap) — never HTML.
  // Always strip tags so accidental HTML (or stale callers) cannot leak into the feed.
  const rawText = input.text ?? input.textHtml ?? '';
  const plainText = stripHtmlTags(rawText)
    .replace(/\r\n/g, '\n')
    // stripHtmlTags collapses to a single line via textContent — restore
    // paragraphs from common textarea newlines when input was already plain.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // If stripHtmlTags wiped newlines from plain input, prefer the raw plain form.
  const publishText = /<\/?[a-z][\s\S]*>/i.test(rawText)
    ? plainText
    : rawText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!publishText && images.length === 0 && !video) {
    throw new Error('Write something or attach media to publish');
  }

  throwIfPublishAborted(signal);
  onProgress?.('Preparing post…', 5);

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
      needsCompress
        ? `Compressing images… (${imgIdx + 1}/${images.length})`
        : `Preparing images… (${imgIdx + 1}/${images.length})`,
      8 + Math.round((imgIdx / Math.max(1, images.length)) * 10)
    );
    const prepared = await compressImageForQuitter(attachment.file);
    throwIfPublishAborted(signal);
    if (!prepared || prepared.size < 32) {
      throw new Error(
        `Image ${imgIdx + 1} is invalid for publish (${prepared?.size || 0} bytes)`
      );
    }
    const base64 = await fileToRawBase64(prepared);
    if (!base64) {
      throw new Error(`Failed to encode image ${imgIdx + 1} for Quitter`);
    }
    // Quitter prefixes data:image/jpeg;base64, at render time for images[].src
    postImages.push({ src: base64 });
  }

  let publishedVideoIdentifier: string | null = null;
  let stashedVideoFileId: string | null = null;

  if (video) {
    throwIfPublishAborted(signal);
    onProgress?.('Preparing video…', 22);

    if (!video.file || video.file.size < 32 * 1024) {
      throw new Error(
        `Video file is invalid for publish (${video.file?.size || 0} bytes)`
      );
    }

    const title = video.metadata.title.trim();
    const sanitizeTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .toLowerCase();
    const id = videoUid.rnd();
    const videoIdentifier = `${QTUBE_VIDEO_BASE}${sanitizeTitle.slice(0, 30)}_${id}`;
    publishedVideoIdentifier = videoIdentifier;
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
      onProgress?.('Creating video thumbnail…', 28);
      const extracted = await extractVideoThumbnailBase64(video.file);
      videoImage = toQuitterVideoImageDataUrl(extracted.videoImage);
    }
    if (!videoImage) {
      throw new Error('A video thumbnail is required for Quitter / Q-Tube');
    }
    // Keep metadata small — huge data-URL thumbs can crash the WebView mid-publish.
    try {
      videoImage = await shrinkVideoImageDataUrl(videoImage);
    } catch {
      // keep original data URL
    }

    // Q-Tube hover preview: exactly 4 WebP data URLs in `extracts`.
    // Missing/empty extracts → ResponsiveImage shows DeletedVideo.jpg on hover.
    onProgress?.('Creating hover snapshots…', 30);
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
      (video.file.name.split('.').pop() || 'mp4').replace(/[^\w]/g, '') ||
      'mp4';
    const safeBase = title
      .slice(0, 15)
      .replace(/[\s\uFEFF\xA0]+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');
    const publishFilename = `${safeBase || 'video'}.${fileExt}`;

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
      videoType: video.file.type || 'video/mp4',
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

    // Stash the video Blob so postMessage does not clone tens of MB (OOM crash).
    stashedVideoFileId = stashPublishFile(video.file);

    // VIDEO first — if it fails we must not leave a post pointing at nothing.
    resources.push({
      identifier: videoIdentifier,
      service: 'VIDEO',
      fileId: stashedVideoFileId,
      name: userName,
      title: title.slice(0, 50),
      description: metadescription,
      filename: publishFilename,
      tag1: QTUBE_VIDEO_BASE,
    });

    resources.push({
      identifier: metadataIdentifier,
      service: 'DOCUMENT',
      base64: metadataBase64,
      name: userName,
      title: title.slice(0, 50),
      description: metadescription,
      filename: 'video_metadata.json',
      tag1: QTUBE_VIDEO_BASE,
      code: videoCode,
    });

    postVideos.push({
      identifier: metadataIdentifier,
      service: 'DOCUMENT',
      name: userName,
      mimeType: video.file.type || 'video/mp4',
    });
  }

  const post = {
    // Marker kept out of payload — publishText is plain only (no <p> tags).
    text: publishText,
    timestamp: Date.now(),
    name: userName,
    ...(postImages.length > 0 ? { images: postImages } : {}),
    ...(postVideos.length > 0 ? { videos: postVideos } : {}),
  };

  const hashtagMatches = publishText.match(/#\w+/g);
  let keywordString = '';
  if (hashtagMatches?.length) {
    const keywords = hashtagMatches.slice(0, 2).map((tag) =>
      tag.length > 70 ? tag.substring(0, 70) : tag
    );
    keywordString = normalizeKeywords(keywords);
  }

  const mentionMatch = publishText.match(
    /@\{([^}]+)\}|(?:^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/
  );
  let mentionString = '';
  if (mentionMatch) {
    const mentionedName = mentionMatch[1] || mentionMatch[2];
    if (mentionedName) {
      const hashedName = await quitterHashString(mentionedName);
      mentionString = `~@${hashedName}~`;
    }
  }

  const postBase64 = await objectToBase64(post);
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
    video ? 'Publishing video…' : 'Publishing to Quitter…',
    video ? 35 : 70
  );
  // Video publishes can take longer on private/public nodes.
  const timeoutMs = video ? 900_000 : 300_000;
  try {
    const publishResult = await publishMultipleResources(
      resources,
      signal,
      timeoutMs
    );
    onProgress?.('Finalizing publish…', 95);

    // Extra guard: Hub may keep partial successes; surface VIDEO failures clearly.
    const unsuccessful =
      publishResult?.error?.unsuccessfulPublishes ||
      publishResult?.unsuccessfulPublishes ||
      publishResult?.failedPublishes;
    if (Array.isArray(unsuccessful) && publishedVideoIdentifier) {
      const videoFailed = unsuccessful.some(
        (item: any) =>
          item?.identifier === publishedVideoIdentifier ||
          item?.service === 'VIDEO'
      );
      if (videoFailed) {
        const reason = unsuccessful
          .map((item: any) => item?.reason)
          .filter(Boolean)
          .join('; ');
        throw new Error(
          reason || 'Video resource failed to publish — post was not completed'
        );
      }
    }

    throwIfPublishAborted(signal);
    return { postIdentifier };
  } catch (err) {
    if (stashedVideoFileId) discardPublishFile(stashedVideoFileId);
    throw err;
  }
}

/**
 * @deprecated Quitter expects plain text in `post.text`. Kept for any callers
 * that still format for display elsewhere.
 */
export function plainTextToQuitterHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n/);
  if (paragraphs.length === 0) return '<p></p>';
  return paragraphs
    .map((line) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (!escaped.trim()) return '<p><br></p>';
      return `<p>${escaped}</p>`;
    })
    .join('');
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

export type ExtractVideoHoverFramesOptions = {
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
      video.onerror = () => reject(new Error('Failed to load video for frames'));
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
    const unique = [...new Set(candidates.map((t) => Math.round(t * 100) / 100))];

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
      success(result) {
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
