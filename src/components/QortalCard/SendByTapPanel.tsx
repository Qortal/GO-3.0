import PhonelinkRingRoundedIcon from '@mui/icons-material/PhonelinkRingRounded';
import { Box, Button, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { closeQortalCardWindow } from '../../atoms/qortalCard';
import { formatQortUnits } from '../../qortalCard/cardTx';
import { readTapRequest } from '../../qortalCard/tapRequest';
import { executeEvent } from '../../utils/events';
import { cardErrorText, isCancelled } from './cardErrorText';
import { noteSx, surfaceSx } from './cardStyles';
import type { RunWithCard } from './useCardTap';

/**
 * Send to another GO phone: the other phone asks for QORT (Take payment →
 * GO phone), this phone reads the request by tapping, then GO's own Send
 * QORT screen opens with the address and amount filled in. Nothing is sent
 * until the user confirms there, with their wallet as always.
 */
export function SendByTapPanel({
  nfcReady,
  run,
}: {
  nfcReady: boolean;
  run: RunWithCard;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const request = await run(
        t('core:qortal_card.prompt.send'),
        (device) => readTapRequest(device),
        { retries: 2 }
      );
      closeQortalCardWindow();
      executeEvent('openPaymentInternal', {
        address: request.address,
        ...(request.amount !== null
          ? { amount: formatQortUnits(request.amount) }
          : {}),
      });
    } catch (failure) {
      if (!isCancelled(failure)) setError(cardErrorText(t, failure));
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {error && (
        <Box role="alert" sx={noteSx(theme, 'error')}>
          {error}
        </Box>
      )}
      <Box
        sx={{
          ...surfaceSx(theme),
          display: 'grid',
          gap: 1,
          justifyItems: 'center',
          py: 3,
          textAlign: 'center',
        }}
      >
        <PhonelinkRingRoundedIcon
          sx={{ color: theme.palette.primary.main, fontSize: 56 }}
        />
        <Typography sx={{ fontWeight: 750 }}>
          {t('core:qortal_card.send.title')}
        </Typography>
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.85rem' }}
        >
          {t('core:qortal_card.send.how')}
        </Typography>
      </Box>
      <Button
        disabled={!nfcReady}
        onClick={() => void start()}
        size="large"
        sx={{ py: 1.4 }}
        variant="contained"
      >
        {t('core:qortal_card.send.start')}
      </Button>
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem' }}
      >
        {t('core:qortal_card.send.safety')}
      </Typography>
    </Box>
  );
}
