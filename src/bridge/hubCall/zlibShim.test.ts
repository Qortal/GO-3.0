/**
 * The mobile zlib shim's synchronous raw DEFLATE against Node's real zlib.
 * Under VITEST the vite module redirects are skipped, so the shim is imported
 * directly here (the hosted call managers get it through the `zlib` alias in
 * the app build).
 */
import * as nodeZlib from 'node:zlib';
import { Buffer as ShimBuffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
  deflateRawSync,
  inflateRawSync,
} from '../../reticulumChat/mobile/shims/zlib';

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

function randomBytes(rand: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** Text-like data with repeats, so LZ77 matches of every length occur. */
function lowEntropyBytes(rand: () => number, length: number): Uint8Array {
  const alphabet = 'abcdefghij \n{}":,0123456789';
  const out = new Uint8Array(length);
  let i = 0;
  while (i < length) {
    if (i > 16 && rand() < 0.35) {
      const distance = 1 + Math.floor(rand() * Math.min(i, 40_000));
      const runLength = 3 + Math.floor(rand() * 300);
      for (let k = 0; k < runLength && i < length; k++, i++) {
        out[i] = out[i - distance];
      }
    } else {
      out[i++] = alphabet.charCodeAt(Math.floor(rand() * alphabet.length));
    }
  }
  return out;
}

function sdpLikeJson(rand: () => number, candidates: number): string {
  const lines = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-'];
  for (let i = 0; i < candidates; i++) {
    lines.push(
      `a=candidate:${Math.floor(rand() * 1e9)} 1 udp ${Math.floor(
        rand() * 2e9
      )} 203.0.113.${i % 250} ${40000 + i} typ srflx raddr 0.0.0.0 rport 0 generation 0`
    );
  }
  lines.push('a=fingerprint:sha-256 ' + 'AB:'.repeat(31) + 'CD');
  return JSON.stringify({
    roomId: 'dmv:0123456789abcdef01',
    callSessionId: '6c7e8a1e-0d25-4e16-9a2d-2f8f0f7c9b11',
    mediaSessionGeneration: 1,
    signalType: 'offer',
    payload: JSON.stringify({
      kind: 'description',
      generation: 'native_audio_v1',
      description: { type: 'offer', sdp: lines.join('\r\n') },
    }),
  });
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected))).toBe(0);
}

type Outcome = { ok: true; data: Buffer } | { ok: false };

function nodeInflate(data: Uint8Array, max?: number): Outcome {
  try {
    return {
      ok: true,
      data: nodeZlib.inflateRawSync(data, max ? { maxOutputLength: max } : {}),
    };
  } catch {
    return { ok: false };
  }
}

function shimInflate(data: Uint8Array, max?: number): Outcome {
  try {
    return {
      ok: true,
      data: inflateRawSync(data, max ? { maxOutputLength: max } : {}),
    };
  } catch {
    return { ok: false };
  }
}

const SIZES = [
  0, 1, 2, 3, 4, 7, 31, 100, 257, 258, 259, 1_000, 4_096, 32_767, 32_768,
  32_769, 65_535, 65_536, 65_537, 100_000, 131_073, 200_000,
];

