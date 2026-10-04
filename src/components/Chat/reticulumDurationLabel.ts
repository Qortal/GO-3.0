import {
  TIME_DAYS_1_IN_MILLISECONDS,
  TIME_HOURS_1_IN_MILLISECONDS,
  TIME_MINUTES_1_IN_MILLISECONDS,
  TIME_MONTHS_1_IN_MILLISECONDS,
  TIME_WEEKS_1_IN_MILLISECONDS,
} from '../../constants/constants';

// Largest unit first; Reticulum's month is a fixed 30 days.
const UNITS = [
  ['month', TIME_MONTHS_1_IN_MILLISECONDS],
  ['week', TIME_WEEKS_1_IN_MILLISECONDS],
  ['day', TIME_DAYS_1_IN_MILLISECONDS],
  ['hour', TIME_HOURS_1_IN_MILLISECONDS],
  ['minute', TIME_MINUTES_1_IN_MILLISECONDS],
] as const;

/**
 * A duration such as a channel's auto-delete time, written out in the
 * user's language: "1 week", "2 days", "1 Woche", "2 дня". Uses the largest
 * unit that divides it exactly, and rounds to hours otherwise.
 */
export function formatReticulumDurationLabel(
  durationMs: number,
  locale?: string
): string {
  const format = (value: number, unit: (typeof UNITS)[number][0]) => {
    try {
      return new Intl.NumberFormat(locale || undefined, {
        style: 'unit',
        unit,
        unitDisplay: 'long',
      }).format(value);
    } catch {
      // An unknown locale tag: fall back to the runtime's language.
      return new Intl.NumberFormat(undefined, {
        style: 'unit',
        unit,
        unitDisplay: 'long',
      }).format(value);
    }
  };
  for (const [unit, unitMs] of UNITS) {
    if (durationMs >= unitMs && durationMs % unitMs === 0) {
      return format(durationMs / unitMs, unit);
    }
  }
  return format(
    Math.max(1, Math.round(durationMs / TIME_HOURS_1_IN_MILLISECONDS)),
    'hour'
  );
}
