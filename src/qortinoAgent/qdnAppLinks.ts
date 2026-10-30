/**
 * MA Helper–style QDN deep links + activity classification for Qortino.
 * Mirrors `/MA-Helper/src/lib/portfolio.ts` `classifyResource` + `buildPortfolioAppLink`.
 */
import { executeEvent } from '../utils/events';
import { extractComponents } from '../components/Chat/MessageDisplay';
import { parkQortinoAgentSheet } from './qortinoSheetNav';

export type QdnActivityKind =
  | 'qtube_video'
  | 'qtube_playlist'
  | 'qtube_like'
  | 'qtube_superlike'
  | 'qtube_comment'
  | 'quitter_post'
  | 'quitter_reply'
  | 'quitter_repost'
  | 'quitter_like'
  | 'quitter_follow'
  | 'qblog_post'
  | 'qshare_file'
  | 'subwire_article'
  | 'subwire_episode'
  | 'qmusic_song'
  | 'qmusic_playlist'
  | 'earbump_playlist'
  | 'earbump_song'
  | 'qmail'
  | 'qchat'
  | 'qfund'
  | 'qshop'
  | 'qshops'
  | 'pdf'
  | 'file'
  | 'image'
  | 'website'
  | 'app'
  | 'metadata'
  | 'other';

export type QdnActivityInfo = {
  kind: QdnActivityKind;
  /** Short human label, e.g. "Q-Tube video" / "Quitter like" */
  label: string;
  /** True when this is a social reaction / aux row, not a primary publish */
  isAux: boolean;
  /** Preferred Hub deep link, or null if not openable in-app */
  link: string | null;
  /** Friendly open label when link is set */
  openLabel: string | null;
};

const QUITTER_ID = {
  APP_HASH: 'MhNiRYdzkaP9dz',
  POST: 'kX47dT',
  REPLY: 'Tj2WBN',
  REPOST: 'cEWGCt',
  REPLY_PRIVATE: 'PtbkAL',
  GROUP_PRIVATE: 'jgoEjJ',
  LIKE_PREFIX: 'x9qg7nNIUHvVit',
  FOLLOW_PREFIX: 'gY.TWOeB25Co.7',
} as const;

const SUBWIRE_ID = {
  APP_HASH: '7l1NGsWiY0SgPb',
  ARTICLE: 'FJVWQM',
  EPISODE: 'eEGFM7',
} as const;

const QTUBE_VIDEO_PREFIX = 'qtube_vid_';
const QTUBE_PLAYLIST_PREFIX = 'qtube_playlist_';
const QSHARE_FILE_PREFIX = 'qshare_file_';
const QSHARE_FILE_BINARY_SUFFIX = /_f_[a-f0-9]+$/i;
const ENJOYMUSIC_SONG_PREFIX = 'enjoymusic_song_';
const ENJOYMUSIC_PLAYLIST_PREFIX = 'enjoymusic_playlist_';
const EARBUMP_SONG_PREFIX = 'earbump_song_';
const EARBUMP_PLAYLIST_PREFIX = 'earbump_playlist_';

function qAppLink(appName: string, ...pathSegments: string[]): string {
  const segs = pathSegments.filter(Boolean).map((s) => encodeURIComponent(s));
  return segs.length
    ? `qortal://APP/${encodeURIComponent(appName)}/${segs.join('/')}`
    : `qortal://APP/${encodeURIComponent(appName)}`;
}

function qappCoreParts(identifier: string): string[] | null {
  const id = identifier.trim();
  if (!id.endsWith('-v1')) return null;
  return id.split('-');
}

function qShareMetadataLinkId(identifier: string): string {
  let id = (identifier || '').trim();
  if (!id || !id.toLowerCase().startsWith(QSHARE_FILE_PREFIX)) return id;
  if (id.endsWith('_metadata')) return id;
  id = id.replace(QSHARE_FILE_BINARY_SUFFIX, '');
  return `${id}_metadata`;
}

