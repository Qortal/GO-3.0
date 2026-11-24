import { afterEach, describe, expect, it } from 'vitest';
import {
  clearGlareCallIdsForTests,
  isGlareCallId,
  rememberGlareCallId,
} from './glareCallIds';

describe('glareCallIds', () => {
  afterEach(() => clearGlareCallIdsForTests());

  it('remembers a glare call for a few minutes', () => {
    rememberGlareCallId('c1', 1_000);
    expect(isGlareCallId('c1', 1_000 + 60_000)).toBe(true);
    expect(isGlareCallId('c1', 1_000 + 4 * 60_000)).toBe(false);
    expect(isGlareCallId('other', 1_000)).toBe(false);
    rememberGlareCallId('', 1_000);
    expect(isGlareCallId('', 1_000)).toBe(false);
  });
});
