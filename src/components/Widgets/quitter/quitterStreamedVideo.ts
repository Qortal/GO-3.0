/**
 * Publish-while-compressing for the Home composer: once the user presses
 * Publish during native compression, upload the finished part of the encoder's
 * output to the node, so only the tail and header are left when it ends.
 */
import { VideoCompress } from '../../../plugins/VideoCompress';
import {
  createStreamedChunkUpload,
  type GrowingFileSource,
  type StreamedChunkUpload,
} from '../../../utils/streamedChunkUpload';
import { isCapacitorAndroid, type VideoPrepareJob } from './quitterVideoCompress';

/** Must equal the chunk URL publishData builds for this resource. */
export const qdnChunkPath = (
  service: string,
  name: string,
  identifier: string
) =>
  `/arbitrary/${service}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}/chunk`;

function nativeGrowingFileSource(): GrowingFileSource {
  let served: { path: string; url: string } | null = null;

  const release = async () => {
    const current = served;
    served = null;
    if (current) {
      await VideoCompress.stopServe({ url: current.url }).catch(
        () => undefined
      );
    }
  };

  const urlFor = async (path: string) => {
    if (served?.path === path) return served.url;
    await release();
    const res = await VideoCompress.serveFile({ path });
    served = { path, url: res.url };
    return res.url;
  };

  return {
    size: async (path) => {
      try {
        const stat = await VideoCompress.stat({ path });
        return stat.exists ? Number(stat.size) || 0 : null;
      } catch {
        return null;
      }
    },
    read: async (path, start, end) => {
      const url = await urlFor(path);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Range: `bytes=${start}-${end - 1}` },
      });
      if (res.status !== 206) {
        throw new Error(`Range read failed (${res.status})`);
      }
      return res.arrayBuffer();
    },
    dispose: release,
  };
}

async function postChunkOnce(
  chunkPath: string,
  chunk: Blob,
  index: number,
  signal: AbortSignal
) {
  const formData = new FormData();
  formData.append('chunk', chunk, 'video.mp4');
  formData.append('index', String(index));
  // Lazy: background.ts is heavy and this module sits under the Home UI.
  const { createEndpoint } = await import('../../../background/background');
  const res = await fetch(await createEndpoint(chunkPath), {
    body: formData,
    method: 'POST',
    signal,
  });
  if (!res.ok) {
    throw new Error(`Chunk ${index} failed (${res.status})`);
  }
}

/**
 * Start uploading a running native compression. Returns null when the job
 * cannot stream (not Android native compression).
 */
export function startLiveVideoUpload({
  job,
  userName,
  videoIdentifier,
  onLiveProgress,
}: {
  job: VideoPrepareJob;
  userName: string;
  videoIdentifier: string;
  onLiveProgress?: (sentBytes: number) => void;
}): { upload: StreamedChunkUpload; unfollow: () => void } | null {
  if (!isCapacitorAndroid()) return null;
  const upload = createStreamedChunkUpload({
    chunkPath: qdnChunkPath('VIDEO', userName, videoIdentifier),
    source: nativeGrowingFileSource(),
    postChunk: postChunkOnce,
    onLiveProgress,
  });
  const unfollow = job.subscribeOutput((path) => upload.follow(path));
  const current = job.getOutputPath();
  if (current) upload.follow(current);
  return { upload, unfollow };
}
