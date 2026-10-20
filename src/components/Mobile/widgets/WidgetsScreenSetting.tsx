import { Box, Switch, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { goWidgetsEnabledAtom } from './goWidgets';

/**
 * Settings → System row (GO phones): the widgets screen left of the first
 * section. Off takes the screen away (and stops its widgets); the widgets
 * added stay saved for when it is switched on again.
 */
export function WidgetsScreenSetting({
  switchSx,
}: {
  switchSx?: SxProps<Theme>;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [enabled, setEnabled] = useAtom(goWidgetsEnabledAtom);
  const title = t('group:dashboard.widgets_screen', {
    defaultValue: 'Widgets screen',
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
          {t('group:dashboard.widgets_screen_desc', {
            defaultValue:
              'A screen left of the first section for widgets: small Q-Apps made for GO 3.0, like the time, the weather or news from Torq. Swipe right to get there.',
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
