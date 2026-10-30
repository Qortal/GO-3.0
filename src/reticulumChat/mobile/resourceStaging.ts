/**
 * OPFS ⇄ native filesystem bridge for Reticulum resource transfers.
 *
 * The chat engine reads and writes resource payloads with `fs`, which in the
 * engine worker is an OPFS-backed shim. The python bridge that actually moves
 * the bytes over Reticulum runs in the Android process and can only see real
 * files. Neither side can open the other's paths, so every resource payload has
 * to be copied across the boundary:
 *
 *   outbound  engine writes OPFS blob → copy to native staging → python reads
 *   inbound   python writes native staging → copy to OPFS → engine reads
 *
 * The engine keeps using its own OPFS paths throughout; the native path only
 * exists for the duration of the transfer and is deleted afterwards.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from './shims/fs';
import { warn } from './shims/logger';
import { buildStagedResourcePath } from './stagedFileName';
import { base64ToBytes, bytesToBase64 } from '../../utils/bytesBase64';

/**
 * Reason the engine gets (as a 'failed' resource status) when received bytes
 * could not be copied into OPFS. With mobileProfile.localFailuresAreLocal it
 * is charged to this device, not to the peer that sent them.
 */
export const LOCAL_STORAGE_UNAVAILABLE = 'local_storage_unavailable';

/** completeInbound's answer when the copy into OPFS failed. */
export type InboundStagingFailure = {
  failed: true;
  reason: typeof LOCAL_STORAGE_UNAVAILABLE;
  /** EMFILE, ENOSPC, ... or the error's name; for logs. */
  code: string;
};

