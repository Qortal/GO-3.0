/**
 * Inline stand-in for `reticulum-resource-worker-pool` on mobile.
 *
 * Unlike the chat pool, the resource store treats a null pool result as a
 * hard error (imports/finalization would fail), so the six task kinds from
 * reticulum-resource.worker.ts are executed synchronously here against the
 * worker's OPFS-backed fs shim. The original worker module is written with
 * CommonJS `require` (for app.asar unpacking) and cannot be bundled, so its
 * small task bodies are reproduced 1:1.
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

function finalizeResource(task: Task): string {
  const stat = fs.statSync(task.sourcePath);
  if (!stat.isFile() || stat.size !== task.expectedSize) {
    throw new Error('Resource source size mismatch');
  }
  const hash = hashFile(task.sourcePath);
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

function writeRange(task: Task): { hash: string; sizeBytes: number } {
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

function runTask(task: Task): Result {
  const startedAt = Date.now();
  try {
    if (task.kind === 'hash_file') {
      return {
        kind: task.kind,
        ok: true,
        hash: hashFile(task.path),
        durationMs: Date.now() - startedAt,
      };
    }
    if (task.kind === 'read_and_hash_file') {
      const bytes = fs.readFileSync(task.path);
      return {
        kind: task.kind,
        ok: true,
        bytes,
        hash: nodeCrypto.createHash('sha256').update(bytes).digest('hex'),
        durationMs: Date.now() - startedAt,
      };
    }
    if (task.kind === 'write_range_file') {
      const result = writeRange(task);
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
      const inspections = (task.entries as any[]).map((entry) => {
        let assembledValid = false;
        let partialExists = false;
        try {
          const stat = fs.statSync(entry.assembledPath);
          assembledValid =
            stat.isFile() &&
            stat.size === entry.expectedSize &&
            (entry.expectComplete ||
              hashFile(entry.assembledPath) === entry.expectedHash);
        } catch {
          assembledValid = false;
        }
        try {
          partialExists = fs.statSync(entry.partialPath).isFile();
        } catch {
          partialExists = false;
        }
        return { fileHash: entry.fileHash, assembledValid, partialExists };
      });
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
      hash: finalizeResource(task),
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

export class ReticulumResourceWorkerPool {
  constructor(..._args: unknown[]) {}

  start(): void {
    /* inline execution */
  }

  stop(): void {
    /* inline execution */
  }

  async run(task: Task, _priority?: number): Promise<Result> {
    // Yield once so long hashes cannot starve queued bridge frames entirely.
    await Promise.resolve();
    return runTask(task);
  }

  stats(): {
    queued: number;
    waiting: number;
    active: number;
    crashCount: number;
    fallbackCount: number;
  } {
    return {
      queued: 0,
      waiting: 0,
      active: 0,
      crashCount: 0,
      fallbackCount: 0,
    };
  }
}

export default ReticulumResourceWorkerPool;
