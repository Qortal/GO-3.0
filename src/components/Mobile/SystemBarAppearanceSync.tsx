import { useEffect } from 'react';
import { decomposeColor, hslToRgb, useTheme } from '@mui/material/styles';
import { isGoLayout } from '../../layout/goLayout';
import { setSystemBarAppearance } from './immersive/immersiveNative';

/**
 * A CSS colour as #rrggbb (alpha dropped), or null when it cannot be read
 * (named colours, color(), var()), in which case native keeps its colour.
 */
export function toRrggbb(color: unknown): string | null {
  if (typeof color !== 'string' || !color.trim()) return null;
  try {
    let parsed = decomposeColor(color.trim());
    if (parsed.type.startsWith('hsl')) {
      parsed = decomposeColor(hslToRgb(color.trim()));
    }
    if (!parsed.type.startsWith('rgb')) return null;
    const channels = parsed.values.slice(0, 3).map((v) => Number(v));
    if (channels.length !== 3 || channels.some((v) => !Number.isFinite(v))) {
      return null;
    }
    return `#${channels
      .map((v) =>
        Math.min(255, Math.max(0, Math.round(v)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;
  } catch {
    return null;
  }
}

/**
 * Keeps the Android status/nav bar icon colour in step with the theme on GO
 * (dark icons on the light theme), and the window behind the WebView in the
 * page background so landscape side gutters match. Mounted inside
 * ThemeProvider by main.tsx; renders nothing, and does nothing off GO.
 *
 * Waits while index.html's dark #app-splash is up (main.tsx removes it after
 * the first paint): the window's own light icons and splash-coloured
 * background match it, and dark icons would vanish on it.
 */
export function SystemBarAppearanceSync(): null {
  const theme = useTheme();
  const go = isGoLayout();
  const light = theme.palette.mode === 'light';
  const background = toRrggbb(theme.palette.background?.default);

  useEffect(() => {
    if (!go) return;
    const apply = () =>
      setSystemBarAppearance({
        lightStatus: light,
        lightNav: light,
        ...(background ? { background } : {}),
      });
    const splash = document.getElementById('app-splash');
    const parent = splash?.parentNode;
    if (!splash || !parent) {
      apply();
      return;
    }
    const observer = new MutationObserver(() => {
      if (splash.isConnected) return;
      observer.disconnect();
      apply();
    });
    observer.observe(parent, { childList: true });
    return () => observer.disconnect();
  }, [go, light, background]);

  return null;
}
