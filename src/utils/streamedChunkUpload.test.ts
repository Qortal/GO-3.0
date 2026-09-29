import { describe, expect, it } from 'vitest';
import {
  createStreamedChunkUpload as createUpload,
  type GrowingFileSource,
  type StreamedChunkUploadOptions,
} from './streamedChunkUpload';

// Same logic as production (1 MiB head, 5 MiB body), scaled down so jsdom's
// slow Blob/FileReader can keep up.
const STREAM_HEAD_BYTES = 64;
const STREAM_BODY_BYTES = 256;
const STREAM_LIVE_MARGIN_BYTES = 32;
const createStreamedChunkUpload = (
  options: Omit<StreamedChunkUploadOptions, 'layout'>
) =>
  createUpload({
    ...options,
    layout: {
      headBytes: STREAM_HEAD_BYTES,
      bodyBytes: STREAM_BODY_BYTES,
      marginBytes: STREAM_LIVE_MARGIN_BYTES,
    },
  });

const CHUNK_PATH = '/arbitrary/VIDEO/Alice/qtube_vid_x_abc/chunk';

const readBlob = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const pattern = (length: number, seed: number) => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + seed) & 0xff;
  return bytes;
};

/** A file on "disk" that the test grows and rewrites, like a muxer does. */
function growingDisk() {
  const files = new Map<string, { bytes: Uint8Array; visible: number }>();
  const source: GrowingFileSource = {
    size: async (path) => files.get(path)?.visible ?? null,
    read: async (path, start, end) => {
      const file = files.get(path)!;
      return file.bytes.slice(start, end).buffer;
    },
  };
  return { files, source };
}

/** Core's uploads-temp dir: chunk files by index, merged in index order. */
function fakeNode() {
  const chunks = new Map<number, Uint8Array>();
  const posts: number[] = [];
  const store = async (chunk: Blob, index: number) => {
    posts.push(index);
    chunks.set(index, await readBlob(chunk));
  };
  const merged = () => {
    const ordered = [...chunks.keys()].sort((a, b) => a - b);
    const total = ordered.reduce((sum, i) => sum + chunks.get(i)!.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const index of ordered) {
      out.set(chunks.get(index)!, offset);
      offset += chunks.get(index)!.length;
    }
    return out;
  };
  return { chunks, posts, store, merged };
}

