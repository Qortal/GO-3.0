import {
  Box,
  Dialog,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import { useTranslation } from 'react-i18next';
import { AuthButton } from '../Auth/AuthShell';
import { QMinterWebsiteIcon } from './QMinterWebsiteIcon';
import {
  openQMinterWebsite,
  Q_MINTER_WEBSITE_LINK,
} from '../../utils/openQMinterWebsite';

type MintingPublicNodeDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function MintingPublicNodeDialog({
  open,
  onClose,
}: MintingPublicNodeDialogProps) {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = useTranslation(['core']);

  const handleOpenQMinter = () => {
    openQMinterWebsite();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      PaperProps={{
        sx: {
          borderRadius: '18px',
          mx: 1.5,
        },
      }}
    >
      <Box sx={{ px: 2.2, pt: 2, pb: 2.4 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            mb: 1.5,
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.1 }}>
            <Box
              sx={{
                alignItems: 'center',
                background: alpha(theme.palette.warning.main, 0.14),
                borderRadius: '12px',
                color: theme.palette.warning.main,
                display: 'flex',
                height: 42,
                justifyContent: 'center',
                width: 42,
              }}
            >
              <SavingsRoundedIcon />
            </Box>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {t('core:minting.public_node_dialog.title', {
                defaultValue: 'Minting requires a private node',
              })}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" aria-label="Close">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>

        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.88rem',
            lineHeight: 1.55,
            mb: 2,
          }}
        >
          {t('core:minting.public_node_dialog.body', {
            defaultValue:
              'Minting is only available when connected to your own private node. You are currently on a public node. Open Q-Minter to read the detailed guide on becoming a minter.',
          })}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.9 }}>
          <AuthButton onClick={handleOpenQMinter} primary fullWidth>
            <Box
              sx={{
                alignItems: 'center',
                display: 'inline-flex',
                gap: 0.85,
                justifyContent: 'center',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  bgcolor: alpha(theme.palette.common.white, 0.14),
                  borderRadius: '50%',
                  display: 'inline-flex',
                  flexShrink: 0,
                  height: 24,
                  justifyContent: 'center',
                  overflow: 'hidden',
                  width: 24,
                }}
              >
                <QMinterWebsiteIcon size={24} />
              </Box>
              {t('core:minting.public_node_dialog.open_q_minter', {
                defaultValue: 'Open Q-Minter guide',
              })}
            </Box>
          </AuthButton>
          <AuthButton onClick={onClose} primary={false} fullWidth>
            {t('core:action.close', { defaultValue: 'Close' })}
          </AuthButton>
        </Box>

        <Typography
          sx={{
            color: isLight
              ? theme.palette.text.secondary
              : alpha(theme.palette.text.secondary, 0.72),
            fontSize: '0.72rem',
            lineHeight: 1.45,
            mt: 1.5,
            textAlign: 'center',
          }}
        >
          {Q_MINTER_WEBSITE_LINK}
        </Typography>
      </Box>
    </Dialog>
  );
}