function qTubeRouteId(service: string, identifier: string): string {
  const id = (identifier || '').trim();
  const svc = (service || '').trim().toUpperCase();
  if (!id) return id;
  if (id.toLowerCase().startsWith(QTUBE_PLAYLIST_PREFIX)) return id;
  if (id.endsWith('_metadata')) return id;
  if (
    svc === 'VIDEO' ||
    svc === 'VIDEO_PRIVATE' ||
    svc === 'PODCAST' ||
    id.startsWith(QTUBE_VIDEO_PREFIX) ||
    id.toLowerCase().startsWith('qtube_')
  ) {
    return `${id}_metadata`;
  }
  return id;
}

function qBlogRemovePrefix(id: string): string {
  const s = (id || '').trim();
  return s.toLowerCase().startsWith('q-blog-') ? s.slice(7) : s;
}

function qBlogPostParts(
  identifier: string
): { blogHandle: string; postSlug: string } | null {
  const raw = (identifier || '').trim();
  const dash = raw.toLowerCase().indexOf('-post-');
  if (dash < 0) return null;
  const blogId = raw.slice(0, dash).trim();
  const postSlug = raw.slice(dash + 6).trim();
  if (!blogId || !postSlug) return null;
  return { blogHandle: qBlogRemovePrefix(blogId), postSlug };
}

function isQuitterLikeOrFollow(identifier: string): boolean {
  const id = identifier.trim();
  if (!id) return false;
  if (
    id.startsWith(QUITTER_ID.LIKE_PREFIX) ||
    id.startsWith(QUITTER_ID.FOLLOW_PREFIX)
  ) {
    return true;
  }
  if (!id.includes('-') && id.length >= 24 && id.length <= 36) return true;
  return false;
}

function isQShopsOrderIdentifier(identifier: string): boolean {
  return (identifier || '').trim().toLowerCase().startsWith('q-store-order-');
}

function isQwbQshopsIdentifier(identifier: string): boolean {
  const id = (identifier || '').trim().toLowerCase();
  if (!id) return false;
  if (id.startsWith('.__qwb__/qshops')) return true;
  if (
    id.includes('qshops-mirror') ||
    id.includes('qshops-catalog-feed') ||
    id.includes('qshops-directory-snapshot')
  ) {
    return true;
  }
  return false;
}

function isQShopIdentifier(identifier: string): boolean {
  const id = (identifier || '').trim().toLowerCase();
  if (isQShopsOrderIdentifier(identifier)) return false;
  return id.startsWith('q-store');
}

function isQShopsIdentifier(identifier: string): boolean {
  const id = (identifier || '').trim().toLowerCase();
  if (id.startsWith('rmt-shop')) return true;
  if (isQShopsOrderIdentifier(identifier)) return true;
  if (isQwbQshopsIdentifier(identifier)) return true;
  if (id.startsWith('qshops') || id.includes('qshops-') || id.includes('qshops_')) {
    return true;
  }
  return false;
}

function isQShopsHashProductIdentifier(
  service: string,
  identifier: string
): boolean {
  const svc = (service || '').toUpperCase();
  if (!['PRODUCT', 'OFFER', 'COUPON'].includes(svc)) return false;
  const id = (identifier || '').trim();
  if (!id || isQShopIdentifier(id) || isQShopsIdentifier(id)) return false;
  return id.startsWith('dTX') || id.startsWith('5f4');
}

function classifyQuitter(
  service: string,
  identifier: string
): QdnActivityKind | null {
  const svc = (service || '').toUpperCase();
  if (svc !== 'DOCUMENT' && svc !== 'DOCUMENT_PRIVATE' && svc !== 'CHAIN_COMMENT') {
    return null;
  }
  const id = identifier.trim();
  if (!id) return null;
  if (id.toLowerCase().includes('_metadata')) return 'metadata';
  if (isQuitterLikeOrFollow(id)) {
    if (id.startsWith(QUITTER_ID.FOLLOW_PREFIX)) return 'quitter_follow';
    return 'quitter_like';
  }
  if (/^quitter[_-]/i.test(id)) {
    const lower = id.toLowerCase();
    if (lower.includes('like')) return 'quitter_like';
    if (lower.includes('follow')) return 'quitter_follow';
    if (lower.includes('reply')) return 'quitter_reply';
    return 'quitter_post';
  }
  const parts = qappCoreParts(id);
  if (!parts || parts[0] !== QUITTER_ID.APP_HASH) return null;
  if (parts[1] === QUITTER_ID.REPLY || parts[1] === QUITTER_ID.REPLY_PRIVATE) {
    return 'quitter_reply';
  }
  if (parts[1] === QUITTER_ID.REPOST) return 'quitter_repost';
  if (parts[1] === QUITTER_ID.POST) return 'quitter_post';
  if (parts[1] === QUITTER_ID.GROUP_PRIVATE) return 'quitter_post';
  return null;
}

