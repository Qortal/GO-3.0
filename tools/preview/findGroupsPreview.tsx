/**
 * Dev-only preview of the Find groups panel (full screen on phones). With
 * no node the group list stays empty; the search field, the filter chips
 * and the list frame show. Run `npm run dev` and open
 * /tools/preview/find-groups.html. Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CssBaseline } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { FindGroupModal } from '../../src/components/Group/FindGroupModal';

const Preview = () => {
  const [open, setOpen] = useState(true);
  return (
    <FindGroupModal
      open={open}
      setOpen={setOpen}
      onOpenJoinedGroup={() => undefined}
    />
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
