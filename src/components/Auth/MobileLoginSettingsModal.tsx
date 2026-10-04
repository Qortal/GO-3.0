import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  Switch,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import { useTranslation } from 'react-i18next';
import { AuthButton, authPasswordFieldSx } from './AuthShell';
import { PasswordField } from '../index';
import { getWallets } from '../../background/background.ts';
import { getWalletAvatarCacheEntries } from '../../utils/walletAvatarCache';
import {
  getCachedWalletPrimaryNames,
  primaryNamesFromAvatarCache,
} from '../../utils/walletPrimaryNameCache';
import { mobileLoginSettingsWalletsAtom } from '../../atoms/global';
import { isCapacitor } from '../../utils/platform';
import {
  disableBiometricUnlock,
  getBiometricEnabledAddresses,
  isBiometricUnlockConfigured,
  isBiometricHardwareAvailable,
  promptBiometricEnable,
  storeBiometricCredentials,
  verifyWalletPassword,
} from '../../utils/walletBiometricAuth';
import { MobileNodeConnectionSettings } from '../Mobile/MobileNodeConnectionSettings';

type RawWallet = {
  address0?: string;
  name?: string;
  filename?: string;
  [key: string]: unknown;
};

type MobileLoginSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  /** Saved accounts already loaded on the Enter Qortal screen. */
  wallets?: RawWallet[];
  /** Pre-select this wallet when opening from the unlock screen. */
  walletAddress?: string;
  rawWallet?: RawWallet | null;
};

const AUTH_STARTUP_AUDIO_DISABLED_STORAGE_KEY = 'hub_startup_audio_disabled';
const STARTUP_SOUND_PREFERENCE_EVENT =
  'qortal-startup-sound-preference-changed';

const shortenAddress = (address?: string) => {
  if (!address) return '';
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
};

async function resolveFullWallet(
  address: string,
  fallback: RawWallet | null
): Promise<RawWallet | null> {
  const trimmed = address.trim();
  try {
    const wallets = await getWallets();
    const list = Array.isArray(wallets) ? wallets : [];
    const match = list.find((w) => w?.address0?.trim() === trimmed);
    if (match && typeof match.encryptedSeed === 'string') {
      return match as RawWallet;
    }
    if (match) return match as RawWallet;
  } catch {
    /* fall back to list item */
  }
  if (
    fallback?.address0?.trim() === trimmed &&
    typeof fallback.encryptedSeed === 'string'
  ) {
    return fallback;
  }
  if (fallback?.address0?.trim() === trimmed) return fallback;
  return null;
}

