import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the OPFS fs shim; `failWrites` models a dry handle
// pool (the shim throws EMFILE from writeFileSync).
const mem = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  failWrites: null as null | Error,
}));
vi.mock('./shims/fs', () => ({
  existsSync: (p: string) => mem.files.has(p),
  mkdirSync: () => undefined,
  readFileSync: (p: string) => {
    const data = mem.files.get(p);
    if (!data) {
      throw Object.assign(new Error(`ENOENT: '${p}'`), { code: 'ENOENT' });
    }
    return Buffer.from(data);
  },
  writeFileSync: (p: string, data: Uint8Array) => {
    if (mem.failWrites) throw mem.failWrites;
    mem.files.set(p, data);
  },
}));

import {
  LOCAL_STORAGE_UNAVAILABLE,
  ReticulumResourceStaging,
  type NativeFsFn,
} from './resourceStaging';
import { __resetLoggerForTests, getBootFaultLogs } from './shims/logger';

const DIR =
  '/data/user/0/com.github.Qortal.qortalGo2/cache/reticulum-chat-resources';
const UUID_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;

function makeStaging(dir = DIR) {
  const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
  const native = new Map<string, string>();
  const nativeFs = vi.fn(async (op: string, args: Record<string, unknown>) => {
    calls.push({ op, args });
    if (op === 'path') return { path: `/kotlin/${String(args.name)}` };
    if (op === 'write') {
      native.set(String(args.path), String(args.dataBase64));
      return { path: args.path };
    }
    if (op === 'read') {
      const data = native.get(String(args.path));
      if (data === undefined)
        throw new Error('Chat resource file is unavailable');
      return { dataBase64: data };
    }
    if (op === 'delete') native.delete(String(args.path));
    return {};
  });
  const staging = new ReticulumResourceStaging(
    nativeFs as unknown as NativeFsFn,
    () => dir
  );
  return { staging, calls, native, nativeFs };
}

describe('ReticulumResourceStaging', () => {
  beforeEach(() => {
    mem.files.clear();
    mem.failWrites = null;
    __resetLoggerForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('builds inbound and outbound paths without asking Kotlin', async () => {
    const { staging, calls } = makeStaging();
    const opfsSave =
      '/qgo/appData/qortal-shared/reticulum-chat-temp/0f1e2d3c.page.recv';
    const inbound = await staging.reserveInbound(opfsSave);
    expect(inbound.startsWith(`${DIR}/`)).toBe(true);
    const inboundName = inbound.slice(DIR.length + 1);
    expect(inboundName).toMatch(UUID_PREFIX);
    expect(inboundName.endsWith('-0f1e2d3c.page.recv')).toBe(true);

    mem.files.set(
      '/qgo/appData/qortal-shared/reticulum-chat-temp/t1.blob',
      new Uint8Array([7, 8])
    );
    const outbound = await staging.stageOutbound(
      '/qgo/appData/qortal-shared/reticulum-chat-temp/t1.blob',
      't1'
    );
    expect(outbound.startsWith(`${DIR}/`)).toBe(true);
    expect(outbound.endsWith('-t1.blob')).toBe(true);
    expect(outbound).not.toBe(inbound);

    expect(calls.map((c) => c.op)).toEqual(['write']);
    expect(calls[0].args.path).toBe(outbound);
  });

  it('asks Kotlin for a path while the staging folder is unknown', async () => {
    const { staging, calls } = makeStaging('');
    const inbound = await staging.reserveInbound('/qgo/x/abc.recv');
    expect(inbound).toBe('/kotlin/abc.recv');
    expect(calls.map((c) => c.op)).toEqual(['path']);
  });

  it('copies a received file into OPFS and drops the native copy', async () => {
    const { staging, native } = makeStaging();
    const opfsSave = '/qgo/appData/qortal-shared/reticulum-chat-temp/a.recv';
    const nativePath = await staging.reserveInbound(opfsSave);
    native.set(nativePath, Buffer.from('{"v":1}').toString('base64'));
    await expect(staging.completeInbound(nativePath)).resolves.toBe(opfsSave);
    expect(Buffer.from(mem.files.get(opfsSave)!).toString()).toBe('{"v":1}');
    await Promise.resolve();
    expect(native.has(nativePath)).toBe(false);
    // Not one of ours (already completed): null, as before.
    await expect(staging.completeInbound(nativePath)).resolves.toBeNull();
  });

  it('returns a local failure, never the native path, when OPFS is full', async () => {
    const { staging, native, calls } = makeStaging();
    const opfsSave = '/qgo/appData/qortal-shared/reticulum-chat-temp/b.recv';
    const nativePath = await staging.reserveInbound(opfsSave);
    native.set(nativePath, Buffer.from('{"v":1}').toString('base64'));
    mem.failWrites = Object.assign(new Error('EMFILE: no spare OPFS handles'), {
      code: 'EMFILE',
    });
    await expect(staging.completeInbound(nativePath)).resolves.toEqual({
      failed: true,
      reason: LOCAL_STORAGE_UNAVAILABLE,
      code: 'EMFILE',
    });
    await Promise.resolve();
    // The native copy is still cleaned up.
    expect(
      calls.some((c) => c.op === 'delete' && c.args.path === nativePath)
    ).toBe(true);
    // The warning reaches the logger's boot-fault buffer (Copy diagnostics).
    expect(
      getBootFaultLogs().some((line) =>
        line.includes('inbound resource staging failed code=EMFILE')
      )
    ).toBe(true);
  });

  it('treats a failed native read as a local failure too', async () => {
    const { staging } = makeStaging();
    const nativePath = await staging.reserveInbound('/qgo/x/c.recv');
    const result = await staging.completeInbound(nativePath);
    expect(result).toMatchObject({
      failed: true,
      reason: LOCAL_STORAGE_UNAVAILABLE,
    });
  });
});
