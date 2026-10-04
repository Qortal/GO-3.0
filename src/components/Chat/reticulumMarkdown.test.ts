import { describe, expect, it } from 'vitest';
import { MARKDOWN_RENDER_MAX_BYTES } from './reticulumFilePreview';
import {
  markdownAnchorSlug,
  renderMarkdownToSafeHtml,
} from './reticulumMarkdown';

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body;

describe('renderMarkdownToSafeHtml', () => {
  it('renders headings with in-viewer anchors and no ids', () => {
    const html = renderMarkdownToSafeHtml('# What to do\n\n## What to do\n');

    expect(html).toContain('<h1 data-anchor="what-to-do">What to do</h1>');
    expect(html).toContain('<h2 data-anchor="what-to-do-1">What to do</h2>');
    expect(html).not.toContain(' id=');
  });

  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdownToSafeHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('turns images into plain links so nothing loads on open', () => {
    const html = renderMarkdownToSafeHtml(
      '![cat](https://tracker.example/pixel.gif)'
    );

    const link = parse(html).querySelector('a');

    expect(html).not.toContain('<img');
    expect(link?.getAttribute('href')).toBe(
      'https://tracker.example/pixel.gif'
    );
    expect(link?.getAttribute('data-image-link')).toBe('true');
    expect(link?.textContent).toBe('cat');
  });

  it('linkifies bare web addresses', () => {
    const html = renderMarkdownToSafeHtml('see https://example.org/page ok');

    expect(html).toContain(
      '<a href="https://example.org/page">https://example.org/page</a>'
    );
  });

  it('drops script links', () => {
    const html = renderMarkdownToSafeHtml('[x](javascript:alert(1))');

    expect(html).not.toContain('<a');
    expect(html).toContain('[x](javascript:alert(1))');
  });

  it('keeps the anchor slug readable', () => {
    expect(markdownAnchorSlug('  Hello, World! ')).toBe('hello-world');
  });
});

// GHSA-253c-mchw-3w2r: with linkify on, markdown-it before 14.3.1 spends
// quadratic time on these, so a received .md file froze the viewer (the
// first one took about 12 s on 14.1.0, and a 1 MB file several minutes).
describe('renderMarkdownToSafeHtml on crafted files', () => {
  const timed = (source: string) => {
    const started = performance.now();
    const html = renderMarkdownToSafeHtml(source);
    return { html, ms: performance.now() - started };
  };

  it('handles a run of unregistered schemes in linear time', () => {
    const { html, ms } = timed('a://'.repeat(70000));

    expect(html.startsWith('<p>a://')).toBe(true);
    expect(ms).toBeLessThan(3000);
  });

  it('handles many e-mail addresses on separate lines', () => {
    const { html, ms } = timed('ping a@b.co ok\n'.repeat(10000));

    expect(html).toContain('<a href="mailto:a@b.co">a@b.co</a>');
    expect(ms).toBeLessThan(3000);
  });

  it('handles the largest file the viewer will parse', () => {
    const unit = 'a://';
    const source = unit.repeat(
      Math.floor(MARKDOWN_RENDER_MAX_BYTES / unit.length)
    );
    const { ms } = timed(source);

    expect(ms).toBeLessThan(5000);
  });
});