export type NativeFsFn = (
  op: 'path' | 'read' | 'write' | 'delete' | 'sweep',
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

/**
 * The engine's resource TTL (RETICULUM_CHAT_RESOURCE_TTL_MS): a staged send
 * older than this can no longer be requested. Kotlin's sweep never goes below
 * it either.
 */
const STAGED_SEND_TTL_MS = 10 * 60_000;
// An outbound file whose transfer never reported a terminal status is
// dropped in session after twice the TTL (a running transfer keeps its open
// file handle, so even a late delete does not cut it off).
const STAGED_SEND_FORGET_MS = 2 * STAGED_SEND_TTL_MS;

function baseName(p: string): string {
  const parts = String(p).split('/');
  return parts[parts.length - 1] || 'blob';
}

function dirName(p: string): string {
  const parts = String(p).split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export class ReticulumResourceStaging {
  /** native staging path → the OPFS path the engine expects the bytes at. */
  private readonly inbound = new Map<string, string>();
  /** native staging paths we created for outbound sends, for cleanup. */
  private readonly outbound = new Set<string>();
  /**
   * transfer id → its outbound staging file. Python's terminal statuses for
   * a send ('sent', 'failed') name only the transfer, never the path.
   */
  private readonly outboundByTransfer = new Map<
    string,
    { path: string; stagedAt: number }
  >();

  /**
   * `nativeDir` returns Kotlin's staging folder once the bridge socket info
   * has arrived ('' before), so new paths need no round trip to Kotlin.
   */
  constructor(
    private readonly nativeFs: NativeFsFn,
    private readonly nativeDir: () => string = () => ''
  ) {}

  private async allocate(name: string): Promise<string> {
    const dir = this.nativeDir();
    if (dir) return buildStagedResourcePath(dir, name);
    // No folder yet (the plugin's bridge socket did not answer): ask Kotlin.
    const result = await this.nativeFs('path', { name });
    const path = String(result?.path || '');
    if (!path) throw new Error('native staging path unavailable');
    return path;
  }

  /**
   * Copies an OPFS blob the engine just wrote into native staging and returns
   * the real path to hand to python. With a `transferId`, the file is deleted
   * when that transfer ends (discardOutboundTransfer).
   */
  async stageOutbound(opfsPath: string, transferId?: string): Promise<string> {
    const bytes = readFileSync(opfsPath);
    const nativePath = await this.allocate(baseName(opfsPath));
    await this.nativeFs('write', {
      path: nativePath,
      dataBase64: bytesToBase64(new Uint8Array(bytes)),
    });
    this.outbound.add(nativePath);
    if (transferId) this.noteOutboundTransfer(transferId, nativePath);
    return nativePath;
  }

  private noteOutboundTransfer(transferId: string, nativePath: string): void {
    const now = Date.now();
    for (const [id, entry] of this.outboundByTransfer) {
      if (now - entry.stagedAt < STAGED_SEND_FORGET_MS) break;
      this.outboundByTransfer.delete(id);
      void this.discard(entry.path);
    }
    // A transfer registered again replaces its earlier file.
    const previous = this.outboundByTransfer.get(transferId);
    this.outboundByTransfer.delete(transferId);
    if (previous && previous.path !== nativePath) {
      void this.discard(previous.path);
    }
    this.outboundByTransfer.set(transferId, {
      path: nativePath,
      stagedAt: now,
    });
  }

  /**
   * The outbound transfer ended ('sent', 'failed', 'cancelled'): Python has
   * finished reading its file. Unknown transfers are ignored.
   */
  async discardOutboundTransfer(transferId: string): Promise<void> {
    const entry = this.outboundByTransfer.get(transferId);
    if (!entry) return;
    this.outboundByTransfer.delete(transferId);
    await this.discard(entry.path);
  }

  /**
   * Once per worker bridge start: Kotlin deletes staged files older than the
   * resource TTL that no terminal status cleaned up (a worker that restarted
   * or crashed mid-transfer). Best effort; an older native side lacks it.
   * True when the native side answered, so the caller can try again later
   * when it did not (only the bridge socket route knows 'sweep').
   */
  async sweepStale(): Promise<boolean> {
    try {
      await this.nativeFs('sweep', { maxAgeMs: STAGED_SEND_TTL_MS });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reserves a native path for an inbound transfer, remembering where the
   * engine expects to read the payload from once it lands.
   */
  async reserveInbound(opfsSavePath: string): Promise<string> {
    const nativePath = await this.allocate(baseName(opfsSavePath));
    this.inbound.set(nativePath, opfsSavePath);
    return nativePath;
  }

  /**
   * Copies a completed inbound transfer out of native staging into OPFS and
   * returns the engine-visible path, or null when this transfer was not one of
   * ours. When the copy fails (no spare OPFS handle, native read timed out)
   * it returns a failure marker: the native path must never reach the engine,
   * which cannot open it and would blame the sender for the ENOENT.
   */
  async completeInbound(
    nativePath: string
  ): Promise<string | null | InboundStagingFailure> {
    const opfsPath = this.inbound.get(nativePath);
    if (!opfsPath) return null;
    this.inbound.delete(nativePath);
    try {
      const result = await this.nativeFs('read', { path: nativePath });
      const dataBase64 = String(result?.dataBase64 ?? '');
      const dir = dirName(opfsPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(opfsPath, base64ToBytes(dataBase64));
      return opfsPath;
    } catch (err) {
      const { code, message } = (err ?? {}) as {
        code?: unknown;
        message?: unknown;
      };
      const label =
        typeof code === 'string' && code
          ? code
          : err instanceof Error
            ? err.name
            : 'unknown';
      warn(
        `inbound resource staging failed code=${label} error=${String(message ?? err).slice(0, 160)}`
      );
      return { failed: true, reason: LOCAL_STORAGE_UNAVAILABLE, code: label };
    } finally {
      void this.discard(nativePath);
    }
  }

  /** Drops a native staging file (transfer finished, failed or cancelled). */
  async discard(nativePath: string): Promise<void> {
    this.inbound.delete(nativePath);
    if (this.outbound.delete(nativePath)) {
      for (const [id, entry] of this.outboundByTransfer) {
        if (entry.path === nativePath) this.outboundByTransfer.delete(id);
      }
    }
    try {
      await this.nativeFs('delete', { path: nativePath });
    } catch {
      /* best effort */
    }
  }
}
