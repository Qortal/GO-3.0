import { describe, expect, it, vi } from 'vitest';

// stageOutbound reads the engine's OPFS blob through the fs shim; these
// tests only care about the native side, so any path reads as 3 bytes.
vi.mock('./shims/fs', () => ({
  existsSync: () => true,
  mkdirSync: () => undefined,
  readFileSync: () => new Uint8Array([1, 2, 3]),
  writeFileSync: () => undefined,
}));

import { ReticulumResourceStaging, type NativeFsFn } from './resourceStaging';
import { MobileReticulumBridge } from './wireBridge';

type FsCall = { op: string; args: Record<string, unknown> };

/** A bridge over real staging with a recording native side. */
function makeStagingBridge() {
  const fsCalls: FsCall[] = [];
  let nextPath = 0;
  const nativeFs: NativeFsFn = async (op, args) => {
    fsCalls.push({ op, args });
    if (op === 'path') {
      nextPath += 1;
      return { path: `/native/stage/${nextPath}-${String(args.name)}` };
    }
    return {};
  };
  const commands: Array<{ action: string; payload: Record<string, any> }> = [];
  const sendCommand = vi.fn(
    async (action: string, payload: Record<string, unknown>) => {
      commands.push({ action, payload: payload as Record<string, any> });
      return { ok: true };
    }
  );
  const bridge = new MobileReticulumBridge(
    sendCommand,
    new ReticulumResourceStaging(nativeFs)
  );
  const opsOf = (op: string) => fsCalls.filter((call) => call.op === op);
  /** The native path the bridge handed Python for this send. */
  const stagedPathOf = (transferId: string) =>
    String(
      commands.find(
        (c) =>
          (c.action === 'send_reticulum_chat_resource' ||
            c.action === 'send_reticulum_resource') &&
          c.payload.transferId === transferId
      )?.payload.filePath ?? ''
    );
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { bridge, fsCalls, opsOf, stagedPathOf, flush };
}

describe('outbound staging cleanup', () => {
  it('sweeps stale staged files once, on the first ready', async () => {
    const { bridge, opsOf, flush } = makeStagingBridge();
    bridge.markReady({});
    bridge.markReady({});
    await flush();
    expect(opsOf('sweep')).toEqual([
      { op: 'sweep', args: { maxAgeMs: 10 * 60_000 } },
    ]);
  });

  it('sweeps again once the socket opens when the first ready came before it', async () => {
    // The main-thread route has no 'sweep' op; only the bridge socket does.
    let socketOpen = false;
    const sweeps: string[] = [];
    const nativeFs: NativeFsFn = async (op) => {
      if (op !== 'sweep') return {};
      sweeps.push(socketOpen ? 'socket' : 'main');
      if (!socketOpen) throw new Error('unknown native fs op: sweep');
      return { deleted: 2 };
    };
    const bridge = new MobileReticulumBridge(
      vi.fn(async () => ({ ok: true })),
      new ReticulumResourceStaging(nativeFs)
    );
    const flush = async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    };
    bridge.markReady({});
    await flush();
    expect(sweeps).toEqual(['main']);

    socketOpen = true;
    // engineHost's ws.onopen.
    bridge.sweepStagingOnce();
    await flush();
    expect(sweeps).toEqual(['main', 'socket']);

    // Done for this worker: later readies and reconnects do not sweep.
    bridge.markReady({});
    bridge.sweepStagingOnce();
    await flush();
    expect(sweeps).toEqual(['main', 'socket']);
  });

  it('deletes a served file when its transfer reports sent', async () => {
    const { bridge, opsOf, stagedPathOf, flush } = makeStagingBridge();
    bridge.markReady({});
    await expect(
      bridge.sendReticulumChatResourceDetailed({
        transferId: 'x1',
        filePath: '/opfs/tmp/x1.json',
      })
    ).resolves.toEqual({ ok: true });
    const staged = stagedPathOf('x1');
    expect(staged).toMatch(/^\/native\/stage\//);
    expect(opsOf('write').map((call) => call.args.path)).toEqual([staged]);

    // Python's terminal status carries the transfer id only.
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'sent',
      transferId: 'x1',
      resourceType: 'reticulum_chat_event',
    });
    await flush();
    expect(opsOf('delete')).toEqual([{ op: 'delete', args: { path: staged } }]);

    // A repeated terminal deletes nothing more.
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'failed',
      transferId: 'x1',
    });
    await flush();
    expect(opsOf('delete')).toHaveLength(1);
  });

  it('deletes on failed and cancelled, and for attachment ranges too', async () => {
    const { bridge, opsOf, stagedPathOf, flush } = makeStagingBridge();
    bridge.markReady({});
    await bridge.sendReticulumChatResourceDetailed({
      transferId: 'f1',
      filePath: '/opfs/tmp/f1.json',
    });
    await bridge.sendReticulumResourceDetailed({
      transferId: 'r1',
      filePath: '/opfs/tmp/r1.bin',
    });
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'failed',
      transferId: 'f1',
      reason: 'resource_authorization_no_longer_active',
    });
    bridge.dispatchPythonEvent('reticulum_resource', {
      status: 'cancelled',
      transferId: 'r1',
      resourceType: 'reticulum_attachment_range',
    });
    await flush();
    expect(opsOf('delete').map((call) => call.args.path)).toEqual([
      stagedPathOf('f1'),
      stagedPathOf('r1'),
    ]);
  });

  it('a transfer registered again deletes its earlier file', async () => {
    const { bridge, opsOf, stagedPathOf, flush } = makeStagingBridge();
    bridge.markReady({});
    await bridge.sendReticulumChatResourceDetailed({
      transferId: 'again',
      filePath: '/opfs/tmp/a.json',
    });
    const first = stagedPathOf('again');
    await bridge.sendReticulumChatResourceDetailed({
      transferId: 'again',
      filePath: '/opfs/tmp/a.json',
    });
    await flush();
    expect(opsOf('delete')).toEqual([{ op: 'delete', args: { path: first } }]);
  });

  it('leaves files of other transfers and of inbound accepts alone', async () => {
    const { bridge, opsOf, stagedPathOf, flush } = makeStagingBridge();
    bridge.markReady({});
    await bridge.sendReticulumChatResourceDetailed({
      transferId: 'keep',
      filePath: '/opfs/tmp/keep.json',
    });
    await bridge.acceptReticulumChatResourceDetailed({
      transferId: 'in1',
      savePath: '/opfs/in/in1.json',
    });
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'sent',
      transferId: 'other',
    });
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'failed',
      transferId: 'in1',
    });
    await flush();
    expect(opsOf('delete')).toEqual([]);
    expect(stagedPathOf('keep')).not.toBe('');
  });
});
