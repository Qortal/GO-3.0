import { describe, expect, it } from 'vitest';
import { isImmersiveSurface, normalizeImmersiveMode } from './immersiveMode';

describe('immersive mode settings', () => {
  it('reads anything unknown as the default, Auto', () => {
    expect(normalizeImmersiveMode('auto')).toBe('auto');
    expect(normalizeImmersiveMode('manual')).toBe('manual');
    expect(normalizeImmersiveMode('off')).toBe('off');
    expect(normalizeImmersiveMode('full')).toBe('auto');
    expect(normalizeImmersiveMode(undefined)).toBe('auto');
  });

  it('goes full screen in Q-Apps only, never on Home or in Chat', () => {
    expect(isImmersiveSurface('home')).toBe(false);
    expect(isImmersiveSurface('apps')).toBe(true);
    expect(isImmersiveSurface('dev')).toBe(true);
    expect(isImmersiveSurface('chat')).toBe(false);
    expect(isImmersiveSurface('wallet')).toBe(false);
  });
});
