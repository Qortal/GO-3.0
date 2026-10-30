import { getBaseApiReact } from '../../../utils/globalApi';

const LIBRARY_GIF_PREFIX = 'gif-';
const LIBRARY_GIF_SERVICE = 'IMAGE';

const CATALOG_LIMIT = '100';
const CATALOG_TTL_MS = 5 * 60 * 1000;
const WORD_MAX = 20;
const JUNK_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'is',
  'it',
  'this',
  'that',
  'img',
  'image',
  'images',
  'gif',
  'gifs',
  'video',
  'pic',
  'picture',
  'photo',
  'download',
  'untitled',
  'screenshot',
  'screen',
  'shot',
  'file',
  'new',
  'copy',
  'final',
  'edited',
  'export',
  'sticker',
  'media',
  'www',
  'http',
  'https',
  'com',
  'net',
  'org',
  'src',
  'dsc',
  'dcim',
  'whatsapp',
  'telegram',
  'tenor',
  'giphy',
  'imgur',
]);

let catalog: LibraryGif[] | null = null;
let catalogFetchedAt = 0;
let catalogPromise: Promise<LibraryGif[]> | null = null;

export type LibraryGif = {
  description?: string;
  identifier: string;
  name: string;
  service: string;
};

type LibraryGifChatImage = {
  identifier: string;
  libraryGif: true;
  mimeType: 'image/gif';
  name: string;
  service: 'IMAGE';
  timestamp: number;
};

type QdnSearchRow = {
  description?: string;
  filename?: string;
  identifier?: string;
  metadata?: { description?: string; title?: string };
  name?: string;
  service?: string;
  title?: string;
};

type GifModeration = {
  blockedNames: string[];
  hidden: { identifier?: string; name?: string }[];
};

const encodeQdnSeg = (value: string) => {
  const raw = String(value ?? '');
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch {
    return encodeURIComponent(raw);
  }
};

export const isLibraryGifImage = (image?: {
  identifier?: string;
  libraryGif?: boolean;
  name?: string;
  service?: string;
}): boolean =>
  Boolean(
    image?.name &&
      (image.libraryGif === true ||
        (image.service === LIBRARY_GIF_SERVICE &&
          String(image.identifier || '').startsWith(LIBRARY_GIF_PREFIX)))
  );

export const libraryGifResourceUrl = (
  gif: { identifier: string; name: string },
  async = false
) => {
  const path = `/arbitrary/${LIBRARY_GIF_SERVICE}/${encodeQdnSeg(gif.name)}/${encodeQdnSeg(gif.identifier)}`;
  return `${getBaseApiReact()}${path}${async ? '?async=true' : ''}`;
};

export const libraryGifKey = (gif: { identifier: string; name: string }) =>
  `${gif.name}::${gif.identifier}`;

export const toChatImagePointer = (gif: LibraryGif): LibraryGifChatImage => ({
  identifier: gif.identifier,
  libraryGif: true,
  mimeType: 'image/gif',
  name: gif.name,
  service: LIBRARY_GIF_SERVICE,
  timestamp: Date.now(),
});

const cleanWord = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, WORD_MAX);

const isUsefulWord = (word: string) =>
  Boolean(word) &&
  word.length >= 2 &&
  !/^\d+$/.test(word) &&
  !JUNK_WORDS.has(word);

const tagsOf = (gif: { description?: string }): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  String(gif.description || '')
    .split(/[^a-zA-Z0-9]+/)
    .map(cleanWord)
    .filter(isUsefulWord)
    .forEach((word) => {
      if (seen.has(word)) return;
      seen.add(word);
      tags.push(word);
    });
  return tags;
};

export const filterLibraryGifs = (
  gifs: LibraryGif[],
  query = '',
  tag = ''
): LibraryGif[] => {
  const words = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const needle = String(tag || '').toLowerCase();
  return gifs.filter((gif) => {
    const tags = tagsOf(gif);
    if (needle && !tags.includes(needle)) return false;
    if (!words.length) return true;
    const hay = `${gif.description || ''} ${gif.name} ${tags.join(' ')}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
};

export const gifTagCounts = (
  gifs: LibraryGif[],
  limit = 16
): { count: number; tag: string }[] => {
  const counts = new Map<string, number>();
  gifs.forEach((gif) => {
    tagsOf(gif).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([tag, count]) => ({ count, tag }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
};

const descriptionOf = (row: QdnSearchRow) =>
  row?.metadata?.description ||
  row?.description ||
  row?.metadata?.title ||
  row?.title ||
  row?.filename ||
  '';

const loadGifModeration = async (): Promise<GifModeration> => {
  try {
    const response = await fetch(
      `${getBaseApiReact()}/arbitrary/DOCUMENT/GIFs/gifs_moderation`
    );
    if (!response.ok) return { blockedNames: [], hidden: [] };
    const data = await response.json();
    return {
      blockedNames: Array.isArray(data?.blockedNames) ? data.blockedNames : [],
      hidden: Array.isArray(data?.hidden) ? data.hidden : [],
    };
  } catch {
    return { blockedNames: [], hidden: [] };
  }
};

const isModerated = (gif: LibraryGif, moderation: GifModeration) => {
  const name = gif.name.toLowerCase();
  if (moderation.blockedNames.some((item) => String(item).toLowerCase() === name)) {
    return true;
  }
  return moderation.hidden.some(
    (row) => row?.name === gif.name && row?.identifier === gif.identifier
  );
};

const fetchLibraryGifCatalog = async (): Promise<LibraryGif[]> => {
  const params = new URLSearchParams({
    excludeblocked: 'true',
    identifier: LIBRARY_GIF_PREFIX,
    includemetadata: 'true',
    limit: CATALOG_LIMIT,
    mode: 'ALL',
    prefix: 'true',
    reverse: 'true',
    service: LIBRARY_GIF_SERVICE,
  });

  const [searchResponse, moderation] = await Promise.all([
    fetch(`${getBaseApiReact()}/arbitrary/resources/search?${params}`),
    loadGifModeration(),
  ]);
  if (!searchResponse.ok) throw new Error('Could not load GIFs');
  const rows = await searchResponse.json();
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row: QdnSearchRow) =>
        row?.name &&
        String(row.identifier || '').startsWith(LIBRARY_GIF_PREFIX)
    )
    .map((row: QdnSearchRow) => ({
      description: descriptionOf(row),
      identifier: String(row.identifier),
      name: String(row.name),
      service: row.service || LIBRARY_GIF_SERVICE,
    }))
    .filter((gif) => !isModerated(gif, moderation));
};

export const getLibraryGifCatalog = (): Promise<LibraryGif[]> => {
  if (catalog && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) {
    return Promise.resolve(catalog);
  }
  if (catalogPromise) return catalogPromise;
  catalogPromise = fetchLibraryGifCatalog()
    .then((rows) => {
      catalog = rows;
      catalogFetchedAt = Date.now();
      return rows;
    })
    .finally(() => {
      catalogPromise = null;
    });
  return catalogPromise;
};

export const fetchLibraryGifFile = async (
  gif: LibraryGif
): Promise<File | null> => {
  try {
    const { getLibraryGifBlob } = await import('./gifMediaCache');
    const blob = await getLibraryGifBlob(gif, 20);
    const type =
      blob.type && blob.type !== 'application/octet-stream'
        ? blob.type
        : 'image/gif';
    return new File([blob], `${gif.identifier}.gif`, { type });
  } catch {
    return null;
  }
};
