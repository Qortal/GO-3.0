import { describe, expect, it } from 'vitest';
import {
  reticulumDisplayLabel,
  reticulumDisplayPhase,
} from './reticulumStatus';

describe('reticulumDisplayPhase', () => {
  it('shows connecting when transport is up but no peers', () => {
    expect(reticulumDisplayPhase('online', 0, true)).toBe('connecting');
    expect(reticulumDisplayLabel(reticulumDisplayPhase('online', 0, true))).toBe(
      'connecting'
    );
  });

  it('shows online only after peers are reached', () => {
    expect(reticulumDisplayPhase('online', 3, true)).toBe('online');
    expect(reticulumDisplayLabel(reticulumDisplayPhase('online', 3, true))).toBe(
      'online'
    );
  });

  it('shows offline when the phone has no network', () => {
    expect(reticulumDisplayPhase('online', 5, false)).toBe('offline');
    expect(reticulumDisplayPhase('connecting', 0, false)).toBe('offline');
    expect(reticulumDisplayLabel(reticulumDisplayPhase('online', 5, false))).toBe(
      'offline'
    );
  });

  it('shows online when peers are live even if transport reports offline', () => {
    expect(reticulumDisplayPhase('offline', 4, true)).toBe('online');
  });
});
