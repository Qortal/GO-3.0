import { describe, expect, it } from 'vitest';
import { matchQAppCatalog } from '../qAppCatalog';
import { matchGoldenAnswer } from '../goldenMatch';
import { extractNameCandidates } from '../qdnLookup';
import {
  isMintingHowToQuery,
  mintingGoldenSeedQuery,
} from '../qdnMintingGuide';
import { extractGroupOwnerQuery, isObviouslyQdnQuestion } from '../qdnRoster';
import { extractGroupDigestQuery } from '../qdnGroupDigest';
import {
  isQortalNetworkDefinitionQuery,
  isGenericConceptNeedle,
  isQortPriceQuery,
} from '../queryIntent';

describe('query routing — network vs apps vs people', () => {
  it('recognizes network definition asks', () => {
    for (const q of [
      'what is qortal',
      'What is Qortal?',
      'whats qortal',
      "what's qortal",
      'what is the qortal network',
      'how does qortal work',
      'explain qortal',
      'define qortal',
    ]) {
      expect(isQortalNetworkDefinitionQuery(q), q).toBe(true);
      expect(matchQAppCatalog(q), q).toBeNull();
    }
  });

  it('routes definition asks to golden qortal-001', () => {
    expect(matchGoldenAnswer('what is qortal')?.entry.id).toBe('qortal-001');
    expect(matchGoldenAnswer('how does qortal work')?.entry.id).toBe(
      'qortal-001'
    );
    expect(matchGoldenAnswer("what's qortal")?.entry.id).toBe('qortal-001');
  });

  it('does not steal concept FAQs into apps', () => {
    expect(matchQAppCatalog('what is minting')).toBeNull();
    expect(isMintingHowToQuery('what is minting')).toBe(true);
    expect(matchGoldenAnswer('what is minting')?.entry.id).toBe('qortal-005');

    expect(matchQAppCatalog('what are qortal names')).toBeNull();
    expect(matchQAppCatalog('tell me about names')).toBeNull();
    expect(matchQAppCatalog('what is trade')).toBeNull();
    expect(matchQAppCatalog('what is search')).toBeNull();
    expect(matchQAppCatalog('what is onboarding')).toBeNull();
    expect(matchQAppCatalog('what is support')).toBeNull();
  });

  it('still matches real apps when named', () => {
    expect(matchQAppCatalog('what is Q-Assets')?.entry.id).toBe('q-assets');
    expect(matchQAppCatalog('what is Welcome to Qortal')?.entry.id).toBe(
      'welcome'
    );
    expect(matchQAppCatalog('open Welcome to Qortal')?.entry.id).toBe(
      'welcome'
    );
    expect(matchQAppCatalog('what is Q-Node')?.entry.id).toBe('q-node');
    expect(matchQAppCatalog('what is the Names app')?.entry.id).toBe('names');
    expect(matchQAppCatalog('explain Ear-Bump')?.entry.name).toBe('Ear-Bump');
  });

  it('keeps Welcome-group questions on QDN intents, not the Welcome app', () => {
    const owner = 'who owns the Welcome to Qortal group';
    expect(matchQAppCatalog(owner)).toBeNull();
    expect(extractGroupOwnerQuery(owner)?.toLowerCase()).toContain('welcome');
    expect(isObviouslyQdnQuestion(owner)).toBe(true);

    const digest = "what's new in Welcome to Qortal this week";
    expect(matchQAppCatalog(digest)).toBeNull();
    expect(extractGroupDigestQuery(digest)?.groupName.toLowerCase()).toContain(
      'welcome'
    );
  });

  it('does not extract person-name junk from how-to questions', () => {
    expect(extractNameCandidates('how does qortal work')).toEqual([]);
    expect(extractNameCandidates('what is qortal')).toEqual([]);
    expect(isGenericConceptNeedle('minting')).toBe(true);
  });

  it('treats desire phrasing as a become-a-minter process ask', () => {
    for (const q of [
      'I want to mint, how',
      'i want to mint how do i do that',
      'i wanna mint',
      'I would like to start minting',
      'help me mint qort',
    ]) {
      expect(isMintingHowToQuery(q), q).toBe(true);
      expect(mintingGoldenSeedQuery(q), q).toBe('How do I become a minter?');
    }
    // Definition asks still seed the definition FAQ.
    expect(mintingGoldenSeedQuery('what is minting')).toBe(
      'What is minting on Qortal?'
    );
  });

  it('matches inflections via stemming (mint vs minting)', () => {
    const m = matchGoldenAnswer('i want to start minting', { minScore: 0.5 });
    expect(m).not.toBeNull();
    expect(m!.entry.category).toBe('qortal');
    expect(`${m!.entry.q} ${m!.entry.a}`.toLowerCase()).toMatch(/mint/);
  });

  it('routes QORT price asks to the honesty FAQ', () => {
    expect(isQortPriceQuery('what is the price of QORT')).toBe(true);
    expect(matchGoldenAnswer('what is the price of QORT')?.entry.id).toBe(
      'qortal-210'
    );
    expect(matchQAppCatalog('what is the price of QORT')).toBeNull();
  });
});
