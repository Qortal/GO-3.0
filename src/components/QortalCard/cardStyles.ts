import { alpha, type Theme } from '@mui/material/styles';

/** A rounded surface, like the cards in the Updates window. */
export const surfaceSx = (theme: Theme) => ({
  backgroundColor:
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.04)
      : alpha(theme.palette.common.black, 0.03),
  border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
  borderRadius: '14px',
  p: 1.5,
});

export const labelSx = (theme: Theme) => ({
  color: theme.palette.text.secondary,
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
});

export type NoteTone = 'info' | 'warning' | 'success' | 'error';

export const noteSx = (theme: Theme, tone: NoteTone) => {
  const color = theme.palette[tone].main;
  return {
    alignItems: 'flex-start',
    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.14 : 0.09),
    border: `1px solid ${alpha(color, 0.35)}`,
    borderRadius: '12px',
    color: theme.palette.text.primary,
    display: 'flex',
    fontSize: '0.8rem',
    gap: 1,
    lineHeight: 1.45,
    px: 1.25,
    py: 1,
  };
};

/** Qxxxxx…xxxx: enough to recognise an address at a glance. */
export const shortAddress = (address: string): string =>
  address && address.length > 14
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