describe('mobile zlib shim: sync raw deflate/inflate', () => {
  it('shim deflate → Node inflate round-trips random, low-entropy and run data', () => {
    const rand = mulberry32(1);
    for (const size of SIZES) {
      for (const make of [
        (n: number) => randomBytes(rand, n),
        (n: number) => lowEntropyBytes(rand, n),
        (n: number) => new Uint8Array(n).fill(7),
      ]) {
        const input = make(size);
        for (const level of [undefined, 0, 1, 9]) {
          const compressed = deflateRawSync(
            input,
            level === undefined ? {} : { level }
          );
          expectSameBytes(nodeZlib.inflateRawSync(compressed), input);
          expectSameBytes(inflateRawSync(compressed), input);
        }
      }
    }
  });

  it('Node deflate (every level and strategy) → shim inflate matches Node', () => {
    const rand = mulberry32(2);
    const strategies = [
      nodeZlib.constants.Z_DEFAULT_STRATEGY,
      nodeZlib.constants.Z_FILTERED,
      nodeZlib.constants.Z_HUFFMAN_ONLY,
      nodeZlib.constants.Z_RLE,
      nodeZlib.constants.Z_FIXED,
    ];
    for (const size of SIZES) {
      const inputs = [
        randomBytes(rand, size),
        lowEntropyBytes(rand, size),
        new Uint8Array(size),
      ];
      for (const input of inputs) {
        for (const level of [0, 1, 6, 9]) {
          for (const strategy of strategies) {
            const compressed = nodeZlib.deflateRawSync(input, {
              level,
              strategy,
              memLevel: size % 2 === 0 ? 8 : 1,
              windowBits: size % 3 === 0 ? 15 : 9,
            });
            expectSameBytes(inflateRawSync(compressed), input);
          }
        }
      }
    }
  });

  it('round-trips SDP-sized signalling JSON and compresses it', () => {
    const rand = mulberry32(3);
    for (const candidates of [0, 1, 8, 40, 300]) {
      const json = sdpLikeJson(rand, candidates);
      const bytes = Buffer.from(json, 'utf8');
      const ours = deflateRawSync(bytes);
      expect(nodeZlib.inflateRawSync(ours).toString('utf8')).toBe(json);
      expect(
        inflateRawSync(nodeZlib.deflateRawSync(bytes)).toString('utf8')
      ).toBe(json);
      if (bytes.length > 2_000) {
        expect(ours.length).toBeLessThan(bytes.length * 0.7);
      }
    }
  });

  it('accepts strings, ArrayBuffers and offset views like Node', () => {
    const text = '{"kind":"hangup","controlId":"abc"}'.repeat(20);
    expect(nodeZlib.inflateRawSync(deflateRawSync(text)).toString()).toBe(text);
    const backing = Buffer.from(`xxxx${text}yyyy`);
    const view = new Uint8Array(
      backing.buffer,
      backing.byteOffset + 4,
      text.length
    );
    expect(inflateRawSync(deflateRawSync(view)).toString()).toBe(text);
    const compressed = nodeZlib.deflateRawSync(text);
    const ab = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength
    );
    expect(inflateRawSync(ab).toString()).toBe(text);
    // Same Buffer class the shim (and the hosted managers) resolve 'buffer' to.
    expect(ShimBuffer.isBuffer(inflateRawSync(compressed))).toBe(true);
    expect(ShimBuffer.isBuffer(deflateRawSync(text))).toBe(true);
  });

  it('empty input: deflate matches zlib bytes, inflate of nothing throws like Node', () => {
    expectSameBytes(
      deflateRawSync(new Uint8Array(0)),
      nodeZlib.deflateRawSync(Buffer.alloc(0))
    );
    expect(() => nodeZlib.inflateRawSync(Buffer.alloc(0))).toThrow();
    expect(() => inflateRawSync(Buffer.alloc(0))).toThrow(
      /unexpected end of file/
    );
  });

  it('honours maxOutputLength exactly like Node (boundary inclusive)', () => {
    const rand = mulberry32(4);
    for (const size of [1, 10, 1_000, 98_304, 98_305, 150_000]) {
      const input = lowEntropyBytes(rand, size);
      const compressed = nodeZlib.deflateRawSync(input);
      expectSameBytes(
        inflateRawSync(compressed, { maxOutputLength: size }),
        input
      );
      expectSameBytes(
        nodeZlib.inflateRawSync(compressed, { maxOutputLength: size }),
        input
      );
      if (size > 1) {
        let nodeError: unknown = null;
        try {
          nodeZlib.inflateRawSync(compressed, { maxOutputLength: size - 1 });
        } catch (err) {
          nodeError = err;
        }
        expect((nodeError as { code?: string })?.code).toBe(
          'ERR_BUFFER_TOO_LARGE'
        );
        let shimError: unknown = null;
        try {
          inflateRawSync(compressed, { maxOutputLength: size - 1 });
        } catch (err) {
          shimError = err;
        }
        expect(shimError).toBeInstanceOf(RangeError);
        expect((shimError as { code?: string }).code).toBe(
          'ERR_BUFFER_TOO_LARGE'
        );
      }
    }
    // A zip bomb (96 KiB cap of group-call.ts GO1 reassembly) stops early.
    const bomb = nodeZlib.deflateRawSync(Buffer.alloc(20 * 1024 * 1024));
    expect(() => inflateRawSync(bomb, { maxOutputLength: 96 * 1024 })).toThrow(
      RangeError
    );
  });

  it('rejects the classic corruptions', () => {
    // BTYPE = 11.
    expect(() => inflateRawSync(Uint8Array.of(0x07, 0x00))).toThrow(
      /invalid block type/
    );
    // Stored block with LEN/NLEN mismatch.
    expect(() =>
      inflateRawSync(Uint8Array.of(0x01, 0x05, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5))
    ).toThrow(/invalid stored block lengths/);
    // Fixed block whose first symbol is a match (distance beyond output).
    const tooFar = nodeZlib.deflateRawSync(Buffer.from('aaaaaaaaaaaa'));
    const corrupted = Buffer.from(tooFar);
    corrupted[0] = 0x03; // keep header, garble the stream start
    const nodeOutcome = nodeInflate(corrupted);
    const shimOutcome = shimInflate(corrupted);
    expect(shimOutcome.ok).toBe(nodeOutcome.ok);
    for (const err of [() => inflateRawSync(Uint8Array.of(0x01, 0x05))]) {
      expect(err).toThrow(/unexpected end of file/);
    }
  });

  it('agrees with Node on truncated, bit-flipped and random streams', () => {
    const rand = mulberry32(5);
    let agreeOk = 0;
    let agreeFail = 0;
    const check = (data: Uint8Array) => {
      const n = nodeInflate(data, 1 << 20);
      const s = shimInflate(data, 1 << 20);
      expect(s.ok).toBe(n.ok);
      if (n.ok && s.ok) {
        expectSameBytes(s.data, n.data);
        agreeOk++;
      } else {
        agreeFail++;
      }
    };
    for (let round = 0; round < 300; round++) {
      const input = lowEntropyBytes(rand, Math.floor(rand() * 4_000));
      const level = Math.floor(rand() * 10);
      const compressed = nodeZlib.deflateRawSync(input, { level });
      // Truncations.
      check(compressed.subarray(0, Math.floor(rand() * compressed.length)));
      // Bit flips.
      const flipped = Buffer.from(compressed);
      for (let f = 0; f < 1 + Math.floor(rand() * 3); f++) {
        const at = Math.floor(rand() * flipped.length);
        if (flipped.length > 0) flipped[at] ^= 1 << Math.floor(rand() * 8);
      }
      check(flipped);
      // Trailing garbage after the final block.
      check(Buffer.concat([compressed, Buffer.from(randomBytes(rand, 8))]));
    }
    for (let round = 0; round < 2_000; round++) {
      check(randomBytes(rand, Math.floor(rand() * 64)));
    }
    expect(agreeOk).toBeGreaterThan(100);
    expect(agreeFail).toBeGreaterThan(100);
  });
});
