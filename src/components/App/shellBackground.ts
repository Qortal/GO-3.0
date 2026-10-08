import type { Theme } from '@mui/material';

/**
 * The soft wash over the app shell (AuthenticatedShell's ::before), on wide
 * screens only: Home shows it; Chat and the Q-Apps library paint their own
 * background over it. Phones use the plain page colour everywhere.
 */
const SHELL_WASH = {
  dark: { top: 'rgba(255, 255, 255, 0.03)', bottom: 'rgba(9, 11, 15, 0.02)' },
  light: {
    top: 'rgba(255, 255, 255, 0.18)',
    bottom: 'rgba(255, 255, 255, 0.08)',
  },
} as const;

export const shellWashGradient = (theme: Theme): string => {
  const wash = SHELL_WASH[theme.palette.mode];
  return `linear-gradient(to bottom, ${wash.top}, ${wash.bottom})`;
};
