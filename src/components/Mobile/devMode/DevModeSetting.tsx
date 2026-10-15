import { Box, Switch, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { goDevModeEnabledAtom } from './devModeApp';

/**
 * Settings → System row (GO phones): turns Dev Mode on. While on, the Pinned
 * tab of the Q-Apps library shows a Dev Mode button next to New folder.
 */
export function DevModeSetting({ switchSx }: { switchSx?: SxProps<Theme> }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [enabled, setEnabled] = useAtom(goDevModeEnabledAtom);
  const title = t('core:go_dev_mode.title', {
    postProcess: 'capitalizeFirstChar',
  });

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'space-between',
        px: 1.35,
        py: 1.2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.82rem',
            fontWeight: 700,
            letterSpacing: '0.01em',
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
            lineHeight: 1.45,
            mt: 0.4,
          }}
        >
          {t('core:go_dev_mode.setting_description', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </Box>
      <Switch
        checked={enabled}
        inputProps={{ 'aria-label': title }}
        onChange={(event) => setEnabled(event.target.checked)}
        sx={switchSx}
      />
    </Box>
  );
}
