/**
 * Group audio arrives as a Uint8Array on GO (the hosted Reticulum adapter
 * decodes base64 into a view) but as an ArrayBuffer on the desktop. Only an
 * ArrayBuffer goes to the decrypt workers and into the hold-while-awaiting-key
 * queue, so on GO every Reticulum frame was decrypted on the page's main
 * thread (already 78 % busy on a Galaxy S8+ in a 4-way call) and audio that
 * arrived before the room key was dropped. This returns an exact ArrayBuffer
 * copy of a view, the buffer itself, or null for anything else.
 */
export function toOwnedAudioArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice()
      .buffer;
  }
  return null;
}
