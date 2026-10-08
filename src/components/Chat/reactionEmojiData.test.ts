import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReactionEmojiNames,
  buildReactionEmojiSections,
  DEFAULT_RECENT_REACTIONS,
  getMaxSupportedEmojiVersion,
  getRecentReactionsForPicker,
  loadReactionEmojiSections,
  QUICK_REACTIONS,
  readRecentReactions,
  RECENT_REACTIONS_LIMIT,
  RECENT_REACTIONS_STORAGE_KEY,
  REACTION_EMOJI_CATEGORIES,
  rememberRecentReaction,
  searchReactionEmojis,
  unifiedToNative,
} from './reactionEmojiData';

describe('unifiedToNative', () => {
  it('turns emoji-picker-react codes into the characters', () => {
    expect(unifiedToNative('1f600')).toBe('😀');
    expect(unifiedToNative('2764-fe0f')).toBe('❤️');
    expect(unifiedToNative('1f468-200d-1f4bb')).toBe('👨‍💻');
  });
});

describe('buildReactionEmojiSections', () => {
  const data = {
    custom: [],
    flags: [{ n: ['flag'], u: '1f3c1', a: '0.6' }],
    smileys_people: [
      { n: ['grinning'], u: '1f600', a: '1.0' },
      { n: ['melting face'], u: '1fae0', a: '14.0' },
      { n: ['broken'], u: '' },
    ],
    activities: [{ n: ['too new'], u: '1fae0', a: '14.0' }],
  };

  it('keeps the Unicode category order and drops empty categories', () => {
    const sections = buildReactionEmojiSections(data);
    expect(sections.map((section) => section.id)).toEqual([
      'smileys_people',
      'activities',
      'flags',
    ]);
    expect(sections[0].emojis).toEqual(['😀', '\u{1FAE0}']);
  });

  it('leaves out emoji newer than the phone can draw', () => {
    const sections = buildReactionEmojiSections(data, 13);
    expect(sections.map((section) => section.id)).toEqual([
      'smileys_people',
      'flags',
    ]);
    expect(sections[0].emojis).toEqual(['😀']);
  });

  it('survives missing or malformed data', () => {
    expect(buildReactionEmojiSections({})).toEqual([]);
    expect(buildReactionEmojiSections(null as never)).toEqual([]);
  });
});

describe('loadReactionEmojiSections', () => {
  it('loads every category of the bundled data', async () => {
    const sections = await loadReactionEmojiSections();
    expect(sections.map((section) => section.id)).toEqual([
      ...REACTION_EMOJI_CATEGORIES,
    ]);
    const smileys = sections[0].emojis;
    expect(smileys[0]).toBe('😀');
    expect(smileys.length).toBeGreaterThan(300);
    // The quick reactions are all in the grid too.
    const all = new Set(sections.flatMap((section) => section.emojis));
    for (const emoji of QUICK_REACTIONS) expect(all.has(emoji)).toBe(true);
  });

  it('filters nothing where no canvas can be probed (tests)', () => {
    expect(getMaxSupportedEmojiVersion()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('recent reactions', () => {
  afterEach(() => window.localStorage.clear());

  it('starts with the starter set', () => {
    expect(readRecentReactions()).toEqual([]);
    expect(getRecentReactionsForPicker()).toEqual(DEFAULT_RECENT_REACTIONS);
  });

  it('puts the latest first without duplicates', () => {
    rememberRecentReaction('🎉');
    rememberRecentReaction('👍');
    rememberRecentReaction('🎉');
    expect(readRecentReactions()).toEqual(['🎉', '👍']);
    expect(getRecentReactionsForPicker()).toEqual(['🎉', '👍']);
  });

  it('keeps a bounded list', () => {
    for (let index = 0; index < RECENT_REACTIONS_LIMIT + 10; index += 1) {
      rememberRecentReaction(String.fromCodePoint(0x1f600 + index));
    }
    expect(readRecentReactions()).toHaveLength(RECENT_REACTIONS_LIMIT);
  });

  it('ignores damaged storage instead of throwing', () => {
    window.localStorage.setItem(RECENT_REACTIONS_STORAGE_KEY, '{oops');
    expect(readRecentReactions()).toEqual([]);
    window.localStorage.setItem(
      RECENT_REACTIONS_STORAGE_KEY,
      JSON.stringify(['🔥', 42, '', 'x'.repeat(100)])
    );
    expect(readRecentReactions()).toEqual(['🔥']);
  });
});

describe('searchReactionEmojis', () => {
  const data = {
    smileys_people: [
      { n: ['grinning', 'grinning face'], u: '1f600', a: '1.0' },
      { n: ['joy', 'face with tears of joy'], u: '1f602', a: '0.6' },
    ],
    travel_places: [{ n: ['fire'], u: '1f525', a: '0.6' }],
    objects: [{ n: ['fire extinguisher'], u: '1f9ef', a: '11.0' }],
    symbols: [{ n: ['spitfire badge'], u: '1f4db', a: '0.6' }],
  };
  const sections = buildReactionEmojiSections(data);
  const names = buildReactionEmojiNames(data);

  it('ranks a whole word, then the start of one, then anywhere', () => {
    expect(searchReactionEmojis('fire', sections, names)).toEqual([
      '🔥',
      '🧯',
      '📛',
    ]);
    expect(searchReactionEmojis('fir', sections, names)).toEqual([
      '🔥',
      '🧯',
      '📛',
    ]);
    expect(searchReactionEmojis('face', sections, names)).toEqual(['😀', '😂']);
  });

  it('puts plain short names first among equal matches', () => {
    const hearts = {
      smileys_people: [
        { n: ['smiling face with heart-eyes'], u: '1f60d', a: '0.6' },
      ],
      symbols: [{ n: ['red heart', 'heart'], u: '2764-fe0f', a: '0.6' }],
    };
    expect(
      searchReactionEmojis(
        'heart',
        buildReactionEmojiSections(hearts),
        buildReactionEmojiNames(hearts)
      )
    ).toEqual(['❤️', '😍']);
  });

  it('needs every word typed, in any order, any case', () => {
    expect(searchReactionEmojis('Tears JOY', sections, names)).toEqual(['😂']);
    expect(searchReactionEmojis('face fire', sections, names)).toEqual([]);
  });

  it('finds an emoji typed or pasted in', () => {
    expect(searchReactionEmojis('😀', sections, names)).toEqual(['😀']);
  });

  it('finds nothing for an empty query', () => {
    expect(searchReactionEmojis('   ', sections, names)).toEqual([]);
  });
});
