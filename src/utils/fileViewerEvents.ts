import { executeEvent } from './events';

/**
 * Opens a file in the in-app viewer (`ReticulumFileViewer`, mounted once in
 * App). Kept free of React and heavy imports so the mobile resource shim and
 * the Capacitor bridge can call it without pulling the viewer into their
 * chunks.
 */
export const OPEN_FILE_VIEWER_EVENT = 'openReticulumFileViewer';

export type FileViewerRequest = {
  /** Reticulum resource hash, resolved through `window.reticulumResources`. */
  fileHash?: string;
  /** An existing `blob:` / `data:` URL, used when there is no hash. */
  url?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
};

export function openFileViewer(request: FileViewerRequest): void {
  if (!request?.fileHash && !request?.url) return;
  executeEvent(OPEN_FILE_VIEWER_EVENT, request);
}
