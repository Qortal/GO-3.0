import { afterEach, describe, expect, it } from 'vitest';
import { QUICK_REACTIONS } from './reactionEmojiData';
import {
  DEFAULT_DOUBLE_TAP_REACTION,
  getDoubleTapReaction,
  OTHER_CHATS_KEY,
  pickPillReactions,
  readReactionPrefs,
  recordReactionUse,
  REACTION_PREFS_STORAGE_KEY,
  resetQuickReactions,
  resetReactionPrefsCache,
  resolveQuickReactions,
  setDoubleTapReaction,
  setQuickReactionMode,
  setQuickReactionSlot,
} from './reactionPreferences';

const usage = () =>
  JSON.parse(window.localStorage.getItem('qortal-hub:reaction-usage') ?? '{}');

describe('reaction preferences', () => {
  afterEach(() => {
    window.localStorage.clear();
    resetReactionPrefsCache();
  });

  it('double taps with thumbs up until told otherwise', () => {
    expect(DEFAULT_DOUBLE_TAP_REACTION).toBe('👍');
    expect(getDoubleTapReaction(readReactionPrefs(), 'group:1')).toBe('👍');
  });

  it('keeps a double-tap emoji per chat, over the all-chats one', () => {
    setDoubleTapReaction('group:1', '🔥');
    setDoubleTapReaction(OTHER_CHATS_KEY, '❤️');
    const prefs = readReactionPrefs();
    expect(getDoubleTapReaction(prefs, 'group:1')).toBe('🔥');
    expect(getDoubleTapReaction(prefs, 'direct:QAbc')).toBe('❤️');
    expect(getDoubleTapReaction(prefs, undefined)).toBe('❤️');
  });

  it('survives a restart, and ignores damaged storage', () => {
    setDoubleTapReaction('direct:QAbc', '😂');
    resetReactionPrefsCache();
    expect(readReactionPrefs().doubleTap).toEqual({ 'direct:QAbc': '😂' });
    window.localStorage.setItem(REACTION_PREFS_STORAGE_KEY, '{nope');
    resetReactionPrefsCache();
    expect(readReactionPrefs().quickReactions).toEqual([...QUICK_REACTIONS]);
    window.localStorage.setItem(
      REACTION_PREFS_STORAGE_KEY,
      JSON.stringify({ quickReactions: ['🎉', 5, '🎉'], doubleTap: { a: 7 } })
    );
    resetReactionPrefsCache();
    const prefs = readReactionPrefs();
    expect(prefs.doubleTap).toEqual({});
    expect(prefs.quickReactions[0]).toBe('🎉');
    expect(new Set(prefs.quickReactions).size).toBe(QUICK_REACTIONS.length);
  });

  it('swaps quick reactions instead of repeating one', () => {
    setQuickReactionSlot(0, '🔥');
    const list = readReactionPrefs().quickReactions;
    expect(list[0]).toBe('🔥');
    expect(list[4]).toBe('👍');
    expect(new Set(list).size).toBe(list.length);
    resetQuickReactions();
    expect(readReactionPrefs().quickReactions).toEqual([...QUICK_REACTIONS]);
  });

  it('ranks the most used, topped up from the quick list', () => {
    recordReactionUse('🎉');
    recordReactionUse('🎉');
    recordReactionUse('😂');
    expect(usage()).toEqual({ '🎉': 2, '😂': 1 });
    setQuickReactionMode('most_used');
    const prefs = readReactionPrefs();
    const quick = resolveQuickReactions(prefs, usage());
    expect(quick.slice(0, 3)).toEqual(['🎉', '😂', '👍']);
    expect(quick).toHaveLength(QUICK_REACTIONS.length);
    setQuickReactionMode('custom');
    expect(resolveQuickReactions(readReactionPrefs(), usage())).toEqual([
      ...QUICK_REACTIONS,
    ]);
  });

  it('always shows the double-tap emoji in the pill', () => {
    const quick = [...QUICK_REACTIONS];
    expect(pickPillReactions(quick, 6, '🔥')).toEqual(quick.slice(0, 6));
    expect(pickPillReactions(quick, 6, '😮')).toEqual([
      ...quick.slice(0, 5),
      '😮',
    ]);
    expect(pickPillReactions(quick, 3, '🎉')).toEqual(['👍', '💯', '🎉']);
  });
});
