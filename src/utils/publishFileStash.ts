/**
 * Hold large publish Blobs/Files by id so they are not structured-cloned
 * through window.postMessage (which doubles memory and can kill WebView).
 */

const stash = new Map<string, Blob>();

export function stashPublishFile(file: Blob): string {
  const id = `qdn-file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  stash.set(id, file);
  return id;
}

export function takePublishFile(id: string): Blob | undefined {
  const file = stash.get(id);
  stash.delete(id);
  return file;
}

export function discardPublishFile(id: string): void {
  stash.delete(id);
}