function classifyQTube(
  service: string,
  identifier: string
): QdnActivityKind | null {
  const id = (identifier || '').trim().toLowerCase();
  const svc = (service || '').toUpperCase();
  const looksQTube =
    id.includes('qtube') ||
    svc === 'VIDEO' ||
    svc === 'VIDEO_PRIVATE' ||
    svc === 'PODCAST' ||
    (svc === 'PLAYLIST' && id.startsWith(QTUBE_PLAYLIST_PREFIX));
  if (!looksQTube) return null;

  if (id.startsWith('qtube_like_')) return 'qtube_like';
  if (id.startsWith('qtube_superlike_') || id.includes('qtube_sl')) {
    return 'qtube_superlike';
  }
  if (id.includes('_cm_') || id.startsWith('qc_v1_qtube_')) return 'qtube_comment';
  if (
    id.includes('_metadata') &&
    !id.startsWith(QTUBE_PLAYLIST_PREFIX) &&
    svc !== 'PLAYLIST'
  ) {
    return 'metadata';
  }
  if (
    id.startsWith(QTUBE_PLAYLIST_PREFIX) ||
    (svc === 'PLAYLIST' && id.includes('qtube'))
  ) {
    if (id.includes('_cm_')) return 'qtube_comment';
    return 'qtube_playlist';
  }
  if (
    svc === 'VIDEO' ||
    svc === 'VIDEO_PRIVATE' ||
    svc === 'PODCAST' ||
    id.startsWith(QTUBE_VIDEO_PREFIX) ||
    (id.startsWith('qtube_') && !id.includes('_metadata'))
  ) {
    return 'qtube_video';
  }
  return null;
}

function classifySubwire(identifier: string): QdnActivityKind | null {
  const id = (identifier || '').trim();
  const lower = id.toLowerCase();
  if (lower.startsWith('subwire') || lower.includes('subwire_')) {
    return 'subwire_article';
  }
  if (lower === 'list_articles_feed' || lower.includes('list_articles_feed')) {
    return 'metadata';
  }
  const parts = qappCoreParts(id);
  if (!parts || parts[0] !== SUBWIRE_ID.APP_HASH) return null;
  if (parts[1] === SUBWIRE_ID.EPISODE) return 'subwire_episode';
  if (parts[1] === SUBWIRE_ID.ARTICLE) return 'subwire_article';
  return 'subwire_article';
}

const LABELS: Record<QdnActivityKind, string> = {
  qtube_video: 'Q-Tube video',
  qtube_playlist: 'Q-Tube playlist',
  qtube_like: 'Q-Tube like',
  qtube_superlike: 'Q-Tube superlike',
  qtube_comment: 'Q-Tube comment',
  quitter_post: 'Quitter post',
  quitter_reply: 'Quitter reply',
  quitter_repost: 'Quitter repost',
  quitter_like: 'Quitter like',
  quitter_follow: 'Quitter follow',
  qblog_post: 'Q-Blog post',
  qshare_file: 'Q-Share file',
  subwire_article: 'Subwire article',
  subwire_episode: 'Subwire episode',
  qmusic_song: 'Q-Music song',
  qmusic_playlist: 'Q-Music playlist',
  earbump_playlist: 'Ear-Bump playlist',
  earbump_song: 'Ear-Bump track',
  qmail: 'Q-Mail message',
  qchat: 'Q-Chat message',
  qfund: 'Q-Fund item',
  qshop: 'Q-Shop item',
  qshops: 'Q-Shops item',
  pdf: 'PDF',
  file: 'File',
  image: 'Image / thumbnail',
  website: 'Website',
  app: 'Q-App',
  metadata: 'Metadata',
  other: 'QDN resource',
};

