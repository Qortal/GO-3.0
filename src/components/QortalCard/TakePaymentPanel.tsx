import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ContactlessRoundedIcon from '@mui/icons-material/ContactlessRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import PhoneAndroidRoundedIcon from '@mui/icons-material/PhoneAndroidRounded';
import PhonelinkRingRoundedIcon from '@mui/icons-material/PhonelinkRingRounded';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  signChargeOnCard,
  type SignedCharge,
} from '../../qortalCard/cardFlows';
import {
  broadcastSignedTx,
  fetchPrimaryName,
  fetchQortBalance,
  fetchUnitFee,
} from '../../qortalCard/cardNode';
import { formatQortUnits, parseQortAmount } from '../../qortalCard/cardTx';
import { QdnNameAvatar } from '../common/QdnNameAvatar';
import { cardErrorText, isCancelled } from './cardErrorText';
import { labelSx, noteSx, shortAddress, surfaceSx } from './cardStyles';
import { PhoneRequestView } from './PhoneRequestView';
import type { RunWithCard } from './useCardTap';

/** Who pays: a Qortal Card, or another GO phone. */
type Payer = 'card' | 'phone';

type Outcome =
  | { state: 'idle' }
  | { state: 'sending' }
  | {
      state: 'paid';
      amount: bigint;
      from: string;
      /** What the card holds after this payment, when the node said. */
      left: bigint | null;
    }
  | {
      state: 'failed';
      message: string;
      amount: bigint;
      /**
       * tap: the card part failed, tap again. other-card: the card is short,
       * tap another one. send: the node did not take it, send the very same
       * signed payment again (never a second one).
       */
      retry: 'tap' | 'other-card' | 'send';
      signed: SignedCharge | null;
    };

/**
 * Take payment. From a card: the shop types an amount in QORT, the buyer
 * holds their card to the phone, the card signs a payment to this account,
 * GO checks the signature and the card's balance, then sends it. From a GO
 * phone: this phone puts out a request the other phone reads by tapping, and
 * the other phone pays from its own wallet.
 */
