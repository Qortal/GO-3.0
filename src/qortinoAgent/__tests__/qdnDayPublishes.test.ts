import { describe, expect, it } from 'vitest';
import {
  extractDayPublishQuery,
  parseCalendarDay,
} from '../qdnDayPublishes';

describe('qdnDayPublishes', () => {
  it('parses March 1st 2025 as a UTC day window', () => {
    const d = parseCalendarDay('what did Simon James post on March 1st 2025');
    expect(d).not.toBeNull();
    expect(d!.dayLabel).toMatch(/March 1, 2025/);
    expect(d!.beforeMs - d!.afterMs).toBeGreaterThan(80_000_000);
  });

  it('extracts publisher name and day', () => {
    const q = extractDayPublishQuery(
      'What did Simon James post on March 1st 2025?'
    );
    expect(q).not.toBeNull();
    expect(q!.name.toLowerCase()).toContain('simon');
    expect(q!.day.dayLabel).toMatch(/2025/);
  });

  it('handles publishes-across-QDN phrasing', () => {
    const q = extractDayPublishQuery(
      'what were Crowetic publishes across QDN on 2025-03-01'
    );
    expect(q).not.toBeNull();
    expect(q!.name.toLowerCase()).toContain('crowetic');
    expect(q!.day.afterMs).toBe(Date.UTC(2025, 2, 1));
  });

  it('extracts name from trailing for/by/from', () => {
    const q = extractDayPublishQuery(
      'what were that user publishes across QDN on March 1st 2025 for Crowetic'
    );
    expect(q).not.toBeNull();
    expect(q!.name.toLowerCase()).toBe('crowetic');
  });

  it('parses day-of-month without a year (24th of July)', () => {
    const d = parseCalendarDay('what did PixelMage publish on 24th of July');
    expect(d).not.toBeNull();
    expect(d!.dayLabel).toMatch(/July 24/);
    const q = extractDayPublishQuery(
      'what did PixelMage publish on 24th of July'
    );
    expect(q).not.toBeNull();
    expect(q!.name.toLowerCase()).toBe('pixelmage');
  });

  it('keeps Qortal-prefixed names like Qortal Justin', () => {
    const q = extractDayPublishQuery(
      'what did qortal justin publish on July 24 2026'
    );
    expect(q).not.toBeNull();
    expect(q!.name.toLowerCase()).toContain('justin');
    expect(q!.name.toLowerCase()).toContain('qortal');
  });
});


