import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Modal,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import QortalLogo from '../../assets/svgs/Logo1Dark.svg';
import { CUSTOM_TITLE_BAR_HEIGHT } from '../Desktop/CustomTitleBar';
import { isCapacitor } from '../../utils/platform';
import {
  isBiometricHardwareAvailable,
  isBiometricUnlockConfigured,
  readBiometricUnlockPassword,
  verifyBiometricUnlock,
} from '../../utils/walletBiometricAuth';

type AuthenticatedLockScreenProps = {
  accountLabel?: string | null;
  /** Wallet address, used to look up this account's fingerprint credential. */
  walletAddress?: string | null;
  onUnlock: (password: string) => Promise<void>;
};

const RETRY_DELAY_MS = 5_000;
const FAILURES_BEFORE_DELAY = 3;

function LockScreenTitleBar() {
  const theme = useTheme();
  const hasWindowControls =
    typeof window.electronAPI?.windowMinimize === 'function';

  if (!hasWindowControls) return null;

  const controlColor = theme.palette.text.secondary;
  const controlHover =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.09)'
      : theme.palette.action.hover;

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: '0 0 auto 0',
        zIndex: 1,
        height: CUSTOM_TITLE_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid',
        borderColor:
          theme.palette.mode === 'dark'
            ? theme.palette.border.subtle
            : theme.palette.divider,
        bgcolor:
          theme.palette.mode === 'dark'
            ? 'rgba(34, 37, 43, 0.97)'
            : theme.palette.background.paper,
        WebkitAppRegion: 'drag',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.75,
          pointerEvents: 'none',
        }}
      >
        <Box
          component="img"
          src={QortalLogo}
          alt=""
          sx={{ width: 'auto', height: 20, display: 'block' }}
        />
        <Typography
          variant="body2"
          sx={{
            color: 'text.primary',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1,
          }}
        >
          Qortal Hub
        </Typography>
      </Box>

      <Box
        sx={{
          ml: 'auto',
          height: '100%',
          display: 'flex',
          WebkitAppRegion: 'no-drag',
        }}
      >
        <IconButton
          disableFocusRipple
          tabIndex={-1}
          size="small"
          onClick={() => window.electronAPI?.windowMinimize?.()}
          aria-label="Minimize"
          sx={{
            width: 46,
            height: CUSTOM_TITLE_BAR_HEIGHT,
            p: 0,
            color: controlColor,
            borderRadius: 0,
            '&:hover': { bgcolor: controlHover },
          }}
        >
          <RemoveRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton
          disableFocusRipple
          tabIndex={-1}
          size="small"
          onClick={() => window.electronAPI?.windowClose?.()}
          aria-label="Close"
          sx={{
            width: 46,
            height: CUSTOM_TITLE_BAR_HEIGHT,
            p: 0,
            color: controlColor,
            borderRadius: 0,
            '&:hover': { bgcolor: '#e81123', color: '#fff' },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  );
}

