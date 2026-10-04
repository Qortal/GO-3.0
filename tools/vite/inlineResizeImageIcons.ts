import type { Plugin } from 'vite';

/**
 * tiptap-extension-resize-image (before 1.4.0) draws its image-alignment
 * toolbar with three <img> icons loaded from fonts.gstatic.com, so selecting an
 * image in the editor sent the user's IP address to Google. 1.4.0 inlines the
 * icons but is a full rewrite of the extension, so we keep 1.1.8 and swap the
 * URLs for the same inline icons at build time (and in the dev server).
 */

const PACKAGE_DIR = '/node_modules/tiptap-extension-resize-image/';

// Material Symbols Outlined "format_align_*" (20px) — the icons upstream
// inlined in 1.4.0.
const ALIGN_ICON_PATHS: Record<string, string> = {
  left: 'M144-144v-72h672v72H144Zm0-150v-72h480v72H144Zm0-150v-72h672v72H144Zm0-150v-72h480v72H144Zm0-150v-72h672v72H144Z',
  center:
    'M144-144v-72h672v72H144Zm144-150v-72h384v72H288ZM144-444v-72h672v72H144Zm144-150v-72h384v72H288ZM144-744v-72h672v72H144Z',
  right:
    'M144-744v-72h672v72H144Zm192 150v-72h480v72H336ZM144-444v-72h672v72H144Zm192 150v-72h480v72H336ZM144-144v-72h672v72H144Z',
};

const GSTATIC_ALIGN_ICON =
  /https:\/\/fonts\.gstatic\.com\/s\/i\/short-term\/release\/materialsymbolsoutlined\/format_align_(left|center|right)\/default\/20px\.svg/g;

const GOOGLE_FONTS_URL = /https?:\/\/fonts\.(gstatic|googleapis)\.com/;

const alignIconDataUrl = (side: string): string =>
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20">' +
      `<path d="${ALIGN_ICON_PATHS[side]}"/></svg>`
  );

/**
 * Replaces the extension's Google-hosted alignment icons with inline SVGs.
 * Throws if any other Google Fonts URL is left, so a package update cannot
 * quietly bring a request to Google back.
 */
export function inlineResizeImageIcons(code: string): string {
  const out = code.replace(GSTATIC_ALIGN_ICON, (_url, side: string) =>
    alignIconDataUrl(side)
  );
  if (GOOGLE_FONTS_URL.test(out)) {
    throw new Error(
      'tiptap-extension-resize-image loads a file from Google Fonts that ' +
        'tools/vite/inlineResizeImageIcons.ts does not inline'
    );
  }
  return out;
}

export function inlineResizeImageIconsPlugin(): Plugin {
  return {
    name: 'inline-resize-image-icons',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes(PACKAGE_DIR)) return null;
      // Only string contents change, never line breaks, so the existing
      // sourcemap stays valid.
      return { code: inlineResizeImageIcons(code), map: null };
    },
  };
}
