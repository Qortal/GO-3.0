import { useEffect, useState } from 'react';
import type { Theme } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme-dark';
import { lightTheme } from '../../../styles/theme-light';
import { EDGE_CROSSFADE_MS, edgeControlsMode } from './ImmersiveEdges';

/**
 * The theme the floating top bar draws its own controls in (search field,
 * Tabs button, avatar ring) while it floats see-through on the page colour
 * immersive mode paints behind it: the one that reads on that colour, so a
 * light page gets a light bar even in GO's dark theme (and the other way
 * round). A new colour takes over halfway through its cross-fade, when it
 * starts to show more than the old one. Undefined: GO's own theme.
 */
export function useImmersiveBarTheme(
  edgeColor: string | null,
  appMode: 'light' | 'dark',
  enabled: boolean
): Theme | undefined {
  const target = edgeControlsMode(edgeColor);
  const [shown, setShown] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    if (target === shown) return;
    const timer = window.setTimeout(
      () => setShown(target),
      target === null ? 0 : EDGE_CROSSFADE_MS / 2
    );
    return () => window.clearTimeout(timer);
  }, [target, shown]);

  if (!enabled || shown === null || shown === appMode) return undefined;
  return shown === 'light' ? lightTheme : darkTheme;
}
