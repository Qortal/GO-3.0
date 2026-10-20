import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash as nodeCreateHash } from 'node:crypto';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { createHash as shimCreateHash } from './crypto';
import {
  ReticulumResourceWorkerPool,
  SUBTLE_HASH_MAX_BYTES,
  macrotaskYield,
  sha256Hex,
} from './resource-worker-pool';

const MB = 1024 * 1024;

function patternBytes(size: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return bytes;
}

function nodeHex(bytes: Uint8Array): string {
  return nodeCreateHash('sha256').update(bytes).digest('hex');
}

function nobleHex(bytes: Uint8Array): string {
  return Buffer.from(nobleSha256(bytes)).toString('hex');
}

describe('mobile resource pool shim', () => {
  let dir = '';
  let pool: ReticulumResourceWorkerPool;

  const file = (name: string, bytes: Uint8Array): string => {
    const target = path.join(dir, name);
    fs.writeFileSync(target, bytes);
    return target;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-resource-pool-'));
    pool = new ReticulumResourceWorkerPool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // First on purpose: Node delivers MessagePort messages in port creation
  // order, not posting order, so the probe port must exist before the
  // shim's yield port (made on first use). Chromium posts each delivery as
  // a task in arrival order, so already-queued messages run first there.
  it('macrotaskYield resolves after already-queued messages, not as a microtask', async () => {
    const order: string[] = [];
    const channel = new MessageChannel();
    const delivered = new Promise<void>((resolve) => {
      channel.port1.onmessage = () => {
        order.push('message');
        resolve();
      };
    });
    channel.port2.postMessage(1);
    // A microtask "yield" would resume after the first step of this chain.
    let steps = 0;
    const chain = (): void => {
      steps += 1;
      if (steps < 100) queueMicrotask(chain);
    };
    queueMicrotask(chain);
    await macrotaskYield();
    order.push(`yield after ${steps} microtasks`);
    await delivered;
    channel.port1.close();
    expect(order).toEqual(['message', 'yield after 100 microtasks']);
  });

  it('hashes 0 B, 1 B, 1 MB + 7 B and 5 MB files like node and noble, via WebCrypto', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
    for (const [index, size] of [0, 1, MB + 7, 5 * MB].entries()) {
      const bytes = patternBytes(size, index + 3);
      const target = file(`f${size}.bin`, bytes);
      const expected = nodeHex(bytes);
      expect(nobleHex(bytes)).toBe(expected);
      expect(shimCreateHash('sha256').update(bytes).digest('hex')).toBe(
        expected
      );

      const hashed = await pool.run({ kind: 'hash_file', path: target });
      expect(hashed).toMatchObject({ kind: 'hash_file', ok: true });
      expect(hashed.hash).toBe(expected);

      const read = await pool.run({ kind: 'read_and_hash_file', path: target });
      expect(read.ok).toBe(true);
      expect(read.hash).toBe(expected);
      expect(Buffer.from(read.bytes!).equals(Buffer.from(bytes))).toBe(true);
    }
    // Every hash above went through WebCrypto, none through the JS hash.
    expect(digest).toHaveBeenCalledTimes(8);
    expect(
      digest.mock.calls.every(([algorithm]) => algorithm === 'SHA-256')
    ).toBe(true);
  });

  it('falls back to the streaming JS hash without WebCrypto, with the same digests', async () => {
    vi.stubGlobal('crypto', {});
    for (const size of [0, 1, MB + 7]) {
      const bytes = patternBytes(size, 11);
      const target = file(`n${size}.bin`, bytes);
      const hashed = await pool.run({ kind: 'hash_file', path: target });
      expect(hashed.hash).toBe(nodeHex(bytes));
      expect(await sha256Hex(bytes)).toBe(nobleHex(bytes));
    }
  });

  it('streams files above the WebCrypto cap instead of reading them whole', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
    const target = path.join(dir, 'big.bin');
    // Sparse: all zeros, no real disk use.
    fs.writeFileSync(target, '');
    fs.truncateSync(target, SUBTLE_HASH_MAX_BYTES + 1);
    const result = await pool.run({ kind: 'hash_file', path: target });
    expect(result.hash).toBe(
      nodeHex(new Uint8Array(SUBTLE_HASH_MAX_BYTES + 1))
    );
    expect(digest).not.toHaveBeenCalled();
  });

  it('finalizes, inspects and writes ranges with identical hashes', async () => {
    const bytes = patternBytes(3 * MB + 5, 7);
    const expected = nodeHex(bytes);
    const source = file('assembled.part', bytes);
    const destination = path.join(dir, 'blob', 'assembled.bin');

    const mismatch = await pool.run({
      kind: 'finalize_resource',
      sourcePath: source,
      destinationPath: destination,
      expectedHash: '00'.repeat(32),
      expectedSize: bytes.length,
      moveSource: true,
    });
    expect(mismatch).toMatchObject({
      ok: false,
      error: 'Assembled file hash mismatch',
    });
    expect(fs.existsSync(source)).toBe(true);

    const finalized = await pool.run({
      kind: 'finalize_resource',
      sourcePath: source,
      destinationPath: destination,
      expectedHash: expected.toUpperCase(),
      expectedSize: bytes.length,
      moveSource: true,
    });
    expect(finalized).toMatchObject({ ok: true, hash: expected });
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(destination).equals(Buffer.from(bytes))).toBe(true);

    const inspected = await pool.run({
      kind: 'inspect_paths',
      entries: [
        {
          fileHash: 'a',
          assembledPath: destination,
          partialPath: source,
          expectedSize: bytes.length,
          expectedHash: expected,
          expectComplete: false,
        },
        {
          fileHash: 'b',
          assembledPath: destination,
          partialPath: destination,
          expectedSize: bytes.length,
          expectedHash: 'ff'.repeat(32),
          expectComplete: false,
        },
        {
          fileHash: 'c',
          assembledPath: path.join(dir, 'missing.bin'),
          partialPath: path.join(dir, 'missing.part'),
          expectedSize: 1,
          expectedHash: expected,
          expectComplete: true,
        },
      ],
    });
    expect(inspected.inspections).toEqual([
      { fileHash: 'a', assembledValid: true, partialExists: false },
      { fileHash: 'b', assembledValid: false, partialExists: true },
      { fileHash: 'c', assembledValid: false, partialExists: false },
    ]);

    const rangePath = path.join(dir, 'ranges', 'r.bin');
    const range = await pool.run({
      kind: 'write_range_file',
      sourcePath: destination,
      destinationPath: rangePath,
      startByte: MB - 3,
      endByteExclusive: 2 * MB + 4,
    });
    const slice = bytes.subarray(MB - 3, 2 * MB + 4);
    expect(range).toMatchObject({
      ok: true,
      hash: nodeHex(slice),
      sizeBytes: slice.length,
    });
    expect(fs.readFileSync(rangePath).equals(Buffer.from(slice))).toBe(true);

    const past = await pool.run({
      kind: 'write_range_file',
      sourcePath: destination,
      destinationPath: rangePath,
      startByte: 0,
      endByteExclusive: bytes.length + 1,
    });
    expect(past).toMatchObject({
      ok: false,
      error: 'Resource byte range exceeds source',
    });
  });

  it('lets a queued MessageChannel message run before a 5 MB hash finishes', async () => {
    const target = file('five.bin', patternBytes(5 * MB, 5));
    const order: string[] = [];
    const channel = new MessageChannel();
    const delivered = new Promise<void>((resolve) => {
      channel.port1.onmessage = () => {
        order.push('message');
        resolve();
      };
    });
    channel.port2.postMessage('bridge frame');
    const hashed = pool
      .run({ kind: 'hash_file', path: target })
      .then((result) => {
        order.push('hash');
        return result;
      });
    await Promise.all([delivered, hashed]);
    channel.port1.close();
    expect(order).toEqual(['message', 'hash']);
    expect((await hashed).ok).toBe(true);
  });

  it('runs overlapping finalize and delete_paths on one path one after another, like the desktop pool', async () => {
    const bytes = patternBytes(2 * MB, 9);
    const expected = nodeHex(bytes);
    const source = file('overlap.part', bytes);
    const destination = path.join(dir, 'overlap.bin');

    // Finalize first: the delete must wait for the hash and the move.
    const finalize = pool.run(
      {
        kind: 'finalize_resource',
        sourcePath: source,
        destinationPath: destination,
        expectedHash: expected,
        expectedSize: bytes.length,
        moveSource: true,
      },
      1
    );
    const remove = pool.run(
      { kind: 'delete_paths', paths: [source, destination] },
      1
    );
    expect(pool.stats().queued + pool.stats().active).toBe(2);
    const [finalized, removed] = await Promise.all([finalize, remove]);
    expect(finalized).toMatchObject({ ok: true, hash: expected });
    expect(removed).toMatchObject({ ok: true, deleted: 1 });
    expect(fs.existsSync(destination)).toBe(false);
    expect(pool.stats()).toMatchObject({ queued: 0, active: 0 });

    // Delete first: the finalize finds no source, as it would on desktop.
    const again = file('overlap.part', bytes);
    const removeFirst = pool.run({ kind: 'delete_paths', paths: [again] }, 1);
    const finalizeAfter = pool.run(
      {
        kind: 'finalize_resource',
        sourcePath: again,
        destinationPath: destination,
        expectedHash: expected,
        expectedSize: bytes.length,
        moveSource: true,
      },
      1
    );
    await expect(removeFirst).resolves.toMatchObject({ ok: true, deleted: 1 });
    await expect(finalizeAfter).resolves.toMatchObject({ ok: false });
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('starts queued tasks in the desktop order: priority, then submission', async () => {
    const target = file('order.bin', patternBytes(64 * 1024, 2));
    const finished: string[] = [];
    const track = (label: string, promise: Promise<unknown>) =>
      promise.then(() => finished.push(label));
    await Promise.all([
      track('first', pool.run({ kind: 'hash_file', path: target }, 2)),
      track('stale-delete', pool.run({ kind: 'delete_paths', paths: [] }, 4)),
      track('inspect', pool.run({ kind: 'inspect_paths', entries: [] }, 3)),
      track('read', pool.run({ kind: 'read_and_hash_file', path: target }, 1)),
      track('hash', pool.run({ kind: 'hash_file', path: target }, 2)),
    ]);
    expect(finished).toEqual([
      'read',
      'first',
      'hash',
      'inspect',
      'stale-delete',
    ]);
  });
});
