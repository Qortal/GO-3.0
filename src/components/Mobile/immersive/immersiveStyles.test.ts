import { describe, expect, it } from 'vitest';
import { immersiveTopBarSx } from './immersiveStyles';
import type { ImmersiveBars } from './useImmersiveBars';

const bars = (over: Partial<ImmersiveBars>): ImmersiveBars =>
  ({
    active: false,
    barsShown: true,
    layoutShown: true,
    topBarHeight: 53,
    showMs: 280,
    hideMs: 240,
    ...over,
  }) as ImmersiveBars;

describe('immersiveTopBarSx', () => {
  it('leaves the bar in the column, in the page colour when given one', () => {
    expect(immersiveTopBarSx(bars({}))).toEqual({ display: 'contents' });
    expect(immersiveTopBarSx(bars({}), { pageBackground: '#0E0F14' })).toEqual({
      display: 'contents',
      '& > *': {
        background: '#0E0F14 !important',
        borderBottomColor: 'transparent !important',
      },
    });
  });

  it('floats the bar in immersive mode, see-through when asked', () => {
    const sx = immersiveTopBarSx(bars({ active: true }), {
      transparent: true,
    }) as Record<string, unknown>;
    expect(sx.position).toBe('fixed');
    expect(sx['& > *']).toEqual({
      background: 'transparent !important',
      borderBottomColor: 'transparent !important',
    });
    const hidden = immersiveTopBarSx(
      bars({ active: true, barsShown: false })
    ) as Record<string, unknown>;
    expect(hidden.transform).toBe('translateY(-100%)');
    expect(hidden['& > *']).toBeUndefined();
  });
});