export function MobileLoginSettingsModal({
  open,
  onClose,
  wallets: walletsProp,
  walletAddress,
  rawWallet,
}: MobileLoginSettingsModalProps) {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = useTranslation(['auth']);
  const nativeShell = isCapacitor();

  const [liteNodeDialogOpen, setLiteNodeDialogOpen] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(
    null
  );
  const [savedWallets, setSavedWallets] = useState<RawWallet[]>([]);
  const [enabledAddresses, setEnabledAddresses] = useState<Set<string>>(
    new Set()
  );
  const [selectedAddress, setSelectedAddress] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [biometricError, setBiometricError] = useState('');
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState('');
  const [hideDialogForBiometric, setHideDialogForBiometric] = useState(false);
  const [passwordFieldActive, setPasswordFieldActive] = useState(false);
  const [primaryNamesByAddress, setPrimaryNamesByAddress] = useState<
    Record<string, string>
  >({});
  const [isStartupSoundDisabled, setIsStartupSoundDisabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return (
        window.localStorage.getItem(AUTH_STARTUP_AUDIO_DISABLED_STORAGE_KEY) ===
        'true'
      );
    } catch {
      return false;
    }
  });
  const wasOpenRef = useRef(false);
  const walletsFromAtom = useAtomValue(mobileLoginSettingsWalletsAtom);

  const walletList = walletsProp?.length
    ? walletsProp
    : walletsFromAtom.length
      ? walletsFromAtom
      : savedWallets;

  const selectedWallet = useMemo(() => {
    const trimmed = selectedAddress.trim();
    if (!trimmed) return null;
    if (rawWallet?.address0?.trim() === trimmed) {
      return rawWallet;
    }
    return walletList.find((w) => w.address0?.trim() === trimmed) ?? null;
  }, [rawWallet, walletList, selectedAddress]);

  const refreshBiometricState = useCallback(async () => {
    const walletsResult = await getWallets();
    const fetched = Array.isArray(walletsResult) ? walletsResult : [];
    const list = walletsProp?.length
      ? walletsProp
      : walletsFromAtom.length
        ? walletsFromAtom
        : fetched;

    const walletAddresses = list
      .map((w) => w?.address0?.trim())
      .filter(Boolean) as string[];

    const [available, enabledList] = await Promise.all([
      isBiometricHardwareAvailable(),
      getBiometricEnabledAddresses(walletAddresses),
    ]);
    setBiometricAvailable(available);
    setEnabledAddresses(new Set(enabledList));

    if (!walletsProp?.length) {
      setSavedWallets(Array.isArray(fetched) ? fetched : []);
    }

    const preferred =
      walletAddress?.trim() ||
      rawWallet?.address0?.trim() ||
      (enabledList.length === 1 ? enabledList[0] : '') ||
      (list.length === 1 ? list[0]?.address0?.trim() : '') ||
      '';

    setSelectedAddress((prev) => {
      const prevTrimmed = prev.trim();
      if (preferred) return preferred;
      if (prevTrimmed && list.some((w) => w.address0?.trim() === prevTrimmed)) {
        return prevTrimmed;
      }
      return '';
    });
  }, [rawWallet?.address0, walletAddress, walletsProp, walletsFromAtom]);

  useEffect(() => {
    if (!open || !walletsProp?.length) return;
    setSelectedAddress((prev) => {
      if (prev && walletsProp.some((w) => w.address0 === prev)) return prev;
      if (walletAddress?.trim()) return walletAddress.trim();
      if (walletsProp.length === 1)
        return walletsProp[0]?.address0?.trim() || '';
      return prev;
    });
  }, [open, walletAddress, walletsProp]);

  useEffect(() => {
    if (!open) {
      setHideDialogForBiometric(false);
      setPasswordFieldActive(false);
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setBiometricBusy(false);
    setBiometricStatus('');
    setSetupPassword('');
    setBiometricError('');
    setPasswordFieldActive(false);
    void refreshBiometricState();
  }, [open, refreshBiometricState]);

  useEffect(() => {
    setPasswordFieldActive(false);
  }, [selectedAddress]);

  useEffect(() => {
    const addresses = walletList
      .map((wallet) => wallet?.address0?.trim())
      .filter(Boolean) as string[];

    if (!open || addresses.length === 0) {
      setPrimaryNamesByAddress({});
      return;
    }

    let canceled = false;

    // Names saved on this device only, as on the account picker: one request
    // listing every saved wallet would tell the node which wallets share
    // this phone.
    void Promise.all([
      getWalletAvatarCacheEntries().catch(() => ({})),
      getCachedWalletPrimaryNames(addresses).catch(
        () => ({}) as Record<string, string>
      ),
    ]).then(([avatarsByAddress, cachedNames]) => {
      if (!canceled) {
        setPrimaryNamesByAddress({
          ...primaryNamesFromAvatarCache(avatarsByAddress, addresses),
          ...cachedNames,
        });
      }
    });

    return () => {
      canceled = true;
    };
  }, [open, walletList]);

  useEffect(() => {
    if (!selectedAddress) {
      setBiometricEnabled(false);
      return;
    }
    if (!open) return;

    let cancelled = false;
    void isBiometricUnlockConfigured(selectedAddress).then((configured) => {
      if (!cancelled) setBiometricEnabled(configured);
    });

    return () => {
      cancelled = true;
    };
  }, [open, selectedAddress, enabledAddresses]);

  const handleSelectWallet = (address: string) => {
    setSelectedAddress(address);
    setSetupPassword('');
    setBiometricError('');
    setPasswordFieldActive(false);
  };

  const handleToggleStartupSound = (
    _event: ChangeEvent<HTMLInputElement>,
    checked: boolean
  ) => {
    setIsStartupSoundDisabled(checked);
    try {
      window.localStorage.setItem(
        AUTH_STARTUP_AUDIO_DISABLED_STORAGE_KEY,
        checked ? 'true' : 'false'
      );
      window.dispatchEvent(
        new CustomEvent(STARTUP_SOUND_PREFERENCE_EVENT, {
          detail: { disabled: checked },
        })
      );
    } catch (error) {
      console.error('Unable to update startup sound preference:', error);
      setIsStartupSoundDisabled(!checked);
    }
  };

  const handleRemoveBiometric = async () => {
    if (!selectedAddress) return;

    setBiometricError('');
    setBiometricBusy(true);
    try {
      await disableBiometricUnlock(selectedAddress);
      setBiometricEnabled(false);
      setSetupPassword('');
      setEnabledAddresses((prev) => {
        const next = new Set(prev);
        next.delete(selectedAddress);
        return next;
      });
      await refreshBiometricState();
    } catch (err) {
      setBiometricError(
        err instanceof Error
          ? err.message
          : t('auth:mobile_login_settings.biometric_disable_failed')
      );
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleEnableBiometric = async () => {
    if (!selectedAddress) return;
    const password = setupPassword.trim();
    if (!password) {
      setBiometricError(
        t('auth:mobile_login_settings.biometric_confirm_password')
      );
      return;
    }

    const wallet = await resolveFullWallet(selectedAddress, selectedWallet);
    if (!wallet) {
      setBiometricError(
        t('auth:mobile_login_settings.biometric_select_account')
      );
      return;
    }

    const address = selectedAddress.trim();
    setBiometricError('');
    setBiometricBusy(true);
    setBiometricStatus(
      t('auth:mobile_login_settings.biometric_checking_password')
    );

    const valid = await verifyWalletPassword(password, wallet);
    if (!valid) {
      setBiometricError(
        t('auth:mobile_login_settings.biometric_wrong_password')
      );
      setBiometricStatus('');
      setBiometricBusy(false);
      return;
    }

    setBiometricStatus(t('auth:mobile_login_settings.biometric_scan_prompt'));
    setHideDialogForBiometric(true);

    try {
      await promptBiometricEnable();
      await storeBiometricCredentials(address, password);

      setBiometricEnabled(true);
      setSetupPassword('');
      setEnabledAddresses((prev) => new Set(prev).add(address));
      setBiometricError('');
      await refreshBiometricState();
    } catch (err) {
      setBiometricError(
        err instanceof Error
          ? err.message
          : t('auth:mobile_login_settings.biometric_enable_failed')
      );
    } finally {
      setHideDialogForBiometric(false);
      setBiometricStatus('');
      setBiometricBusy(false);
    }
  };

  const walletDisplayName = (wallet: RawWallet) => {
    const address = wallet.address0?.trim() || '';
    const primaryName = address ? primaryNamesByAddress[address] : undefined;
    return (
      primaryName?.trim() ||
      wallet.name?.trim() ||
      t('auth:authentication_form.unnamed_account', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  };

  const cardSx = {
    alignItems: 'center',
    background: isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.04)',
    border: isLight
      ? `1px solid ${theme.palette.divider}`
      : '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    display: 'flex',
    gap: 1.25,
    px: 1.5,
    py: 1.35,
    textAlign: 'left',
    width: '100%',
  };

  if (!nativeShell) return null;

  return (
    <>
      <Dialog
        open={open && !hideDialogForBiometric}
        onClose={onClose}
        fullWidth
        maxWidth="xs"
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        sx={{ zIndex: 14000 }}
        slotProps={{
          backdrop: { sx: { zIndex: 13999 } },
        }}
        PaperProps={{
          sx: {
            background: isLight
              ? 'linear-gradient(180deg, #f8faff 0%, #eef2fa 100%)'
              : 'linear-gradient(180deg, #0c1018 0%, #07090f 100%)',
            borderRadius: '18px',
            maxHeight: 'min(88vh, 720px)',
            mx: 1.5,
            zIndex: 14000,
          },
        }}
      >
        <Box
          sx={{
            px: 2.2,
            pt: 2,
            pb: 2.4,
            maxHeight: 'min(88vh, 720px)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              mb: 0.5,
            }}
          >
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {t('auth:mobile_login_settings.title')}
            </Typography>
            <IconButton onClick={onClose} size="small" aria-label="Close">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.82rem',
              lineHeight: 1.45,
              mb: 2,
            }}
          >
            {t('auth:mobile_login_settings.subtitle')}
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box
              sx={{
                ...cardSx,
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 1.1,
              }}
            >
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.25 }}>
                <Box
                  sx={{
                    alignItems: 'center',
                    background: alpha(theme.palette.success.main, 0.12),
                    borderRadius: '12px',
                    color: theme.palette.success.main,
                    display: 'flex',
                    height: 42,
                    justifyContent: 'center',
                    width: 42,
                    flexShrink: 0,
                  }}
                >
                  <FingerprintRoundedIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                    {t('auth:mobile_login_settings.biometric_title')}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.74rem',
                      lineHeight: 1.35,
                      mt: 0.25,
                    }}
                  >
                    {t('auth:mobile_login_settings.biometric_hint')}
                  </Typography>
                </Box>
              </Box>

              {biometricAvailable === false && (
                <Typography
                  sx={{
                    color: theme.palette.warning.main,
                    fontSize: '0.76rem',
                    lineHeight: 1.4,
                  }}
                >
                  {t(
                    'auth:mobile_login_settings.biometric_hardware_unavailable'
                  )}
                </Typography>
              )}

              {walletList.length === 0 ? (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.76rem',
                    lineHeight: 1.4,
                  }}
                >
                  {t('auth:mobile_login_settings.biometric_no_accounts_saved')}
                </Typography>
              ) : (
                <>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('auth:mobile_login_settings.biometric_pick_account')}
                  </Typography>

                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.65,
                    }}
                  >
                    {walletList.map((wallet) => {
                      const address = wallet.address0?.trim() || '';
                      if (!address) return null;
                      const isSelected = selectedAddress === address;
                      const isEnabled = enabledAddresses.has(address);

                      return (
                        <ButtonBase
                          key={address}
                          onClick={() => handleSelectWallet(address)}
                          sx={{
                            alignItems: 'center',
                            background: isSelected
                              ? alpha(theme.palette.primary.main, 0.14)
                              : isLight
                                ? 'rgba(255,255,255,0.55)'
                                : 'rgba(255,255,255,0.03)',
                            border: isSelected
                              ? `1px solid ${alpha(theme.palette.primary.main, 0.42)}`
                              : isLight
                                ? `1px solid ${theme.palette.divider}`
                                : '1px solid rgba(255,255,255,0.07)',
                            borderRadius: '10px',
                            color: 'inherit',
                            display: 'flex',
                            gap: 0.85,
                            justifyContent: 'flex-start',
                            minHeight: 52,
                            px: 1.1,
                            py: 0.95,
                            textAlign: 'left',
                            touchAction: 'manipulation',
                            width: '100%',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          {isSelected ? (
                            <RadioButtonCheckedRoundedIcon
                              sx={{
                                color: theme.palette.primary.main,
                                fontSize: 20,
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <RadioButtonUncheckedRoundedIcon
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: 20,
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              sx={{
                                fontSize: '0.84rem',
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {walletDisplayName(wallet)}
                            </Typography>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: '0.72rem',
                              }}
                            >
                              {shortenAddress(address)}
                            </Typography>
                          </Box>
                          {isEnabled && (
                            <CheckCircleRoundedIcon
                              sx={{
                                color: theme.palette.success.main,
                                fontSize: 18,
                                flexShrink: 0,
                              }}
                            />
                          )}
                        </ButtonBase>
                      );
                    })}
                  </Box>

                  {biometricAvailable !== false &&
                    selectedAddress &&
                    selectedWallet && (
                      <>
                        {biometricEnabled ? (
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1,
                              mt: 0.25,
                            }}
                          >
                            <Box
                              sx={{
                                alignItems: 'center',
                                display: 'flex',
                                gap: 0.75,
                              }}
                            >
                              <CheckCircleRoundedIcon
                                sx={{
                                  color: theme.palette.success.main,
                                  fontSize: 20,
                                  flexShrink: 0,
                                }}
                              />
                              <Typography
                                sx={{ fontSize: '0.82rem', fontWeight: 600 }}
                              >
                                {t(
                                  'auth:mobile_login_settings.biometric_on_for_account'
                                )}
                              </Typography>
                            </Box>
                            <AuthButton
                              onClick={() => void handleRemoveBiometric()}
                              disabled={biometricBusy}
                              fullWidth
                              sx={{
                                background: 'transparent',
                                border: isLight
                                  ? `1px solid ${theme.palette.divider}`
                                  : '1px solid rgba(255,255,255,0.12)',
                                color: theme.palette.error.main,
                                fontWeight: 600,
                                '&:hover': {
                                  background: alpha(
                                    theme.palette.error.main,
                                    0.08
                                  ),
                                },
                              }}
                            >
                              {biometricBusy
                                ? t(
                                    'auth:mobile_login_settings.biometric_removing'
                                  )
                                : t(
                                    'auth:mobile_login_settings.biometric_remove'
                                  )}
                            </AuthButton>
                          </Box>
                        ) : (
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1,
                              mt: 0.25,
                            }}
                          >
                            <Typography
                              sx={{
                                fontSize: '0.82rem',
                                fontWeight: 600,
                                lineHeight: 1.4,
                              }}
                            >
                              {t(
                                'auth:mobile_login_settings.biometric_confirm_password'
                              )}
                            </Typography>
                            <PasswordField
                              value={setupPassword}
                              onChange={(e) => setSetupPassword(e.target.value)}
                              onFocus={() => setPasswordFieldActive(true)}
                              onMouseDown={() => setPasswordFieldActive(true)}
                              onKeyDown={(e) => {
                                if (
                                  e.key === 'Enter' &&
                                  setupPassword.trim() &&
                                  !biometricBusy
                                ) {
                                  void handleEnableBiometric();
                                }
                              }}
                              placeholder={t(
                                'auth:mobile_login_settings.biometric_password_label'
                              )}
                              fullWidth
                              InputProps={{
                                readOnly: !passwordFieldActive,
                              }}
                              sx={authPasswordFieldSx(theme)}
                            />
                            <AuthButton
                              onClick={() => void handleEnableBiometric()}
                              disabled={!setupPassword.trim() || biometricBusy}
                              primary
                              fullWidth
                            >
                              {biometricBusy
                                ? biometricStatus ||
                                  t(
                                    'auth:mobile_login_settings.biometric_enabling'
                                  )
                                : t(
                                    'auth:mobile_login_settings.biometric_enable'
                                  )}
                            </AuthButton>
                          </Box>
                        )}
                      </>
                    )}

                  {biometricAvailable !== false && !selectedAddress && (
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.78rem',
                        mt: 0.25,
                      }}
                    >
                      {t('auth:mobile_login_settings.biometric_tap_account')}
                    </Typography>
                  )}
                </>
              )}

              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.72rem',
                  lineHeight: 1.45,
                }}
              >
                {t('auth:mobile_login_settings.biometric_privacy')}
              </Typography>

              {biometricError && (
                <Typography
                  sx={{ color: theme.palette.error.main, fontSize: '0.76rem' }}
                >
                  {biometricError}
                </Typography>
              )}
            </Box>

            <Box
              sx={{
                ...cardSx,
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 1.1,
              }}
            >
              <Box>
                <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                  {t('auth:mobile_node_settings.section_title')}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.74rem',
                    lineHeight: 1.35,
                    mt: 0.25,
                  }}
                >
                  {t('auth:mobile_node_settings.section_hint')}
                </Typography>
              </Box>
              <MobileNodeConnectionSettings compact />
            </Box>

            <Box
              sx={{
                ...cardSx,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 1.25,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    background: alpha(theme.palette.primary.main, 0.12),
                    borderRadius: '12px',
                    color: theme.palette.primary.main,
                    display: 'flex',
                    height: 42,
                    justifyContent: 'center',
                    width: 42,
                    flexShrink: 0,
                  }}
                >
                  <VolumeOffRoundedIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                    {t('auth:mobile_login_settings.startup_sound_title')}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.74rem',
                      lineHeight: 1.35,
                      mt: 0.25,
                    }}
                  >
                    {t('auth:mobile_login_settings.startup_sound_hint')}
                  </Typography>
                </Box>
              </Box>
              <Switch
                checked={isStartupSoundDisabled}
                onChange={handleToggleStartupSound}
                inputProps={{
                  'aria-label': t(
                    'auth:mobile_login_settings.startup_sound_title'
                  ),
                }}
              />
            </Box>

            <Box
              component="button"
              type="button"
              onClick={() => setLiteNodeDialogOpen(true)}
              sx={{
                ...cardSx,
                cursor: 'pointer',
                border: 'none',
                font: 'inherit',
                color: 'inherit',
                '&:hover': {
                  background: isLight
                    ? 'rgba(255,255,255,0.95)'
                    : 'rgba(255,255,255,0.06)',
                },
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  background: alpha(theme.palette.primary.main, 0.12),
                  borderRadius: '12px',
                  color: theme.palette.primary.main,
                  display: 'flex',
                  height: 42,
                  justifyContent: 'center',
                  width: 42,
                  flexShrink: 0,
                }}
              >
                <HubRoundedIcon />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                  {t('auth:mobile_login_settings.lite_node_title')}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.74rem',
                    lineHeight: 1.35,
                    mt: 0.25,
                  }}
                >
                  {t('auth:mobile_login_settings.lite_node_hint')}
                </Typography>
              </Box>
              <ChevronRightRoundedIcon
                sx={{ color: theme.palette.text.secondary, fontSize: 20 }}
              />
            </Box>
          </Box>
        </Box>
      </Dialog>

      <Dialog
        open={liteNodeDialogOpen}
        onClose={() => setLiteNodeDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        sx={{ zIndex: 15000 }}
        slotProps={{
          backdrop: { sx: { zIndex: 14999 } },
        }}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            mx: 1.5,
            zIndex: 15000,
          },
        }}
      >
        <Box sx={{ px: 2.2, py: 2.2 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, mb: 1 }}>
            {t('auth:mobile_login_settings.lite_node_dialog_title')}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.84rem',
              lineHeight: 1.5,
              mb: 2,
            }}
          >
            {t('auth:mobile_login_settings.lite_node_dialog_body')}
          </Typography>
          <AuthButton
            onClick={() => setLiteNodeDialogOpen(false)}
            primary
            fullWidth
          >
            {t('auth:mobile_login_settings.lite_node_dialog_ok')}
          </AuthButton>
        </Box>
      </Dialog>
    </>
  );
}
