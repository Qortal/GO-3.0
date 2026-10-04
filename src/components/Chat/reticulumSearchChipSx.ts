import { alpha, type Theme } from '@mui/material/styles';

/**
 * The active-filter chips in a group's message search ("from: alice ×").
 * Finger-sized on phones, where the remove icon gets padding so its whole
 * 40px square is the tap target while the glyph stays 22px.
 */
export function reticulumSearchChipSx(theme: Theme, phone: boolean) {
  return {
    backgroundColor: alpha(theme.palette.primary.main, 0.18),
    borderRadius: '4px',
    color: theme.palette.primary.light,
    height: phone ? 40 : 24,
    ...(phone
      ? {
          fontSize: 14,
          '& .MuiChip-label': { pl: 1.25, pr: 0.25 },
          '& .MuiChip-deleteIcon': {
            boxSizing: 'content-box',
            fontSize: 22,
            m: 0,
            p: '9px',
          },
        }
      : {}),
  } as const;
}
