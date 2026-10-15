import ContactlessRoundedIcon from '@mui/icons-material/ContactlessRounded';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';
import { noteSx } from './cardStyles';
import type { CardTapState } from './useCardTap';

const pulse = keyframes`
  0% { transform: scale(0.85); opacity: 0.55; }
  70% { transform: scale(1.35); opacity: 0; }
  100% { transform: scale(1.35); opacity: 0; }
`;

/**
 * Bottom sheet over the Qortal Card window while GO waits for a card or reads
 * it. Lives inside the window's paper, so it never fights other dialogs.
 */
export function CardTapPrompt({
  tap,
  onCancel,
}: {
  tap: CardTapState;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const working = tap.phase === 'working';

  return (
    <Box
      sx={{
        backgroundColor: alpha(theme.palette.common.black, 0.45),
        display: 'flex',
        flexDirection: 'column',
        inset: 0,
        justifyContent: 'flex-end',
        position: 'absolute',
        zIndex: 2,
      }}
    >
      <Box
        aria-live="polite"
        role="status"
        sx={{
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          borderTopLeftRadius: '22px',
          borderTopRightRadius: '22px',
          boxShadow: theme.shadows[12],
          display: 'grid',
          gap: 1.25,
          justifyItems: 'center',
          pb: `calc(${SAFE_AREA_BOTTOM} + 20px)`,
          pt: 3,
          px: 2.5,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: 96,
            justifyContent: 'center',
            position: 'relative',
            width: 96,
          }}
        >
          {!working && (
            <Box
              sx={{
                animation: `${pulse} 1.6s ease-out infinite`,
                border: `3px solid ${theme.palette.primary.main}`,
                borderRadius: '50%',
                inset: 0,
                position: 'absolute',
              }}
            />
          )}
          {working ? (
            <CircularProgress size={56} thickness={3} />
          ) : (
            <ContactlessRoundedIcon
              sx={{ color: theme.palette.primary.main, fontSize: 64 }}
            />
          )}
        </Box>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 750 }}>
          {working ? t('core:qortal_card.prompt.keep_holding') : tap.prompt}
        </Typography>
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.85rem' }}
        >
          {t('core:qortal_card.prompt.hint')}
        </Typography>
        {tap.retry && !working && (
          <Box sx={{ ...noteSx(theme, 'warning'), textAlign: 'left' }}>
            {t('core:qortal_card.prompt.retry')}
          </Box>
        )}
        {tap.otherTag && !working && (
          <Box sx={{ ...noteSx(theme, 'warning'), textAlign: 'left' }}>
            {t('core:qortal_card.prompt.other_tag')}
          </Box>
        )}
        {!working && (
          <Button onClick={onCancel} sx={{ mt: 0.5 }} variant="outlined">
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        )}
      </Box>
    </Box>
  );
}