export function AuthenticatedLockScreen({
  accountLabel,
  walletAddress,
  onUnlock,
}: AuthenticatedLockScreenProps) {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const checkingRef = useRef(false);
  const scanLeftScreenRef = useRef(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [biometricReady, setBiometricReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (!blockedUntil) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((blockedUntil - Date.now()) / 1000)
      );
      setSecondsRemaining(remaining);
      if (remaining === 0) setBlockedUntil(0);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [blockedUntil]);

  // Offer the fingerprint route only when this account actually has a
  // credential enrolled, so the button never appears just to fail on tap.
  useEffect(() => {
    if (!isCapacitor() || !walletAddress) return undefined;
    let cancelled = false;
    void (async () => {
      const [hardware, configured] = await Promise.all([
        isBiometricHardwareAvailable(),
        isBiometricUnlockConfigured(walletAddress),
      ]);
      if (!cancelled) setBiometricReady(hardware && configured);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const handleBiometricUnlock = async () => {
    if (!walletAddress || checkingRef.current || blockedUntil > Date.now()) {
      return;
    }

    checkingRef.current = true;
    setIsScanning(true);
    setError('');
    let leftScreen = document.hidden;
    const watchVisibility = () => {
      if (document.hidden) leftScreen = true;
    };
    document.addEventListener('visibilitychange', watchVisibility);
    try {
      await verifyBiometricUnlock();
      // Unlock through the same password check as the form below, so a
      // fingerprint is never a weaker proof than typing the password.
      const stored = await readBiometricUnlockPassword(walletAddress);
      await onUnlock(stored);
      setPassword('');
    } catch (err) {
      if (leftScreen) {
        // The phone locking or the app being switched away ends the scan; that
        // is not the user declining it, so ask again on the way back rather
        // than reporting a cancellation they did not make.
        scanLeftScreenRef.current = true;
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /cancel/i.test(message)
          ? 'Fingerprint unlock was cancelled.'
          : 'Fingerprint unlock failed. Enter your password instead.'
      );
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      document.removeEventListener('visibilitychange', watchVisibility);
      checkingRef.current = false;
      setIsScanning(false);
    }
  };

  const biometricUnlockRef = useRef(handleBiometricUnlock);
  useEffect(() => {
    biometricUnlockRef.current = handleBiometricUnlock;
  });

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden || !scanLeftScreenRef.current) return;
      scanLeftScreenRef.current = false;
      void biometricUnlockRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || checkingRef.current || blockedUntil > Date.now()) return;

    checkingRef.current = true;
    setIsChecking(true);
    setError('');
    try {
      await onUnlock(password);
      setPassword('');
    } catch {
      const nextFailures = failedAttempts + 1;
      setFailedAttempts(nextFailures);
      setPassword('');
      if (nextFailures % FAILURES_BEFORE_DELAY === 0) {
        setBlockedUntil(Date.now() + RETRY_DELAY_MS);
      }
      setError('That password is not correct. Please try again.');
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  };

  const isBlocked = blockedUntil > Date.now();
  const isBusy = isChecking || isScanning;

  return (
    <Modal
      open
      disableEscapeKeyDown
      aria-labelledby="app-lock-title"
      sx={{
        zIndex: (muiTheme) => muiTheme.zIndex.modal + 1000,
      }}
    >
      <Box
        role="dialog"
        aria-modal="true"
        onKeyDownCapture={(event) => event.stopPropagation()}
        sx={{
          position: 'fixed',
          inset: 0,
          outline: 0,
          overflowY: 'auto',
          display: 'grid',
          placeItems: 'center',
          px: 2,
          py: 3,
          background:
            theme.palette.mode === 'dark'
              ? 'radial-gradient(circle at 50% 15%, #18283b 0%, #0d131c 42%, #090d13 100%)'
              : 'radial-gradient(circle at 50% 15%, #e7f1ff 0%, #f5f8fc 48%, #e8edf4 100%)',
        }}
      >
        <LockScreenTitleBar />
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            width: 'min(420px, 100%)',
            p: { xs: 3, sm: 4 },
            borderRadius: '24px',
            border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.11 : 0.5)}`,
            bgcolor: alpha(theme.palette.background.paper, 0.94),
            boxShadow: '0 28px 80px rgba(0, 0, 0, 0.38)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
            <Box
              sx={{
                width: 70,
                height: 70,
                borderRadius: '22px',
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.13),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
              }}
            >
              <Box
                component="img"
                src={QortalLogo}
                alt="Qortal"
                sx={{ width: 42, height: 42 }}
              />
            </Box>
          </Box>

          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Typography id="app-lock-title" variant="h5" fontWeight={700}>
              Qortal Hub is locked
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              {accountLabel
                ? `${accountLabel} is still signed in.`
                : 'You are still signed in.'}
            </Typography>
          </Box>

          {biometricReady && (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.1,
                mb: 1,
              }}
            >
              <ButtonBase
                onClick={() => void handleBiometricUnlock()}
                disabled={isBusy || isBlocked}
                aria-label="Unlock with fingerprint"
                sx={{
                  alignItems: 'center',
                  animation:
                    isBusy || isBlocked
                      ? 'none'
                      : 'lockFingerprintPulse 2.4s ease-in-out infinite',
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
                  borderRadius: '50%',
                  color: theme.palette.primary.main,
                  display: 'flex',
                  height: 88,
                  justifyContent: 'center',
                  width: 88,
                  '@keyframes lockFingerprintPulse': {
                    '0%, 100%': {
                      boxShadow: `0 0 0 0 ${alpha(theme.palette.primary.main, 0.22)}`,
                      transform: 'scale(1)',
                    },
                    '50%': {
                      boxShadow: `0 0 0 10px ${alpha(theme.palette.primary.main, 0)}`,
                      transform: 'scale(1.045)',
                    },
                  },
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.18),
                  },
                  '&:disabled': { animation: 'none', opacity: 0.55 },
                }}
              >
                {isScanning ? (
                  <CircularProgress size={34} color="inherit" />
                ) : (
                  <FingerprintRoundedIcon sx={{ fontSize: 44 }} />
                )}
              </ButtonBase>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center' }}
              >
                {isScanning
                  ? 'Waiting for your fingerprint…'
                  : 'Tap to unlock with your fingerprint'}
              </Typography>
              <Divider flexItem sx={{ my: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  or
                </Typography>
              </Divider>
            </Box>
          )}

          <TextField
            fullWidth
            autoFocus={!biometricReady}
            inputRef={inputRef}
            type="password"
            label="Qortal account password"
            value={password}
            disabled={isBusy || isBlocked}
            autoComplete="current-password"
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) setError('');
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <KeyRoundedIcon color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {isBlocked
                ? `Please wait ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'} and try again.`
                : error}
            </Alert>
          )}

          <Button
            fullWidth
            size="large"
            variant="contained"
            type="submit"
            disabled={!password || isBusy || isBlocked}
            startIcon={
              isChecking ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <LockRoundedIcon />
              )
            }
            sx={{
              mt: 2.5,
              minHeight: 48,
              borderRadius: '12px',
              fontWeight: 700,
            }}
          >
            {isChecking ? 'Unlocking…' : 'Unlock'}
          </Button>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 2.25, textAlign: 'center' }}
          >
            Chats and active calls remain connected while locked.
          </Typography>
        </Box>
      </Box>
    </Modal>
  );
}
