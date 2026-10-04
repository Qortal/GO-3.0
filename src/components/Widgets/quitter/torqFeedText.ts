/**
 * Torq posts carry extra links for Quitter readers: the post's own Torq link
 * and `qortal://use-embed/...` links for GIFs and files. Torq hides them and
 * shows the GIF, file or poll instead (its stripQuitterCompatLinks), so the
 * Home feed does the same when it shows Torq.
 */
import { buildTorqPostLink } from './torqPublish';

const QORTAL_URL_RE = /qortal:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]]+$/;

const sameLink = (a: string, b: string) => {
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    return a === b;
  }
};

export function visibleTorqPostText(
  text: string,
  post: { author: string; identifier: string; hasAttachments?: boolean }
): string {
  const ownLink = buildTorqPostLink(post.author, post.identifier);
  const next = String(text || '').replace(QORTAL_URL_RE, (raw) => {
    const url = raw.replace(TRAILING_PUNCTUATION_RE, '');
    const tail = raw.slice(url.length);
    if (/^qortal:\/\/use-embed\//i.test(url)) return tail;
    if (sameLink(url, ownLink)) return tail;
    if (post.hasAttachments && /^qortal:\/\/APP\/Q-Share\/share\//i.test(url)) {
      return tail;
    }
    return raw;
  });
  return next
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
