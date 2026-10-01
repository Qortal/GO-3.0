import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, useTheme } from '@mui/material';
import { getDialogPaperSx } from '../App/dialogSurface';
import {
  acknowledgeVendorFreezeHint,
  fetchBackgroundSyncState,
  isNativeAndroid,
  subscribeBackgroundSyncEvents,
} from './backgroundSync';
import { VendorFreezeNotice } from './MobileBackgroundSyncSetting';

type Props = {
  /** Another prompt is on screen; show the hint after it closes. */
  suspended?: boolean;
};

/**
 * One-time vendor-freeze hint, app-wide (native Android only). The native
 * side records a freeze and keeps the hint pending until it is acknowledged;
 * this reads that flag on start and on every return to GO, and listens for
 * the live event, so the user sees it without opening notification settings.
 * No polling: one native read per resume.
 */
export const VendorFreezeHintDialog = ({ suspended = false }: Props) => {
  const theme = useTheme();
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [manufacturer, setManufacturer] = useState<string | null>(null);
  // A read already in flight must not reopen a hint dismissed meanwhile.
  const readStampRef = useRef(0);

  const refresh = useCallback(async () => {
    const stamp = ++readStampRef.current;
    const state = await fetchBackgroundSyncState();
    if (!state || stamp !== readStampRef.current) return;
    setManufacturer(state.manufacturer);
    setPending(state.vendorFreezeHintPending);
  }, []);

  useEffect(() => {
    if (!isNativeAndroid()) return undefined;
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = subscribeBackgroundSyncEvents({
      onVendorFreezeDetected: (event) => {
        readStampRef.current += 1;
        if (event.manufacturer) setManufacturer(event.manufacturer);
        setPending(true);
      },
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [refresh]);

  const dismiss = useCallback(() => {
    readStampRef.current += 1;
    setPending(false);
    void acknowledgeVendorFreezeHint();
  }, []);

  return (
    <Dialog
      aria-labelledby={titleId}
      fullWidth
      maxWidth="xs"
      onClose={dismiss}
      open={pending && !suspended}
      PaperProps={{
        sx: getDialogPaperSx(theme, { maxWidth: 420, radius: 20 }),
      }}
    >
      <DialogContent sx={{ '&&': { p: 1.5 } }}>
        <VendorFreezeNotice
          manufacturer={manufacturer}
          onDismiss={dismiss}
          titleId={titleId}
        />
      </DialogContent>
    </Dialog>
  );
};

export default VendorFreezeHintDialog;
