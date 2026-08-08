import { describe, expect, it } from 'vitest';
import {
  buildCharacterPortrait,
  extractContentThemes,
  sanitizeCharacterPortrait,
} from '../qdnCharacterPortrait';

describe('qdnCharacterPortrait', () => {
  it('detects censorship / free-speech themes from titles', () => {
    const themes = extractContentThemes([
      {
        source: 'Q-Tube',
        title: 'Why censorship is destroying free speech online',
        excerpt: 'deplatforming and cancel culture',
      },
      {
        source: 'Q-Blog',
        title: 'Uncensored notes on liberty',
      },
    ]);
    const labels = themes.map((t) => t.id);
    expect(labels).toContain('censorship');
    expect(labels.some((id) => id === 'freedom' || id === 'privacy')).toBe(
      true
    );
  });

  it('builds a personalized portrait mentioning themes', () => {
    const themes = extractContentThemes([
      {
        source: 'Q-Tube',
        title: 'Fighting censorship on the open web',
      },
      {
        source: 'DOCUMENT',
        title: 'Privacy and sovereignty guide',
      },
    ]);
    const portrait = buildCharacterPortrait({
      name: 'FreeSpeaker',
      rolePitch: 'a non-minter on Qortal',
      level: 2,
      themes,
      publishes: [
        {
          source: 'Q-Tube',
          title: 'Fighting censorship on the open web',
        },
        {
          source: 'DOCUMENT',
          title: 'Privacy and sovereignty guide',
        },
      ],
      appCounts: [
        { app: 'Q-Tube', count: 4 },
        { app: 'Q-Blog', count: 2 },
      ],
    });
    expect(portrait.toLowerCase()).toContain('freespeaker');
    expect(portrait.toLowerCase()).toMatch(/censor|free speech|privacy|sovereign/);
    expect(portrait.toLowerCase()).toMatch(
      /based on what|published by the user|has published/
    );
  });

  it('rejects invented / game-flavored LLM polish', () => {
    expect(
      sanitizeCharacterPortrait(
        'As an AI I think they love quantum video games.',
        'Crowetic'
      )
    ).toBe('');
    expect(
      sanitizeCharacterPortrait(
        'Crowetic cares about free speech and posts uncensored commentary on Q-Tube.',
        'Crowetic'
      ).length
    ).toBeGreaterThan(40);
  });

  it('rejects incomplete-profile refusals from small models', () => {
    expect(
      sanitizeCharacterPortrait(
        'Qortal Justin appears to be incomplete based on the available information.',
        'Qortal Justin'
      )
    ).toBe('');
    expect(
      sanitizeCharacterPortrait(
        'This profile seems incomplete and I cannot determine their interests.',
        'Qortal Justin'
      )
    ).toBe('');
  });
});
