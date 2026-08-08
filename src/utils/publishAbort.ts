/**
 * Cooperative cancel for in-flight QDN publishes (chunk uploads + multi-resource loops).
 * Bound for the duration of a Quitter (or other) publish that supports AbortSignal.
 */

let activeSignal: AbortSignal | null = null;

export function bindPublishAbort(signal?: AbortSignal | null): void {
  activeSignal = signal ?? null;
}

export function clearPublishAbort(): void {
  activeSignal = null;
}

export function isPublishAborted(): boolean {
  return Boolean(activeSignal?.aborted);
}

export class PublishAbortedError extends Error {
  constructor(message = 'Publish cancelled') {
    super(message);
    this.name = 'PublishAbortedError';
  }
}

export function throwIfPublishAborted(): void {
  if (isPublishAborted()) {
    throw new PublishAbortedError();
  }
}
