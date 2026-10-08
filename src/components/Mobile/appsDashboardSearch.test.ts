import { describe, expect, it } from 'vitest';
import {
  splitFirstMatch,
  appMatchesSearchQuery,
  buildAppsSearchSuggestions,
  isBareQortalNameQuery,
  scoreAppSearchMatch,
  titleAcronym,
} from './appsDashboardSearch';

const qwb = {
  name: 'QWB',
  service: 'APP',
  metadata: {
    title: 'Qortal Web Builder',
    description:
      'Interactive Qortal Website Builder. Create Your personalized page.',
    tags: ['web', 'builder', 'QWB', 'shop', 'blog'],
  },
};

const quitter = {
  name: 'Quitter',
  service: 'APP',
  metadata: {
    title: 'Quitter',
    description: 'Decentralized social network',
    tags: ['social'],
  },
};

describe('appsDashboardSearch matching', () => {
  it('builds an acronym from title words', () => {
    expect(titleAcronym('Qortal Web Builder')).toBe('qwb');
  });

  it('matches QWB by name, tag, and title acronym', () => {
    expect(scoreAppSearchMatch(qwb, 'QWB')).toBeGreaterThanOrEqual(1000);
    expect(appMatchesSearchQuery(qwb, 'qwb')).toBe(true);
    expect(
      appMatchesSearchQuery(
        {
          ...qwb,
          name: 'SomePublisher',
          metadata: { ...qwb.metadata, tags: ['QWB'] },
        },
        'qwb'
      )
    ).toBe(true);
    expect(
      appMatchesSearchQuery(
        {
          ...qwb,
          name: 'SomePublisher',
          metadata: {
            title: 'Qortal Web Builder',
            description: 'builder',
            tags: [],
          },
        },
        'qwb'
      )
    ).toBe(true);
  });

  it('surfaces QWB as the first suggestion for query "QWB"', () => {
    const suggestions = buildAppsSearchSuggestions(
      'QWB',
      [quitter, qwb],
      'Open as Qortal link'
    );
    expect(suggestions[0]).toEqual({ type: 'app', app: qwb });
    expect(suggestions.some((item) => item.type === 'link')).toBe(false);
  });

  it('still offers open-as-link for explicit qortal paths', () => {
    const suggestions = buildAppsSearchSuggestions(
      'APP/QWB',
      [qwb],
      'Open as Qortal link'
    );
    expect(suggestions.some((item) => item.type === 'link')).toBe(true);
  });

  it('detects bare name queries', () => {
    expect(isBareQortalNameQuery('QWB')).toBe(true);
    expect(isBareQortalNameQuery('qortal://QWB')).toBe(true);
    expect(isBareQortalNameQuery('APP/QWB')).toBe(false);
    expect(isBareQortalNameQuery('qortal://APP/QWB')).toBe(false);
  });
});

describe('splitFirstMatch', () => {
  it('splits around the first match, any case', () => {
    expect(splitFirstMatch('Q-Tube test', 'TEST')).toEqual({
      before: 'Q-Tube ',
      match: 'test',
      after: '',
    });
    expect(splitFirstMatch('testing test', 'test')).toEqual({
      before: '',
      match: 'test',
      after: 'ing test',
    });
  });

  it('keeps the whole text when nothing matches', () => {
    expect(splitFirstMatch('Q-Mail', 'zz')).toEqual({
      before: 'Q-Mail',
      match: '',
      after: '',
    });
    expect(splitFirstMatch('Q-Mail', '  ')).toEqual({
      before: 'Q-Mail',
      match: '',
      after: '',
    });
  });
});
