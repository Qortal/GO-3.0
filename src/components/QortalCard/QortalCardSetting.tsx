import { Box, Switch, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { qortalCardEnabledAtom } from '../../atoms/qortalCard';

/**
 * Settings → System row (GO phones): turns Qortal Card on. While on, the
 * avatar menu shows Qortal Card right below Notifications.
 */
export function QortalCardSetting({ switchSx }: { switchSx?: SxProps<Theme> }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [enabled, setEnabled] = useAtom(qortalCardEnabledAtom);

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
          {t('core:qortal_card.setting.title')}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
            lineHeight: 1.45,
            mt: 0.4,
          }}
        >
          {t('core:qortal_card.setting.description')}
        </Typography>
      </Box>
      <Switch
        checked={enabled}
        inputProps={{ 'aria-label': t('core:qortal_card.setting.title') }}
        onChange={(event) => setEnabled(event.target.checked)}
        sx={switchSx}
      />
    </Box>
  );
}
