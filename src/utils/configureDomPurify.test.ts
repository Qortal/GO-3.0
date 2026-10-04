import DOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';
import './configureDomPurify';

const sanitize = (
  html: string,
  config?: Parameters<typeof DOMPurify.sanitize>[1]
) => String(DOMPurify.sanitize(html, config));

const NODE_IMAGE = 'http://127.0.0.1:12391/arbitrary/IMAGE/alice/pic';
const TRACKER = 'https://tracker.example/pixel.gif?reader=alice';

describe('remote content hook', () => {
  it('turns an outside image into its URL as text', () => {
    const out = sanitize(`<p>hi<img src="${TRACKER}" alt="cat">there</p>`);

    expect(out).not.toContain('<img');
    expect(out).toContain(TRACKER.replace(/&/g, '&amp;'));
    expect(out).toMatch(/^<p>hi https:\/\/tracker\.example\/\S+ there<\/p>$/);
  });

  it('keeps images from the node and data: images', () => {
    const dataImage = 'data:image/png;base64,iVBORw0KGgo=';
    const out = sanitize(`<img src="${NODE_IMAGE}"><img src="${dataImage}">`);

    expect(out).toBe(`<img src="${NODE_IMAGE}"><img src="${dataImage}">`);
  });

  it.each(['HTTPS://TRACKER.EXAMPLE/pixel.gif', '//tracker.example/pixel.gif'])(
    'refuses %s',
    (src) => {
      expect(sanitize(`<img src="${src}">`)).not.toContain('<img');
    }
  );

  it('handles several outside images in a row', () => {
    const out = sanitize(
      `<img src="https://a.example/1.png"><img src="${NODE_IMAGE}"><img src="https://b.example/2.png">`
    );

    expect(out).toContain('https://a.example/1.png');
    expect(out).toContain('https://b.example/2.png');
    expect(out.match(/<img\b/g)).toHaveLength(1);
    expect(out).toContain(`src="${NODE_IMAGE}"`);
  });

  it('works with a restrictive config and inside links', () => {
    const out = sanitize(
      `<a href="https://x.example"><img src="${TRACKER}"></a>`,
      {
        ALLOWED_TAGS: ['a', 'img'],
        ALLOWED_ATTR: ['href', 'src'],
      }
    );

    expect(out).not.toContain('<img');
    expect(out).toContain('tracker.example');
  });

  it('drops outside srcset, poster and media sources', () => {
    const out = sanitize(
      `<img src="${NODE_IMAGE}" srcset="${TRACKER} 2x">` +
        `<video src="https://t.example/v.mp4" poster="https://t.example/p.png" controls></video>` +
        `<audio><source src="https://t.example/a.mp3"></audio>` +
        `<table background="https://t.example/bg.png"><tbody><tr><td>x</td></tr></tbody></table>`
    );

    expect(out).not.toContain('t.example');
    expect(out).not.toContain('srcset');
    expect(out).toContain(`src="${NODE_IMAGE}"`);
  });

  it('drops styles that fetch and keeps the rest', () => {
    const out = sanitize(
      '<p style="background:u\\72 l(https://t.example/x.png)">a</p>' +
        '<p style="color: rgb(10, 20, 30)">b</p>'
    );

    expect(out).not.toContain('t.example');
    expect(out).toContain('style="color: rgb(10, 20, 30)"');
  });

  it('drops outside SVG image references', () => {
    const out = sanitize(
      '<svg><image href="https://t.example/x.png"></image><image xlink:href="https://t.example/y.png"></image></svg>'
    );

    expect(out).not.toContain('t.example');
  });

  it('still adds noopener to links that open a new tab', () => {
    const out = sanitize('<a href="https://x.example" target="_blank">x</a>', {
      ADD_ATTR: ['target'],
    });

    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('drops HTML invoker commands, even in the default config', () => {
    const out = sanitize(
      '<button commandfor="settings" command="show-modal">tap</button>'
    );

    expect(out).toContain('<button>tap</button>');
    expect(out).not.toContain('commandfor');
    expect(out).not.toContain('command=');
  });
});
