import { describe, expect, it } from 'vitest';
import {
  classifyFilePreview,
  decodeTextPreview,
  fileExtension,
  looksLikeText,
  mimeTypeForExternalOpen,
  resolveFileMimeType,
} from './reticulumFilePreview';
import {
  markdownAnchorSlug,
  renderMarkdownToSafeHtml,
} from './reticulumMarkdown';

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('classifyFilePreview', () => {
  it.each([
    ['report.md', 'application/octet-stream', 'markdown'],
    ['README.markdown', '', 'markdown'],
    ['notes.txt', 'text/plain', 'text'],
    ['data.json', '', 'text'],
    ['page.html', 'text/html', 'text'],
    ['photo.JPG', '', 'image'],
    ['logo.svg', '', 'image'],
    ['clip.mp4', 'application/octet-stream', 'video'],
    ['voice.m4a', '', 'audio'],
    ['book.pdf', '', 'pdf'],
    ['archive.zip', '', 'other'],
    ['app.apk', '', 'other'],
    ['letter.docx', '', 'other'],
    ['photo.heic', 'image/heic', 'other'],
  ])('%s (%s) -> %s', (fileName, mimeType, kind) => {
    expect(classifyFilePreview({ fileName, mimeType })).toBe(kind);
  });

  it('uses the declared type when the name has no extension', () => {
    expect(
      classifyFilePreview({ fileName: 'scan', mimeType: 'image/png' })
    ).toBe('image');
    expect(
      classifyFilePreview({ fileName: 'doc', mimeType: 'application/pdf' })
    ).toBe('pdf');
  });

  it('sniffs unknown extensions', () => {
    expect(
      classifyFilePreview({
        fileName: 'notes.xyz',
        head: utf8('plain words\n'),
      })
    ).toBe('text');
    expect(
      classifyFilePreview({
        fileName: 'blob.xyz',
        head: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x14]),
      })
    ).toBe('other');
  });

  it('lets the bytes overrule a declared text type', () => {
    expect(
      classifyFilePreview({
        fileName: 'mystery.dat',
        mimeType: 'text/plain',
        head: new Uint8Array([0, 1, 2, 3, 0xff, 0xfe, 0, 7]),
      })
    ).toBe('other');
    expect(
      classifyFilePreview({ fileName: 'notes', mimeType: 'text/plain' })
    ).toBe('text');
  });

  it('never sniffs known binary containers as text', () => {
    expect(
      classifyFilePreview({ fileName: 'x.zip', head: utf8('looks like text') })
    ).toBe('other');
  });
});

describe('looksLikeText', () => {
  it('accepts UTF-8 cut in the middle of a character', () => {
    const bytes = utf8('héllo wörld ✓');
    expect(looksLikeText(bytes.subarray(0, bytes.length - 1))).toBe(true);
  });

  it('rejects NUL bytes and invalid UTF-8', () => {
    expect(looksLikeText(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0x61, 0xff, 0xfe, 0x62]))).toBe(false);
  });
});

describe('mime helpers', () => {
  it('prefers a specific declared type and falls back to the extension', () => {
    expect(resolveFileMimeType('a.bin', 'image/png; charset=binary')).toBe(
      'image/png'
    );
    expect(resolveFileMimeType('a.webm', 'application/octet-stream')).toBe(
      'video/webm'
    );
    expect(resolveFileMimeType('a.unknown', '')).toBe(
      'application/octet-stream'
    );
  });

  it('hands text-like files to other apps as text/plain', () => {
    expect(mimeTypeForExternalOpen('report.md')).toBe('text/plain');
    expect(mimeTypeForExternalOpen('a.csv')).toBe('text/plain');
    expect(mimeTypeForExternalOpen('a.html')).toBe('text/html');
    expect(mimeTypeForExternalOpen('a.pdf')).toBe('application/pdf');
  });

  it('reads extensions from paths and well-known bare names', () => {
    expect(fileExtension('dir/Report.Final.MD')).toBe('md');
    expect(fileExtension('Dockerfile')).toBe('dockerfile');
    expect(fileExtension('noext')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
  });
});

describe('decodeTextPreview', () => {
  it('strips a BOM and reports truncation', () => {
    const bytes = utf8('\ufeffabcdef');
    expect(decodeTextPreview(bytes)).toEqual({
      text: 'abcdef',
      truncated: false,
    });
    expect(decodeTextPreview(bytes, 4)).toEqual({ text: 'a', truncated: true });
  });
});

describe('renderMarkdownToSafeHtml', () => {
  it('renders headings, emphasis, lists, code and tables', () => {
    const html = renderMarkdownToSafeHtml(
      [
        '# Title',
        '',
        'Some **bold** and `code`.',
        '',
        '- one',
        '- two',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
      ].join('\n')
    );
    expect(html).toContain('<h1 data-anchor="title">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table>');
  });

  it('escapes raw HTML and drops script-capable links', () => {
    const html = renderMarkdownToSafeHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });

  it('turns images into links instead of loading them', () => {
    const html = renderMarkdownToSafeHtml(
      '![tracker](https://example.com/p.gif)'
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://example.com/p.gif"');
    expect(html).toContain('>tracker</a>');
  });

  it('gives headings GitHub-style anchors, de-duplicated', () => {
    expect(markdownAnchorSlug('What users should do now')).toBe(
      'what-users-should-do-now'
    );
    expect(markdownAnchorSlug('1. What the blockchain shows')).toBe(
      '1-what-the-blockchain-shows'
    );
    const html = renderMarkdownToSafeHtml('## Same\n\n## Same');
    expect(html).toContain('data-anchor="same"');
    expect(html).toContain('data-anchor="same-1"');
  });
});
