import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import PhonelinkRingRoundedIcon from '@mui/icons-material/PhonelinkRingRounded';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listIncomingPayments,
  type IncomingPayment,
} from '../../qortalCard/cardNode';
import { formatQortUnits } from '../../qortalCard/cardTx';
import { putOutTapRequest } from '../../qortalCard/qortalNfc';
import { encodeTapRequest } from '../../qortalCard/tapRequest';
import { cardErrorText } from './cardErrorText';
import { noteSx, shortAddress, surfaceSx } from './cardStyles';

/** How long a request stays out. */
const PHONE_REQUEST_TTL_MS = 120_000;
const POLL_MS = 3_000;

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.75; }
`;

type Phase =
  | { state: 'waiting'; read: boolean }
  | { state: 'paid'; payment: IncomingPayment }
  | { state: 'expired' }
  | { state: 'failed'; message: string };

/**
 * This phone asks for QORT: the request goes out over NFC for another GO
 * phone to read (Send tab there), and the node is watched for the payment,
 * unconfirmed ones included.
 */
export function PhoneRequestView({
  address,
  amount,
  onDone,
}: {
  address: string;
  /** In 1e-8 QORT, or null to let the payer type it. */
  amount: bigint | null;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [phase, setPhase] = useState<Phase>({ state: 'waiting', read: false });

  useEffect(() => {
    let live = true;
    let stopRequest: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const end = () => {
      stopRequest?.();
      if (poll) clearInterval(poll);
      if (expiry) clearTimeout(expiry);
    };

    void (async () => {
      try {
        // Payments already there do not count.
        const seen = new Set(
          (await listIncomingPayments(address).catch(() => [])).map(
            (payment) => payment.signature
          )
        );
        if (!live) return;
        stopRequest = await putOutTapRequest(
          encodeTapRequest({ address, amount }),
          PHONE_REQUEST_TTL_MS,
          () => live && setPhase({ state: 'waiting', read: true })
        );
        if (!live) {
          stopRequest();
          return;
        }
        poll = setInterval(async () => {
          const payments = await listIncomingPayments(address).catch(() => []);
          const match = payments.find(
            (payment) =>
              !seen.has(payment.signature) &&
              (amount === null || payment.amount === amount)
          );
          if (live && match) {
            end();
            navigator.vibrate?.([30, 60, 30]);
            setPhase({ state: 'paid', payment: match });
          }
        }, POLL_MS);
        expiry = setTimeout(() => {
          end();
          if (live) setPhase({ state: 'expired' });
        }, PHONE_REQUEST_TTL_MS);
      } catch (error) {
        end();
        if (live)
          setPhase({ state: 'failed', message: cardErrorText(t, error) });
      }
    })();

    return () => {
      live = false;
      end();
    };
  }, [address, amount, t]);

  if (phase.state === 'paid') {
    return (
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
        <CheckCircleRoundedIcon
          sx={{ color: theme.palette.success.main, fontSize: 64 }}
        />
        <Typography sx={{ fontSize: '1.3rem', fontWeight: 800 }}>
          {t('core:qortal_card.request.received', {
            amount: formatQortUnits(phase.payment.amount),
          })}
        </Typography>
        {phase.payment.from && (
          <Typography sx={{ color: theme.palette.text.secondary }}>
            {t('core:qortal_card.request.received_from', {
              address: shortAddress(phase.payment.from),
            })}
          </Typography>
        )}
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem' }}
        >
          {t('core:qortal_card.pay.confirm_time')}
        </Typography>
        <Button onClick={onDone} sx={{ mt: 1 }} variant="contained">
          {t('core:qortal_card.pay.new')}
        </Button>
      </Box>
    );
  }

  if (phase.state === 'expired' || phase.state === 'failed') {
    return (
      <Box sx={{ ...surfaceSx(theme), display: 'grid', gap: 1.25 }}>
        <Box role="alert" sx={noteSx(theme, 'error')}>
          {phase.state === 'expired'
            ? t('core:qortal_card.request.expired')
            : phase.message}
        </Box>
        <Button onClick={onDone} variant="contained">
          {t('core:qortal_card.pay.new')}
        </Button>
      </Box>
    );
  }

  return (
    <Box
      aria-live="polite"
      sx={{
        ...surfaceSx(theme),
        display: 'grid',
        gap: 1.25,
        justifyItems: 'center',
        py: 3,
        textAlign: 'center',
      }}
    >
      <PhonelinkRingRoundedIcon
        sx={{
          animation: `${pulse} 1.6s ease-in-out infinite`,
          color: theme.palette.primary.main,
          fontSize: 64,
        }}
      />
      <Typography sx={{ fontSize: '1.05rem', fontWeight: 750 }}>
        {amount !== null
          ? t('core:qortal_card.request.asking', {
              amount: formatQortUnits(amount),
            })
          : t('core:qortal_card.request.asking_any')}
      </Typography>
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.85rem' }}
      >
        {phase.read
          ? t('core:qortal_card.request.read')
          : t('core:qortal_card.request.how')}
      </Typography>
      {phase.read && <CircularProgress size={28} />}
      <Button onClick={onDone} variant="outlined">
        {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
      </Button>
    </Box>
  );
}
