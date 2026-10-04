import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inlineResizeImageIcons,
  inlineResizeImageIconsPlugin,
} from './inlineResizeImageIcons';

const packageFile = (relative: string) =>
  resolve(
    __dirname,
    '../../node_modules/tiptap-extension-resize-image',
    relative
  );

const transform = (code: string, id: string) =>
  (
    inlineResizeImageIconsPlugin().transform as (
      code: string,
      id: string
    ) => { code: string } | null
  )(code, id);

describe('inlineResizeImageIcons', () => {
  it.each(['esm/index.js', 'dist/index.js'])(
    'leaves no Google URL in the installed %s',
    (relative) => {
      const original = readFileSync(packageFile(relative), 'utf8');
      const out = inlineResizeImageIcons(original);

      expect(out).not.toMatch(/https?:\/\/fonts\.(gstatic|googleapis)\.com/);
      const icons = out.match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g);
      // 1.1.x sets the three alignment icons by URL; 1.4+ already inlines them.
      expect(icons?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(out.split('\n').length).toBe(original.split('\n').length);
    }
  );

  it('swaps each alignment icon for its own inline SVG', () => {
    const code = ['left', 'center', 'right']
      .map(
        (side) =>
          `img.setAttribute('src', 'https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/format_align_${side}/default/20px.svg');`
      )
      .join('\n');

    const svgs = [
      ...inlineResizeImageIcons(code).matchAll(
        /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g
      ),
    ].map((m) => atob(m[1]));

    expect(svgs).toHaveLength(3);
    expect(new Set(svgs).size).toBe(3);
    for (const svg of svgs) {
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).toMatch(/<path d="M[^"]+"\/><\/svg>$/);
    }
  });

  it('refuses a Google Fonts URL it does not know how to inline', () => {
    expect(() =>
      inlineResizeImageIcons(
        "img.src = 'https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/delete/default/20px.svg';"
      )
    ).toThrow(/Google Fonts/);
  });

  it('only transforms the resize-image package', () => {
    const code =
      "x = 'https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/format_align_left/default/20px.svg';";

    expect(transform(code, '/app/src/components/Chat/TipTap.tsx')).toBeNull();
    expect(
      transform(
        code,
        '/app/node_modules/tiptap-extension-resize-image/esm/index.js'
      )?.code
    ).toContain('data:image/svg+xml;base64,');
  });
});
