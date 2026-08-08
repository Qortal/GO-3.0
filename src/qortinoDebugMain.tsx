import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from './components/Theme/ThemeContext';
import { QortinoDebugPage } from './components/Group/QortinoAgent/QortinoDebugPage';
import '../src/styles/index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <QortinoDebugPage />
  </ThemeProvider>
);
