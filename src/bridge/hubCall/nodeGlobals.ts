/**
 * Node globals the unmodified Hub call managers expect, for GO's WebView.
 *
 * electron/src/call.ts, group-call.ts, group-call-wire-reticulum.ts and
 * ed25519-verify-common.ts use the free identifiers `Buffer` and (group-call)
 * `setImmediate`, and two of them encode/decode `'base64url'`:
 *   - group-call.ts GO1 reassembly: `Buffer.from(parts, 'base64url')` — every
 *     inbound WebRTC signal and DM call-control frame;
 *   - group-call-wire-reticulum.ts compact GJ `d` (22-char base64url form).
 * The `buffer` npm package (6.0.3) the app ships throws "Unknown encoding"
 * for 'base64url', so this module teaches it that encoding (additive: the
 * encoding never worked before, nothing else changes) and installs the
 * globals only where they are missing.
 *
 * Import this module FIRST (before anything that imports the managers):
 * ed25519-verify-common evaluates `Buffer.from(...)` at module load.
 * It is GO-only — desktop Electron never loads src/bridge/hubCall.
 */
import { Buffer as PolyfillBuffer } from 'buffer';
import { sharedMacrotaskQueue } from './macrotask';

const PATCHED = Symbol.for('qortal.go.bufferBase64UrlPatched');

type BufferCtor = typeof PolyfillBuffer;

function isBase64UrlEncoding(encoding: unknown): boolean {
  return typeof encoding === 'string' && encoding.toLowerCase() === 'base64url';
}

function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  return pad === 0 ? base64 : base64 + '='.repeat(4 - pad);
}

/**
 * Adds 'base64url' to a `buffer`-package Buffer class (from, toString,
 * write, byteLength, isEncoding). A Buffer that already supports it (Node's
 * own) is left untouched. Idempotent.
 */
export function ensureBufferBase64Url(BufferClass: BufferCtor): void {
  const holder = BufferClass as unknown as Record<symbol, boolean>;
  if (holder[PATCHED]) return;
  let supported = false;
  try {
    supported =
      BufferClass.isEncoding('base64url') &&
      BufferClass.from('-_8', 'base64url' as BufferEncoding).length === 2;
  } catch {
    supported = false;
  }
  if (supported) {
    holder[PATCHED] = true;
    return;
  }
  const proto = BufferClass.prototype as unknown as Record<string, unknown>;
  const ctor = BufferClass as unknown as Record<string, unknown>;

  const originalIsEncoding = BufferClass.isEncoding.bind(BufferClass);
  ctor.isEncoding = (encoding: string): boolean =>
    isBase64UrlEncoding(encoding) || originalIsEncoding(encoding);

  const originalFrom = BufferClass.from as (...args: unknown[]) => unknown;
  ctor.from = function from(this: unknown, ...args: unknown[]): unknown {
    if (typeof args[0] === 'string' && isBase64UrlEncoding(args[1])) {
      return originalFrom.call(
        BufferClass,
        base64UrlToBase64(args[0]),
        'base64'
      );
    }
    return originalFrom.apply(BufferClass, args);
  };

  const originalByteLength = BufferClass.byteLength as (
    ...args: unknown[]
  ) => number;
  ctor.byteLength = function byteLength(...args: unknown[]): number {
    if (typeof args[0] === 'string' && isBase64UrlEncoding(args[1])) {
      return originalByteLength.call(
        BufferClass,
        base64UrlToBase64(args[0]),
        'base64'
      );
    }
    return originalByteLength.apply(BufferClass, args);
  };

  const originalToString = proto.toString as (...args: unknown[]) => string;
  proto.toString = function toString(this: unknown, ...args: unknown[]) {
    if (isBase64UrlEncoding(args[0])) {
      return base64ToBase64Url(
        originalToString.call(this, 'base64', args[1], args[2])
      );
    }
    // Keep the original arity: buffer's toString() treats "no arguments"
    // as a fast utf8 path.
    return originalToString.apply(this, args);
  };

  const originalWrite = proto.write as (...args: unknown[]) => number;
  proto.write = function write(this: unknown, ...args: unknown[]): number {
    if (typeof args[0] === 'string') {
      const encodingIndex = args.findIndex(
        (arg, index) => index > 0 && typeof arg === 'string'
      );
      if (encodingIndex > 0 && isBase64UrlEncoding(args[encodingIndex])) {
        const next = [...args];
        next[0] = base64UrlToBase64(args[0]);
        next[encodingIndex] = 'base64';
        return originalWrite.apply(this, next);
      }
    }
    return originalWrite.apply(this, args);
  };

  holder[PATCHED] = true;
}

/** Installs Buffer/setImmediate where missing and base64url everywhere. */
export function installHubCallNodeGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  ensureBufferBase64Url(PolyfillBuffer);
  if (typeof g.Buffer === 'undefined') {
    g.Buffer = PolyfillBuffer;
  } else if (g.Buffer !== PolyfillBuffer) {
    ensureBufferBase64Url(g.Buffer as BufferCtor);
  }
  if (typeof g.setImmediate !== 'function') {
    // MessageChannel, not setTimeout(0): group-call.ts flushes every
    // Reticulum audio frame through setImmediate, and timers are clamped
    // (4 ms nested) and throttled while the page is hidden (screen off at
    // the ear, phone locked). See macrotask.ts.
    const queue = sharedMacrotaskQueue();
    g.setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
      queue.set(fn, ...args);
    g.clearImmediate = (id: number) => queue.clear(id);
  }
}

installHubCallNodeGlobals();
