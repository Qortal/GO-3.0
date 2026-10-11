// Leaf module: the publish window's store reads these without loading the
// publish code (and its key handling) itself.

/** A file goes to the node in parts of this size (the last one smaller). */
export const QDN_PUBLISH_CHUNK_BYTES = 5 * 1024 * 1024;

/**
 * How far one resource has got, for GO's publish window. A Q-App's own window
 * still hears of it through `receiveChunks` (PUBLISH_STATUS), as before.
 * - uploading: `sentChunks` of `totalChunks` parts are on the node (data sent
 *   in one piece counts as one part);
 * - processing: all of it is there; the node builds the file and GO signs;
 * - retrying: a part or a node call failed and is tried again shortly;
 * - published: the transaction is on its way to QDN.
 */
export type PublishProgress =
  | { stage: 'uploading'; sentChunks: number; totalChunks: number }
  | { stage: 'processing' }
  | { stage: 'retrying' }
  | { stage: 'published' };
