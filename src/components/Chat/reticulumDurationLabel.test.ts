import { describe, expect, it } from 'vitest';
import {
  TIME_DAYS_1_IN_MILLISECONDS,
  TIME_HOURS_1_IN_MILLISECONDS,
  TIME_MONTHS_1_IN_MILLISECONDS,
  TIME_WEEKS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import { formatReticulumDurationLabel } from './reticulumDurationLabel';

describe('formatReticulumDurationLabel', () => {
  it('writes the expiry options in English', () => {
    expect(
      formatReticulumDurationLabel(TIME_DAYS_1_IN_MILLISECONDS, 'en')
    ).toBe('1 day');
    expect(
      formatReticulumDurationLabel(3 * TIME_DAYS_1_IN_MILLISECONDS, 'en')
    ).toBe('3 days');
    expect(
      formatReticulumDurationLabel(TIME_WEEKS_1_IN_MILLISECONDS, 'en')
    ).toBe('1 week');
    expect(
      formatReticulumDurationLabel(TIME_MONTHS_1_IN_MILLISECONDS, 'en')
    ).toBe('1 month');
  });

  it('uses the largest exact unit, then rounds to hours', () => {
    expect(
      formatReticulumDurationLabel(12 * TIME_HOURS_1_IN_MILLISECONDS, 'en')
    ).toBe('12 hours');
    expect(
      formatReticulumDurationLabel(14 * TIME_DAYS_1_IN_MILLISECONDS, 'en')
    ).toBe('2 weeks');
    expect(formatReticulumDurationLabel(90 * 60 * 1000 + 1, 'en')).toBe(
      '2 hours'
    );
  });

  it('follows the user language', () => {
    expect(
      formatReticulumDurationLabel(TIME_WEEKS_1_IN_MILLISECONDS, 'de')
    ).toBe('1 Woche');
    expect(
      formatReticulumDurationLabel(2 * TIME_DAYS_1_IN_MILLISECONDS, 'ru')
    ).toBe('2 дня');
  });

  it('survives a malformed language tag', () => {
    expect(
      formatReticulumDurationLabel(TIME_DAYS_1_IN_MILLISECONDS, 'not a tag')
    ).toMatch(/1/);
  });
});
