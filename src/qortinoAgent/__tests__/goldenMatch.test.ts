import { describe, expect, it } from 'vitest';
import { goldenEntryCount, matchGoldenAnswer } from '../goldenMatch';

describe('matchGoldenAnswer', () => {
  it('loads a full golden set', () => {
    expect(goldenEntryCount()).toBeGreaterThanOrEqual(1600);
    expect(goldenEntryCount()).toBeLessThanOrEqual(1700);
  });

  it('matches core Qortal definition questions', () => {
    const m = matchGoldenAnswer('What is Qortal?');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThan(0.9);
    expect(m!.entry.a.toLowerCase()).toContain('decentralized');
    // Explaining Qortal should not mention "game" at all.
    expect(m!.entry.a.toLowerCase()).not.toMatch(/\bgame\b/);
  });

  it('matches survival water purification', () => {
    const m = matchGoldenAnswer('How do I purify water by boiling?');
    expect(m).not.toBeNull();
    expect(m!.entry.a.toLowerCase()).toMatch(/boil/);
  });

  it('rejects unrelated small talk', () => {
    expect(matchGoldenAnswer('lol thanks')).toBeNull();
  });

  it('does not confuse herb mint with Qortal minting', () => {
    const m = matchGoldenAnswer('how do I grow mint', { minScore: 0.5 });
    expect(m).not.toBeNull();
    expect(m!.entry.category).toBe('gardening');
    expect(m!.entry.a.toLowerCase()).toMatch(/herb|pot|soil/);
    expect(m!.entry.a.toLowerCase()).not.toMatch(/minting rights/);
  });

  it('answers what is a node as Qortal Core, not book metaphor', () => {
    const m = matchGoldenAnswer('what is a node', { minScore: 0.55 });
    expect(m?.entry.id).toBe('qortal-206');
  });
});
