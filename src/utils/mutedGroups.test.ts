import { describe, expect, it } from 'vitest';
import { isGroupMuted, toggleGroupMute } from './mutedGroups';

describe('isGroupMuted', () => {
  it('matches numeric and string ids alike', () => {
    expect(isGroupMuted([42], '42')).toBe(true);
    expect(isGroupMuted(['42'], 42)).toBe(true);
    expect(isGroupMuted([42], 7)).toBe(false);
  });

  it('is false for a missing list or id', () => {
    expect(isGroupMuted(null, 42)).toBe(false);
    expect(isGroupMuted([42], undefined)).toBe(false);
    expect(isGroupMuted([''], '')).toBe(false);
  });
});

describe('toggleGroupMute', () => {
  it('adds a group that was not muted', () => {
    expect(toggleGroupMute([7], 42)).toEqual([7, 42]);
    expect(toggleGroupMute(undefined, 42)).toEqual([42]);
  });

  it('removes a muted group whatever type it was stored as', () => {
    expect(toggleGroupMute([7, '42'], 42)).toEqual([7]);
    expect(toggleGroupMute([7, 42], '42')).toEqual([7]);
  });
});
