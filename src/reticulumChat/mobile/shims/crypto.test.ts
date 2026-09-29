import { describe, expect, it } from 'vitest';
import { createHash as nodeCreateHash } from 'node:crypto';
import { createHash } from './crypto';

describe('mobile crypto shim createHash', () => {
  it('hashes multiple update() calls from a reused buffer like node does', () => {
    // Mirrors resource-worker-pool.hashFile: one 1 MiB scratch buffer, refilled per read.
    const total = 3 * 1024 * 1024 + 12345;
    const data = new Uint8Array(total);
    for (let i = 0; i < total; i++) data[i] = (i * 7 + (i >> 8)) & 0xff;
    const expected = nodeCreateHash('sha256').update(data).digest('hex');
    const scratch = Buffer.alloc(1024 * 1024);
    const hash = createHash('sha256');
    for (let off = 0; off < total; ) {
      const n = Math.min(scratch.length, total - off);
      scratch.set(data.subarray(off, off + n), 0);
      hash.update(scratch.subarray(0, n));
      off += n;
    }
    expect(hash.digest('hex')).toBe(expected);
  });

  it('matches node for single-shot and string input', () => {
    expect(createHash('sha256').update('hello').digest('hex')).toBe(
      nodeCreateHash('sha256').update('hello').digest('hex')
    );
    expect(createHash('sha512').update(new Uint8Array([1, 2, 3])).digest('base64')).toBe(
      nodeCreateHash('sha512').update(new Uint8Array([1, 2, 3])).digest('base64')
    );
  });
});
