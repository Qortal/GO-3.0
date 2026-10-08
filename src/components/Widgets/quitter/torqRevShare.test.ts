import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecuteEvent = vi.fn();
vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => mockExecuteEvent(...args),
}));

const getPendingRevShare = vi.fn();
const consumeSharedFile = vi.fn(async () => undefined);
vi.mock('../../../plugins/ShareReceiver', () => ({
  ShareReceiver: {
    getPendingRevShare: () => getPendingRevShare(),
    consumeSharedFile: (path: string) => consumeSharedFile(path),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (path: string) =>
      `https://localhost/_capacitor_file_${path}`,
  },
}));

vi.mock('../../../utils/imageCompression', () => ({
  stripImageFileMetadata: async (file: File) => file,
}));

import '../../../i18n/i18n';
import {
  OPEN_REV_COMPOSER_ACTION,
  OPEN_REV_COMPOSER_RECEIVED_ACTION,
  drainRevShare,
  handOffRevFile,
  openTorqRevComposer,
} from './torqRevShare';

const sentMessages = () =>
  mockExecuteEvent.mock.calls
    .filter(([name]) => name === 'sendToApp')
    .map(([, detail]) => detail);

const snackbars = () =>
  mockExecuteEvent.mock.calls.filter(([name]) => name === 'openGlobalSnackBar');

/** Torq's answer, as its frame posts it to GO's window. */
const torqReceived = (requestId: string) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { action: OPEN_REV_COMPOSER_RECEIVED_ACTION, requestId },
    })
  );

describe('torqRevShare', () => {
  beforeEach(() => {
    mockExecuteEvent.mockClear();
    getPendingRevShare.mockReset();
    consumeSharedFile.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens rev/new in Torq, reusing an open Torq tab', async () => {
    await expect(openTorqRevComposer()).resolves.toBe(true);
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: {
        identifier: '',
        name: 'Torq',
        navigateIfAlreadyOpen: true,
        path: 'rev/new',
        service: 'APP',
      },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
    expect(sentMessages()).toHaveLength(0);
  });

  it('offers the file until Torq answers', async () => {
    const photo = new File(['p'], 'sunset.jpg', { type: 'image/jpeg' });
    const handoff = handOffRevFile(photo, { retryMs: 100, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(250);
    const sent = sentMessages();
    expect(sent.length).toBe(3);
    expect(sent[0]).toMatchObject({
      service: 'APP',
      name: 'Torq',
      message: { action: OPEN_REV_COMPOSER_ACTION, file: photo },
    });
    torqReceived(sent[0].message.requestId);
    await expect(handoff).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(sentMessages().length).toBe(3);
    expect(snackbars()).toHaveLength(0);
  });

  it('gives up and says so when Torq never answers', async () => {
    const photo = new File(['p'], 'sunset.jpg', { type: 'image/jpeg' });
    const handoff = handOffRevFile(photo, { retryMs: 100, timeoutMs: 300 });
    // Another request's answer is not this one's.
    torqReceived('someone-else');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(handoff).resolves.toBe(false);
    expect(snackbars()).toHaveLength(1);
  });

  it('opens the editor empty, with a note, for a video too big for a Rev', async () => {
    getPendingRevShare.mockResolvedValue({
      tooLarge: true,
      maxFileBytes: 100 * 1024 * 1024,
    });
    await drainRevShare();
    expect(snackbars()[0][1].message).toContain('100');
    expect(mockExecuteEvent).toHaveBeenCalledWith(
      'addTab',
      expect.objectContaining({
        data: expect.objectContaining({ path: 'rev/new' }),
      })
    );
    expect(sentMessages()).toHaveLength(0);
  });

  it('reads a shared photo, frees the cache copy and hands it to Torq', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
      }))
    );
    getPendingRevShare.mockResolvedValue({
      item: {
        path: '/cache/shared_media/a.jpg',
        mimeType: 'image/jpeg',
        name: 'a.jpg',
        size: 4,
      },
    });
    await drainRevShare();
    expect(consumeSharedFile).toHaveBeenCalledWith('/cache/shared_media/a.jpg');
    const [first] = sentMessages();
    expect(first.message.file).toBeInstanceOf(File);
    expect(first.message.file.name).toBe('a.jpg');
    torqReceived(first.message.requestId);
  });
});
