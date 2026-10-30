import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  isNativeVideoCompressAvailable,
  VideoCompress,
  type VideoCompressResult,
} from '../../../plugins/VideoCompress';
import { scrubVideoFileMetadata } from '../../../utils/stripVideoMetadata';

const MB = 1024 * 1024;

const INEFFICIENT_EXT =
  /\.(webm|mkv|avi|3gp|3gpp|ogv|ogg|wmv|flv|mts|m2ts|mpeg|mpg|mov|hevc|h265)$/i;

export type CompressLevel = 'high' | 'medium' | 'max' | 'none';

export type CompressPlan = {
  shouldCompress: boolean;
  /** Always true when source is not already an efficient MP4 container. */
  forceTranscode: boolean;
  level: CompressLevel;
  targetMaxBytes: number;
  maxHeight: number;
  frameRate: number;
  keyFrameInterval: number;
  audioBitRate: number;
  /** 0 = keep input channels; 1 = mono when re-encoding. */
  audioChannels: number;
  /** Remux audio (skip AAC re-encode) for faster compress. */
  passThroughAudio: boolean;
  label: string;
  /** Soft estimate shown in the UI (bytes). */
  estimatedBytes: number;
  /** Clip length the estimate assumed; native needs it to derive bitrate. */
  durationSec: number;
};

export type CompressPresetOption = {
  level: Exclude<CompressLevel, 'none'>;
  label: string;
  detail: string;
  estimatedBytes: number;
  maxHeight: number;
  frameRate: number;
  keyFrameInterval: number;
  audioBitRate: number;
  audioChannels: number;
  passThroughAudio: boolean;
  targetMaxBytes: number;
};

export class VideoPrepareCancelledError extends Error {
  constructor(message = 'Compression canceled') {
    super(message);
    this.name = 'VideoPrepareCancelledError';
  }
}

export type VideoPrepareJob = {
  promise: Promise<PrepareVideoResult>;
  /** Stop native compression + progress listeners. */
  cancel: () => void;
  /**
   * Native compression only: follow the file the encoder is writing, so the
   * finished part can upload before the encode ends. Fires again with a new
   * path when native retries with safer settings. Returns an unsubscribe.
   */
  subscribeOutput: (listener: (path: string) => void) => () => void;
  /** Latest encoder output path, or null before/after native compression. */
  getOutputPath: () => string | null;
};

export function isEfficientQuitterVideoFormat(
  mimeType?: string,
  fileName?: string
): boolean {
  const mime = (mimeType || '').toLowerCase();
  const name = fileName || '';
  if (mime === 'video/mp4' || mime === 'video/x-m4v') {
    return !INEFFICIENT_EXT.test(name);
  }
  if (!mime && /\.(mp4|m4v)$/i.test(name)) return true;
  return false;
}

/**
 * Match VideoCompressPlugin.estimateBitrate() mid-band targets.
 * These are what DeepMedia actually tends to hit per preset.
 */
function estimateOutputVideoBitrate(
  maxHeight: number,
  frameRate: number
): number {
  // Native clamps: 360→0.35–1.0M, 480→0.6–1.6M, 720→1.0–3.2M (+0.4M @30fps)
  if (maxHeight <= 360) return 700_000;
  if (maxHeight <= 480) return 1_100_000;
  return frameRate >= 30 ? 2_200_000 : 1_800_000;
}

/** Infer length when the editor hasn't loaded duration yet. */
function inferDurationSec(fileSize: number, durationSec?: number): number {
  if (durationSec && durationSec > 0.5) return durationSec;
  // Phone-camera originals are typically ~10–16 Mbps, not 5.
  // Using 12 Mbps keeps High/Medium/Max estimates close to real DeepMedia output.
  if (fileSize > 0) {
    return Math.max(8, Math.min(1800, (fileSize * 8) / 12_000_000));
  }
  return 60;
}

function estimateCompressedBytes(
  fileSize: number,
  maxHeight: number,
  frameRate: number,
  audioBitRate: number,
  durationSec?: number
): number {
  const size = Math.max(0, fileSize);
  const seconds = inferDurationSec(size, durationSec);
  const videoBps = estimateOutputVideoBitrate(maxHeight, frameRate);
  const audioBps = Math.max(48_000, Math.min(160_000, audioBitRate));
  // ~3% mux/container overhead
  let bytes = Math.round(((videoBps + audioBps) * seconds * 1.03) / 8);
  if (size > 0) bytes = Math.min(size, bytes);
  return Math.max(300_000, bytes);
}

