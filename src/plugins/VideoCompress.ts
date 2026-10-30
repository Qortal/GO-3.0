import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isAndroidApp } from '../utils/androidApp';

export type VideoCompressOptions = {
  /** Absolute filesystem path or content:// URI */
  path: string;
  /** Skip when source is smaller than this (default 0 — plan decides). */
  skipIfBelowBytes?: number;
  /**
   * When true, always MediaCodec-transcode to H.264 MP4 even if under the
   * size skip threshold (used for MOV/WebM/MKV/3GP → Quitter-efficient MP4).
   */
  forceTranscode?: boolean;
  /** Soft target for output size in bytes. */
  targetMaxBytes?: number;
  /** Max output height (default 720). */
  maxHeight?: number;
  /** Cap output frame rate for faster encodes (default 30). */
  frameRate?: number;
  /** Keyframe interval in seconds (higher = faster encode). */
  keyFrameInterval?: number;
  /** AAC audio bitrate when re-encoding (default 96000). */
  audioBitRate?: number;
  /**
   * Audio channel count when re-encoding. 0/omit = keep input;
   * 1 = force mono (slightly less audio work).
   */
  audioChannels?: number;
  /**
   * Remux original audio without re-encoding (much faster).
   * Prefer false — pass-through breaks muxes on some OEMs.
   */
  passThroughAudio?: boolean;
  /** Title shown on the OS progress notification. */
  notificationTitle?: string;
  /**
   * Clip length used to turn targetMaxBytes into a bitrate. Pass the same
   * length the target was sized from, or native guesses it from file size.
   */
  durationSec?: number;
};

export type VideoCompressResult = {
  path: string;
  uri: string;
  size: number;
  skipped: boolean;
  compressed: boolean;
};

export type VideoCompressProgressEvent = {
  progress: number;
  state: 'starting' | 'compressing' | 'completed' | 'failed' | string;
  /** Output file the running attempt is writing (present while 0–99%). */
  path?: string;
};

export type VideoCompressStatResult = {
  path: string;
  size: number;
  exists: boolean;
};

export type VideoCompressServeResult = {
  url: string;
  path: string;
  size: number;
};

export type VideoCacheDownloadResult = {
  path: string;
  size: number;
};

export type VideoExtractAudioResult = {
  path: string;
  uri: string;
  size: number;
};

export interface VideoCompressPlugin {
  compress(options: VideoCompressOptions): Promise<VideoCompressResult>;
  cancel(): Promise<void>;
  /** Native file size. */
  stat(options: { path: string }): Promise<VideoCompressStatResult>;
  /**
   * Serve a local file on http://127.0.0.1 so WebView fetch() can read full
   * bytes (convertFileSrc truncates large videos on Android).
   */
  serveFile(options: { path: string }): Promise<VideoCompressServeResult>;
  /** Stop the server behind `url`; with no url, stop every server. */
  stopServe(options?: { url?: string }): Promise<void>;
  /** Download a remote URL into app cache (for extract/compress). */
  downloadUrlToCache(options: {
    url: string;
    filename?: string;
  }): Promise<VideoCacheDownloadResult>;
  /** Strip video track and write audio-only M4A into cache. */
  extractAudio(options: { path: string }): Promise<VideoExtractAudioResult>;
  addListener(
    eventName: 'progress',
    listenerFunc: (event: VideoCompressProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

const VideoCompressNative =
  registerPlugin<VideoCompressPlugin>('VideoCompress');

export const isNativeVideoCompressAvailable = () => isAndroidApp();

export const VideoCompress = {
  compress: async (
    options: VideoCompressOptions
  ): Promise<VideoCompressResult> => {
    if (!isNativeVideoCompressAvailable()) {
      throw new Error('Native video compression is only available on Android');
    }
    return VideoCompressNative.compress(options);
  },
  cancel: async (): Promise<void> => {
    if (!isNativeVideoCompressAvailable()) return;
    await VideoCompressNative.cancel();
  },
  stat: async (options: { path: string }): Promise<VideoCompressStatResult> => {
    if (!isNativeVideoCompressAvailable()) {
      throw new Error('Native video compression is only available on Android');
    }
    return VideoCompressNative.stat(options);
  },
  serveFile: async (options: {
    path: string;
  }): Promise<VideoCompressServeResult> => {
    if (!isNativeVideoCompressAvailable()) {
      throw new Error('Native video compression is only available on Android');
    }
    return VideoCompressNative.serveFile(options);
  },
  stopServe: async (options?: { url?: string }): Promise<void> => {
    if (!isNativeVideoCompressAvailable()) return;
    await VideoCompressNative.stopServe(options || {});
  },
  downloadUrlToCache: async (options: {
    url: string;
    filename?: string;
  }): Promise<VideoCacheDownloadResult> => {
    if (!isNativeVideoCompressAvailable()) {
      throw new Error('Native download is only available on Android');
    }
    return VideoCompressNative.downloadUrlToCache(options);
  },
  extractAudio: async (options: {
    path: string;
  }): Promise<VideoExtractAudioResult> => {
    if (!isNativeVideoCompressAvailable()) {
      throw new Error('Native audio extract is only available on Android');
    }
    return VideoCompressNative.extractAudio(options);
  },
  addProgressListener: async (
    listener: (event: VideoCompressProgressEvent) => void
  ): Promise<PluginListenerHandle | null> => {
    if (!isNativeVideoCompressAvailable()) return null;
    return VideoCompressNative.addListener('progress', listener);
  },
};
