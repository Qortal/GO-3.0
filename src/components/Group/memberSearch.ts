/**
 * Search over a group's member list (the phone Members screen): ranks members
 * by how well their name or address matches what is typed, and says where the
 * match sits so the row can draw the typed letters differently.
 */

/** Characters of `text` from `start` up to (not including) `end`. */
type MemberMatchRange = { start: number; end: number };

/** One piece of a line drawn with the matched letters picked out. */
export type MemberTextSegment = { text: string; match: boolean };

type FoldedText = {
  folded: string;
  /** `map[i]` = where folded character `i` came from in the original. */
  map: number[];
};

type MemberSearchEntry = {
  address: string;
  name: string;
  isAdmin: boolean;
  isOwner: boolean;
  foldedName: FoldedText;
  foldedAddress: string;
};

export type MemberSearchResult = {
  address: string;
  name: string;
  isAdmin: boolean;
  isOwner: boolean;
  /** Where the query sits in `name`, when the name matched. */
  nameMatch: MemberMatchRange | null;
  /** Where the query sits in `address`, when only the address matched. */
  addressMatch: MemberMatchRange | null;
};

/** Better tiers first. */
const RANK = {
  nameStart: 0,
  wordStart: 1,
  nameContains: 2,
  addressStart: 3,
  addressContains: 4,
} as const;

const MEMBER_SEARCH_LIMIT = 8;

const COMBINING_MARKS = /[̀-ͯ]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Lower case without accents ("Zoë" → "zoe"), keeping track of where each
 * folded character came from so a match can be drawn on the original text.
 */
export function foldForSearch(text: string): FoldedText {
  const source = String(text ?? '');
  let folded = '';
  const map: number[] = [];
  let offset = 0;
  for (const char of source) {
    const piece = char
      .toLowerCase()
      .normalize('NFD')
      .replace(COMBINING_MARKS, '');
    for (let i = 0; i < piece.length; i += 1) map.push(offset);
    folded += piece;
    offset += char.length;
  }
  map.push(source.length);
  return { folded, map };
}

const labelOf = (member: any): string =>
  String(member?.primaryName || member?.name || '').trim();

/** Built once per member list; searching then only compares strings. */
export function buildMemberSearchIndex(
  members: any[],
  ownerAddress?: string | null
): MemberSearchEntry[] {
  const seen = new Set<string>();
  const entries: MemberSearchEntry[] = [];
  for (const member of members || []) {
    const address = typeof member?.member === 'string' ? member.member : '';
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const name = labelOf(member);
    entries.push({
      address,
      name,
      isAdmin: Boolean(member?.isAdmin),
      isOwner: Boolean(ownerAddress) && address === ownerAddress,
      foldedName: foldForSearch(name),
      foldedAddress: address.toLowerCase(),
    });
  }
  return entries;
}

const toOriginalRange = (
  { map }: FoldedText,
  start: number,
  length: number
): MemberMatchRange => ({ start: map[start], end: map[start + length] });

/** Where `query` starts a word in `text` (not at index 0), or -1. */
const wordStartIndex = (text: string, query: string): number => {
  let at = text.indexOf(query, 1);
  while (at > 0) {
    if (!WORD_CHAR.test(text[at - 1])) return at;
    at = text.indexOf(query, at + 1);
  }
  return -1;
};

type Ranked = {
  entry: MemberSearchEntry;
  rank: number;
  exact: boolean;
  result: MemberSearchResult;
};

const rankEntry = (entry: MemberSearchEntry, query: string): Ranked | null => {
  const name = entry.foldedName.folded;
  const base = {
    address: entry.address,
    name: entry.name,
    isAdmin: entry.isAdmin,
    isOwner: entry.isOwner,
  };
  if (name) {
    let rank: number | null = null;
    let at = -1;
    if (name.startsWith(query)) {
      rank = RANK.nameStart;
      at = 0;
    } else {
      at = wordStartIndex(name, query);
      if (at > 0) rank = RANK.wordStart;
      else {
        at = name.indexOf(query);
        if (at >= 0) rank = RANK.nameContains;
      }
    }
    if (rank !== null) {
      return {
        entry,
        rank,
        exact: name === query,
        result: {
          ...base,
          nameMatch: toOriginalRange(entry.foldedName, at, query.length),
          addressMatch: null,
        },
      };
    }
  }
  const at = entry.foldedAddress.indexOf(query);
  if (at < 0) return null;
  return {
    entry,
    rank: at === 0 ? RANK.addressStart : RANK.addressContains,
    exact: entry.foldedAddress === query,
    result: {
      ...base,
      nameMatch: null,
      addressMatch: { start: at, end: at + query.length },
    },
  };
};

const compareRanked = (left: Ranked, right: Ranked): number => {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.exact !== right.exact) return left.exact ? -1 : 1;
  const byName = (left.entry.name || left.entry.address).localeCompare(
    right.entry.name || right.entry.address,
    undefined,
    { sensitivity: 'base' }
  );
  if (byName !== 0) return byName;
  return left.entry.address.localeCompare(right.entry.address);
};

/**
 * Members matching `query`, best first: name starts with it, then a word in
 * the name starts with it, then the name contains it, then the address
 * starts with or contains it. Case and accents are ignored. `total` counts
 * every match, including the ones past `limit`.
 */
export function searchMembers(
  index: MemberSearchEntry[],
  query: string,
  limit = MEMBER_SEARCH_LIMIT
): { results: MemberSearchResult[]; total: number } {
  const needle = foldForSearch(String(query ?? '').trim()).folded;
  if (!needle) return { results: [], total: 0 };
  const ranked: Ranked[] = [];
  for (const entry of index || []) {
    const hit = rankEntry(entry, needle);
    if (hit) ranked.push(hit);
  }
  ranked.sort(compareRanked);
  return {
    results: ranked.slice(0, Math.max(0, limit)).map((hit) => hit.result),
    total: ranked.length,
  };
}

/** `text` cut into plain and matched pieces around `range`. */
export function segmentsForMatch(
  text: string,
  range: MemberMatchRange | null
): MemberTextSegment[] {
  if (!range || range.end <= range.start) return [{ text, match: false }];
  return [
    { text: text.slice(0, range.start), match: false },
    { text: text.slice(range.start, range.end), match: true },
    { text: text.slice(range.end), match: false },
  ].filter((segment) => segment.text);
}

/**
 * A short form of `address` ("QabcDE…wxyz"), kept long enough to show the
 * matched letters when the match falls in the part that would be cut.
 */
export function shortAddressSegments(
  address: string,
  range: MemberMatchRange | null = null,
  head = 6,
  tail = 4
): MemberTextSegment[] {
  const text = String(address ?? '');
  if (text.length <= head + tail + 1) return segmentsForMatch(text, range);

  // The spans of the address that stay visible, merged when they touch or
  // when the gap between them is too small to be worth an ellipsis.
  const spans: Array<[number, number]> = [
    [0, head],
    [text.length - tail, text.length],
  ];
  if (range && range.end > range.start) spans.push([range.start, range.end]);
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const segments: MemberTextSegment[] = [];
  merged.forEach(([start, end], position) => {
    if (position > 0) segments.push({ text: '…', match: false });
    const piece = text.slice(start, end);
    const local =
      range && range.end > start && range.start < end
        ? {
            start: Math.max(range.start, start) - start,
            end: Math.min(range.end, end) - start,
          }
        : null;
    segments.push(...segmentsForMatch(piece, local));
  });
  return segments;
}
