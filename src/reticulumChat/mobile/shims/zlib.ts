/**
 * Node `zlib` stand-in for the mobile engine worker.
 *
 * Hub 3.0.3 gzips group author manifests before serving them as a linked
 * resource and gunzips the ones it receives (`getCompressedAuthorManifest`,
 * `importReceivedAuthorManifestResource`). Only the callback forms of
 * `gzip`/`gunzip` plus `constants.Z_BEST_SPEED` are used, so that is all this
 * shim provides. The WebView's `CompressionStream`/`DecompressionStream`
 * (Chrome 80+) do the actual work; the `maxOutputLength` option is honoured
 * so a hostile manifest cannot inflate without bound.
 */
import { Buffer } from 'buffer';

type ZlibCallback = (error: Error | null, result: Buffer) => void;
type GzipOptions = { level?: number };
type GunzipOptions = { maxOutputLength?: number };

export const constants = {
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
};

function toBytes(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return input;
}

async function pumpThrough(
  input: Uint8Array,
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> },
  maxOutputLength: number
): Promise<Buffer> {
  const writer = stream.writable.getWriter();
  let writeError: unknown = null;
  const writing = writer
    .write(input)
    .then(() => writer.close())
    .catch((err) => {
      // A rejected write also fails the reader; remember it so the loop's
      // error is the one reported and this promise never rejects unobserved.
      writeError = err;
    });
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxOutputLength) {
      await reader.cancel().catch(() => undefined);
      const err = Object.assign(
        new Error('Cannot create final Buffer. It would be larger than maxOutputLength.'),
        { code: 'ERR_BUFFER_TOO_LARGE' }
      );
      throw err;
    }
    chunks.push(value);
  }
  await writing;
  if (writeError) throw writeError;
  const out = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function callbackify(promise: Promise<Buffer>, callback: ZlibCallback): void {
  promise.then(
    (result) => callback(null, result),
    (error) =>
      callback(error instanceof Error ? error : new Error(String(error)), Buffer.alloc(0))
  );
}

export function gzip(
  input: Uint8Array | ArrayBuffer | string,
  optionsOrCallback: GzipOptions | ZlibCallback,
  maybeCallback?: ZlibCallback
): void {
  const callback =
    typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  if (!callback) throw new TypeError('zlib.gzip requires a callback');
  if (typeof CompressionStream !== 'function') {
    callback(new Error('CompressionStream unavailable in this WebView'), Buffer.alloc(0));
    return;
  }
  callbackify(
    pumpThrough(toBytes(input), new CompressionStream('gzip'), Number.MAX_SAFE_INTEGER),
    callback
  );
}

export function gunzip(
  input: Uint8Array | ArrayBuffer | string,
  optionsOrCallback: GunzipOptions | ZlibCallback,
  maybeCallback?: ZlibCallback
): void {
  const callback =
    typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  const options =
    typeof optionsOrCallback === 'function' ? {} : optionsOrCallback || {};
  if (!callback) throw new TypeError('zlib.gunzip requires a callback');
  if (typeof DecompressionStream !== 'function') {
    callback(new Error('DecompressionStream unavailable in this WebView'), Buffer.alloc(0));
    return;
  }
  const maxOutputLength =
    Number.isFinite(options.maxOutputLength) && (options.maxOutputLength as number) > 0
      ? (options.maxOutputLength as number)
      : Number.MAX_SAFE_INTEGER;
  callbackify(
    pumpThrough(toBytes(input), new DecompressionStream('gzip'), maxOutputLength),
    callback
  );
}

// ── Synchronous raw DEFLATE (RFC 1951) ──────────────────────────────────────
//
// Hub 3.0.3's call managers (electron/src/call.ts, group-call.ts), hosted in
// GO's WebView by src/bridge/hubCall, compress WebRTC signals and DM
// call-control with `deflateRawSync` and inflate inbound ones with
// `inflateRawSync({ maxOutputLength })` inside synchronous code paths, so the
// async CompressionStream above cannot be used. No dependency: a complete
// inflater (stored, fixed and dynamic Huffman blocks, zlib's code-set
// validity rules) and a small LZ77 + fixed-Huffman compressor that falls back
// to stored blocks when that is smaller. Output of deflateRawSync differs
// byte-wise from zlib's but every zlib inflater decodes it.

