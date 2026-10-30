/**
 * Upload a QDN resource's chunks while its file is still being written (native
 * video compression), then make the node's copy match the final bytes before
 * `/finalize`.
 *
 * Why this is safe: Core stores each `POST …/{identifier}/chunk` as
 * `uploads-temp/<service>/<name>/<identifier>/chunk_<index>` (REPLACE_EXISTING)
 * and `/finalize` concatenates every `chunk_*` file in index order. So chunks
 * may arrive in any order, may differ in size, and a stale index is neutralised
 * by overwriting it with an empty chunk.
 *
 * Layout: index 0 is `[0, HEAD)` and is always sent last, because MP4 muxers
 * rewrite the header (mdat size, reserved moov) when they stop. Index i ≥ 1 is
 * `[HEAD + (i-1)·BODY, HEAD + i·BODY)`. At the end every live chunk is hashed
 * against the final file and re-sent if it differs, so a muxer that rewrites
 * other bytes, or a native retry that restarts the file, still publishes the
 * exact final bytes.
 */

const STREAM_HEAD_BYTES = 1024 * 1024;
const STREAM_BODY_BYTES = 5 * 1024 * 1024;
/** Stay this far behind the encoder's write position. */
const STREAM_LIVE_MARGIN_BYTES = 512 * 1024;

export type GrowingFileSource = {
  /** Bytes on disk right now, or null when the file is gone. */
  size: (path: string) => Promise<number | null>;
  /** Read `[start, end)` of the file. */
  read: (path: string, start: number, end: number) => Promise<ArrayBuffer>;
  dispose?: () => Promise<void>;
};

export type StreamedChunkUploadOptions = {
  /** Same string publishData builds: `/arbitrary/{service}/{name}/{identifier}/chunk`. */
  chunkPath: string;
  source: GrowingFileSource;
  /** One attempt, no retry sleep — a failed live chunk is redone at the end. */
  postChunk: (
    chunkPath: string,
    chunk: Blob,
    index: number,
    signal: AbortSignal
  ) => Promise<void>;
  pollMs?: number;
  /** Chunk layout; defaults to the STREAM_* constants (tests use tiny ones). */
  layout?: { headBytes: number; bodyBytes: number; marginBytes: number };
  onLiveProgress?: (sentBytes: number) => void;
};

type CompleteStreamedUploadArgs = {
  file: Blob;
  chunkPath: string;
  uploadChunk: (chunk: Blob, index: number) => Promise<void>;
  throwIfAborted?: () => void;
  onProgress?: (done: number, total: number) => void;
};

export type StreamedChunkUpload = {
  /** Read from this file; a new path (native retry) restarts at index 1. */
  follow: (path: string) => void;
  /** Stop sending new live chunks; waits for the one in flight. */
  stopLive: () => Promise<void>;
  cancel: () => void;
  /** Send whatever the node is missing, using the final bytes. */
  complete: (args: CompleteStreamedUploadArgs) => Promise<void>;
  liveSentBytes: () => number;
  /** True once any live chunk was sent (or attempted) to the node. */
  touchedNode: () => boolean;
};

type ChunkRecord = {
  start: number;
  end: number;
  /** Null while the POST is in flight or failed: the node copy is unknown. */
  digest: string | null;
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fnv1a = (bytes: Uint8Array): string => {
  // Fallback when WebCrypto is missing: change detection only, not security.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x01000193) >>> 0;
  }
  return `fnv-${bytes.length}-${h1.toString(16)}-${h2.toString(16)}`;
};

async function digestBytes(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      return toHex(new Uint8Array(await subtle.digest('SHA-256', buffer)));
    } catch {
      // fall through
    }
  }
  return fnv1a(new Uint8Array(buffer));
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

