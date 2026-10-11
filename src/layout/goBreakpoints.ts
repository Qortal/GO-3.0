import { createBreakpoints } from '@mui/system';
import type { Theme } from '@mui/material/styles';
import { isGoLayout } from './goLayout';

/** md/lg/xl unreachable on GO; finite and ascending (Infinity yields an invalid query). */
export const GO_BREAKPOINT_VALUES = {
  xs: 0,
  sm: 600,
  md: 100000,
  lg: 100001,
  xl: 100002,
};

/**
 * GO always runs the phone shell, so only the breakpoint functions move md and
 * up out of reach. `values`, `keys` and `unit` stay as they are, so anything
 * that reads the numbers (Dialog maxWidth, numeric queries) is unchanged.
 */
export function withGoBreakpoints<T extends Theme>(
  theme: T,
  go: boolean = isGoLayout()
): T {
  if (!go) return theme; // Hub: the very same object
  const g = createBreakpoints({ values: { ...GO_BREAKPOINT_VALUES } });
  theme.breakpoints = {
    ...theme.breakpoints,
    up: g.up,
    down: g.down,
    between: g.between,
    only: g.only,
    not: g.not,
  };
  return theme;
}
