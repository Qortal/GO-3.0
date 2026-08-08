/**
 * Inline stand-in for `reticulum-chat-worker-pool` on mobile.
 *
 * Node worker_threads are unavailable in the engine worker, and every chat
 * pool call site has an inline fallback for a null result (the pool is a
 * best-effort accelerator on desktop). Additionally the engine runs with
 * process.env.VITEST set, which routes the digest/author-tree builds through
 * their inline branches — required here because the pooled variants open the
 * SQLite file from a second connection, which the OPFS SAH-pool VFS forbids.
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
}

export default ReticulumChatWorkerPool;