type RawSyncInput = Uint8Array | ArrayBuffer | string;
type InflateRawSyncOptions = { maxOutputLength?: number };
type DeflateRawSyncOptions = { level?: number };

const ZLIB_MAX_BITS = 15;
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

function zlibDataError(message: string): Error {
  return Object.assign(new Error(message), {
    errno: -3,
    code: 'Z_DATA_ERROR',
  });
}

function zlibEndOfInput(): Error {
  return Object.assign(new Error('unexpected end of file'), {
    errno: -5,
    code: 'Z_BUF_ERROR',
  });
}

function rawSyncInputBytes(input: RawSyncInput): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  // Tag check, not instanceof: buffers can come from another realm (worker,
  // iframe, test environment).
  if (
    input instanceof ArrayBuffer ||
    Object.prototype.toString.call(input) === '[object ArrayBuffer]'
  ) {
    return new Uint8Array(input as ArrayBuffer);
  }
  throw new TypeError(
    'The "buffer" argument must be of type string, Buffer, TypedArray or ArrayBuffer'
  );
}

/** Canonical Huffman decoding table: code counts per length + sorted symbols. */
type HuffmanTable = { count: Uint16Array; symbol: Uint16Array; maxLen: number };

/**
 * Builds a decoding table and applies zlib's `inflate_table` validity rules:
 * over-subscribed sets are always invalid; incomplete sets are invalid for
 * the code-length code and otherwise allowed only as a single 1-bit code.
 * Returns null on an invalid set.
 */
function buildHuffmanTable(
  lengths: ArrayLike<number>,
  offset: number,
  n: number,
  kind: 'codes' | 'lens' | 'dists'
): HuffmanTable | null {
  const count = new Uint16Array(ZLIB_MAX_BITS + 1);
  for (let i = 0; i < n; i++) count[lengths[offset + i]]++;
  let maxLen = 0;
  for (let len = ZLIB_MAX_BITS; len >= 1; len--) {
    if (count[len] !== 0) {
      maxLen = len;
      break;
    }
  }
  const symbol = new Uint16Array(n);
  if (maxLen === 0) {
    // No codes at all: zlib accepts the set; any decode attempt then fails.
    return { count, symbol, maxLen };
  }
  let left = 1;
  for (let len = 1; len <= ZLIB_MAX_BITS; len++) {
    left <<= 1;
    left -= count[len];
    if (left < 0) return null; // over-subscribed
  }
  if (left > 0 && (kind === 'codes' || maxLen !== 1)) return null; // incomplete
  const offs = new Uint16Array(ZLIB_MAX_BITS + 2);
  for (let len = 1; len <= ZLIB_MAX_BITS; len++) {
    offs[len + 1] = offs[len] + count[len];
  }
  for (let i = 0; i < n; i++) {
    const len = lengths[offset + i];
    if (len !== 0) symbol[offs[len]++] = i;
  }
  return { count, symbol, maxLen };
}

let fixedLiteralTable: HuffmanTable | null = null;
let fixedDistanceTable: HuffmanTable | null = null;

function fixedInflateTables(): [HuffmanTable, HuffmanTable] {
  if (!fixedLiteralTable || !fixedDistanceTable) {
    // Like zlib, all 288 literal/length and 32 distance codes exist; the
    // unused symbols (286, 287, distance 30, 31) decode and are then rejected.
    const lengths = new Uint8Array(288 + 32);
    for (let i = 0; i < 144; i++) lengths[i] = 8;
    for (let i = 144; i < 256; i++) lengths[i] = 9;
    for (let i = 256; i < 280; i++) lengths[i] = 7;
    for (let i = 280; i < 288; i++) lengths[i] = 8;
    for (let i = 288; i < 320; i++) lengths[i] = 5;
    fixedLiteralTable = buildHuffmanTable(lengths, 0, 288, 'lens');
    fixedDistanceTable = buildHuffmanTable(lengths, 288, 32, 'dists');
  }
  return [fixedLiteralTable!, fixedDistanceTable!];
}