export function TakePaymentPanel({
  address,
  nfcReady,
  canRequest,
  run,
}: {
  address: string;
  nfcReady: boolean;
  /** This phone can put out a request for a GO phone (NFC card emulation). */
  canRequest: boolean;
  run: RunWithCard;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [amountText, setAmountText] = useState('');
  const [fee, setFee] = useState<bigint | null>(null);
  const [feeFailed, setFeeFailed] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });
  const [payer, setPayer] = useState<Payer>('card');
  /** The paying card's name on chain, once known. */
  const [payerName, setPayerName] = useState<string | null>(null);
  /** The amount a request to a GO phone is out for (null: any amount). */
  const [requesting, setRequesting] = useState<{
    amount: bigint | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    fetchUnitFee('payment')
      .then((value) => live && setFee(value))
      .catch(() => live && setFeeFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const amount = parseQortAmount(amountText);
  const fromPhone = canRequest && payer === 'phone';
  const canCharge =
    nfcReady && amount !== null && fee !== null && outcome.state === 'idle';
  // A GO phone may be asked for "any amount": the payer types it there.
  const canAsk = nfcReady && (amountText.trim() === '' || amount !== null);

  const send = async (signed: SignedCharge, charged: bigint) => {
    setOutcome({ state: 'sending' });
    const balance = await fetchQortBalance(signed.cardAddress).catch(
      () => null
    );
    const needed = charged + (fee ?? 0n);
    if (balance !== null && balance < needed) {
      setOutcome({
        state: 'failed',
        message: t('core:qortal_card.pay.not_enough', {
          balance: formatQortUnits(balance),
          needed: formatQortUnits(needed),
        }),
        amount: charged,
        retry: 'other-card',
        signed: null,
      });
      return;
    }
    const result = await broadcastSignedTx(signed.signedBase58);
    if (result.ok === true) {
      navigator.vibrate?.([30, 60, 30]);
      setPayerName(null);
      setOutcome({
        state: 'paid',
        amount: charged,
        from: signed.cardAddress,
        left: balance !== null ? balance - needed : null,
      });
      // Show the card's name and avatar when it has one.
      void fetchPrimaryName(signed.cardAddress)
        .then(setPayerName)
        .catch(() => undefined);
    } else {
      setOutcome({
        state: 'failed',
        message: t('core:qortal_card.pay.failed', { message: result.message }),
        amount: charged,
        retry: 'send',
        signed,
      });
    }
  };

  /** One tap of a card for `charged`. Nothing is sent unless it signs. */
  const chargeFor = async (charged: bigint) => {
    if (fee === null) return;
    try {
      const signed = await run(
        t('core:qortal_card.prompt.charge', {
          amount: formatQortUnits(charged),
        }),
        (card) =>
          signChargeOnCard(card, { recipient: address, amount: charged, fee }),
        // Safe to ask again: only a checked signature leaves this tap.
        { retries: 3 }
      );
      await send(signed, charged);
    } catch (error) {
      if (isCancelled(error)) {
        setOutcome({ state: 'idle' });
        return;
      }
      setOutcome({
        state: 'failed',
        message: cardErrorText(t, error),
        amount: charged,
        retry: 'tap',
        signed: null,
      });
    }
  };

  const charge = () => {
    if (canCharge) void chargeFor(amount);
  };

  const reset = () => {
    setOutcome({ state: 'idle' });
    setRequesting(null);
    setAmountText('');
    setPayerName(null);
  };

  if (requesting) {
    return (
      <PhoneRequestView
        address={address}
        amount={requesting.amount}
        onDone={reset}
      />
    );
  }

  const sentence = (key: string) =>
    t(key, { postProcess: 'capitalizeFirstChar' });

  if (outcome.state === 'sending') {
    return (
      <Box
        sx={{
          ...surfaceSx(theme),
          alignItems: 'center',
          display: 'grid',
          gap: 1.5,
          justifyItems: 'center',
          py: 4,
        }}
      >
        <CircularProgress />
        <Typography>{t('core:qortal_card.pay.sending')}</Typography>
      </Box>
    );
  }

  if (outcome.state === 'paid') {
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
          {t('core:qortal_card.pay.paid', {
            amount: formatQortUnits(outcome.amount),
          })}
        </Typography>
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
          {payerName && (
            <QdnNameAvatar
              alt={payerName}
              avatarName={payerName}
              sx={{ height: 32, width: 32 }}
            >
              {payerName.charAt(0)}
            </QdnNameAvatar>
          )}
          <Typography sx={{ color: theme.palette.text.secondary }}>
            {payerName
              ? t('core:qortal_card.pay.paid_from_name', { name: payerName })
              : t('core:qortal_card.pay.paid_from', {
                  address: shortAddress(outcome.from),
                })}
          </Typography>
        </Box>
        {outcome.left !== null && (
          <Typography sx={{ fontSize: '0.85rem' }}>
            {t('core:qortal_card.pay.balance_left', {
              amount: formatQortUnits(outcome.left),
            })}
          </Typography>
        )}
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem' }}
        >
          {t('core:qortal_card.pay.confirm_time')}
        </Typography>
        <Button onClick={reset} sx={{ mt: 1 }} variant="contained">
          {t('core:qortal_card.pay.new')}
        </Button>
      </Box>
    );
  }

  if (outcome.state === 'failed') {
    const { retry, signed } = outcome;
    const again = () => {
      if (retry === 'send' && signed) void send(signed, outcome.amount);
      else void chargeFor(outcome.amount);
    };
    return (
      <Box sx={{ ...surfaceSx(theme), display: 'grid', gap: 1.25 }}>
        <Box sx={noteSx(theme, 'error')} role="alert">
          <ErrorOutlineRoundedIcon fontSize="small" />
          <span>{outcome.message}</span>
        </Box>
        <Typography sx={{ fontSize: '1.1rem', fontWeight: 750 }}>
          {t('core:qortal_card.pay.charge', {
            amount: formatQortUnits(outcome.amount),
          })}
        </Typography>
        <Button
          disabled={retry !== 'send' && !nfcReady}
          onClick={again}
          size="large"
          startIcon={retry === 'send' ? undefined : <ContactlessRoundedIcon />}
          sx={{ py: 1.2 }}
          variant="contained"
        >
          {retry === 'send'
            ? t('core:qortal_card.pay.send_again')
            : retry === 'other-card'
              ? t('core:qortal_card.pay.another_card')
              : t('core:qortal_card.pay.try_again')}
        </Button>
        <Button onClick={reset}>{t('core:qortal_card.pay.new')}</Button>
      </Box>
    );
  }

  const payers: Array<{ key: Payer; label: string; icon: ReactNode }> = [
    {
      key: 'card',
      label: t('core:qortal_card.pay.from_card'),
      icon: <CreditCardRoundedIcon fontSize="small" />,
    },
    {
      key: 'phone',
      label: t('core:qortal_card.pay.from_phone'),
      icon: <PhoneAndroidRoundedIcon fontSize="small" />,
    },
  ];

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {canRequest && (
        <Box
          aria-label={t('core:qortal_card.pay.who_pays')}
          role="radiogroup"
          sx={{
            border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
            borderRadius: '12px',
            display: 'grid',
            gap: 0.4,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            p: 0.4,
          }}
        >
          {payers.map((option) => {
            const selected = option.key === payer;
            return (
              <ButtonBase
                aria-checked={selected}
                key={option.key}
                onClick={() => setPayer(option.key)}
                role="radio"
                sx={{
                  backgroundColor: selected
                    ? alpha(theme.palette.primary.main, 0.16)
                    : 'transparent',
                  borderRadius: '9px',
                  color: selected
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary,
                  fontSize: '0.85rem',
                  fontWeight: selected ? 750 : 600,
                  gap: 0.75,
                  minHeight: 40,
                }}
              >
                {option.icon}
                {option.label}
              </ButtonBase>
            );
          })}
        </Box>
      )}
      <Box sx={{ ...surfaceSx(theme), display: 'grid', gap: 1.25 }}>
        <Typography sx={labelSx(theme)}>
          {fromPhone
            ? t('core:qortal_card.pay.amount_optional')
            : t('core:qortal_card.pay.amount_label')}
        </Typography>
        <TextField
          autoComplete="off"
          inputProps={{
            'aria-label': fromPhone
              ? t('core:qortal_card.pay.amount_optional')
              : t('core:qortal_card.pay.amount_label'),
            inputMode: 'decimal',
          }}
          InputProps={{
            endAdornment: <InputAdornment position="end">QORT</InputAdornment>,
            sx: { fontSize: '1.4rem', fontWeight: 750 },
          }}
          error={amountText !== '' && amount === null}
          helperText={
            amountText !== '' && amount === null
              ? t('core:qortal_card.pay.amount_invalid')
              : ' '
          }
          onChange={(event) => setAmountText(event.target.value)}
          value={amountText}
        />
        {!fromPhone && (
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.82rem' }}
          >
            {fee !== null
              ? t('core:qortal_card.pay.fee_note', {
                  fee: formatQortUnits(fee),
                })
              : feeFailed
                ? t('core:qortal_card.pay.fee_unknown')
                : '…'}
          </Typography>
        )}
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.82rem' }}
        >
          {t('core:qortal_card.pay.to', { address: shortAddress(address) })}
        </Typography>
      </Box>

      {fromPhone ? (
        <Button
          disabled={!canAsk}
          onClick={() => setRequesting({ amount })}
          size="large"
          startIcon={<PhonelinkRingRoundedIcon />}
          sx={{ py: 1.4 }}
          variant="contained"
        >
          {amount !== null
            ? t('core:qortal_card.pay.request', {
                amount: formatQortUnits(amount),
              })
            : t('core:qortal_card.pay.request_any')}
        </Button>
      ) : (
        <Button
          disabled={!canCharge}
          onClick={charge}
          size="large"
          startIcon={<ContactlessRoundedIcon />}
          sx={{ py: 1.4 }}
          variant="contained"
        >
          {amount !== null
            ? t('core:qortal_card.pay.charge', {
                amount: formatQortUnits(amount),
              })
            : t('core:qortal_card.pay.enter_amount')}
        </Button>
      )}
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem' }}
      >
        {fromPhone
          ? sentence('core:qortal_card.pay.how_phone')
          : sentence('core:qortal_card.pay.how')}
      </Typography>
    </Box>
  );
}
