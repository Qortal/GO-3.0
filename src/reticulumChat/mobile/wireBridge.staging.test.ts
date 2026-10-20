import { describe, expect, it, vi } from 'vitest';

// The OPFS shim with a dry handle pool: every new file fails with EMFILE.
const mem = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  dry: false,
}));
vi.mock('./shims/fs', () => ({
  existsSync: (p: string) => mem.files.has(p),
  mkdirSync: () => undefined,
  readFileSync: (p: string) => Buffer.from(mem.files.get(p) ?? []),
  writeFileSync: (p: string, data: Uint8Array) => {
    if (mem.dry) {
      throw Object.assign(new Error('EMFILE: no spare OPFS handles'), {
        code: 'EMFILE',
      });
    }
    mem.files.set(p, data);
  },
}));

import { ReticulumResourceStaging, type NativeFsFn } from './resourceStaging';
import { MobileReticulumBridge } from './wireBridge';

const DIR =
  '/data/user/0/com.github.Qortal.qortalGo2/cache/reticulum-chat-resources';

function makeBridge() {
  const native = new Map<string, string>();
  const nativeFs = vi.fn(async (op: string, args: Record<string, unknown>) => {
    if (op === 'read')
      return { dataBase64: native.get(String(args.path)) ?? '' };
    if (op === 'delete') native.delete(String(args.path));
    return {};
  });
  const staging = new ReticulumResourceStaging(
    nativeFs as unknown as NativeFsFn,
    () => DIR
  );
  const sendCommand = vi.fn(
    async (_action: string, _payload: Record<string, unknown>) => ({
      ok: true,
    })
  );
  const bridge = new MobileReticulumBridge(sendCommand, staging);
  bridge.markReady({});
  const received: Array<Record<string, unknown>> = [];
  bridge.on('reticulum-chat-resource', (payload) => received.push(payload));
  return { bridge, sendCommand, native, received };
}

/** Lets the staging chain (native read, OPFS write) settle. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('MobileReticulumBridge inbound staging', () => {
  it('hands the engine the OPFS copy of a received page', async () => {
    mem.dry = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bridge, sendCommand, native, received } = makeBridge();
    const savePath =
      '/qgo/appData/qortal-shared/reticulum-chat-temp/t1.page.recv';
    await bridge.acceptReticulumChatResourceDetailed({
      transferId: 't1',
      savePath,
    });
    const nativePath = String(
      (sendCommand.mock.calls[0][1] as Record<string, unknown>).savePath
    );
    expect(nativePath.startsWith(`${DIR}/`)).toBe(true);
    native.set(nativePath, Buffer.from('{"v":1}').toString('base64'));
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'received',
      transferId: 't1',
      path: nativePath,
    });
    await settle();
    expect(received).toEqual([
      { status: 'received', transferId: 't1', path: savePath },
    ]);
  });

  it('reports local_storage_unavailable, with no path, when the copy fails', async () => {
    mem.dry = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bridge, sendCommand, native, received } = makeBridge();
    await bridge.acceptReticulumChatResourceDetailed({
      transferId: 't2',
      savePath: '/qgo/appData/qortal-shared/reticulum-chat-temp/t2.page.recv',
    });
    const nativePath = String(
      (sendCommand.mock.calls[0][1] as Record<string, unknown>).savePath
    );
    native.set(nativePath, Buffer.from('{"v":1}').toString('base64'));
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'received',
      transferId: 't2',
      path: nativePath,
      peerPresenceHash: 'b'.repeat(32),
    });
    await settle();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      status: 'failed',
      reason: 'local_storage_unavailable',
      transferId: 't2',
      peerPresenceHash: 'b'.repeat(32),
    });
    // Never the native path the engine cannot open.
    expect(received[0].path).toBeUndefined();
    // Later completions still go through (the chain is not stuck).
    mem.dry = false;
    await bridge.acceptReticulumChatResourceDetailed({
      transferId: 't3',
      savePath: '/qgo/appData/qortal-shared/reticulum-chat-temp/t3.page.recv',
    });
    const next = String(
      (sendCommand.mock.calls[1][1] as Record<string, unknown>).savePath
    );
    native.set(next, Buffer.from('{"v":2}').toString('base64'));
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'received',
      transferId: 't3',
      path: next,
    });
    await settle();
    expect(received[1]).toMatchObject({ status: 'received', transferId: 't3' });
  });
});
