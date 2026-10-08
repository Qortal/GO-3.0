import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMMERSIVE_PILL_POSITION,
  isImmersiveSurface,
  normalizeImmersiveMode,
  normalizeImmersivePillPosition,
} from './immersiveMode';

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

  it('keeps the button position on screen', () => {
    expect(normalizeImmersivePillPosition({ side: 'left', y: 0.2 })).toEqual({
      side: 'left',
      y: 0.2,
    });
    expect(normalizeImmersivePillPosition({ side: 'up', y: 7 })).toEqual({
      side: 'right',
      y: 1,
    });
    expect(normalizeImmersivePillPosition(null)).toEqual(
      DEFAULT_IMMERSIVE_PILL_POSITION
    );
  });
});
