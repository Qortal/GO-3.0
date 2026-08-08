import { describe, expect, it } from 'vitest';
import {
  formatDirectWhoIsAnswer,
  stripStreamingCharacterSection,
  withStreamingCharacterSection,
  type QdnDossier,
} from '../qdnLookup';
import { linkifyQdnReferences } from '../qdnLinkify';

function stubDossier(over: Partial<QdnDossier> = {}): QdnDossier {
  return {
    name: 'FreeSpeaker',
    address: 'Qaddr123',
    level: 4,
    tags: ['Minter'],
    avatarUrl: '',
    description: 'Hub bio',
    characterSummary:
      'FreeSpeaker comes across as someone drawn to anti-censorship / free speech.',
    contentThemes: [{ id: 'censorship', label: 'anti-censorship / free speech' }],
    publishSignals: [],
    text: '',
    stats: {
      name: 'FreeSpeaker',
      address: 'Qaddr123',
      level: 4,
      tags: ['Minter'],
      ownedNames: ['FreeSpeaker'],
      ageDays: 400,
      txsSampled: 20,
      recent30: 5,
      blocksMinted: 10,
      balance: 1,
      qdnResourceCount: 12,
      appCounts: [{ app: 'Q-Tube', count: 3 }],
      publishTitles: ['[Q-Tube] Fighting censorship'],
      chatHints: [],
      topTxTypes: ['PAYMENT'],
    },
    profileSummary: 'Portfolio paragraph about FreeSpeaker.',
    nominationSummary: 'Nomination paragraph.',
    publishedSites: [],
    quitterPosts: [
      {
        name: 'FreeSpeaker',
        identifier: 'post-1',
        text: 'Censorship has no place on QDN.',
      },
    ],
    nameRole: 'primary',
    primaryName: 'FreeSpeaker',
    ...over,
  };
}

describe('who-is answer sections', () => {
  it('formats portfolio + activity without duplicating character or Quitter', () => {
    const answer = formatDirectWhoIsAnswer(stubDossier());
    expect(answer).toContain('### Portfolio');
    expect(answer).toContain('Portfolio paragraph');
    expect(answer).toContain('### Account activity');
    expect(answer).toContain('Qaddr123');
    expect(answer).toContain('### Recent publishes');
    expect(answer).toContain('Fighting censorship');
    // Character + Quitter belong in UI chips — not repeated in the body.
    expect(answer).not.toContain('### Character');
    expect(answer).not.toContain('Recent Quitter');
    expect(answer).not.toContain('Censorship has no place on QDN');
  });

  it('streams a temporary Character section then strips it cleanly', () => {
    const base = formatDirectWhoIsAnswer(stubDossier());
    const live = withStreamingCharacterSection(
      base,
      'FreeSpeaker is a free-speech advocate who posts videos.'
    );
    expect(live).toContain('### Character');
    expect(live).toContain('free-speech advocate');
    expect(live).toContain('### Portfolio');
    const stripped = stripStreamingCharacterSection(live);
    expect(stripped).toContain('### Portfolio');
    expect(stripped).toContain('### Account activity');
    expect(stripped).not.toContain('### Character');
    expect(stripped).not.toContain('free-speech advocate');
    // Body after strip matches the non-character dossier answer.
    expect(stripped.replace(/\s+/g, ' ').trim()).toBe(
      base.replace(/\s+/g, ' ').trim()
    );
  });

  it('linkifies Q-App references for blue tap targets', () => {
    const linked = linkifyQdnReferences(
      'They publish often on Q-Tube and Quitter.'
    );
    expect(linked).toContain('[Q-Tube](qortal://APP/Q-Tube)');
    expect(linked).toContain('[Quitter](qortal://APP/Quitter)');
  });
});
