/**
 * Reads back a zip of stored (uncompressed) entries, as buildStoredZip
 * (components/Mobile/widgets/storedZip) writes them, through its central
 * directory. Throws where the layout is not what a zip reader expects.
 */
export function readStoredZip(
  zip: Uint8Array
): { name: string; crc: number; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`not a stored zip: ${what}`);
  };
  const end = zip.length - 22;
  check(end >= 0 && view.getUint32(end, true) === 0x06054b50, 'end record');
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  const entries: { name: string; crc: number; data: Uint8Array }[] = [];
  let at = centralOffset;
  for (let i = 0; i < count; i += 1) {
    check(view.getUint32(at, true) === 0x02014b50, 'central header');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    // The local header says the same and keeps the bytes as they are.
    check(view.getUint32(localOffset, true) === 0x04034b50, 'local header');
    check(view.getUint16(localOffset + 8, true) === 0, 'stored');
    check(view.getUint32(localOffset + 14, true) === crc, 'local crc');
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    entries.push({
      name,
      crc,
      data: zip.subarray(dataStart, dataStart + size),
    });
    at += 46 + nameLength;
  }
  check(at - centralOffset === centralSize, 'central size');
  return entries;
}
