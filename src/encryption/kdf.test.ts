import { beforeEach, describe, expect, it, vi } from 'vitest';

const bcrypt = vi.hoisted(() => ({
  native: true,
  wasmFails: false,
  wasmCalls: 0,
}));

// The shared test setup stubs asmcrypto out; the KDF needs the real SHA-512.
vi.unmock('asmcrypto.js/asmcrypto.all.js');

vi.mock('../utils/nativeBcrypt', () => ({
  canUseNativeBcrypt: vi.fn(() => bcrypt.native),
  nativeBcryptHashBatch: vi.fn(),
}));

// Stand-in for the hash-wasm worker: answers each job on the next tick.
vi.mock('./bcryptworkerwasm.worker.js?worker', () => ({
  default: class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    postMessage(job: { hashBase64: string }) {
      bcrypt.wasmCalls += 1;
      setTimeout(() => {
        this.onmessage?.({
          data: bcrypt.wasmFails
            ? { error: 'wasm failed' }
            : { result: `wasm:${job.hashBase64}` },
        });
      }, 0);
    }
    terminate() {}
  },
}));

import { nativeBcryptHashBatch } from '../utils/nativeBcrypt';
import {
  getUnlockTimingSnapshot,
  resetUnlockTimingsForTests,
} from '../utils/unlockTimings';
import { doInitWorkers, kdf } from './kdf';

const nativeBatch = vi.mocked(nativeBcryptHashBatch);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const nativeResult = (jobs: Array<{ hashBase64: string }>) => ({
  hashes: jobs.map((job) => `native:${job.hashBase64}`),
  elapsedMs: 612,
  poolSize: 7,
  debuggable: false,
});

describe('kdf', () => {
  beforeEach(() => {
    bcrypt.native = true;
    bcrypt.wasmFails = false;
    bcrypt.wasmCalls = 0;
    nativeBatch.mockReset();
    nativeBatch.mockImplementation(async (jobs) => nativeResult(jobs));
    resetUnlockTimingsForTests();
    // The fallback path warns on purpose.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('shares one native batch between concurrent identical calls', async () => {
    const gate = deferred<void>();
    nativeBatch.mockImplementation(async (jobs) => {
      await gate.promise;
      return nativeResult(jobs);
    });
    const threads = doInitWorkers(16);
    const first = kdf('pw', undefined, threads, 'prewarm');
    const second = kdf('pw', new Uint8Array(4), threads, 'scan');
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);

    expect(nativeBatch).toHaveBeenCalledTimes(1);
    expect(nativeBatch.mock.calls[0][0]).toHaveLength(16);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a).toHaveLength(64);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    // A caller scribbling on its copy must not change the other's.
    a.fill(0);
    expect(b).not.toEqual(a);

    const events = getUnlockTimingSnapshot().events;
    expect(events.map((e) => e.step)).toEqual(['kdf', 'kdf']);
    expect(events[0].detail).toBe(
      'native, batch 612 ms, pool 7, 16 jobs, prewarm'
    );
    expect(events[1].detail).toBe('joined running KDF, 16 jobs, scan');
  });

  it('runs separate batches for different seeds or job counts', async () => {
    const [a, b, c] = await Promise.all([
      kdf('pw-one', undefined, doInitWorkers(16)),
      kdf('pw-two', undefined, doInitWorkers(16)),
      kdf('pw-one', undefined, doInitWorkers(8)),
    ]);
    expect(nativeBatch).toHaveBeenCalledTimes(3);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('does not keep a failed batch in flight: the next call runs again', async () => {
    nativeBatch.mockRejectedValueOnce(new Error('plugin gone'));
    bcrypt.wasmFails = true;
    await expect(
      kdf('pw', undefined, doInitWorkers(4), 'decrypt')
    ).rejects.toBe('wasm failed');

    bcrypt.wasmFails = false;
    const key = await kdf('pw', undefined, doInitWorkers(4), 'decrypt');
    expect(key).toHaveLength(64);
    expect(nativeBatch).toHaveBeenCalledTimes(2);

    const events = getUnlockTimingSnapshot().events;
    expect(events.map((e) => e.detail)).toEqual([
      'failed, 4 jobs, decrypt',
      'native, batch 612 ms, pool 7, 4 jobs, decrypt',
    ]);
  });

  it('falls back to WASM and says why in the timing', async () => {
    nativeBatch.mockRejectedValueOnce(new Error('not implemented'));
    const fromWasm = await kdf('pw', undefined, doInitWorkers(4), 'decrypt');
    expect(bcrypt.wasmCalls).toBe(4);

    bcrypt.native = false;
    const offAndroid = await kdf('pw', undefined, doInitWorkers(4));
    expect(offAndroid).toEqual(fromWasm);
    expect(nativeBatch).toHaveBeenCalledTimes(1);

    const [first, second] = getUnlockTimingSnapshot().events;
    expect(first.step).toBe('kdf');
    expect(first.ms).toBeGreaterThanOrEqual(0);
    expect(first.detail).toBe(
      'wasm (native failed: not implemented), 4 jobs, decrypt'
    );
    expect(second.detail).toBe('wasm (not native Android), 4 jobs');
  });
});
