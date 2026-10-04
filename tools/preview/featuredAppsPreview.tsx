/**
 * Dev-only preview of the Home "Featured Q-Apps" panel at phone widths.
 * Run `npm run dev` and open /tools/preview/featured-apps.html. Not a build
 * input, so it never ships.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { HomeFeaturedApps } from '../../src/components/Group/HomeFeaturedApps';

const WIDTHS = [340, 360, 412, 520];

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [width, setWidth] = useState(360);
  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => setWidth(w)}
            style={{ fontWeight: w === width ? 700 : 400 }}
          >
            {w}px
          </button>
        ))}
        <button onClick={toggleTheme}>{themeMode}</button>
      </div>
      <div style={{ width }}>
        <HomeFeaturedApps />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
