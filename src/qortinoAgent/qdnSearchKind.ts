/**
 * QDN search-engine kind chips for Qortino QDN mode.
 * Single-select: All (default) | Users | Videos | Images | Audio | Documents.
 */
import type { QdnMediaKind } from './qdnMedia';
import type { TopicMediaIntent } from './qdnTopicMedia';

export type QdnSearchKind =
  | 'all'
  | 'users'
  | 'videos'
  | 'images'
  | 'audio'
  | 'documents';

export const QDN_SEARCH_KIND_OPTIONS: ReadonlyArray<{
  id: QdnSearchKind;
  label: string;
  hint: string;
}> = [
  { id: 'all', label: 'All', hint: 'General QDN search' },
  { id: 'users', label: 'Users', hint: 'Registered names / people' },
  { id: 'videos', label: 'Videos', hint: 'VIDEO / Q-Tube' },
  { id: 'images', label: 'Images', hint: 'IMAGE resources' },
  { id: 'audio', label: 'Audio', hint: 'AUDIO / music' },
  {
    id: 'documents',
    label: 'Documents',
    hint: 'DOCUMENT, blog posts, and files',
  },
];

const FORCE_STOP = new Set([
  'a',
  'an',
  'the',
  'me',
  'my',
  'some',
  'any',
  'all',
  'please',
  'show',
  'find',
  'get',
  'list',
  'browse',
  'search',
  'look',
  'looking',
  'want',
  'need',
  'qdn',
  // Keep "qortal" — part of registered names ("Qortal Justin").
  'for',
  'of',
  'about',
  'on',
  'with',
  'by',
  'from',
  'in',
  'to',
  'and',
  'or',
  'what',
  'who',
  'where',
  'when',
  'why',
  'how',
  'is',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'i',
  'you',
  'we',
  'images',
  'image',
  'photos',
  'photo',
  'pictures',
  'picture',
  'pics',
  'pic',
  'videos',
  'video',
  'music',
  'songs',
  'song',
  'audio',
  'tracks',
  'track',
  'pdfs',
  'pdf',
  'documents',
  'document',
  'files',
  'file',
  'users',
  'user',
  'people',
  'person',
  'names',
  'name',
]);

/** Media kinds for a chip (null = not a media chip). */
export function mediaKindsForSearchKind(
  kind: QdnSearchKind
): QdnMediaKind[] | null {
  switch (kind) {
    case 'videos':
      return ['video'];
    case 'images':
      return ['image'];
    case 'audio':
      return ['audio'];
    case 'documents':
      return ['pdf', 'file'];
    default:
      return null;
  }
}

/** QDN services to search for a media/documents chip. */
export function servicesForSearchKind(kind: QdnSearchKind): string[] {
  switch (kind) {
    case 'videos':
      return ['VIDEO'];
    case 'images':
      // IMAGE is primary; THUMBNAIL catches gallery-style publishes under a name.
      return ['IMAGE', 'THUMBNAIL'];
    case 'audio':
      return ['AUDIO'];
    case 'documents':
      return ['DOCUMENT', 'BLOG_POST', 'FILE'];
    default:
      return [];
  }
}

export function humanLabelForSearchKind(kind: QdnSearchKind): string {
  switch (kind) {
    case 'all':
      return 'All';
    case 'users':
      return 'Users';
    case 'videos':
      return 'Videos';
    case 'images':
      return 'Images';
    case 'audio':
      return 'Audio';
    case 'documents':
      return 'Documents';
  }
}

/** Strip chip/media stopwords from a query → topical subject. */
export function extractForcedSearchSubject(query: string): {
  subject: string;
  subjectLabel: string;
} {
  const tokens = query
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !FORCE_STOP.has(t));

  if (!tokens.length) {
    return { subject: '', subjectLabel: '' };
  }

  const subjectLabel = tokens.join(' ');
  // Multi-word phrases are person / compound subjects ("qortal justin") —
  // never collapse to the last token alone (that pulled Justin Bieber videos).
  if (tokens.length >= 2) {
    return { subject: subjectLabel, subjectLabel };
  }
  const last = tokens[0];
  const subject =
    last.length > 3 && last.endsWith('s') && !last.endsWith('ss')
      ? last.slice(0, -1)
      : last;
  return { subject, subjectLabel };
}

/**
 * Build a topic-media intent from a search chip (no NLP "show me images of" required).
 * Empty subject → recent browse of that service kind.
 */
export function buildForcedTopicMediaIntent(
  query: string,
  kind: Exclude<QdnSearchKind, 'all' | 'users'>
): TopicMediaIntent {
  const mediaKinds = mediaKindsForSearchKind(kind) || ['file'];
  const { subject, subjectLabel } = extractForcedSearchSubject(query);
  return {
    kinds: mediaKinds,
    subject,
    subjectLabel: subjectLabel || humanLabelForSearchKind(kind).toLowerCase(),
    services: servicesForSearchKind(kind),
    forced: true,
  };
}

/** True when the chip forces a typed media/document search. */
export function isMediaSearchKind(
  kind: QdnSearchKind
): kind is 'videos' | 'images' | 'audio' | 'documents' {
  return (
    kind === 'videos' ||
    kind === 'images' ||
    kind === 'audio' ||
    kind === 'documents'
  );
}