const AUX_KINDS = new Set<QdnActivityKind>([
  'qtube_like',
  'qtube_superlike',
  'qtube_comment',
  'quitter_like',
  'quitter_follow',
  'quitter_reply',
  'quitter_repost',
  'earbump_song', // MA Helper: songs have no deep link
  'qmail', // preview-only in MA Helper
  'qshops', // app-root only — no per-item deep link
  'metadata',
  'image',
]);

/** Classify a QDN resource row (publish vs like/reply/etc.). */
export function classifyQdnActivity(
  service: string,
  identifier: string,
  publisher?: string
): QdnActivityInfo {
  const svc = (service || '').toUpperCase();
  const id = (identifier || '').trim();
  const idLower = id.toLowerCase();
  const pub = (publisher || '').trim();

  // Prefix / fingerprint matches (same priority as MA Helper classifyResource)
  const subwire = classifySubwire(id);
  if (subwire && (qappCoreParts(id)?.[0] === SUBWIRE_ID.APP_HASH || idLower.includes('subwire'))) {
    return finalize(subwire, svc, id, pub);
  }

  const quitter = classifyQuitter(service, id);
  if (quitter) return finalize(quitter, svc, id, pub);

  const qtube = classifyQTube(service, id);
  if (qtube) return finalize(qtube, svc, id, pub);

  if (
    idLower.startsWith(ENJOYMUSIC_PLAYLIST_PREFIX) ||
    (svc === 'PLAYLIST' && idLower.startsWith('enjoymusic'))
  ) {
    return finalize('qmusic_playlist', svc, id, pub);
  }
  if (
    idLower.startsWith(ENJOYMUSIC_SONG_PREFIX) ||
    idLower.startsWith('enjoymusic')
  ) {
    return finalize('qmusic_song', svc, id, pub);
  }

  if (
    idLower.startsWith(EARBUMP_PLAYLIST_PREFIX) ||
    (svc === 'PLAYLIST' && idLower.includes('earbump'))
  ) {
    return finalize('earbump_playlist', svc, id, pub);
  }
  if (
    idLower.startsWith(EARBUMP_SONG_PREFIX) ||
    idLower.startsWith('earbump') ||
    idLower.startsWith('ear-bump')
  ) {
    return finalize('earbump_song', svc, id, pub);
  }

  if (
    svc === 'BLOG_POST' ||
    svc === 'BLOG' ||
    svc === 'BLOG_COMMENT' ||
    idLower.startsWith('qblog') ||
    idLower.startsWith('q-blog') ||
    idLower.includes('-post-') ||
    idLower.includes('_post_') ||
    idLower.includes('qblog')
  ) {
    if (idLower.startsWith('idx-') || idLower.startsWith('idx_')) {
      return finalize('metadata', svc, id, pub);
    }
    if (idLower.includes('_profile')) return finalize('metadata', svc, id, pub);
    return finalize('qblog_post', svc, id, pub);
  }

  if (
    idLower.startsWith(QSHARE_FILE_PREFIX) ||
    idLower.startsWith('qshare') ||
    idLower.startsWith('qfile') ||
    idLower.startsWith('q-share')
  ) {
    if (idLower.includes('_like_') || idLower.startsWith('qshare_like')) {
      return finalize('metadata', svc, id, pub);
    }
    return finalize('qshare_file', svc, id, pub);
  }

  if (
    idLower.startsWith('_mail_') ||
    idLower.startsWith('qmail') ||
    idLower.includes('qortal_qmail') ||
    idLower.includes('_qmail_') ||
    idLower.includes('q-mail') ||
    svc === 'MAIL_PRIVATE' ||
    svc === 'MESSAGE_PRIVATE'
  ) {
    return finalize('qmail', svc, id, pub);
  }

  if (idLower.startsWith('qfund')) {
    return finalize('qfund', svc, id, pub);
  }

  if (idLower.startsWith('qchat') || svc.startsWith('QCHAT')) {
    return finalize('qchat', svc, id, pub);
  }

  if (isQShopsIdentifier(id) || isQShopsHashProductIdentifier(svc, id)) {
    return finalize('qshops', svc, id, pub);
  }
  if (isQShopIdentifier(id)) {
    return finalize('qshop', svc, id, pub);
  }
  if (['STORE', 'PRODUCT', 'OFFER', 'COUPON'].includes(svc)) {
    return finalize(
      isQShopIdentifier(id) ? 'qshop' : 'qshops',
      svc,
      id,
      pub
    );
  }

  if (svc === 'WEBSITE') return finalize('website', svc, id, pub);
  if (svc === 'APP') return finalize('app', svc, id, pub);

  if (
    svc === 'AUDIO' ||
    svc === 'AUDIO_PRIVATE' ||
    svc === 'VOICE' ||
    svc === 'VOICE_PRIVATE'
  ) {
    return finalize('other', svc, id, pub);
  }

  if (svc === 'PDF' || idLower.endsWith('.pdf')) {
    return finalize('pdf', svc, id, pub);
  }
  if (
    svc === 'IMAGE' ||
    svc === 'THUMBNAIL' ||
    svc === 'IMAGE_PRIVATE' ||
    svc === 'GIF_REPOSITORY'
  ) {
    return finalize('image', svc, id, pub);
  }
  if (svc === 'METADATA' || idLower.includes('_metadata')) {
    return finalize('metadata', svc, id, pub);
  }
  if (
    ['FILE', 'FILES', 'ATTACHMENT', 'ATTACHMENT_PRIVATE', 'FILE_PRIVATE'].includes(
      svc
    )
  ) {
    return finalize('file', svc, id, pub);
  }

  // MA Helper: opaque DOCUMENT rows default toward Quitter — we only do that
  // when fingerprint matched above. Remaining docs stay "other".
  return finalize('other', svc, id, pub);
}