class RawInflater {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;
  private out: Uint8Array;
  private outLen = 0;

  constructor(
    private readonly input: Uint8Array,
    private readonly maxOutputLength: number
  ) {
    const initial = Math.min(
      maxOutputLength,
      Math.max(1_024, input.length * 4)
    );
    this.out = new Uint8Array(Math.max(1, initial));
  }

  run(): Uint8Array {
    let last = 0;
    do {
      last = this.bits(1);
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) this.codes(...fixedInflateTables());
      else if (type === 2) this.dynamic();
      else throw zlibDataError('invalid block type');
    } while (!last);
    return this.out.subarray(0, this.outLen);
  }

  private bits(need: number): number {
    let val = this.bitBuf;
    while (this.bitCnt < need) {
      if (this.pos >= this.input.length) throw zlibEndOfInput();
      val |= this.input[this.pos++] << this.bitCnt;
      this.bitCnt += 8;
    }
    this.bitBuf = val >>> need;
    this.bitCnt -= need;
    return val & ((1 << need) - 1);
  }

  private ensure(extra: number): void {
    const needed = this.outLen + extra;
    if (needed > this.maxOutputLength) {
      throw Object.assign(
        new RangeError(
          `Cannot create a Buffer larger than ${this.maxOutputLength} bytes`
        ),
        { code: 'ERR_BUFFER_TOO_LARGE' }
      );
    }
    if (needed <= this.out.length) return;
    let size = this.out.length * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(Math.min(size, this.maxOutputLength));
    next.set(this.out.subarray(0, this.outLen));
    this.out = next;
  }

  private stored(): void {
    // Discard the rest of the current byte (always < 8 buffered bits).
    this.bitBuf = 0;
    this.bitCnt = 0;
    if (this.pos + 4 > this.input.length) throw zlibEndOfInput();
    const len = this.input[this.pos] | (this.input[this.pos + 1] << 8);
    const nlen = this.input[this.pos + 2] | (this.input[this.pos + 3] << 8);
    this.pos += 4;
    if (len !== (~nlen & 0xffff)) {
      throw zlibDataError('invalid stored block lengths');
    }
    if (this.pos + len > this.input.length) throw zlibEndOfInput();
    this.ensure(len);
    this.out.set(this.input.subarray(this.pos, this.pos + len), this.outLen);
    this.outLen += len;
    this.pos += len;
  }

  private decode(table: HuffmanTable, what: string): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= ZLIB_MAX_BITS; len++) {
      code |= this.bits(1);
      const count = table.count[len];
      if (code - count < first) return table.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
      if (len >= table.maxLen) break;
    }
    throw zlibDataError(`invalid ${what} code`);
  }

  private codes(lit: HuffmanTable, dist: HuffmanTable): void {
    for (;;) {
      const sym = this.decode(lit, 'literal/length');
      if (sym < 256) {
        this.ensure(1);
        this.out[this.outLen++] = sym;
        continue;
      }
      if (sym === 256) return;
      const li = sym - 257;
      if (li >= 29) throw zlibDataError('invalid literal/length code');
      const length = LENGTH_BASE[li] + this.bits(LENGTH_EXTRA[li]);
      const di = this.decode(dist, 'distance');
      if (di >= 30) throw zlibDataError('invalid distance code');
      const distance = DIST_BASE[di] + this.bits(DIST_EXTRA[di]);
      if (distance > this.outLen) {
        throw zlibDataError('invalid distance too far back');
      }
      this.ensure(length);
      const out = this.out;
      let from = this.outLen - distance;
      let to = this.outLen;
      for (let i = 0; i < length; i++) out[to++] = out[from++];
      this.outLen = to;
    }
  }

  private dynamic(): void {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > 286 || ndist > 30) {
      throw zlibDataError('too many length or distance symbols');
    }
    const lengths = new Uint8Array(320);
    for (let i = 0; i < ncode; i++) {
      lengths[CODE_LENGTH_ORDER[i]] = this.bits(3);
    }
    const codeTable = buildHuffmanTable(lengths, 0, 19, 'codes');
    if (!codeTable || codeTable.maxLen === 0) {
      throw zlibDataError('invalid code lengths set');
    }
    lengths.fill(0);
    let index = 0;
    while (index < nlen + ndist) {
      const sym = this.decode(codeTable, 'code lengths');
      if (sym < 16) {
        lengths[index++] = sym;
        continue;
      }
      let len = 0;
      let repeat: number;
      if (sym === 16) {
        if (index === 0) throw zlibDataError('invalid bit length repeat');
        len = lengths[index - 1];
        repeat = 3 + this.bits(2);
      } else if (sym === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (index + repeat > nlen + ndist) {
        throw zlibDataError('invalid bit length repeat');
      }
      while (repeat--) lengths[index++] = len;
    }
    if (lengths[256] === 0) {
      throw zlibDataError('invalid code -- missing end-of-block');
    }
    const litTable = buildHuffmanTable(lengths, 0, nlen, 'lens');
    if (!litTable) throw zlibDataError('invalid literal/lengths set');
    const distTable = buildHuffmanTable(lengths, nlen, ndist, 'dists');
    if (!distTable) throw zlibDataError('invalid distances set');
    this.codes(litTable, distTable);
  }
}