/** User-facing High / Medium / Max options with soft size estimates. */
export function listCompressPresets(
  fileSize: number,
  durationSec?: number
): CompressPresetOption[] {
  const highAudio = 128_000;
  const mediumAudio = 96_000;
  const maxAudio = 64_000;

  const highBytes = estimateCompressedBytes(
    fileSize,
    720,
    30,
    highAudio,
    durationSec
  );
  let mediumBytes = estimateCompressedBytes(
    fileSize,
    480,
    30,
    mediumAudio,
    durationSec
  );
  let maxBytes = estimateCompressedBytes(
    fileSize,
    360,
    24,
    maxAudio,
    durationSec
  );

  // Keep a clear High > Medium > Max ladder even when duration is unknown.
  if (mediumBytes >= highBytes) {
    mediumBytes = Math.max(300_000, Math.round(highBytes * 0.55));
  }
  if (maxBytes >= mediumBytes) {
    maxBytes = Math.max(300_000, Math.round(mediumBytes * 0.65));
  }

  return [
    {
      level: 'high',
      label: 'High quality',
      detail: '720p · 30fps · best quality',
      estimatedBytes: highBytes,
      maxHeight: 720,
      frameRate: 30,
      // Longer GOP = fewer I-frames = faster MediaCodec encode
      keyFrameInterval: 4,
      audioBitRate: highAudio,
      audioChannels: 0,
      // Re-encode AAC — pass-through caused bad muxes on some devices
      passThroughAudio: false,
      targetMaxBytes: highBytes,
    },
    {
      level: 'medium',
      label: 'Medium compression',
      detail: '480p · 30fps · balanced',
      estimatedBytes: mediumBytes,
      maxHeight: 480,
      frameRate: 30,
      keyFrameInterval: 5,
      audioBitRate: mediumAudio,
      audioChannels: 0,
      passThroughAudio: false,
      targetMaxBytes: mediumBytes,
    },
    {
      level: 'max',
      label: 'Max compression',
      detail: '360p · 24fps · smallest file',
      estimatedBytes: maxBytes,
      maxHeight: 360,
      frameRate: 24,
      keyFrameInterval: 6,
      audioBitRate: maxAudio,
      // Keep stereo — mono AAC fails on some OEM encoders; size comes from video.
      audioChannels: 0,
      passThroughAudio: false,
      targetMaxBytes: maxBytes,
    },
  ];
}

/** Adaptive plan + format conversion to Quitter-efficient H.264 MP4. */
export function planVideoCompression(
  fileSize: number,
  mimeType?: string,
  fileName?: string,
  level: CompressLevel = 'high',
  durationSec?: number
): CompressPlan {
  const efficient = isEfficientQuitterVideoFormat(mimeType, fileName);
  const size = Math.max(0, fileSize);
  const forceTranscode = !efficient;
  const tinyEfficient = efficient && size > 0 && size < 5 * MB;

  const assumedDurationSec = inferDurationSec(size, durationSec);

  if (level === 'none' || tinyEfficient) {
    return {
      shouldCompress: false,
      forceTranscode: false,
      level: tinyEfficient ? 'none' : level,
      targetMaxBytes: size,
      maxHeight: 1080,
      frameRate: 30,
      keyFrameInterval: 4,
      audioBitRate: 128_000,
      audioChannels: 0,
      passThroughAudio: false,
      label: tinyEfficient ? 'Already efficient MP4' : 'Compression skipped',
      estimatedBytes: size,
      durationSec: assumedDurationSec,
    };
  }

  const presets = listCompressPresets(size, durationSec);
  const preset = presets.find((item) => item.level === level) || presets[0];

  const labelByLevel: Record<Exclude<CompressLevel, 'none'>, string> = {
    high: 'High quality compress for publish',
    medium: 'Medium compression for faster publish',
    max: 'Max compression for faster publish',
  };

  return {
    shouldCompress: true,
    forceTranscode,
    level: preset.level,
    targetMaxBytes: preset.targetMaxBytes,
    maxHeight: preset.maxHeight,
    frameRate: preset.frameRate,
    keyFrameInterval: preset.keyFrameInterval,
    audioBitRate: preset.audioBitRate,
    audioChannels: preset.audioChannels,
    passThroughAudio: preset.passThroughAudio,
    label: labelByLevel[preset.level],
    estimatedBytes: preset.estimatedBytes,
    durationSec: assumedDurationSec,
  };
}