function finalize(
  kind: QdnActivityKind,
  service: string,
  identifier: string,
  publisher: string
): QdnActivityInfo {
  const link = publisher
    ? buildQdnAppLink(publisher, service, identifier, kind)
    : null;
  return {
    kind,
    label: LABELS[kind],
    isAux: AUX_KINDS.has(kind),
    link,
    openLabel: link ? openLabelFor(kind) : null,
  };
}

function openLabelFor(kind: QdnActivityKind): string {
  switch (kind) {
    case 'qtube_video':
    case 'qtube_playlist':
      return 'Open in Q-Tube';
    case 'quitter_post':
      return 'Open in Quitter';
    case 'qblog_post':
      return 'Open in Q-Blog';
    case 'qshare_file':
      return 'Open in Q-Share';
    case 'subwire_article':
    case 'subwire_episode':
      return 'Open in Subwire';
    case 'qmusic_song':
    case 'qmusic_playlist':
      return 'Open in Q-Music';
    case 'earbump_playlist':
      return 'Open in Ear-Bump';
    case 'qchat':
      return 'Open in Q-Chat';
    case 'qfund':
      return 'Open in Q-Fund';
    case 'qshop':
      return 'Open in Q-Shop';
    case 'qshops':
      return 'Open Q-Shops';
    case 'file':
    case 'pdf':
      return 'Open in Q-Manager';
    case 'website':
      return 'Open website';
    case 'app':
      return 'Open Q-App';
    default:
      return 'Open';
  }
}

/**
 * Build a Hub deep link that opens content inside the publishing Q-App
 * (same shapes as MA Helper `buildPortfolioAppLink`).
 */
