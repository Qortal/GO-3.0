import { Box, ButtonBase, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import HeadphonesRoundedIcon from '@mui/icons-material/HeadphonesRounded';
import { useTranslation } from 'react-i18next';
import { openBackgroundPlayerWindow } from './backgroundPlayer';

/**
 * Settings → System row (GO phones): opens the background player settings
 * (audio and video off screen, the notification and lock screen player).
 */
export function BackgroundPlayerSetting() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <ButtonBase
      data-testid="background-player-setting"
      onClick={openBackgroundPlayerWindow}
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'space-between',
        px: 1.35,
        py: 1.2,
        textAlign: 'left',
        width: '100%',
      }}
    >
      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          gap: 1.1,
          minWidth: 0,
        }}
      >
        <HeadphonesRoundedIcon
          sx={{ color: theme.palette.primary.light, fontSize: 20, mt: 0.1 }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.82rem',
              fontWeight: 700,
              letterSpacing: '0.01em',
            }}
          >
            {t('core:go_player.title')}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.75rem',
              lineHeight: 1.45,
              mt: 0.4,
            }}
          >
            {t('core:go_player.setting_row_desc')}
          </Typography>
        </Box>
      </Box>
      <ChevronRightRoundedIcon
        sx={{ color: alpha(theme.palette.text.secondary, 0.8), flexShrink: 0 }}
      />
    </ButtonBase>
  );
}
