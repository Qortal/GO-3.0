import { describe, expect, it } from 'vitest';
import { resolveFollowUpQuery } from '../qdnFollowUpContext';
import { extractCompareNames } from '../qdnCompare';
import { parseTimeRange } from '../qdnDayPublishes';
import { detectTopicMediaIntent } from '../qdnTopicMedia';
import { detectMintingCoachIntent } from '../qdnMintingCoach';
import { extractGroupDigestQuery } from '../qdnGroupDigest';

describe('follow-up + extras', () => {
  it('resolves that user from prior profile', () => {
    const r = resolveFollowUpQuery('what did that user publish last week', [
      {
        role: 'assistant',
        content: 'Crowetic is…',
        profiles: [{ name: 'Crowetic' }],
      },
    ]);
    expect(r.text.toLowerCase()).toContain('crowetic');
    expect(r.text.toLowerCase()).toContain('last week');
  });

  it('resolves he/she to the prior profile (not a name search)', () => {
    const r = resolveFollowUpQuery('What did he publish on june 12th', [
      {
        role: 'user',
        content: 'What did qortal justin publish on may 17th',
      },
      {
        role: 'assistant',
        content: 'I didn’t find QDN publishes from Qortal Justin…',
        profiles: [{ name: 'Qortal Justin' }],
      },
    ]);
    expect(r.text.toLowerCase()).toContain('qortal justin');
    expect(r.text.toLowerCase()).toMatch(/june\s+12/);
    expect(r.text.toLowerCase()).not.toMatch(/\bhe\b/);
  });

  it('parses last week range', () => {
    const r = parseTimeRange('publishes last week');
    expect(r).not.toBeNull();
    expect(r!.beforeMs - r!.afterMs).toBeGreaterThan(6 * 86_400_000);
  });

  it('parses March 2025 month window', () => {
    const r = parseTimeRange('images of dogs from March 2025');
    expect(r).not.toBeNull();
    expect(r!.dayLabel.toLowerCase()).toContain('march');
  });

  it('detects dated topic media', () => {
    const intent = detectTopicMediaIntent(
      'show me images of the dogs from March 2025'
    );
    expect(intent).not.toBeNull();
    expect(intent!.subject).toBe('dog');
    expect(intent!.range).not.toBeNull();
  });

  it('extracts compare names', () => {
    expect(extractCompareNames('compare Crowetic vs Simon James')).toEqual([
      'Crowetic',
      'Simon James',
    ]);
  });

  it('detects minting coach', () => {
    expect(detectMintingCoachIntent('what is my minting level?')).toBe(true);
    expect(detectMintingCoachIntent('what is minting?')).toBe(false);
  });

  it('extracts group digest query', () => {
    const q = extractGroupDigestQuery(
      "what's new in Welcome to Qortal this week?"
    );
    expect(q).not.toBeNull();
    expect(q!.groupName.toLowerCase()).toContain('welcome');
  });
});
