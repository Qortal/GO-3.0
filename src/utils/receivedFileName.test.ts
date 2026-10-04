import { describe, expect, it } from 'vitest';
import {
  cleanFileName,
  fileExtensionLabel,
  MAX_FILE_NAME_LENGTH,
  splitFileNameForDisplay,
} from './receivedFileName';

const RLO = '\u202E';

// N-27: a sender picks the name of every file it sends.
describe('cleanFileName', () => {
  it('removes a right-to-left override, so the real extension shows', () => {
    expect(cleanFileName(`holiday${RLO}gpj.apk`)).toBe('holidaygpj.apk');
    expect(fileExtensionLabel(`holiday${RLO}gpj.apk`)).toBe('APK');
  });

  it('removes other bidi, zero-width and control characters', () => {
    expect(cleanFileName('in\u2066voice\u2069.pdf')).toBe('invoice.pdf');
    expect(cleanFileName('GO.a\u200Bpk')).toBe('GO.apk');
    expect(cleanFileName('a\u200Fb\u200Ec.txt')).toBe('abc.txt');
    expect(cleanFileName('line\nbreak\u0000.txt')).toBe('linebreak.txt');
    expect(cleanFileName('para\u2029graph\u2028.md')).toBe('paragraph.md');
    expect(cleanFileName('bom\uFEFF.txt')).toBe('bom.txt');
  });

  it('removes a lone surrogate but keeps emoji and other scripts', () => {
    expect(cleanFileName('x\uD800y.txt')).toBe('xy.txt');
    expect(cleanFileName('фото 📷.jpg')).toBe('фото 📷.jpg');
    expect(cleanFileName('صورة.png')).toBe('صورة.png');
  });

  it('turns path separators and refused characters into "_"', () => {
    expect(cleanFileName('../../wallets.json')).toBe('_.._wallets.json');
    expect(cleanFileName('a/b\\c.txt')).toBe('a_b_c.txt');
    expect(cleanFileName('what?*:|"<>.txt')).toBe('what_______.txt');
  });

  it('drops leading dots and trailing dots and spaces', () => {
    expect(cleanFileName('.hidden')).toBe('hidden');
    expect(cleanFileName('photo.jpg. ')).toBe('photo.jpg');
    expect(cleanFileName('  spaced.txt  ')).toBe('spaced.txt');
    expect(cleanFileName('...')).toBe('');
  });

  it('is empty for nothing, so the caller picks its own fallback', () => {
    expect(cleanFileName(undefined)).toBe('');
    expect(cleanFileName(null)).toBe('');
    expect(cleanFileName('')).toBe('');
    expect(cleanFileName(`${RLO}\u200B`)).toBe('');
  });

  it('shortens a long name and keeps its extension', () => {
    const cleaned = cleanFileName(`${'a'.repeat(400)}.pdf`);
    expect(cleaned).toHaveLength(MAX_FILE_NAME_LENGTH);
    expect(cleaned.endsWith('.pdf')).toBe(true);
  });

  it('never cuts an emoji in half when shortening', () => {
    const cleaned = cleanFileName(`${'a'.repeat(194)}📷📷📷.jpeg`);
    expect(cleaned).toBe(`${'a'.repeat(194)}.jpeg`);
    expect(cleaned.endsWith('.jpeg')).toBe(true);
    expect(cleaned).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('splitFileNameForDisplay', () => {
  it('splits the stem from the extension', () => {
    expect(splitFileNameForDisplay('report.final.pdf')).toEqual({
      stem: 'report.final',
      extension: '.pdf',
    });
  });

  it('shows no extension when there is none or it is not one', () => {
    expect(splitFileNameForDisplay('README')).toEqual({
      stem: 'README',
      extension: '',
    });
    expect(splitFileNameForDisplay('.env')).toEqual({
      stem: 'env',
      extension: '',
    });
    expect(
      splitFileNameForDisplay('a.thisisnotreallyanextension').extension
    ).toBe('');
  });

  it('splits the cleaned name, not the raw one', () => {
    expect(splitFileNameForDisplay(`holiday${RLO}gpj.apk`)).toEqual({
      stem: 'holidaygpj',
      extension: '.apk',
    });
  });

  it('labels the extension in capitals', () => {
    expect(fileExtensionLabel('photo.jpeg')).toBe('JPEG');
    expect(fileExtensionLabel('noext')).toBe('');
  });
});