/**
 * Android WebView's `new File([blob])` often reports size 0 (or lies) even when
 * bytes are present. Always build a Blob with File-like fields on native —
 * publishData uses .size / .slice / .name.
 */
function createPublishFile(
  buffer: ArrayBuffer,
  name: string,
  mimeType: string
): File {
  const type = mimeType || 'video/mp4';
  const byteLength = buffer.byteLength;
  if (byteLength < 1024) {
    throw new Error(
      `Compressed video file is invalid (too small: ${byteLength} bytes)`
    );
  }

  // Prefer real File on desktop/web only.
  if (!Capacitor.isNativePlatform()) {
    try {
      const file = new File([buffer], name, { type, lastModified: Date.now() });
      if (file.size === byteLength) return file;
    } catch {
      // fall through
    }
  }

  const blob = new Blob([buffer], { type });
  if (blob.size !== byteLength) {
    throw new Error(
      `Compressed video read failed (blob ${blob.size}, buffer ${byteLength})`
    );
  }
  Object.defineProperties(blob, {
    name: { value: name, configurable: true },
    lastModified: { value: Date.now(), configurable: true },
    webkitRelativePath: { value: '', configurable: true },
  });
  return blob as File;
}

/**
 * Read a native file into a JS File via loopback HTTP (full bytes).
 * Do NOT use Capacitor.convertFileSrc — Android WebView truncates large videos.
 */
