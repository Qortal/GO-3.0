/**
 * Inline stand-in for `reticulum-resource-worker-pool` on mobile.
 *
 * Unlike the chat pool, the resource store treats a null pool result as a
 * hard error (imports/finalization would fail), so the six task kinds from
 * reticulum-resource.worker.ts are executed inline here against the worker's
 * OPFS-backed fs shim. The original worker module is written with CommonJS
 * `require` (for app.asar unpacking) and cannot be bundled, so its small task
 * bodies are reproduced, with the same results.
 *
 * Two differences, both because this runs on the engine thread itself:
 * - SHA-256 of files up to SUBTLE_HASH_MAX_BYTES goes through WebCrypto. The
 *   `crypto` shim's hash is pure JS, which GrapheneOS's per-app "WebView JIT"
 *   switch makes ~100x slower (about 0.4 s per MB on a desktop CPU, more on a
 *   phone); WebCrypto is native and costs well under 1 ms per MB either way.
 *   The hex digests are identical.
 * - Tasks run one at a time in the desktop pool's order (priority, then
 *   submission), each after a real task boundary, so bridge frames and RPCs
 *   queued behind a task are not held up by it.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as nodeCrypto from 'crypto';
import { Buffer } from 'buffer';

type Task = { kind: string } & Record<string, any>;

type Result = {
  id?: number;
  kind: string;
  ok: boolean;
  durationMs: number;
  hash?: string;
  deleted?: number;
  bytes?: Uint8Array;
  sizeBytes?: number;
  inspections?: Array<{
    fileHash: string;
    assembledValid: boolean;
    partialExists: boolean;
  }>;
  error?: string;
};

/**
 * Largest file or byte range read whole and hashed with WebCrypto. It bounds
 * what one task holds in memory (the bytes plus WebCrypto's own copy);
 * anything bigger streams through the pure-JS hash in 1 MB reads, as before.
 */
export const SUBTLE_HASH_MAX_BYTES = 64 * 1024 * 1024;

const READ_CHUNK_BYTES = 1024 * 1024;

/** WebCrypto, when this context has it (a secure origin such as localhost). */
function subtleCrypto(): SubtleCrypto | null {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  return subtle && typeof subtle.digest === 'function' ? subtle : null;
}

function toHex(digest: ArrayBuffer): string {
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Lowercase hex SHA-256, the same string `createHash('sha256')` gives. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = subtleCrypto();
  if (subtle && bytes.byteLength <= SUBTLE_HASH_MAX_BYTES) {
    try {
      return toHex(await subtle.digest('SHA-256', bytes as BufferSource));
    } catch {
      /* the pure-JS hash below gives the same digest */
    }
  }
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Reads exactly `size` bytes into one buffer (1 MB reads, so the shim never
 * allocates a second whole-file copy). Null when the file is not `size`
 * bytes long any more; the caller then streams it to EOF like before.
 */
function readWholeFile(filePath: string, size: number): Uint8Array | null {
  const bytes = new Uint8Array(size);
  const fd = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    while (offset < size) {
      const bytesRead = fs.readSync(
        fd,
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, size - offset),
        offset
      );
      if (bytesRead <= 0) return null;
      offset += bytesRead;
    }
    if (fs.readSync(fd, new Uint8Array(1), 0, 1, size) > 0) return null;
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * SHA-256 of a file. The read is synchronous and the digest is awaited, so
 * nothing else touches the file between the two.
 */
export async function hashResourceFile(filePath: string): Promise<string> {
  if (subtleCrypto()) {
    const size = fs.statSync(filePath).size;
    if (size <= SUBTLE_HASH_MAX_BYTES) {
      const bytes = readWholeFile(filePath, size);
      if (bytes) return sha256Hex(bytes);
    }
  }
  return hashFile(filePath);
}

let yieldChannel: MessageChannel | null = null;
const yieldWaiters: Array<() => void> = [];

/**
 * Resolves in a later task (a MessageChannel post, not a microtask), so
 * messages already queued for this worker (bridge frames, RPCs) run first.
 */
export function macrotaskYield(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    if (!yieldChannel) {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        yieldWaiters.shift()?.();
      };
      // Node (tests) would otherwise keep the process alive for the port.
      (channel.port1 as { unref?: () => void }).unref?.();
      yieldChannel = channel;
    }
    yieldWaiters.push(resolve);
    yieldChannel.port2.postMessage(0);
  });
}

