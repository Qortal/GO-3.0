import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAcceptDelay } from '../../hooks/useAcceptDelay';
import { useSecureScreen } from '../../hooks/useSecureScreen';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { DECLINE_GUARD_MS } from '../../utils/qappApprovalQueue';

/**
 * Above every screen and sheet; below the Q-App approval dialog
 * (BACK_PRIORITY.call + 10), which is drawn over this one.
 */
const PAYMENT_PUBLISH_BACK_PRIORITY = BACK_PRIORITY.call + 5;

type Message = {
  message: string;
  paymentFee?: string;
  publishFee?: string;
};

type PaymentPublishDialogProps = {
  open: boolean;
  /** The id of the request on screen (useModal); restarts the Accept delay. */
  requestId?: number | null;
  /** How many more confirmations wait behind this one. */
  pendingCount?: number;
  message: Message;
  onAccept: () => void;
  onCancel: () => void;
};

/**
 * GO's own payment / publish confirmation (GO-28 / GO-29): Accept waits a
 * second after a request appears, and while open the screen cannot be
 * captured and taps through another app's overlay are dropped. The Android
 * back button declines it (ignored for a moment after a confirmation
 * appears, so a double press cannot decline the next one).
 */
export function PaymentPublishDialog({
  open,
  requestId = null,
  pendingCount = 0,
  message,
  onAccept,
  onCancel,
}: PaymentPublishDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  useSecureScreen({ secure: open, touchProtection: open });
  const acceptArmed = useAcceptDelay(open, requestId ?? message);
  const backArmed = useAcceptDelay(
    open,
    requestId ?? message,
    DECLINE_GUARD_MS
  );
  useAndroidBack(
    () => {
      if (backArmed) onCancel();
      return true;
    },
    { priority: PAYMENT_PUBLISH_BACK_PRIORITY, enabled: open }
  );

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      PaperProps={{
        sx: {
          background: theme.palette.background.paper,
          backgroundImage: 'none',
          border: `1px solid ${theme.palette.border.main}`,
          borderRadius: '18px',
          boxShadow: '0 26px 56px rgba(0,0,0,0.44)',
          color: theme.palette.text.primary,
          minWidth: 360,
          overflow: 'hidden',
        },
      }}
      sx={{ zIndex: 10001 }}
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          borderBottom: `1px solid ${theme.palette.divider}`,
          color: theme.palette.text.primary,
          fontSize: '1.04rem',
          fontWeight: 650,
          px: 3,
          py: 2,
          textAlign: 'left',
        }}
      >
        {message.paymentFee
          ? t('core:payment', { postProcess: 'capitalizeFirstChar' })
          : t('core:publish', { postProcess: 'capitalizeFirstChar' })}
      </DialogTitle>
      <DialogContent
        sx={{
          px: 3,
          pb: 2.65,
          '&&': {
            pt: 2.75,
          },
        }}
      >
        <DialogContentText
          id="alert-dialog-description"
          sx={{
            color: theme.palette.text.primary,
            fontSize: '1rem',
            lineHeight: 1.6,
            mb: message?.paymentFee || message?.publishFee ? 1.65 : 0,
            // The message carries a full 34-character address.
            overflowWrap: 'anywhere',
            textAlign: 'left',
          }}
        >
          {message.message}
        </DialogContentText>
        {(message?.paymentFee || message?.publishFee) && (
          <Box
            sx={{
              backgroundColor: theme.palette.action.hover,
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '12px',
              display: 'grid',
              gap: 0.55,
              px: 1.45,
              py: 1.2,
            }}
          >
            <DialogContentText
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.78rem',
                fontWeight: 650,
                letterSpacing: '0.02em',
                lineHeight: 1.35,
                m: 0,
                textTransform: 'uppercase',
              }}
            >
              {message?.paymentFee
                ? t('core:fee.payment', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:fee.publish', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </DialogContentText>
            <DialogContentText
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.96rem',
                fontWeight: 700,
                lineHeight: 1.45,
                m: 0,
              }}
            >
              {message?.paymentFee || message.publishFee}
            </DialogContentText>
          </Box>
        )}
        {pendingCount > 0 ? (
          <DialogContentText
            data-testid="payment-publish-pending"
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.84rem',
              lineHeight: 1.4,
              mt: 1.4,
              textAlign: 'left',
            }}
          >
            {t('core:approval_dialog.more_waiting', { count: pendingCount })}
          </DialogContentText>
        ) : null}
      </DialogContent>
      <DialogActions
        sx={{
          borderTop: `1px solid ${theme.palette.divider}`,
          gap: 1.2,
          justifyContent: 'center',
          px: 3,
          py: 1.8,
        }}
      >
        <Button
          sx={{
            backgroundColor: theme.palette.action.hover,
            border: `1px solid ${theme.palette.border.main}`,
            borderRadius: '11px',
            color: theme.palette.text.primary,
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            '&:hover': {
              backgroundColor: theme.palette.action.selected,
              borderColor: theme.palette.text.secondary,
            },
          }}
          variant="outlined"
          onClick={onCancel}
        >
          {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          sx={{
            backgroundColor: theme.palette.primary.main,
            borderRadius: '11px',
            color: '#FFFFFF',
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            textTransform: 'none',
            '&:hover': {
              backgroundColor: theme.palette.primary.main,
              filter: 'brightness(1.05)',
            },
            '&.Mui-disabled': {
              backgroundColor: theme.palette.primary.main,
              color: '#FFFFFF',
              opacity: 0.45,
            },
          }}
          variant="contained"
          // No autoFocus: Enter must not confirm a payment the moment it
          // appears.
          disabled={!acceptArmed}
          data-testid="payment-publish-accept"
          onClick={() => {
            if (acceptArmed) onAccept();
          }}
        >
          {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