const waitFor = async (check: () => boolean, timeoutMs = 4000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

const bodyEnd = (index: number) =>
  STREAM_HEAD_BYTES + index * STREAM_BODY_BYTES;

describe('createStreamedChunkUpload', () => {
  it('uploads finished body chunks live, then only the tail and header', async () => {
    const finalSize = bodyEnd(3) + 70;
    const final = pattern(finalSize, 7);
    const { files, source } = growingDisk();
    // The muxer's header placeholder differs from the final header.
    const disk = final.slice();
    disk.fill(0, 0, 16);
    files.set('/out/a0.mp4', { bytes: disk, visible: 0 });
    const node = fakeNode();

    const upload = createStreamedChunkUpload({
      chunkPath: CHUNK_PATH,
      source,
      pollMs: 1,
      postChunk: async (_path, chunk, index) => node.store(chunk, index),
    });
    upload.follow('/out/a0.mp4');

    // Write position passes chunk 1 and 2 (+ margin) but not chunk 3.
    files.get('/out/a0.mp4')!.visible = bodyEnd(2) + STREAM_LIVE_MARGIN_BYTES;
    // posts records a chunk when its POST starts; liveSentBytes only after it
    // finished, so wait on the latter or a loaded runner reads it too early.
    await waitFor(() => upload.liveSentBytes() === 2 * STREAM_BODY_BYTES);
    expect(node.posts).toEqual([1, 2]);
    expect(upload.touchedNode()).toBe(true);
    expect(upload.liveSentBytes()).toBe(2 * STREAM_BODY_BYTES);

    const finalBlob = new Blob([final]);
    await upload.complete({
      file: finalBlob,
      chunkPath: CHUNK_PATH,
      uploadChunk: node.store,
    });

    // Chunk 3 (full) and 4 (tail) are new; header last; 1–2 are not re-sent.
    expect(node.posts).toEqual([1, 2, 3, 4, 0]);
    expect(node.merged()).toEqual(final);
  });

  it('re-sends a live chunk whose bytes changed before the end', async () => {
    const finalSize = bodyEnd(2) + 10;
    const final = pattern(finalSize, 3);
    const { files, source } = growingDisk();
    const disk = final.slice();
    // Byte inside body chunk 1 that the "muxer" rewrites later.
    disk[STREAM_HEAD_BYTES + 5] ^= 0xff;
    files.set('/out/a0.mp4', { bytes: disk, visible: 0 });
    const node = fakeNode();
    const upload = createStreamedChunkUpload({
      chunkPath: CHUNK_PATH,
      source,
      pollMs: 1,
      postChunk: async (_path, chunk, index) => node.store(chunk, index),
    });
    upload.follow('/out/a0.mp4');
    files.get('/out/a0.mp4')!.visible = bodyEnd(1) + STREAM_LIVE_MARGIN_BYTES;
    await waitFor(() => node.posts.length === 1);

    await upload.complete({
      file: new Blob([final]),
      chunkPath: CHUNK_PATH,
      uploadChunk: node.store,
    });
    expect(node.posts).toEqual([1, 1, 2, 3, 0]);
    expect(node.merged()).toEqual(final);
  });

  it('empties stale indexes when a native retry produces a shorter file', async () => {
    const { files, source } = growingDisk();
    const first = pattern(bodyEnd(3) + 100, 1);
    files.set('/out/a0.mp4', { bytes: first, visible: 0 });
    const node = fakeNode();
    const upload = createStreamedChunkUpload({
      chunkPath: CHUNK_PATH,
      source,
      pollMs: 1,
      postChunk: async (_path, chunk, index) => node.store(chunk, index),
    });
    upload.follow('/out/a0.mp4');
    files.get('/out/a0.mp4')!.visible = bodyEnd(3) + STREAM_LIVE_MARGIN_BYTES;
    await waitFor(() => node.posts.length === 3);

    // Attempt 0 failed; attempt 1 writes a smaller file from scratch.
    const final = pattern(bodyEnd(1) + 123, 9);
    upload.follow('/out/a1.mp4');
    files.set('/out/a1.mp4', { bytes: final, visible: final.length });

    await upload.complete({
      file: new Blob([final]),
      chunkPath: CHUNK_PATH,
      uploadChunk: node.store,
    });
    expect(node.chunks.get(3)?.length).toBe(0);
    expect(node.merged()).toEqual(final);
  });

  it('ignores live chunks sent to a different resource', async () => {
    const final = pattern(bodyEnd(1) + 50, 4);
    const { files, source } = growingDisk();
    files.set('/out/a0.mp4', { bytes: final, visible: final.length + STREAM_LIVE_MARGIN_BYTES });
    const liveNode = fakeNode();
    const upload = createStreamedChunkUpload({
      chunkPath: CHUNK_PATH,
      source,
      pollMs: 1,
      postChunk: async (_path, chunk, index) => liveNode.store(chunk, index),
    });
    upload.follow('/out/a0.mp4');
    await waitFor(() => liveNode.posts.length === 1);

    const otherNode = fakeNode();
    await upload.complete({
      file: new Blob([final]),
      chunkPath: '/arbitrary/VIDEO/Alice/qtube_vid_other/chunk',
      uploadChunk: otherNode.store,
    });
    expect(otherNode.posts).toEqual([1, 2, 0]);
    expect(otherNode.merged()).toEqual(final);
  });

  it('touches nothing when the file never grows past the first body chunk', async () => {
    const { files, source } = growingDisk();
    files.set('/out/a0.mp4', { bytes: pattern(100, 0), visible: 100 });
    const node = fakeNode();
    const upload = createStreamedChunkUpload({
      chunkPath: CHUNK_PATH,
      source,
      pollMs: 1,
      postChunk: async (_path, chunk, index) => node.store(chunk, index),
    });
    upload.follow('/out/a0.mp4');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await upload.stopLive();
    expect(upload.touchedNode()).toBe(false);
    expect(node.posts).toEqual([]);
  });

  it('marks a chunk whose POST failed as unknown and sends it again', async () => {
    const final = pattern(bodyEnd(1) + 10, 6);
    const { files, source } = growingDisk();
    files.set('/out/a0.mp4', { bytes: final, visible: final.length + STREAM_LIVE_MARGIN_BYTES });
    const node = fakeNode();
    let attempts = 0;
    const upload = createStreamedChunkUpload({
      chunkPath: CHUNK_PATH,
      source,
      pollMs: 1,
      postChunk: async () => {
        attempts += 1;
        throw new Error('node went away');
      },
    });
    upload.follow('/out/a0.mp4');
    await waitFor(() => attempts === 1);
    await upload.complete({
      file: new Blob([final]),
      chunkPath: CHUNK_PATH,
      uploadChunk: node.store,
    });
    expect(upload.touchedNode()).toBe(true);
    expect(node.posts).toEqual([1, 2, 0]);
    expect(node.merged()).toEqual(final);
  });
});