/**
 * Synchronous raw inflate (Node `zlib.inflateRawSync` subset). Honours
 * `maxOutputLength` (RangeError code ERR_BUFFER_TOO_LARGE, like Node) and
 * throws on corrupt (Z_DATA_ERROR) or truncated (Z_BUF_ERROR) input. Bytes
 * after the final block are ignored, as zlib does.
 */
export function inflateRawSync(
  input: RawSyncInput,
  options: InflateRawSyncOptions = {}
): Buffer {
  const max =
    Number.isFinite(options?.maxOutputLength) &&
    (options.maxOutputLength as number) >= 1
      ? Math.floor(options.maxOutputLength as number)
      : 0x7fffffff;
  const inflated = new RawInflater(rawSyncInputBytes(input), max).run();
  return Buffer.from(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}

class BitWriter {
  private buf = new Uint8Array(1_024);
  private len = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  private grow(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** Writes `count` (≤ 16) bits of `value`, least significant bit first. */
  writeBits(value: number, count: number): void {
    this.bitBuf |= (value & ((1 << count) - 1)) << this.bitCnt;
    this.bitCnt += count;
    while (this.bitCnt >= 8) {
      this.grow(1);
      this.buf[this.len++] = this.bitBuf & 0xff;
      this.bitBuf >>>= 8;
      this.bitCnt -= 8;
    }
  }

  alignToByte(): void {
    if (this.bitCnt > 0) this.writeBits(0, 8 - this.bitCnt);
  }

  writeBytes(bytes: Uint8Array): void {
    this.grow(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  /** Bit position, used to size a block before choosing its encoding. */
  get bitLength(): number {
    return this.len * 8 + this.bitCnt;
  }

  finish(): Uint8Array {
    this.alignToByte();
    return this.buf.subarray(0, this.len);
  }
}

function reverseBits(code: number, length: number): number {
  let out = 0;
  for (let i = 0; i < length; i++) {
    out = (out << 1) | (code & 1);
    code >>>= 1;
  }
  return out;
}

let fixedLiteralCodes: { code: Uint16Array; len: Uint8Array } | null = null;
let fixedDistanceCodes: Uint16Array | null = null;

/** Fixed Huffman codes (RFC 1951 §3.2.6), pre-reversed for LSB-first output. */
function fixedDeflateCodes(): {
  lit: { code: Uint16Array; len: Uint8Array };
  dist: Uint16Array;
} {
  if (!fixedLiteralCodes || !fixedDistanceCodes) {
    const code = new Uint16Array(288);
    const len = new Uint8Array(288);
    for (let sym = 0; sym < 288; sym++) {
      let c: number;
      let l: number;
      if (sym < 144) {
        c = 0x30 + sym;
        l = 8;
      } else if (sym < 256) {
        c = 0x190 + (sym - 144);
        l = 9;
      } else if (sym < 280) {
        c = sym - 256;
        l = 7;
      } else {
        c = 0xc0 + (sym - 280);
        l = 8;
      }
      code[sym] = reverseBits(c, l);
      len[sym] = l;
    }
    fixedLiteralCodes = { code, len };
    fixedDistanceCodes = new Uint16Array(30);
    for (let d = 0; d < 30; d++) fixedDistanceCodes[d] = reverseBits(d, 5);
  }
  return { lit: fixedLiteralCodes, dist: fixedDistanceCodes };
}

const LENGTH_SYMBOL = new Uint16Array(259);
const LENGTH_SYMBOL_EXTRA = new Uint8Array(259);
for (let i = 0; i < 29; i++) {
  const top = i === 28 ? 258 : LENGTH_BASE[i] + (1 << LENGTH_EXTRA[i]) - 1;
  for (let length = LENGTH_BASE[i]; length <= top; length++) {
    LENGTH_SYMBOL[length] = 257 + i;
    LENGTH_SYMBOL_EXTRA[length] = i;
  }
}
// zlib encodes 258 with code 285 (no extra bits), never 284 + 31.
LENGTH_SYMBOL[258] = 285;
LENGTH_SYMBOL_EXTRA[258] = 28;

function distanceIndex(distance: number): number {
  let lo = 0;
  let hi = 29;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (DIST_BASE[mid] <= distance) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const DEFLATE_WINDOW = 32_768;
const DEFLATE_MIN_MATCH = 3;
const DEFLATE_MAX_MATCH = 258;
const DEFLATE_HASH_BITS = 15;
const DEFLATE_BLOCK_INPUT = 65_535;

/**
 * Synchronous raw deflate (Node `zlib.deflateRawSync` subset). LZ77 with
 * hash chains + fixed Huffman codes per block, or a stored block whenever
 * that is smaller (incompressible data); `level: 0` stores only.
 */
export function deflateRawSync(
  input: RawSyncInput,
  options: DeflateRawSyncOptions = {}
): Buffer {
  const data = rawSyncInputBytes(input);
  const level =
    typeof options?.level === 'number' && Number.isFinite(options.level)
      ? Math.max(-1, Math.min(9, Math.trunc(options.level)))
      : -1;
  const writer = new BitWriter();
  if (data.length === 0) {
    // Same 2 bytes as zlib: one final fixed block holding only end-of-block.
    writer.writeBits(1, 1);
    writer.writeBits(1, 2);
    writer.writeBits(0, 7);
    const empty = writer.finish();
    return Buffer.from(empty.buffer, empty.byteOffset, empty.byteLength);
  }
  const maxChain = level === 0 ? 0 : level === -1 ? 64 : 4 + level * 12;
  const { lit, dist } = fixedDeflateCodes();
  const head = new Int32Array(1 << DEFLATE_HASH_BITS).fill(-1);
  const prev = new Int32Array(DEFLATE_WINDOW).fill(-1);
  const hashAt = (i: number): number =>
    ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) &
    ((1 << DEFLATE_HASH_BITS) - 1);
  const insert = (i: number): void => {
    if (i + DEFLATE_MIN_MATCH > data.length) return;
    const h = hashAt(i);
    prev[i & (DEFLATE_WINDOW - 1)] = head[h];
    head[h] = i;
  };

  // Symbols of the current block: literal (< 256) or match (length, distance).
  const symLength = new Uint16Array(DEFLATE_BLOCK_INPUT);
  const symValue = new Uint16Array(DEFLATE_BLOCK_INPUT);

  let pos = 0;
  while (pos < data.length) {
    const blockStart = pos;
    const blockEnd = Math.min(data.length, pos + DEFLATE_BLOCK_INPUT);
    const isLast = blockEnd === data.length;
    let symbols = 0;
    let fixedBits = 3 + 7; // header + end-of-block (code 256 is 7 bits)
    while (pos < blockEnd) {
      let bestLength = 0;
      let bestDistance = 0;
      if (maxChain > 0 && pos + DEFLATE_MIN_MATCH <= data.length) {
        const limit = Math.min(DEFLATE_MAX_MATCH, blockEnd - pos);
        let candidate = head[hashAt(pos)];
        let chain = maxChain;
        while (candidate >= 0 && chain-- > 0) {
          const distance = pos - candidate;
          if (distance > DEFLATE_WINDOW || distance <= 0) break;
          if (data[candidate + bestLength] === data[pos + bestLength]) {
            let length = 0;
            while (
              length < limit &&
              data[candidate + length] === data[pos + length]
            ) {
              length++;
            }
            if (length > bestLength) {
              bestLength = length;
              bestDistance = distance;
              if (length >= limit) break;
            }
          }
          const next = prev[candidate & (DEFLATE_WINDOW - 1)];
          if (next >= candidate) break;
          candidate = next;
        }
      }
      if (bestLength >= DEFLATE_MIN_MATCH) {
        symLength[symbols] = bestLength;
        symValue[symbols] = bestDistance;
        symbols++;
        const di = distanceIndex(bestDistance);
        fixedBits +=
          lit.len[LENGTH_SYMBOL[bestLength]] +
          LENGTH_EXTRA[LENGTH_SYMBOL_EXTRA[bestLength]] +
          5 +
          DIST_EXTRA[di];
        for (let i = 0; i < bestLength; i++) insert(pos + i);
        pos += bestLength;
      } else {
        symLength[symbols] = 0;
        symValue[symbols] = data[pos];
        symbols++;
        fixedBits += lit.len[data[pos]];
        insert(pos);
        pos++;
      }
    }
    const storedLength = blockEnd - blockStart;
    const storedBits =
      3 + ((8 - ((writer.bitLength + 3) & 7)) & 7) + 32 + storedLength * 8;
    if (level === 0 || storedBits <= fixedBits) {
      writer.writeBits(isLast ? 1 : 0, 1);
      writer.writeBits(0, 2);
      writer.alignToByte();
      writer.writeBits(storedLength & 0xffff, 16);
      writer.writeBits(~storedLength & 0xffff, 16);
      writer.writeBytes(data.subarray(blockStart, blockEnd));
      continue;
    }
    writer.writeBits(isLast ? 1 : 0, 1);
    writer.writeBits(1, 2);
    for (let s = 0; s < symbols; s++) {
      const length = symLength[s];
      if (length === 0) {
        const byte = symValue[s];
        writer.writeBits(lit.code[byte], lit.len[byte]);
        continue;
      }
      const symbol = LENGTH_SYMBOL[length];
      const li = LENGTH_SYMBOL_EXTRA[length];
      writer.writeBits(lit.code[symbol], lit.len[symbol]);
      if (LENGTH_EXTRA[li] > 0) {
        writer.writeBits(length - LENGTH_BASE[li], LENGTH_EXTRA[li]);
      }
      const distance = symValue[s];
      const di = distanceIndex(distance);
      writer.writeBits(dist[di], 5);
      if (DIST_EXTRA[di] > 0) {
        writer.writeBits(distance - DIST_BASE[di], DIST_EXTRA[di]);
      }
    }
    writer.writeBits(lit.code[256], lit.len[256]);
  }
  const out = writer.finish();
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

export default {
  constants,
  gzip,
  gunzip,
  deflateRawSync,
  inflateRawSync,
};
