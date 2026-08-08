/**
 * Save / extract helpers for Qortino themed media viewers.
 */
import { Capacitor } from '@capacitor/core';
import { downloadFromLocation, normalizeFilename } from '../utils/downloadFromLocation';
import {
  saveBlobToMobileDocuments,
  mobileSaveLocationLabelFor,
} from '../utils/mobileFileSave';
import { saveFileToDiskGeneric } from '../utils/generateWallet/generateWallet';
import {
  isNativeVideoCompressAvailable,
  VideoCompress,
} from '../plugins/VideoCompress';
import {
  buildMediaStreamUrl,
  waitForQdnResourceReady,
  type QdnMediaItem,
} from './qdnMedia';

function extForKind(kind: QdnMediaItem['kind']): string {
  switch (kind) {
    case 'video':
      return 'mp4';
    case 'audio':
      return 'm4a';
    case 'image':
      return 'jpg';
    case 'pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

function mimeForKind(kind: QdnMediaItem['kind']): string {
  switch (kind) {
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mp4';
    case 'image':
      return 'image/jpeg';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export function mediaSaveFilename(item: QdnMediaItem, overrideExt?: string): string {
  const ext = overrideExt || extForKind(item.kind);
  const base = normalizeFilename(item.title || item.identifier || 'qdn_media');
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

export async function saveQdnMediaToDevice(
  item: QdnMediaItem,
  options?: {
    downloadResource?: (r: {
      name: string;
      service: string;
      identifier: string;
    }) => void;
    onProgress?: (label: string) => void;
  }
): Promise<{ message: string }> {
  options?.onProgress?.('Preparing download…');
  await waitForQdnResourceReady(item, {
    downloadResource: options?.downloadResource,
    timeoutMs: 120_000,
    onProgress: (p, status) => {
      options?.onProgress?.(
        p > 0 ? `Fetching from QDN… ${p}%` : `Preparing… (${status || 'QDN'})`
      );
    },
  });

  const filename = mediaSaveFilename(item);
  options?.onProgress?.('Saving to device…');

  if (Capacitor.isNativePlatform()) {
    const result = await downloadFromLocation({
      filename,
      location: {
        service: item.service,
        name: item.name,
        identifier: item.identifier,
      },
      mimeType: mimeForKind(item.kind),
    });
    if (!result.success) {
      throw new Error(result.error || 'Save failed');
    }
    return {
      message: `Saved to ${mobileSaveLocationLabelFor(filename)}/${filename}`,
    };
  }

  const url = buildMediaStreamUrl(item, false);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  await saveFileToDiskGeneric(blob, filename);
  return { message: `Downloaded ${filename}` };
}

/**
 * Extract audio from a READY QDN video and save as M4A.
 * Native Android uses MediaCodec demux (video track removed).
 */
export async function extractAudioFromQdnVideo(
  item: QdnMediaItem,
  options?: {
    downloadResource?: (r: {
      name: string;
      service: string;
      identifier: string;
    }) => void;
    onProgress?: (label: string) => void;
  }
): Promise<{ message: string }> {
  if (item.kind !== 'video') {
    throw new Error('Audio extract is for videos');
  }

  options?.onProgress?.('Waiting for video on QDN…');
  const { url } = await waitForQdnResourceReady(item, {
    downloadResource: options?.downloadResource,
    timeoutMs: 180_000,
    onProgress: (p, status) => {
      options?.onProgress?.(
        p > 0 ? `Fetching video… ${p}%` : `Preparing video… (${status || 'QDN'})`
      );
    },
  });

  const audioName = mediaSaveFilename(item, 'm4a');

  if (isNativeVideoCompressAvailable()) {
    options?.onProgress?.('Caching video…');
    const cached = await VideoCompress.downloadUrlToCache({
      url,
      filename: `${item.identifier || 'video'}.mp4`,
    });
    options?.onProgress?.('Extracting audio…');
    const extracted = await VideoCompress.extractAudio({ path: cached.path });
    options?.onProgress?.('Saving audio…');
    const served = await VideoCompress.serveFile({ path: extracted.path });
    try {
      const res = await fetch(served.url);
      if (!res.ok) throw new Error(`Could not read extracted audio (${res.status})`);
      const blob = await res.blob();
      const audioBlob =
        blob.type && blob.type.startsWith('audio')
          ? blob
          : new Blob([blob], { type: 'audio/mp4' });
      await saveBlobToMobileDocuments(audioName, audioBlob);
    } finally {
      await VideoCompress.stopServe().catch(() => undefined);
    }
    return {
      message: `Audio saved to ${mobileSaveLocationLabelFor(audioName)}/${audioName}`,
    };
  }

  // Browser / PC debug: download the video file (extract needs Android).
  options?.onProgress?.('Downloading video (PC — save video; extract on Android)…');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  await saveFileToDiskGeneric(blob, mediaSaveFilename(item, 'mp4'));
  return {
    message:
      'Saved the video on this PC. Open the Android app to extract audio from the video.',
  };
}