function hashFile(filePath: string): string {
  const hash = nodeCrypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

async function finalizeResource(task: Task): Promise<string> {
  const stat = fs.statSync(task.sourcePath);
  if (!stat.isFile() || stat.size !== task.expectedSize) {
    throw new Error('Resource source size mismatch');
  }
  const hash = await hashResourceFile(task.sourcePath);
  if (hash !== String(task.expectedHash).toLowerCase()) {
    throw new Error('Assembled file hash mismatch');
  }
  fs.mkdirSync(path.dirname(task.destinationPath), { recursive: true });
  if (path.resolve(task.sourcePath) !== path.resolve(task.destinationPath)) {
    if (task.moveSource) {
      try {
        fs.renameSync(task.sourcePath, task.destinationPath);
      } catch {
        fs.rmSync(task.destinationPath, { force: true });
        fs.renameSync(task.sourcePath, task.destinationPath);
      }
      return hash;
    }
    const temporaryPath = `${task.destinationPath}.${Date.now()}.tmp`;
    try {
      fs.copyFileSync(task.sourcePath, temporaryPath);
      fs.renameSync(temporaryPath, task.destinationPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  return hash;
}

async function writeRange(
  task: Task
): Promise<{ hash: string; sizeBytes: number }> {
  const startByte = Math.floor(task.startByte);
  const endByteExclusive = Math.floor(task.endByteExclusive);
  if (startByte < 0 || endByteExclusive <= startByte) {
    throw new Error('Invalid resource byte range');
  }
  const sourceStat = fs.statSync(task.sourcePath);
  if (!sourceStat.isFile() || endByteExclusive > sourceStat.size) {
    throw new Error('Resource byte range exceeds source');
  }
  fs.mkdirSync(path.dirname(task.destinationPath), { recursive: true });
  if (subtleCrypto() && endByteExclusive - startByte <= SUBTLE_HASH_MAX_BYTES) {
    // Served ranges are at most 1 MB: copy the range whole, then hash it
    // with WebCrypto. The output file is complete before the await.
    const bytes = copyRangeWhole(task, startByte, endByteExclusive);
    return { hash: await sha256Hex(bytes), sizeBytes: bytes.byteLength };
  }
  return writeRangeStreaming(task, startByte, endByteExclusive);
}

function copyRangeWhole(
  task: Task,
  startByte: number,
  endByteExclusive: number
): Uint8Array {
  const sizeBytes = endByteExclusive - startByte;
  const bytes = new Uint8Array(sizeBytes);
  const source = fs.openSync(task.sourcePath, 'r');
  const output = fs.openSync(task.destinationPath, 'w');
  try {
    let offset = 0;
    while (offset < sizeBytes) {
      const bytesRead = fs.readSync(
        source,
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, sizeBytes - offset),
        startByte + offset
      );
      if (bytesRead <= 0) {
        throw new Error('Unexpected EOF while reading resource range');
      }
      offset += bytesRead;
    }
    fs.writeSync(output, bytes);
  } catch (error) {
    fs.rmSync(task.destinationPath, { force: true });
    throw error;
  } finally {
    fs.closeSync(source);
    fs.closeSync(output);
  }
  return bytes;
}

function writeRangeStreaming(
  task: Task,
  startByte: number,
  endByteExclusive: number
): { hash: string; sizeBytes: number } {
  const source = fs.openSync(task.sourcePath, 'r');
  const output = fs.openSync(task.destinationPath, 'w');
  const sizeBytes = endByteExclusive - startByte;
  const buffer = Buffer.alloc(Math.min(1024 * 1024, sizeBytes));
  const hash = nodeCrypto.createHash('sha256');
  let remaining = sizeBytes;
  let offset = startByte;
  try {
    while (remaining > 0) {
      const readSize = Math.min(buffer.length, remaining);
      const bytesRead = fs.readSync(source, buffer, 0, readSize, offset);
      if (bytesRead <= 0) {
        throw new Error('Unexpected EOF while reading resource range');
      }
      const slice = buffer.subarray(0, bytesRead);
      fs.writeSync(output, slice);
      hash.update(slice);
      remaining -= bytesRead;
      offset += bytesRead;
    }
  } catch (error) {
    fs.rmSync(task.destinationPath, { force: true });
    throw error;
  } finally {
    fs.closeSync(source);
    fs.closeSync(output);
  }
  return { hash: hash.digest('hex'), sizeBytes };
}

async function runTask(task: Task): Promise<Result> {
  const startedAt = Date.now();
  try {
    if (task.kind === 'hash_file') {
      return {
        kind: task.kind,
        ok: true,
        hash: await hashResourceFile(task.path),
        durationMs: Date.now() - startedAt,
      };
    }
    if (task.kind === 'read_and_hash_file') {
      const bytes = fs.readFileSync(task.path);
      return {
        kind: task.kind,
        ok: true,
        bytes,
        hash: await sha256Hex(bytes),
        durationMs: Date.now() - startedAt,
      };
    }
    if (task.kind === 'write_range_file') {
      const result = await writeRange(task);
      return {
        kind: task.kind,
        ok: true,
        hash: result.hash,
        sizeBytes: result.sizeBytes,
        durationMs: Date.now() - startedAt,
      };
    }
    if (task.kind === 'delete_paths') {
      let deleted = 0;
      for (const candidate of new Set(
        (task.paths as string[]).filter(Boolean)
      )) {
        if (!fs.existsSync(candidate)) continue;
        fs.rmSync(candidate, { recursive: true, force: true });
        deleted += 1;
      }
      return {
        kind: task.kind,
        ok: true,
        deleted,
        durationMs: Date.now() - startedAt,
      };
    }
    if (task.kind === 'inspect_paths') {
      const inspections: NonNullable<Result['inspections']> = [];
      for (const entry of task.entries as any[]) {
        let assembledValid = false;
        let partialExists = false;
        try {
          const stat = fs.statSync(entry.assembledPath);
          assembledValid =
            stat.isFile() &&
            stat.size === entry.expectedSize &&
            (entry.expectComplete ||
              (await hashResourceFile(entry.assembledPath)) ===
                entry.expectedHash);
        } catch {
          assembledValid = false;
        }
        try {
          partialExists = fs.statSync(entry.partialPath).isFile();
        } catch {
          partialExists = false;
        }
        inspections.push({
          fileHash: entry.fileHash,
          assembledValid,
          partialExists,
        });
      }
      return {
        kind: task.kind,
        ok: true,
        inspections,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      kind: task.kind,
      ok: true,
      hash: await finalizeResource(task),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      kind: task.kind,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

type QueueEntry = {
  task: Task;
  priority: number;
  id: number;
  resolve: (result: Result) => void;
};

export class ReticulumResourceWorkerPool {
  private queue: QueueEntry[] = [];
  private active: QueueEntry | null = null;
  private pumping = false;
  private nextId = 0;

  constructor(..._args: unknown[]) {}

  start(): void {
    /* inline execution */
  }

  stop(): void {
    // Queued tasks still run: the store has always relied on inline results.
  }

  run(task: Task, priority = 2): Promise<Result> {
    return new Promise((resolve) => {
      this.enqueue({ task, priority, id: ++this.nextId, resolve });
      void this.pump();
    });
  }

  /**
   * One task at a time, like the desktop pool's single worker: a finalize
   * (hash, then rename) never interleaves with a delete or inspect of the
   * same files now that hashing awaits WebCrypto.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        // A real task boundary: bridge frames and RPCs that arrived while
        // the previous task ran are handled before the next one starts.
        await macrotaskYield();
        const entry = this.queue.shift();
        if (!entry) break;
        this.active = entry;
        let result: Result;
        try {
          result = await runTask(entry.task);
        } catch (error) {
          result = {
            kind: entry.task.kind,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            durationMs: 0,
          };
        } finally {
          this.active = null;
        }
        entry.resolve(result);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Same order as the desktop pool: lower priority first, then FIFO. */
  private enqueue(entry: QueueEntry): void {
    let low = 0;
    let high = this.queue.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = this.queue[middle];
      if (
        candidate.priority < entry.priority ||
        (candidate.priority === entry.priority && candidate.id < entry.id)
      ) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    this.queue.splice(low, 0, entry);
  }

  stats(): {
    queued: number;
    waiting: number;
    active: number;
    crashCount: number;
    fallbackCount: number;
  } {
    return {
      queued: this.queue.length,
      waiting: 0,
      active: this.active ? 1 : 0,
      crashCount: 0,
      fallbackCount: 0,
    };
  }
}

export default ReticulumResourceWorkerPool;
