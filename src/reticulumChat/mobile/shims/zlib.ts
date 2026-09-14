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

export default { constants, gzip, gunzip };
