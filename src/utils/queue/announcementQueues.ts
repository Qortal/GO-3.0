import { RequestQueueWithPromise } from './queue';

/**
 * Shared announcement queues. Used by App (for pause/resume/clear) and by the
 * announcement components. Defined here so App can import them without loading
 * the chat bundle.
 */
export const requestQueueCommentCount = new RequestQueueWithPromise(3);

export const requestQueuePublishedAccouncements = new RequestQueueWithPromise(
  3
);
