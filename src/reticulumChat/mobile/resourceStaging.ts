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

export type NativeFsFn = (
  op: 'path' | 'read' | 'write' | 'delete',
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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

  constructor(private readonly nativeFs: NativeFsFn) {}

  private async allocate(name: string): Promise<string> {
    const result = await this.nativeFs('path', { name });
    const path = String(result?.path || '');
    if (!path) throw new Error('native staging path unavailable');
    return path;
  }

  /**
   * Copies an OPFS blob the engine just wrote into native staging and returns
   * the real path to hand to python.
   */
  async stageOutbound(opfsPath: string): Promise<string> {
    const bytes = readFileSync(opfsPath);
    const nativePath = await this.allocate(baseName(opfsPath));
    await this.nativeFs('write', {
      path: nativePath,
      dataBase64: toBase64(new Uint8Array(bytes)),
    });
    this.outbound.add(nativePath);
    return nativePath;
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
   * ours.
   */
  async completeInbound(nativePath: string): Promise<string | null> {
    const opfsPath = this.inbound.get(nativePath);
    if (!opfsPath) return null;
    this.inbound.delete(nativePath);
    try {
      const result = await this.nativeFs('read', { path: nativePath });
      const dataBase64 = String(result?.dataBase64 ?? '');
      const dir = dirName(opfsPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(opfsPath, fromBase64(dataBase64));
      return opfsPath;
    } catch (err) {
      console.warn('[MobileChat] inbound resource staging failed', err);
      return null;
    } finally {
      void this.discard(nativePath);
    }
  }

  /** Drops a native staging file (transfer finished, failed or cancelled). */
  async discard(nativePath: string): Promise<void> {
    this.inbound.delete(nativePath);
    this.outbound.delete(nativePath);
    try {
      await this.nativeFs('delete', { path: nativePath });
    } catch {
      /* best effort */
    }
  }
}
