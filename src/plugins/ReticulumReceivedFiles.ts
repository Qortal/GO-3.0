import { Reticulum } from './Reticulum';

/**
 * The received-file calls of the native Reticulum plugin
 * (ReticulumPlugin.kt). Received Q-Chat files stay in GO's private storage;
 * these read one for the in-app viewer, export one on "Save to device" and
 * remove them all on logout. Each call only acts on a path inside the
 * received-file folders (ReceivedFilePolicy.java).
 */
export interface ReticulumReceivedFilesPlugin {
  /** One slice of a received file, base64. Rejects with code NOT_FOUND. */
  qchatReceivedFileRead(options: {
    path: string;
    offset: number;
    length: number;
  }): Promise<{
    dataBase64: string;
    bytesRead: number;
    size: number;
    eof: boolean;
  }>;

  /**
   * Copies a received file into Documents/Qortal Go/<category> under a
   * cleaned name. `folder` is the path under Documents. Rejects with code
   * NOT_FOUND when the file is gone.
   */
  qchatReceivedFileSave(options: { path: string; fileName?: string }): Promise<{
    ok: boolean;
    uri: string;
    name: string;
    folder: string;
  }>;

  /** Deletes every received file GO still holds. Saved copies stay. */
  qchatReceivedFilesClear(): Promise<{ ok: boolean; deleted: number }>;
}

// Same native plugin object; this interface only adds the calls above, so
// src/plugins/Reticulum.ts does not have to change with them.
export const ReticulumReceivedFiles =
  Reticulum as unknown as ReticulumReceivedFilesPlugin;
