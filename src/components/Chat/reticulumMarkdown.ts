import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import '../../utils/configureDomPurify';

/**
 * Markdown → sanitized HTML for the in-app file viewer.
 *
 * Received files are untrusted, so: raw HTML in the source is escaped rather
 * than passed through (`html: false`), images become plain links (loading a
 * remote image would tell its host who opened the file), and the result still
 * goes through DOMPurify. Headings carry a `data-anchor` slug so in-document
 * links (`[see below](#what-to-do)`) can scroll inside the viewer; ids are
 * avoided because they would land in the app's own document.
 */

let parser: MarkdownIt | null = null;

export function markdownAnchorSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function getParser(): MarkdownIt {
  if (parser) return parser;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });

  md.core.ruler.push('heading_anchors', (state) => {
    const seen = new Map<string, number>();
    const { tokens } = state;
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const text = (inline?.children || [])
        .filter(
          (child) => child.type === 'text' || child.type === 'code_inline'
        )
        .map((child) => child.content)
        .join('');
      const base = markdownAnchorSlug(text);
      if (!base) continue;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      tokens[i].attrSet('data-anchor', count ? `${base}-${count}` : base);
    }
  });

  md.renderer.rules.image = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const alt =
      md.renderer.renderInlineAsText(token.children || [], md.options, env) ||
      src;
    return `<a href="${md.utils.escapeHtml(src)}" data-image-link="true">${md.utils.escapeHtml(alt)}</a>`;
  };

  parser = md;
  return md;
}

export function renderMarkdownToSafeHtml(source: string): string {
  const html = getParser().render(source);
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name'],
  });
}