async function fileFromNativeUri(
  pathOrUri: string,
  name: string,
  mimeType = 'video/mp4',
  expectedSize?: number
): Promise<File> {
  if (!isNativeVideoCompressAvailable()) {
    throw new Error('Native video read is only available on Android');
  }

  const path = pathOrUri.replace(/^file:\/\//, '');
  let servedUrl = '';
  try {
    const served = await VideoCompress.serveFile({ path });
    servedUrl = served.url;
    const diskSize = Number(served.size) || 0;
    if (diskSize < 1024) {
      throw new Error(
        `Compressed video file is invalid (too small: ${diskSize} bytes)`
      );
    }
    if (
      typeof expectedSize === 'number' &&
      expectedSize > 32 * 1024 &&
      Math.abs(diskSize - expectedSize) > Math.max(4096, expectedSize * 0.05)
    ) {
      throw new Error(
        `Compressed video size mismatch (disk ${diskSize}, expected ~${expectedSize})`
      );
    }

    let buffer: ArrayBuffer | null = null;
    let lastError: unknown = null;

    // 1) WebView fetch → arrayBuffer (most direct)
    try {
      const response = await fetch(served.url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`local HTTP ${response.status}`);
      }
      buffer = await response.arrayBuffer();
    } catch (err) {
      lastError = err;
    }

    // 2) CapacitorHttp bypasses WebView networking quirks
    if (!buffer || buffer.byteLength < 1024) {
      try {
        const { CapacitorHttp } = await import('@capacitor/core');
        const res = await CapacitorHttp.get({
          url: served.url,
          responseType: 'arraybuffer',
        });
        const data = res.data;
        if (data instanceof ArrayBuffer) {
          buffer = data;
        } else if (typeof data === 'string' && data.length > 0) {
          // Some runtimes return base64 for binary
          const binary = atob(data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          buffer = bytes.buffer;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!buffer || buffer.byteLength < 1024) {
      throw new Error(
        `Compressed video read failed (disk ${diskSize} bytes)` +
          (lastError
            ? `: ${String((lastError as any)?.message || lastError)}`
            : '')
      );
    }

    if (
      diskSize > 32 * 1024 &&
      Math.abs(buffer.byteLength - diskSize) > Math.max(4096, diskSize * 0.02)
    ) {
      throw new Error(
        `Compressed video read failed (got ${buffer.byteLength} bytes, disk ${diskSize})`
      );
    }

    return createPublishFile(buffer, name, mimeType || 'video/mp4');
  } finally {
    // Stop only our server: a live upload may be reading another file.
    if (servedUrl) {
      await VideoCompress.stopServe({ url: servedUrl }).catch(() => undefined);
    }
  }
}

export type PrepareVideoResult = {
  file: File;
  plan: CompressPlan;
  compressed: boolean;
  skipped: boolean;
};

export type PrepareVideoOptions = {
  file?: File | null;
  size: number;
  name: string;
  mimeType?: string;
  nativePath?: string;
  compressLevel?: CompressLevel;
  /** Clip length from the editor; keeps the bitrate matched to the estimate. */
  durationSec?: number;
  notificationTitle?: string;
  onProgress?: (message: string, percent?: number) => void;
};

function resolveCompressLevel(options: PrepareVideoOptions): CompressLevel {
  return options.compressLevel || 'high';
}

/**
 * Start compression in the background (OS notification + progress events).
 * Returns a job whose promise resolves with the publish-ready File.
 */
export function startBackgroundVideoPrepare(
  options: PrepareVideoOptions
): VideoPrepareJob {
  let progressHandle: PluginListenerHandle | null = null;
  let cancelled = false;
  let settleCancel: ((error: Error) => void) | null = null;
  let outputPath: string | null = null;
  const outputListeners = new Set<(path: string) => void>();
  const setOutputPath = (next: string | null) => {
    if (next === outputPath) return;
    outputPath = next;
    if (!next) return;
    outputListeners.forEach((listener) => {
      try {
        listener(next);
      } catch {
        // a broken listener must not stop compression
      }
    });
  };

  const throwIfCancelled = () => {
    if (cancelled) throw new VideoPrepareCancelledError();
  };

  const promise = (async (): Promise<PrepareVideoResult> => {
    const level = resolveCompressLevel(options);
    const plan = planVideoCompression(
      options.size,
      options.mimeType,
      options.name,
      level,
      options.durationSec
    );
    const wantCompress = plan.shouldCompress || plan.forceTranscode;
    const fallbackName =
      options.name.replace(/\.\w+$/, '') + '.mp4' || 'video.mp4';

    const ensureFile = async (): Promise<File> => {
      if (options.file) return options.file;
      if (!options.nativePath) {
        throw new Error('Video file is missing');
      }
      return fileFromNativeUri(
        options.nativePath,
        options.name || fallbackName,
        options.mimeType || 'video/mp4'
      );
    };
    // The original is published as it is (not transcoded), so drop the
    // recording location, device and time from its metadata first. The
    // native transcoder never writes them into compressed output.
    const originalFile = async (): Promise<File> =>
      (await scrubVideoFileMetadata(await ensureFile())) as File;

    if (!wantCompress) {
      throwIfCancelled();
      options.onProgress?.('Video ready', 100);
      return {
        file: await originalFile(),
        plan,
        compressed: false,
        skipped: true,
      };
    }

    if (!isNativeVideoCompressAvailable()) {
      throwIfCancelled();
      options.onProgress?.(
        plan.forceTranscode
          ? 'Format conversion needs Android — using original'
          : 'Native compression unavailable — using original',
        undefined
      );
      return {
        file: await originalFile(),
        plan,
        compressed: false,
        skipped: false,
      };
    }

    if (!options.nativePath) {
      throwIfCancelled();
      options.onProgress?.(
        'Pick the video via the system picker to enable conversion',
        undefined
      );
      return {
        file: await originalFile(),
        plan,
        compressed: false,
        skipped: false,
      };
    }

    throwIfCancelled();
    options.onProgress?.('Compressing Your Video', 0);
    progressHandle = await VideoCompress.addProgressListener((event) => {
      if (cancelled) return;
      if (typeof event.path === 'string' && event.path) {
        setOutputPath(event.path);
      }
      if (event.progress < 0) {
        options.onProgress?.(
          event.state === 'canceled'
            ? 'Compression canceled'
            : 'Compression failed',
          -1
        );
        return;
      }
      options.onProgress?.(
        event.progress >= 100 ? 'Video ready' : 'Compressing Your Video',
        event.progress
      );
    });

    let result: VideoCompressResult;
    try {
      const compressPromise = VideoCompress.compress({
        path: options.nativePath,
        // Never skip by a fixed MB gate — plan already decided compression.
        skipIfBelowBytes: 0,
        forceTranscode: plan.forceTranscode,
        targetMaxBytes: plan.targetMaxBytes,
        maxHeight: plan.maxHeight,
        frameRate: plan.frameRate,
        keyFrameInterval: plan.keyFrameInterval,
        audioBitRate: plan.audioBitRate,
        audioChannels: plan.audioChannels,
        passThroughAudio: plan.passThroughAudio,
        notificationTitle: options.notificationTitle || 'Compressing video',
        durationSec: plan.durationSec,
      });
      result = await Promise.race([
        compressPromise,
        new Promise<never>((_, reject) => {
          settleCancel = reject;
          if (cancelled) {
            reject(new VideoPrepareCancelledError());
          }
        }),
      ]);
    } catch (err: any) {
      if (
        cancelled ||
        err?.name === 'VideoPrepareCancelledError' ||
        /cancel/i.test(String(err?.message || err))
      ) {
        throw new VideoPrepareCancelledError(
          err?.message || 'Compression canceled'
        );
      }
      throw err;
    } finally {
      settleCancel = null;
      outputPath = null;
      await progressHandle?.remove();
      progressHandle = null;
    }

    throwIfCancelled();

    if (result.skipped || !result.compressed) {
      options.onProgress?.('Video ready', 100);
      return {
        file: await originalFile(),
        plan,
        compressed: false,
        skipped: true,
      };
    }

    // Prefer absolute filesystem path — content:// fetch in WebView is unreliable.
    const readPath = result.path || result.uri;
    if (!readPath) {
      throw new Error('Compressed video path missing');
    }
    const compressedFile = await fileFromNativeUri(
      readPath,
      fallbackName,
      'video/mp4',
      result.size
    );

    throwIfCancelled();

    // Prefer native-reported size — WebView File.size can lie (often 0).
    const effectiveSize = Math.max(
      compressedFile.size || 0,
      Number(result.size) || 0
    );
    if (effectiveSize < 32 * 1024) {
      throw new Error(`Compressed video is invalid (${effectiveSize} bytes)`);
    }

    // options.size is 0 when the picker/share sheet did not report a size;
    // without this guard every such video fell back to the uncompressed original.
    if (
      !plan.forceTranscode &&
      options.size > 0 &&
      effectiveSize >= options.size * 0.95
    ) {
      options.onProgress?.('Video ready', 100);
      return {
        file: await originalFile(),
        plan,
        compressed: false,
        skipped: false,
      };
    }

    options.onProgress?.(`Ready · ${formatBytes(effectiveSize)}`, 100);
    return {
      file: compressedFile,
      plan,
      compressed: true,
      skipped: false,
    };
  })();

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    outputPath = null;
    outputListeners.clear();
    void progressHandle?.remove();
    progressHandle = null;
    settleCancel?.(new VideoPrepareCancelledError());
    settleCancel = null;
    void VideoCompress.cancel().catch(() => undefined);
  };

  // Listeners only matter while encoding.
  void promise.then(
    () => outputListeners.clear(),
    () => outputListeners.clear()
  );

  return {
    promise,
    cancel,
    subscribeOutput: (listener) => {
      outputListeners.add(listener);
      return () => {
        outputListeners.delete(listener);
      };
    },
    getOutputPath: () => outputPath,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB`;
}

export function canUseNativeVideoCompress(): boolean {
  return isNativeVideoCompressAvailable();
}

export function isCapacitorAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function pickVideoForQuitter(): Promise<{
  file: File | null;
  nativePath: string;
  size: number;
  name: string;
  mimeType: string;
} | null> {
  if (!isCapacitorAndroid()) return null;
  const { FilePicker } = await import('@capawesome/capacitor-file-picker');
  const result = await FilePicker.pickVideos({ limit: 1, readData: false });
  const picked = result?.files?.[0];
  if (!picked?.path) return null;

  const name = picked.name || `video-${Date.now()}.mp4`;
  const mimeType = picked.mimeType || 'video/*';
  const size = typeof picked.size === 'number' ? picked.size : 0;

  // Keep the original out of JS memory — compress/publish read via native path.
  // Eagerly loading 50MB+ through WebView was the source of "read failed" errors.
  return {
    file: null,
    nativePath: picked.path,
    size,
    name,
    mimeType,
  };
}
