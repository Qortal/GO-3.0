import { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PersonIcon from '@mui/icons-material/Person';
import { useTranslation } from 'react-i18next';
import {
  dialogContentSx,
  getDialogPaperSx,
} from '../App/dialogSurface';

type WalletAccountEditDialogProps = {
  open: boolean;
  onClose: () => void;
  wallet: {
    name?: string;
    note?: string;
    address0?: string;
    filename?: string;
  };
  displayName: string;
  addressLabel: string;
  avatarSrc?: string;
  canEditAccountName: boolean;
  onSave: (values: { name?: string; note: string }) => void;
  onRemove: () => void;
};

export const WalletAccountEditDialog = ({
  open,
  onClose,
  wallet,
  displayName,
  addressLabel,
  avatarSrc,
  canEditAccountName,
  onSave,
  onRemove,
}: WalletAccountEditDialogProps) => {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = useTranslation(['auth', 'core']);
  const [accountName, setAccountName] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setAccountName(wallet?.name || '');
    setNote(wallet?.note || '');
  }, [open, wallet]);

  const handleSave = () => {
    onSave({
      ...(canEditAccountName ? { name: accountName.trim() } : {}),
      note,
    });
    onClose();
  };

  const handleRemove = () => {
    onRemove();
    onClose();
  };

  const fieldLabelSx = {
    color: isLight ? theme.palette.text.secondary : 'rgba(214,221,233,0.56)',
    fontSize: '0.74rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  };

  const fieldInputSx = {
    color: theme.palette.text.primary,
    fontSize: '0.95rem',
    mt: 0.45,
    '&:before': {
      borderBottom: isLight
        ? `1px solid ${theme.palette.divider}`
        : '1px solid rgba(255,255,255,0.08)',
    },
    '&:after': {
      borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
    },
  };

  const actionSx = (danger: boolean) => ({
    alignItems: 'center',
    backgroundColor: danger
      ? alpha(theme.palette.error.main, isLight ? 0.08 : 0.14)
      : isLight
        ? alpha(theme.palette.primary.main, 0.08)
        : 'rgba(255,255,255,0.04)',
    border: `1px solid ${
      danger
        ? alpha(theme.palette.error.main, 0.28)
        : isLight
          ? alpha(theme.palette.primary.main, 0.22)
          : 'rgba(255,255,255,0.1)'
    }`,
    borderRadius: '10px',
    color: danger ? theme.palette.error.main : theme.palette.text.primary,
    display: 'inline-flex',
    flex: 1,
    fontSize: '0.9rem',
    fontWeight: 700,
    height: 44,
    justifyContent: 'center',
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: getDialogPaperSx(theme, { maxWidth: 420, radius: 20 }),
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          px: 2.2,
          pt: 1.6,
        }}
      >
        <Typography
          sx={{
            fontSize: '1rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          {t('auth:entry.wallet_edit_dialog_title', {
            defaultValue: 'Account details',
          })}
        </Typography>
        <IconButton aria-label={t('core:action.close')} onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ ...dialogContentSx, pt: 1.2 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            mb: 2.2,
            textAlign: 'center',
          }}
        >
          <Avatar
            src={avatarSrc || undefined}
            sx={{
              height: 72,
              width: 72,
              bgcolor: isLight
                ? alpha(theme.palette.text.primary, 0.06)
                : alpha(theme.palette.common.white, 0.08),
            }}
          >
            <PersonIcon sx={{ fontSize: 36 }} />
          </Avatar>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
            {displayName}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.82rem',
            }}
          >
            {addressLabel}
          </Typography>
        </Box>

        {canEditAccountName && (
          <Box sx={{ mb: 1.6 }}>
            <Typography sx={fieldLabelSx}>
              {t('auth:entry.wallet_edit_name_label')}
            </Typography>
            <Input
              autoFocus
              fullWidth
              placeholder={t(
                'auth:entry.wallet_edit_account_name_placeholder'
              )}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              inputProps={{ maxLength: 48 }}
              sx={fieldInputSx}
            />
          </Box>
        )}

        <Box sx={{ mb: 2.4 }}>
          <Typography sx={fieldLabelSx}>
            {t('auth:entry.wallet_edit_note_label')}
          </Typography>
          <Input
            fullWidth
            placeholder={t('auth:entry.wallet_edit_note_placeholder')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            inputProps={{ maxLength: 100 }}
            sx={fieldInputSx}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <ButtonBase onClick={handleRemove} sx={actionSx(true)}>
            {t('auth:entry.wallet_edit_remove')}
          </ButtonBase>
          <ButtonBase onClick={handleSave} sx={actionSx(false)}>
            {t('auth:entry.wallet_edit_save')}
          </ButtonBase>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default WalletAccountEditDialog;
