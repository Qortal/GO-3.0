/**
 * Safe replacement for `new File(...)`.
 *
 * cordova-plugin-file overwrites the global `File` constructor on Android with
 * its own non-spec version — `File(name, localURL, type, lastModified, size)`.
 * Calling `new File([blob], 'photo.jpg', { type })` there returns a plain
 * object whose `name` is the parts array and whose `type` is the options
 * object: it is not a Blob, its size is 0, `URL.createObjectURL()` throws
 * "Overload resolution failed", and `file.type.startsWith(...)` throws too.
 *
 * A Blob carrying `name`/`lastModified` behaves like a File everywhere the app
 * uses one (object URLs, FormData, fetch bodies, `.name`, `.type`, `.size`),
 * so that is the fallback when the native constructor is unavailable.
 */

let nativeFileUsable: boolean | null = null;

/** True when the global `File` is the real DOM constructor. */
function isNativeFileConstructor(): boolean {
  if (nativeFileUsable === null) {
    try {
      nativeFileUsable =
        typeof File === 'function' &&
        new File([new Blob([])], 'probe.txt') instanceof Blob;
    } catch {
      nativeFileUsable = false;
    }
  }
  return nativeFileUsable;
}

/** Attach File-ish metadata to a Blob in place. */
export function nameBlob(
  blob: Blob,
  name: string,
  lastModified = Date.now()
): File {
  try {
    Object.defineProperty(blob, 'name', {
      value: name,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(blob, 'lastModified', {
      value: lastModified,
      writable: true,
      configurable: true,
    });
  } catch {
    // Some engines refuse extra props on Blob — name is best-effort.
  }
  // Duck-typed File: every File member the app touches is present.
  return blob as File;
}

/** Build a File (or a File-shaped Blob) that is always a real Blob. */
export function createNamedFile(
  parts: BlobPart[],
  name: string,
  options?: { type?: string; lastModified?: number }
): File {
  const type = options?.type || '';
  const lastModified = options?.lastModified ?? Date.now();
  if (isNativeFileConstructor()) {
    return new File(parts, name, { type, lastModified });
  }
  const blob = type ? new Blob(parts, { type }) : new Blob(parts);
  return nameBlob(blob, name, lastModified);
}