export function buildQdnAppLink(
  publisher: string,
  service: string,
  identifier: string,
  kindHint?: QdnActivityKind
): string | null {
  const pub = publisher.trim();
  const id = (identifier || '').trim();
  if (!pub) return null;

  const kind =
    kindHint ||
    classifyQdnActivity(service, identifier).kind;

  switch (kind) {
    case 'quitter_post':
      return qAppLink('Quitter', 'post', pub, id);

    case 'qtube_video':
      return qAppLink('Q-Tube', 'video', pub, qTubeRouteId(service, id));

    case 'qtube_playlist':
      return qAppLink('Q-Tube', 'playlist', pub, qTubeRouteId(service, id));

    case 'qblog_post': {
      const parts = qBlogPostParts(id);
      if (parts) {
        return qAppLink('Q-Blog', pub, parts.blogHandle, parts.postSlug);
      }
      if (id.includes('-post-')) {
        const dash = id.toLowerCase().indexOf('-post-');
        const blogHandle = qBlogRemovePrefix(id.slice(0, dash));
        const postSlug = id.slice(dash + 6);
        if (blogHandle && postSlug) {
          return qAppLink('Q-Blog', pub, blogHandle, postSlug);
        }
      }
      return qAppLink('Q-Blog', pub, qBlogRemovePrefix(id));
    }

    case 'qshare_file':
      return qAppLink('Q-Share', 'share', pub, qShareMetadataLinkId(id));

    case 'subwire_article':
    case 'subwire_episode':
      return qAppLink('Subwire', 'article', pub, id);

    case 'qmusic_playlist':
      return qAppLink('Q-Music', 'playlists', pub, id);

    case 'qmusic_song':
      return qAppLink('Q-Music', 'songs', pub, id);

    case 'earbump_playlist':
      return qAppLink('Ear-Bump', 'playlists', pub, id);

    case 'earbump_song':
      // MA Helper: Ear-Bump song ids return null (no in-app song route)
      return null;

    case 'qchat':
      if (!id || id === 'default') return qAppLink('Q-Chat');
      return qAppLink('Q-Chat', 'message', pub, id);

    case 'qfund':
      if (!id || id === 'default') return qAppLink('Q-Fund');
      return qAppLink('Q-Fund', pub, id);

    case 'qshop':
      if (!id || id === 'default') return qAppLink('Q-Shop');
      return qAppLink('Q-Shop', pub, id);

    case 'qshops':
      // MA Helper: Q-Shops has no per-item deep links
      return qAppLink('Q-Shops');

    case 'qmail':
      // MA Helper: preview-only — no Hub deep link per message
      return null;

    case 'website':
      return `qortal://WEBSITE/${encodeURIComponent(pub)}`;

    case 'app':
      return `qortal://APP/${encodeURIComponent(pub)}`;

    case 'file':
    case 'pdf':
      if (!id || id === 'default') return qAppLink('Q-Manager');
      return qAppLink('Q-Manager', 'file', pub, id);

    default:
      return null;
  }
}

/** Open a full `qortal://…` link in a new Hub/Go tab (APP paths supported). */
export function openQortalDeepLink(link: string): void {
  const url = link.trim().replace(/[.,;:!?)+]+$/, '');
  if (!url.toLowerCase().startsWith('qortal://')) return;
  parkQortinoAgentSheet();
  // extractComponents checks the link (GO-21) and returns the name already
  // decoded; decoding it again would turn "%252e%252e" into "%2e%2e".
  const res = extractComponents(url);
  if (!res) return;
  const name = res.name || '';
  executeEvent('addTab', {
    data: {
      service: res.service,
      name,
      identifier: res.identifier,
      path: res.path || '',
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
}

/** Compact id for display (small font) — never the main answer. */
export function shortResourceId(identifier: string, max = 36): string {
  const id = (identifier || '').trim();
  if (!id || id === 'default') return '';
  if (id.length <= max) return id;
  return `${id.slice(0, max - 1)}…`;
}

/** One line for LLM notes / user-facing day-publish lists. */
export function formatQdnResourceLine(opts: {
  index?: number;
  name: string;
  service: string;
  identifier: string;
  title?: string;
  when?: string;
}): string {
  const activity = classifyQdnActivity(
    opts.service,
    opts.identifier,
    opts.name
  );
  const title =
    opts.title?.trim() &&
    opts.title.trim().toLowerCase() !== opts.identifier.toLowerCase()
      ? opts.title.trim()
      : activity.label;
  const when = opts.when ? ` · ${opts.when}` : '';
  const aux = activity.isAux ? ' (reaction / aux — not a new publish)' : '';
  const prefix = typeof opts.index === 'number' ? `${opts.index}. ` : '';
  const linkPart = activity.link
    ? ` [${activity.openLabel || 'Open'}](${activity.link})`
    : '';
  const hash = shortResourceId(opts.identifier);
  const hashPart = hash ? ` \`${hash}\`` : '';
  return `${prefix}**${activity.label}** — ${title}${when}${aux}${linkPart}${hashPart}`;
}

/** Prefer APP deep link for share/copy; fall back to raw service URL. */
export function preferredQortalLink(item: {
  name: string;
  service: string;
  identifier: string;
}): string {
  return (
    buildQdnAppLink(item.name, item.service, item.identifier) ||
    `qortal://${item.service}/${item.name}/${item.identifier}`
  );
}
