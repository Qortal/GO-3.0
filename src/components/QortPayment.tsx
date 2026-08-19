import {
  alpha,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { useEffect, useRef, useState } from 'react';
import { getFee } from '../background/background.ts';
import { useTranslation } from 'react-i18next';
import BoundedNumericTextField from '../common/BoundedNumericTextField.tsx';
import { ErrorText } from './ErrorText/ErrorText.tsx';
import { getBlueTier1ButtonSx } from '../styles/blueMaterial';
import { executeEvent } from '../utils/events';
import { formatQortAmount } from '../utils/numberFunctions';
import { QORTINO_DONATION_COMPLETED_EVENT } from './Group/qortinoDonationEasterEgg';
import { isQrScannerAvailable } from '../utils/qrScanner';
import { parsePaymentTarget } from '../utils/paymentLink';
import { QrScannerOverlay } from './QrScannerOverlay';
import { useAutoFitInputFont } from './common/AutoFitText';
import { validateAddress } from '../utils/validateAddress';
import { getPrimaryNameForAvatar } from './Group/groupApi';

export const QortPayment = ({
  balance,
  show,
  onSuccess,
  defaultPaymentTo,
  defaultPaymentAmount,
  compact = false,
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['auth', 'core', 'group', 'question']);
  const [paymentTo, setPaymentTo] = useState<string>(defaultPaymentTo);
  const [paymentAmount, setPaymentAmount] = useState<number>(
    defaultPaymentAmount || 0
  );
  // Seed used to (re)mount the uncontrolled amount field when a prefilled /
  // scanned amount arrives, so its displayed value updates.
  const [amountSeed, setAmountSeed] = useState<number>(defaultPaymentAmount || 0);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  // Primary registered name of a *scanned* recipient address (shown in green
  // next to "To" so the sender can confirm who they're paying).
  const [scannedRecipientName, setScannedRecipientName] = useState<string>('');
  const canScan = isQrScannerAvailable();
  const paymentToInputRef = useRef<HTMLInputElement | null>(null);
  useAutoFitInputFont(paymentToInputRef, paymentTo, {
    maxFontPx: compact ? 15 : 15,
    minFontPx: 8,
  });
  const [paymentPassword, setPaymentPassword] = useState<string>('');
  const [isPaymentPasswordEditable, setIsPaymentPasswordEditable] =
    useState(false);
  const [sendPaymentError, setSendPaymentError] = useState<string>('');
  const [isLoadingSendCoin, setIsLoadingSendCoin] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState(false);
  const isDarkMode = theme.palette.mode === 'dark';
  const secondaryTextColor = alpha(
    theme.palette.text.secondary,
    isDarkMode ? 0.9 : 0.82
  );
  const inputSurface = alpha(
    isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
    isDarkMode ? 0.032 : 0.042
  );
  const sectionDivider = alpha(theme.palette.divider, isDarkMode ? 0.18 : 0.22);
  const inputBorder = alpha(theme.palette.divider, isDarkMode ? 0.16 : 0.2);

  useEffect(() => {
    setPaymentTo(defaultPaymentTo || '');
  }, [defaultPaymentTo]);

  useEffect(() => {
    if (defaultPaymentAmount && defaultPaymentAmount > 0) {
      setPaymentAmount(defaultPaymentAmount);
      setAmountSeed(defaultPaymentAmount);
    }
  }, [defaultPaymentAmount]);

  // Resolve and show the primary registered name for a scanned recipient
  // address (only when it's a valid Qortal address).
  const scannedNameRequestRef = useRef(0);
  const resolveScannedRecipientName = (recipient: string) => {
    const value = (recipient || '').trim();
    setScannedRecipientName('');
    if (!value || !validateAddress(value)) return;
    const token = ++scannedNameRequestRef.current;
    getPrimaryNameForAvatar(value)
      .then((name) => {
        // Ignore stale responses if a newer scan started meanwhile.
        if (token !== scannedNameRequestRef.current) return;
        if (name) setScannedRecipientName(name);
      })
      .catch(() => {});
  };

  const handleScanResult = (scanned: string) => {
    setIsScannerOpen(false);
    if (!scanned) return;
    setSendPaymentError('');
    const parsed = parsePaymentTarget(scanned);
    if (parsed.kind === 'payment') {
      setPaymentTo(parsed.recipient);
      resolveScannedRecipientName(parsed.recipient);
      if (parsed.amount && parsed.amount > 0) {
        setPaymentAmount(parsed.amount);
        setAmountSeed(parsed.amount);
      }
    } else if (!scanned.includes('?') && !/^[a-z][a-z0-9+.-]*:/i.test(scanned)) {
      // Not a recognized payment/link, but a plain token (address or name):
      // populate the recipient field directly.
      setPaymentTo(scanned);
      resolveScannedRecipientName(scanned);
    } else {
      setSendPaymentError(
        t('core:message.error.unrecognized_qr', {
          defaultValue: 'This QR code is not a Qortal payment code.',
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  };

  const fieldLabelSx = {
    color: secondaryTextColor,
    fontSize: compact ? '0.75rem' : '0.77rem',
    fontWeight: 400,
    letterSpacing: '0.014em',
    lineHeight: 1.2,
  } as const;

  const fieldGroupSx = {
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? '6px' : '7px',
  } as const;
  const formatSendPaymentError = (message: unknown) => {
    const rawMessage =
      typeof message === 'string'
        ? message.trim()
        : message instanceof Error
          ? message.message.trim()
          : '';

    if (/\bNO_BALANCE\b/i.test(rawMessage)) {
      return t('question:message.error.insufficient_balance_qort', {
        defaultValue: 'Your QORT balance is insufficient.',
        postProcess: 'capitalizeFirstChar',
      });
    }

    return rawMessage;
  };

  const textFieldSurfaceSx = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: inputSurface,
      borderRadius: '10px',
      color: theme.palette.text.primary,
      minHeight: compact ? '42px' : '44px',
      '& fieldset': {
        borderColor: inputBorder,
      },
      '&:hover fieldset': {
        borderColor: alpha(theme.palette.primary.main, 0.28),
      },
      '&.Mui-focused fieldset': {
        borderColor: alpha(theme.palette.primary.main, 0.42),
      },
    },
    '& .MuiOutlinedInput-input': {
      fontSize: compact ? '0.92rem' : '0.94rem',
      fontWeight: 500,
      padding: compact ? '9px 12px' : '10px 13px',
    },
    '& .MuiOutlinedInput-input::placeholder': {
      color: alpha(theme.palette.text.secondary, isDarkMode ? 0.78 : 0.72),
      fontWeight: 400,
      opacity: 1,
    },
    '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
      {
        WebkitBoxShadow: isDarkMode
          ? '0 0 0 100px rgb(28, 31, 38) inset'
          : '0 0 0 100px rgb(248, 250, 253) inset',
        WebkitTextFillColor: theme.palette.text.primary,
        caretColor: theme.palette.text.primary,
        transition: 'background-color 9999s ease-out 0s',
      },
  } as const;

  const sendCoinFunc = async () => {
    try {
      setSendPaymentError('');
      if (!paymentTo) {
        setSendPaymentError(
          t('auth:action.enter_recipient', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (!paymentAmount) {
        setSendPaymentError(
          t('auth:action.enter_amount', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (!paymentPassword) {
        setSendPaymentError(
          t('auth:action.enter_wallet_password', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }

      const fee = await getFee('PAYMENT');

      await show({
        message: t('core:message.question.transfer_qort', {
          amount: Number(paymentAmount),
          postProcess: 'capitalizeFirstChar',
        }),
        paymentFee: fee.fee + ' QORT',
      });

      setIsLoadingSendCoin(true);

      window
        .sendMessage('sendCoin', {
          amount: Number(paymentAmount),
          receiver: paymentTo.trim(),
          password: paymentPassword,
        })
        .then((response) => {
          if (response?.error) {
            setSendPaymentError(formatSendPaymentError(response.error));
          } else {
            executeEvent(QORTINO_DONATION_COMPLETED_EVENT, {
              recipient: paymentTo.trim(),
            });
            onSuccess();
          }
          setIsLoadingSendCoin(false);
        })
        .catch((error) => {
          console.error('Failed to send coin:', error);
          setSendPaymentError(formatSendPaymentError(error));
          setIsLoadingSendCoin(false);
        });
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <>
    {canScan && (
      <QrScannerOverlay
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onResult={handleScanResult}
      />
    )}
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '14px' : '16px',
        px: compact ? 2 : 2.5,
        py: compact ? 1.6 : 2.1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          pb: compact ? 1.35 : 1.5,
          borderBottom: `1px solid ${sectionDivider}`,
        }}
      >
        <Typography
          sx={{
            ...fieldLabelSx,
            alignSelf: 'flex-start',
          }}
        >
          {t('core:balance', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
        <Typography
          sx={{
            alignSelf: 'flex-start',
            color: theme.palette.text.primary,
            fontSize: compact ? '1.06rem' : '1.12rem',
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1.1,
          }}
        >
          {formatQortAmount(balance, i18n.language)} QORT
        </Typography>
      </Box>

      <Box sx={fieldGroupSx}>
        <Box
          sx={{
            alignItems: 'baseline',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <Typography component="label" htmlFor="payment-to" sx={fieldLabelSx}>
            {t('core:to', { postProcess: 'capitalizeFirstChar' })}
          </Typography>
          {scannedRecipientName && (
            <Typography
              sx={{
                color: theme.palette.success.main,
                fontSize: compact ? '0.75rem' : '0.77rem',
                fontWeight: 600,
                letterSpacing: '0.01em',
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {scannedRecipientName}
            </Typography>
          )}
        </Box>
        <TextField
          id="payment-to"
          value={paymentTo}
          onChange={(e) => {
            setPaymentTo(e.target.value);
            // Manual edits invalidate the scanned-name badge.
            if (scannedRecipientName) setScannedRecipientName('');
          }}
          autoComplete="off"
          placeholder={t('group:dashboard.qortal_address_or_name')}
          fullWidth
          inputRef={paymentToInputRef}
          sx={{
            ...textFieldSurfaceSx,
            '& .MuiOutlinedInput-input': {
              ...(textFieldSurfaceSx['& .MuiOutlinedInput-input'] as object),
              letterSpacing: '-0.01em',
              // Font size is auto-fit via useAutoFitInputFont so a full Qortal
              // address always fits on one line.
            },
          }}
          InputProps={
            canScan
              ? {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setIsScannerOpen(true)}
                        edge="end"
                        aria-label={t('core:action.scan_qr_code', {
                          defaultValue: 'Scan QR code',
                          postProcess: 'capitalizeFirstChar',
                        })}
                        sx={{ color: theme.palette.text.secondary }}
                      >
                        <QrCodeScannerIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }
              : undefined
          }
        />
      </Box>

      <Box sx={fieldGroupSx}>
        <Typography
          component="label"
          htmlFor="payment-amount"
          sx={fieldLabelSx}
        >
          {t('core:amount', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
        <BoundedNumericTextField
          key={`payment-amount-${amountSeed}`}
          value={paymentAmount}
          minValue={0}
          maxValue={+balance}
          allowDecimals={true}
          initialValue={amountSeed ? String(amountSeed) : '0'}
          allowNegatives={false}
          addIconButtons={false}
          afterChange={(e: string) => setPaymentAmount(+e)}
          sx={{
            width: '100%',
            '& .MuiOutlinedInput-root': {
              backgroundColor: inputSurface,
              borderRadius: '10px',
              minHeight: compact ? '42px' : '44px',
              '& fieldset': {
                borderColor: inputBorder,
              },
              '&:hover fieldset': {
                borderColor: alpha(theme.palette.primary.main, 0.28),
              },
              '&.Mui-focused fieldset': {
                borderColor: alpha(theme.palette.primary.main, 0.42),
              },
            },
            '& input': {
              fontSize: compact ? '0.92rem' : '0.94rem',
              padding: compact ? '9px 12px' : '10px 13px',
            },
          }}
        />
      </Box>

      <Box sx={fieldGroupSx}>
        <Typography
          component="label"
          htmlFor="payment-password"
          sx={fieldLabelSx}
        >
          {t('auth:wallet.password_confirmation', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
        <TextField
          id="payment-password"
          type={showPassword ? 'text' : 'password'}
          value={paymentPassword}
          onChange={(e) => setPaymentPassword(e.target.value)}
          autoComplete="new-password"
          name="payment-password-confirmation"
          fullWidth
          onFocus={() => setIsPaymentPasswordEditable(true)}
          onMouseDown={() => setIsPaymentPasswordEditable(true)}
          onBlur={() => {
            if (!paymentPassword) {
              setIsPaymentPasswordEditable(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (isLoadingSendCoin) return;
              sendCoinFunc();
            }
          }}
          InputProps={{
            readOnly: !isPaymentPasswordEditable,
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowPassword((prev) => !prev)}
                  edge="end"
                  sx={{ color: theme.palette.text.secondary }}
                >
                  {showPassword ? (
                    <VisibilityOffIcon fontSize="small" />
                  ) : (
                    <VisibilityIcon fontSize="small" />
                  )}
                </IconButton>
              </InputAdornment>
            ),
          }}
          inputProps={{
            autoComplete: 'new-password',
            'data-1p-ignore': 'true',
            'data-lpignore': 'true',
            spellCheck: 'false',
          }}
          sx={textFieldSurfaceSx}
        />
      </Box>

      <ErrorText
        sx={{
          fontSize: '0.74rem',
          minHeight: sendPaymentError ? '20px' : compact ? '8px' : '12px',
          px: 0.5,
        }}
      >
        {sendPaymentError}
      </ErrorText>

      <Button
        variant="contained"
        fullWidth
        disabled={isLoadingSendCoin}
        onClick={() => {
          if (isLoadingSendCoin) return;
          sendCoinFunc();
        }}
        sx={{
          borderRadius: '12px',
          ...getBlueTier1ButtonSx(),
          background: isDarkMode
            ? 'linear-gradient(180deg, rgba(143,181,247,0.96) 0%, rgba(124,166,236,0.96) 100%)'
            : 'linear-gradient(180deg, rgba(133,176,245,0.96) 0%, rgba(113,157,230,0.96) 100%)',
          boxShadow: isDarkMode
            ? '0 10px 24px rgba(76, 123, 209, 0.18), inset 0 1px 0 rgba(255,255,255,0.26)'
            : '0 10px 20px rgba(76, 123, 209, 0.16), inset 0 1px 0 rgba(255,255,255,0.32)',
          fontSize: '0.84rem',
          fontWeight: 600,
          minHeight: compact ? 42 : 44,
          textTransform: 'none',
          '&:hover': {
            background: isDarkMode
              ? 'linear-gradient(180deg, rgba(149,186,249,0.97) 0%, rgba(130,171,239,0.97) 100%)'
              : 'linear-gradient(180deg, rgba(138,181,248,0.97) 0%, rgba(118,163,234,0.97) 100%)',
            boxShadow: isDarkMode
              ? '0 12px 28px rgba(76, 123, 209, 0.2), inset 0 1px 0 rgba(255,255,255,0.28)'
              : '0 12px 24px rgba(76, 123, 209, 0.18), inset 0 1px 0 rgba(255,255,255,0.34)',
          },
        }}
        startIcon={
          isLoadingSendCoin ? (
            <CircularProgress size={16} color="inherit" />
          ) : null
        }
      >
        {t('core:action.send', { postProcess: 'capitalizeFirstChar' })}
      </Button>
    </Box>
    </>
  );
};
