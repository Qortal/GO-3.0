import { describe, expect, it } from 'vitest';
import { extractNameCandidates } from '../qdnLookup';
import { detectCreativeAboutPersonIntent } from '../qdnWrittenSummary';

describe('extractNameCandidates', () => {
  it('pulls the subject from nomination phrasing (not the word Nomination)', () => {
    expect(extractNameCandidates('Write nomination for Jonny')).toEqual([
      'Jonny',
    ]);
    expect(extractNameCandidates('nomination for Crowetic')).toEqual([
      'Crowetic',
    ]);
    expect(extractNameCandidates('nominate Simon James for minter')).toEqual([
      'Simon James',
    ]);
  });

  it('still extracts who-is subjects', () => {
    expect(extractNameCandidates('who is Crowetic')[0]?.toLowerCase()).toBe(
      'crowetic'
    );
    expect(extractNameCandidates('who is Simon James')[0]).toBe('Simon James');
  });

  it('keeps Qortal-prefixed spoken names (Qortal Justin)', () => {
    const fromPublish = extractNameCandidates(
      'what did qortal justin publish'
    );
    expect(fromPublish[0]?.toLowerCase()).toBe('qortal justin');

    const fromWho = extractNameCandidates('who is qortal justin');
    expect(fromWho[0]?.toLowerCase()).toBe('qortal justin');

    // Bare Users-chip typing — must NOT collapse to token "Justin".
    expect(extractNameCandidates('Qortal Justin')[0]?.toLowerCase()).toBe(
      'qortal justin'
    );
    expect(extractNameCandidates('qortal justin')[0]?.toLowerCase()).toBe(
      'qortal justin'
    );
  });

  it('extracts names from find-information-about phrasing', () => {
    expect(
      extractNameCandidates('find information about qortal justin please')[0]
        ?.toLowerCase()
    ).toBe('qortal justin');
    expect(
      extractNameCandidates('tell me information about the cat')[0]?.toLowerCase()
    ).toBe('the cat');
  });

  it('keeps The-prefixed names like the cat', () => {
    expect(extractNameCandidates('the cat')[0]?.toLowerCase()).toBe('the cat');
    expect(extractNameCandidates('who is the cat')[0]?.toLowerCase()).toBe(
      'the cat'
    );
  });

  it('extracts publisher from what-did-publish phrasing', () => {
    expect(
      extractNameCandidates('what did PixelMage publish on 24th of July')[0]
        ?.toLowerCase()
    ).toBe('pixelmage');
  });

  it('extracts the person from write-a-poem-about phrasing (not Poem)', () => {
    expect(
      extractNameCandidates('write a poem about Crowetic')[0]?.toLowerCase()
    ).toBe('crowetic');
    expect(
      extractNameCandidates('write a poem about Crowetic').map((x) =>
        x.toLowerCase()
      )
    ).not.toContain('poem');
    expect(
      detectCreativeAboutPersonIntent('write a poem about Crowetic')?.formLabel
    ).toBe('poem');
  });

  it('extracts the person from write-a-message-to phrasing (not Message)', () => {
    const q =
      'write a message to Crowetic and ask him how to become a minter';
    expect(extractNameCandidates(q)[0]?.toLowerCase()).toBe('crowetic');
    expect(
      extractNameCandidates(q).map((x) => x.toLowerCase())
    ).not.toContain('message');
    const intent = detectCreativeAboutPersonIntent(q);
    expect(intent?.formLabel).toBe('message');
    expect(intent?.relation).toBe('to');
  });
});
