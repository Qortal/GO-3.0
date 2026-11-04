import { describe, expect, it } from 'vitest';
import { readStoredZip } from '../../../test/readStoredZip';
import { buildStoredZip, crc32 } from './storedZip';

const text = (value: string) => new TextEncoder().encode(value);

describe('storedZip', () => {
  it('computes the CRC-32 a zip carries', () => {
    expect(crc32(text(''))).toBe(0);
    expect(crc32(text('hello'))).toBe(0x3610a686);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(
      0x414fa339
    );
  });

  it('keeps every file as it is, with its path and checksum', () => {
    const files = [
      { path: 'index.html', data: text('<!doctype html><p>hi</p>') },
      { path: 'assets/app-1.js', data: new Uint8Array([0, 255, 7, 128]) },
      { path: 'fonts/ünï.css', data: text('a{}') },
    ];
    const entries = readStoredZip(buildStoredZip(files));
    expect(entries.map((entry) => entry.name)).toEqual(
      files.map((file) => file.path)
    );
    entries.forEach((entry, i) => {
      expect([...entry.data]).toEqual([...files[i].data]);
      expect(entry.crc).toBe(crc32(files[i].data));
    });
  });

  it('makes an empty zip of no files', () => {
    const zip = buildStoredZip([]);
    expect(zip.length).toBe(22);
    expect(readStoredZip(zip)).toEqual([]);
  });
});
