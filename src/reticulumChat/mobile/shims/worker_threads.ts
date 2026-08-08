/**
 * `worker_threads` stand-in for the engine worker.
 *
 * The chat/resource worker modules import { parentPort } and register message
 * handlers only when it is non-null (they are also imported by vitest, so a
 * null parentPort is an already-supported mode). The mobile inline pools call
 * the modules' exported task functions directly instead of spawning threads.
 */

export const parentPort: null = null;
export const workerData: undefined = undefined;

export class Worker {
  constructor() {
    throw new Error('worker_threads.Worker is not available on mobile');
  }
}

export default { parentPort, workerData, Worker };
