import { describe, expect, it } from 'vitest';
import { createTheme } from '@mui/material/styles';
import type { Breakpoint } from '@mui/material/styles';
import { GO_BREAKPOINT_VALUES, withGoBreakpoints } from '../goBreakpoints';
import { lightTheme } from '../../styles/theme-light';
import { darkTheme } from '../../styles/theme-dark';

const KEYS: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl'];

function queries(theme: ReturnType<typeof createTheme>) {
  const b = theme.breakpoints;
  const out: string[] = [];
  for (const k of KEYS) {
    out.push(b.up(k), b.down(k), b.only(k), b.not(k));
    for (const k2 of KEYS) out.push(b.between(k, k2));
  }
  out.push(b.up(1250), b.down(964));
  return out;
}

describe('withGoBreakpoints', () => {
  it('returns the very same theme on the Hub, with stock queries', () => {
    const theme = createTheme();
    const before = queries(theme);
    expect(withGoBreakpoints(theme, false)).toBe(theme);
    expect(queries(theme)).toEqual(before);
    expect(queries(theme)).toEqual(queries(createTheme()));
  });

  it('leaves the app themes stock in tests (isGoLayout() is false)', () => {
    expect(queries(lightTheme)).toEqual(queries(createTheme()));
    expect(queries(darkTheme)).toEqual(queries(createTheme()));
  });

  it('makes md and up unreachable on GO', () => {
    const stock = createTheme();
    const theme = withGoBreakpoints(createTheme(), true);
    const b = theme.breakpoints;

    expect(b.down('md')).toBe('@media (max-width:99999.95px)');
    expect(b.up('md')).toBe('@media (min-width:100000px)');
    expect(b.up('lg')).toContain('100001');
    expect(b.between('sm', 'md')).toBe(
      '@media (min-width:600px) and (max-width:99999.95px)'
    );
    expect(b.down('sm')).toBe(stock.breakpoints.down('sm'));
    expect(b.up('sm')).toBe(stock.breakpoints.up('sm'));
    // Numeric queries (Dialog's own down(964), the 1250 dashboard) unchanged.
    expect(b.down(964)).toBe(stock.breakpoints.down(964));
    expect(b.up(1250)).toBe(stock.breakpoints.up(1250));
  });

  it('keeps values, keys and unit, so Dialog widths do not change', () => {
    const theme = withGoBreakpoints(createTheme(), true);
    expect(theme.breakpoints.values.md).toBe(900);
    expect(theme.breakpoints.values).toEqual(createTheme().breakpoints.values);
    expect(theme.breakpoints.keys).toEqual(KEYS);
    expect(theme.breakpoints.unit).toBe('px');
    expect(GO_BREAKPOINT_VALUES.md).toBeGreaterThan(GO_BREAKPOINT_VALUES.sm);
  });

  it('routes sx breakpoint objects through the GO queries', () => {
    const theme = withGoBreakpoints(createTheme(), true);
    const css = theme.unstable_sx({ display: { xs: 'a', md: 'b' } }) as Record<
      string,
      unknown
    >;
    const mdKey = Object.keys(css).find((k) =>
      k.includes('min-width:100000px')
    );
    expect(mdKey).toBeDefined();
    expect(css[mdKey!]).toEqual({ display: 'b' });
    expect(JSON.stringify(css)).not.toContain('min-width:900px');
  });
});
