import { Box, Button, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useTranslation } from 'react-i18next';

export type MobileCallLockCoverProps = {
  zIndex: number;
  /** Android's own unlock prompt, when the native session offers it. */
  onUnlock?: () => void;
  /**
   * A call view is drawn on top: only the opaque backdrop (hidden from
   * TalkBack), so nothing of GO shows while the call view fades in or out.
   */
  backdrop?: boolean;
};

/**
 * While GO is shown over the phone's lock screen for a call, nothing but the
 * call may be visible. It lies under the call views, and between them (the
 * ring just ended, a call just hung up, GO just opened from a ring) Android
 * keeps GO over the lock for a few seconds: this opaque cover hides the
 * wallet and chats until the phone is unlocked.
 */
export function MobileCallLockCover({
  zIndex,
  onUnlock,
  backdrop = false,
}: MobileCallLockCoverProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  if (backdrop) {
    return (
      <Box
        aria-hidden="true"
        data-testid="call-lock-backdrop"
        sx={{
          backgroundColor: theme.palette.background.default,
          inset: 0,
          position: 'fixed',
          zIndex,
        }}
      />
    );
  }
  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={t('core:go_call.unlock_phone')}
      data-testid="call-lock-cover"
      sx={{
        alignItems: 'center',
        backgroundColor: theme.palette.background.default,
        color: theme.palette.text.primary,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        inset: 0,
        justifyContent: 'center',
        position: 'fixed',
        px: 4,
        textAlign: 'center',
        zIndex,
      }}
    >
      <LockRoundedIcon
        sx={{ color: alpha(theme.palette.text.primary, 0.6), fontSize: 44 }}
      />
      <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
        {t('core:go_call.unlock_phone')}
      </Typography>
      {onUnlock ? (
        <Button variant="contained" onClick={onUnlock} sx={{ minHeight: 48 }}>
          {t('core:go_call.unlock')}
        </Button>
      ) : null}
    </Box>
  );
}
