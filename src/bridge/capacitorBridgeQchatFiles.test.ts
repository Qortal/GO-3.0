import { afterEach, describe, expect, it, vi } from 'vitest';

// Every call the bridge makes to the native Reticulum plugin, by method name.
const native = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('../plugins/Reticulum', () => ({
  Reticulum: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return () => {
          native.calls.push(prop);
          return Promise.resolve({});
        };
      },
    }
  ),
}));

const PRIVATE_PATH = '/data/user/0/app/files/qchat-received/u/x.jpg';

async function loadBridge() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return await import('./capacitorBridge');
  } finally {
    warn.mockRestore();
  }
}

// N-27: every Q-Chat file event the chat and the transfer notifications see
// carries the sender's file name without bidi or control characters.
describe('Q-Chat file transfer events', () => {
  it('clean the file name a peer chose', async () => {
    const { withCleanQchatFileName } = await loadBridge();

    const received = withCleanQchatFileName({
      status: 'received',
      transferId: 'qft-1',
      path: '/data/user/0/app/files/qchat-received/u/holidaygpj.apk',
      fileName: 'holiday\u202Egpj.apk',
    });
    expect(received).toEqual({
      status: 'received',
      transferId: 'qft-1',
      path: '/data/user/0/app/files/qchat-received/u/holidaygpj.apk',
      fileName: 'holidaygpj.apk',
    });
    // No copy in public Downloads, so no content:// uri either.
    expect(received).not.toHaveProperty('downloadsUri');

    const clean = { status: 'receiving', fileName: 'photo.jpg' };
    expect(withCleanQchatFileName(clean)).toBe(clean);
    expect(withCleanQchatFileName({ status: 'failed' })).toEqual({
      status: 'failed',
    });
    expect(withCleanQchatFileName({ fileName: '\u200B\u202E' })).toEqual({
      fileName: 'file',
    });
  });
});

// N-22: a completed download is not copied out of GO's private storage.
describe('a received Q-Chat file', () => {
  let off: (() => void) | undefined;

  afterEach(() => {
    off?.();
    off = undefined;
  });

  it('reaches the chat with its private path and makes no native call', async () => {
    const bridge = await loadBridge();
    const seen: Record<string, unknown>[] = [];
    off = bridge.onMobileQchatFileTransferEvent((payload) => {
      seen.push(payload);
    });
    native.calls.length = 0;

    bridge.handleQchatFileTransferEvent({
      status: 'receiving',
      transferId: 'qft-2',
      fileName: 'x\u202E.jpg',
      bytesTransferred: 512,
    });
    bridge.handleQchatFileTransferEvent({
      status: 'received',
      transferId: 'qft-2',
      path: PRIVATE_PATH,
      fileName: 'x\u202E.jpg',
      size: 1024,
    });
    // Anything the bridge started in the background has run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([
      {
        status: 'receiving',
        transferId: 'qft-2',
        fileName: 'x.jpg',
        bytesTransferred: 512,
      },
      {
        status: 'received',
        transferId: 'qft-2',
        path: PRIVATE_PATH,
        fileName: 'x.jpg',
        size: 1024,
      },
    ]);
    expect(native.calls).toEqual([]);
  });
});