export function createStreamedChunkUpload(
  options: StreamedChunkUploadOptions
): StreamedChunkUpload {
  const pollMs = options.pollMs ?? 1200;
  const {
    headBytes = STREAM_HEAD_BYTES,
    bodyBytes = STREAM_BODY_BYTES,
    marginBytes = STREAM_LIVE_MARGIN_BYTES,
  } = options.layout || {};
  const bodyRange = (index: number) => {
    const start = headBytes + (index - 1) * bodyBytes;
    return { start, end: start + bodyBytes };
  };
  const records = new Map<number, ChunkRecord>();
  const abort = new AbortController();
  let currentPath: string | null = null;
  let nextIndex = 1;
  let live = true;
  let sentBytes = 0;
  let wake: (() => void) | null = null;
  let loop: Promise<void> | null = null;

  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, pollMs);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });

  const pump = async () => {
    while (live) {
      const path = currentPath;
      if (!path) {
        await sleep();
        continue;
      }
      const index = nextIndex;
      const { start, end } = bodyRange(index);
      const size = await options.source.size(path);
      if (!live || path !== currentPath) continue;
      if (size == null || size < end + marginBytes) {
        await sleep();
        continue;
      }
      const bytes = await options.source.read(path, start, end);
      if (!live || path !== currentPath) continue;
      if (bytes.byteLength !== end - start) {
        throw new Error(
          `Live read returned ${bytes.byteLength} of ${end - start} bytes`
        );
      }
      // Mark first: if the POST dies midway the node may hold part of it.
      records.set(index, { start, end, digest: null });
      await options.postChunk(
        options.chunkPath,
        new Blob([bytes]),
        index,
        abort.signal
      );
      records.set(index, { start, end, digest: await digestBytes(bytes) });
      if (path === currentPath) nextIndex = index + 1;
      sentBytes += bytes.byteLength;
      options.onLiveProgress?.(sentBytes);
    }
  };

  const ensureLoop = () => {
    if (loop || !live) return;
    loop = pump().catch((err) => {
      // Not fatal: complete() re-sends anything the node may be missing.
      live = false;
      if (!abort.signal.aborted) {
        console.warn('[streamed-upload] live upload stopped', err);
      }
    });
  };

  const stopLive = async () => {
    live = false;
    wake?.();
    await loop;
    await options.source.dispose?.().catch(() => undefined);
  };

  return {
    follow: (path) => {
      if (!path || path === currentPath) return;
      currentPath = path;
      nextIndex = 1;
      ensureLoop();
      wake?.();
    },
    stopLive,
    cancel: () => {
      live = false;
      abort.abort();
      wake?.();
      void options.source.dispose?.().catch(() => undefined);
    },
    liveSentBytes: () => sentBytes,
    touchedNode: () => records.size > 0,
    complete: async ({
      file,
      chunkPath,
      uploadChunk,
      throwIfAborted,
      onProgress,
    }) => {
      await stopLive();
      // Live chunks went to another resource (e.g. a retry with a new id).
      const known =
        chunkPath === options.chunkPath && !abort.signal.aborted
          ? records
          : new Map<number, ChunkRecord>();
      const finalSize = file.size;
      const bodyCount =
        finalSize > headBytes
          ? Math.ceil((finalSize - headBytes) / bodyBytes)
          : 0;

      const plan: { index: number; start: number; end: number }[] = [];
      for (let index = 1; index <= bodyCount; index += 1) {
        const { start } = bodyRange(index);
        const end = Math.min(start + bodyBytes, finalSize);
        const record = known.get(index);
        if (record?.digest && record.start === start && record.end === end) {
          throwIfAborted?.();
          const digest = await digestBytes(
            await blobToArrayBuffer(file.slice(start, end))
          );
          if (digest === record.digest) continue;
        }
        plan.push({ index, start, end });
      }
      // Indexes past the final end would be merged in: overwrite them empty.
      for (const index of known.keys()) {
        if (index > bodyCount) plan.push({ index, start: 0, end: 0 });
      }
      plan.push({ index: 0, start: 0, end: Math.min(headBytes, finalSize) });

      let done = 0;
      onProgress?.(done, plan.length);
      for (const item of plan) {
        throwIfAborted?.();
        const chunk =
          item.end > item.start
            ? file.slice(item.start, item.end)
            : new Blob([]);
        await uploadChunk(chunk, item.index);
        done += 1;
        onProgress?.(done, plan.length);
      }
    },
  };
}

// The stash hands publishData the same Blob object the composer attached this
// to, so a WeakMap carries the upload across the postMessage boundary.
const attached = new WeakMap<Blob, StreamedChunkUpload>();

export function attachStreamedChunkUpload(
  file: Blob,
  upload: StreamedChunkUpload
): void {
  attached.set(file, upload);
}

export function detachStreamedChunkUpload(file: Blob | null | undefined): void {
  if (file) attached.delete(file);
}

export function takeStreamedChunkUpload(
  file: unknown
): StreamedChunkUpload | null {
  if (!(file instanceof Blob)) return null;
  const upload = attached.get(file) || null;
  attached.delete(file);
  return upload;
}
