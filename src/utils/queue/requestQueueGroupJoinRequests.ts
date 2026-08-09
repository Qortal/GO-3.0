import { RequestQueueWithPromise } from './queue';

/**
 * Shared queue for group join requests. Used by App (for pause/resume/clear)
 * and by Group/GroupJoinRequests. Defined here so App can import it without
 * loading the Group component bundle.
 */
export const requestQueueGroupJoinRequests = new RequestQueueWithPromise(2);
