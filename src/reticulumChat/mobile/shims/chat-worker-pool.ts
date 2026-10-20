/**
 * Inline stand-in for `reticulum-chat-worker-pool` on mobile.
 *
 * Node worker_threads are unavailable in the engine worker, and every chat
 * pool call site has an inline fallback for a null result (the pool is a
 * best-effort accelerator on desktop). The digest/author-tree builds never
 * call this on GO: engineHost sets mobileProfile.inlineDigestBuilds, which
 * routes them through their inline branches (the pooled variants open the
 * SQLite file from a second connection, which the OPFS SAH-pool VFS forbids).
 * The engine.worker.ts `process.env.VITEST` value does not do this in built
 * bundles: Vite replaces `process.env` there with an empty object, so before
 * that option every build here returned null and logged a worker fallback.
 */

export type ReticulumChatWorkerTask = { id: number; kind: string } & Record<
  string,
  unknown
>;
export type ReticulumChatWorkerTaskInput = Omit<ReticulumChatWorkerTask, 'id'>;
export type ReticulumChatWorkerResult = Record<string, unknown> | null;

export function resolveReticulumChatWorkerPath(): string {
  return '/nonexistent/reticulum-chat.worker.js';
}

export class ReticulumChatWorkerPool {
  constructor(
    private readonly label = 'chat',
    _workerCount?: number,
    _maxPending?: number,
    _slowTaskMs?: number
  ) {}

  start(): void {
    /* no worker threads on mobile */
  }

  stop(): void {
    /* nothing to stop */
  }

  run(_task: ReticulumChatWorkerTaskInput): Promise<null> {
    // Null signals "worker unavailable"; callers use their inline fallbacks.
    return Promise.resolve(null);
  }

  stats(): {
    pending: number;
    workers: number;
    fallbackCount: number;
    crashCount: number;
  } {
    return { pending: 0, workers: 0, fallbackCount: 0, crashCount: 0 };
  }
}

export default ReticulumChatWorkerPool;
