import { describe, expect, it } from 'vitest';
import { Buffer as PolyBuffer } from 'buffer';
import {
  ensureBufferBase64Url,
  installHubCallNodeGlobals,
} from './nodeGlobals';

const NodeBuffer = (globalThis as { Buffer: typeof Buffer }).Buffer;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('nodeGlobals: base64url on the WebView Buffer polyfill', () => {
  it('the polyfill is patched on import (it lacks base64url otherwise)', () => {
    expect(PolyBuffer).not.toBe(NodeBuffer);
    expect(PolyBuffer.isEncoding('base64url')).toBe(true);
    expect(PolyBuffer.isEncoding('BASE64URL')).toBe(true);
    expect(PolyBuffer.isEncoding('hex')).toBe(true);
    expect(PolyBuffer.isEncoding('nope')).toBe(false);
  });

  it('matches Node for from/toString/byteLength/write over random data', () => {
    const rand = mulberry32(9);
    for (let n = 0; n < 300; n++) {
      const bytes = Uint8Array.from({ length: n }, () =>
        Math.floor(rand() * 256)
      );
      const expected = NodeBuffer.from(bytes).toString('base64url');
      expect(PolyBuffer.from(bytes).toString('base64url')).toBe(expected);
      expect(Array.from(PolyBuffer.from(expected, 'base64url'))).toEqual(
        Array.from(bytes)
      );
      // Padded and standard-alphabet input decode too (like Node).
      const padded = NodeBuffer.from(bytes).toString('base64');
      expect(Array.from(PolyBuffer.from(padded, 'base64url'))).toEqual(
        Array.from(bytes)
      );
      expect(PolyBuffer.byteLength(expected, 'base64url')).toBe(
        NodeBuffer.byteLength(expected, 'base64url')
      );
      if (n > 4) {
        expect(PolyBuffer.from(bytes).toString('base64url', 1, n - 2)).toBe(
          NodeBuffer.from(bytes).toString('base64url', 1, n - 2)
        );
        const target = PolyBuffer.alloc(n + 2);
        const nodeTarget = NodeBuffer.alloc(n + 2);
        expect(target.write(expected, 1, 'base64url')).toBe(
          nodeTarget.write(expected, 1, 'base64url')
        );
        expect(Array.from(target)).toEqual(Array.from(nodeTarget));
      }
    }
  });

  it('leaves the other encodings and the no-argument toString alone', () => {
    const buf = PolyBuffer.from('héllo wörld', 'utf8');
    expect(buf.toString()).toBe('héllo wörld');
    expect(buf.toString('hex')).toBe(
      NodeBuffer.from('héllo wörld').toString('hex')
    );
    expect(buf.toString('base64')).toBe(
      NodeBuffer.from('héllo wörld').toString('base64')
    );
    expect(PolyBuffer.from('68656c6c6f', 'hex').toString()).toBe('hello');
    expect(buf.write('xy', 0)).toBe(2);
    expect(() => PolyBuffer.from('x', 'nope' as BufferEncoding)).toThrow();
  });

  it('is idempotent and leaves a Buffer that already supports it untouched', () => {
    const toString = PolyBuffer.prototype.toString;
    ensureBufferBase64Url(PolyBuffer);
    installHubCallNodeGlobals();
    expect(PolyBuffer.prototype.toString).toBe(toString);
    const nodeToString = NodeBuffer.prototype.toString;
    ensureBufferBase64Url(NodeBuffer as unknown as typeof PolyBuffer);
    expect(NodeBuffer.prototype.toString).toBe(nodeToString);
    expect(typeof (globalThis as { setImmediate?: unknown }).setImmediate).toBe(
      'function'
    );
  });
});
