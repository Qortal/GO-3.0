import { describe, expect, it } from 'vitest';
import {
  buildForcedTopicMediaIntent,
  extractForcedSearchSubject,
  isMediaSearchKind,
  mediaKindsForSearchKind,
  servicesForSearchKind,
} from '../qdnSearchKind';
import { isQortPriceQuery } from '../queryIntent';
import { matchGoldenAnswer } from '../goldenMatch';

describe('qdnSearchKind', () => {
  it('maps chips to media kinds and services', () => {
    expect(mediaKindsForSearchKind('videos')).toEqual(['video']);
    expect(mediaKindsForSearchKind('images')).toEqual(['image']);
    expect(mediaKindsForSearchKind('audio')).toEqual(['audio']);
    expect(mediaKindsForSearchKind('documents')).toEqual(['pdf', 'file']);
    expect(mediaKindsForSearchKind('users')).toBeNull();
    expect(mediaKindsForSearchKind('all')).toBeNull();
    expect(servicesForSearchKind('documents')).toEqual([
      'DOCUMENT',
      'BLOG_POST',
      'FILE',
    ]);
    expect(isMediaSearchKind('videos')).toBe(true);
    expect(isMediaSearchKind('users')).toBe(false);
  });

  it('builds forced topic intents without NLP phrasing', () => {
    const dogs = buildForcedTopicMediaIntent('dogs', 'images');
    expect(dogs.kinds).toEqual(['image']);
    expect(dogs.subject).toMatch(/dog/);
    expect(dogs.forced).toBe(true);
    expect(dogs.services).toEqual(['IMAGE', 'THUMBNAIL']);

    const recent = buildForcedTopicMediaIntent('please', 'videos');
    expect(recent.forced).toBe(true);
    expect(recent.subject).toBe('');
    expect(recent.services).toEqual(['VIDEO']);
  });

  it('extracts subjects from chip queries', () => {
    const s = extractForcedSearchSubject('show me videos about cats');
    expect(s.subjectLabel).toContain('cat');
  });

  it('keeps multi-word person subjects intact (not last token only)', () => {
    const s = extractForcedSearchSubject('Qortal Justin');
    expect(s.subject.toLowerCase()).toBe('qortal justin');
    expect(s.subjectLabel.toLowerCase()).toBe('qortal justin');
    expect(s.subject.toLowerCase()).not.toBe('justin');
  });
});

describe('QORT price honesty', () => {
  it('detects market price asks', () => {
    expect(isQortPriceQuery('what is the price of QORT')).toBe(true);
    expect(isQortPriceQuery('how much is QORT')).toBe(true);
    expect(isQortPriceQuery('QORT to USD')).toBe(true);
    expect(isQortPriceQuery('what is QORT')).toBe(false);
    expect(isQortPriceQuery('is QORT priceless')).toBe(false);
  });

  it('matches the curated price FAQ, not philosophy priceless', () => {
    const m = matchGoldenAnswer('what is the price of QORT', {
      minScore: 0.55,
    });
    expect(m).not.toBeNull();
    expect(m!.entry.id).toBe('qortal-210');
    expect(m!.entry.a.toLowerCase()).toMatch(/qdn/);
    expect(m!.entry.a.toLowerCase()).toMatch(/ltc/);
    expect(m!.entry.a.toLowerCase()).not.toMatch(/\$\d/);
  });
});
