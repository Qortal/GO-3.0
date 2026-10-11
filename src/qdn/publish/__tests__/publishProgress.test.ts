import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../background/background', () => ({
  createEndpoint: vi.fn(
    async (endpoint: string) => `http://node.test${endpoint}`
  ),
  getBaseApi: vi.fn(async () => 'http://node.test'),
}));

import { publishData } from '../publish';
import {
  QDN_PUBLISH_CHUNK_BYTES,
  type PublishProgress,
} from '../publishProgress';

// GO's publish window follows each resource through publishData's
// onProgress, whatever the Q-App is told (receiveChunks) and with or without
// a tab.
describe('publishData progress', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { method?: string }) =>
        init?.method === 'POST'
          ? new Response('txbytes', { status: 200 })
          : new Response(JSON.stringify({ name: 'Alice' }), { status: 200 })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports data sent in one piece', async () => {
    const seen: PublishProgress[] = [];
    await publishData({
      data: 'aGVsbG8=',
      identifier: 'post-1',
      registeredName: 'Alice',
      service: 'DOCUMENT',
      uploadType: 'base64',
      withFee: false,
      onProgress: (progress: PublishProgress) => seen.push(progress),
    });
    expect(seen).toEqual([
      { stage: 'uploading', sentChunks: 0, totalChunks: 1 },
      { stage: 'processing' },
      { stage: 'published' },
    ]);
  });

  it('reports each part of a file, then processing', async () => {
    const seen: PublishProgress[] = [];
    const file = new File(
      [new Uint8Array(QDN_PUBLISH_CHUNK_BYTES * 2 + 10)],
      'holiday.mp4'
    );
    await publishData({
      data: file,
      identifier: 'video-1',
      registeredName: 'Alice',
      service: 'VIDEO',
      uploadType: 'file',
      withFee: false,
      onProgress: (progress: PublishProgress) => seen.push(progress),
    });
    expect(seen).toEqual([
      { stage: 'uploading', sentChunks: 0, totalChunks: 3 },
      { stage: 'uploading', sentChunks: 1, totalChunks: 3 },
      { stage: 'uploading', sentChunks: 2, totalChunks: 3 },
      { stage: 'uploading', sentChunks: 3, totalChunks: 3 },
      { stage: 'processing' },
      { stage: 'processing' },
      { stage: 'published' },
    ]);
  });

  it('never lets a broken listener break the publish', async () => {
    await expect(
      publishData({
        data: 'aGVsbG8=',
        identifier: 'post-1',
        registeredName: 'Alice',
        service: 'DOCUMENT',
        uploadType: 'base64',
        withFee: false,
        onProgress: () => {
          throw new Error('window gone');
        },
      })
    ).resolves.toBeUndefined();
  });
});
